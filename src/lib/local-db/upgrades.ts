/**
 * Local database upgrades.
 *
 * Runs on every start, on both fresh and existing local databases, so an app
 * that was installed before a feature shipped still gets the new columns and
 * functions without losing a single saved row. Every statement is idempotent.
 */

import SALE_RULES_SQL from "./sale-rules.sql?raw";

/**
 * The bill-saving rules (create bill, edit bill, stock effect of a line).
 * A local database only runs the installation script once, so a computer set
 * up before an update keeps the older rules forever. Re-applying them on every
 * start is what stops an edited bill from gaining a second copy of its lines
 * and from staying on "pending" after it was completed.
 */
export const LOCAL_SALE_RULES_SQL = SALE_RULES_SQL;

/**
 * One-time repair for bills that already grew a second (or third) copy of the
 * same product. Only the first line of each product is kept — with its original
 * quantity, never the sum — and the bill total is recalculated from the lines
 * that remain. Discount and delivery charges are preserved.
 */
export const DEDUPE_SALE_ITEMS_SQL = `
DROP TABLE IF EXISTS pg_temp.kdf_dup_sales;

CREATE TEMP TABLE kdf_dup_sales AS
WITH ranked AS (
  SELECT ctid AS rid, sale_id,
         row_number() OVER (PARTITION BY sale_id, product_id
                            ORDER BY ctid ASC) AS rn
    FROM public.sale_items
)
SELECT DISTINCT sale_id FROM ranked WHERE rn > 1;

WITH ranked AS (
  SELECT ctid AS rid,
         row_number() OVER (PARTITION BY sale_id, product_id
                            ORDER BY ctid ASC) AS rn
    FROM public.sale_items
)
DELETE FROM public.sale_items si
 USING ranked r
 WHERE si.ctid = r.rid AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sale_items_sale_product_key
  ON public.sale_items (sale_id, product_id);

UPDATE public.sales s
   SET grand_total = GREATEST(
         COALESCE((SELECT SUM(i.total) FROM public.sale_items i WHERE i.sale_id = s.id), 0)
           - COALESCE(s.discount_amount, 0), 0)
         + COALESCE(s.delivery_charges, 0)
  FROM kdf_dup_sales d
 WHERE s.id = d.sale_id;

DROP TABLE IF EXISTS pg_temp.kdf_dup_sales;
`;

export const LOCAL_UPGRADE_SQL = `
-- Month-end stock lock: opening and closing records live in the same table and
-- are told apart by "kind", so a month keeps both figures permanently.
ALTER TABLE public.stock_opening_snapshots ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'opening';

DO $x$ BEGIN
  ALTER TABLE public.stock_opening_snapshots DROP CONSTRAINT stock_opening_snapshots_scope_item_id_year_month_key;
EXCEPTION WHEN undefined_object THEN NULL; WHEN undefined_table THEN NULL; END $x$;

DROP INDEX IF EXISTS public.stock_opening_snapshots_scope_item_id_year_month_key;
DROP INDEX IF EXISTS public.ux_stock_snapshot;

CREATE UNIQUE INDEX IF NOT EXISTS stock_snapshot_scope_item_year_month_kind_key
  ON public.stock_opening_snapshots (scope, item_id, year, month, kind);

CREATE OR REPLACE FUNCTION public.lock_month_opening(_year integer, _month integer, _rows jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_prev_year integer;
  v_prev_month integer;
  v_count integer := 0;
BEGIN
  IF _month < 1 OR _month > 12 THEN RAISE EXCEPTION 'Invalid month'; END IF;
  v_prev_year := CASE WHEN _month = 1 THEN _year - 1 ELSE _year END;
  v_prev_month := CASE WHEN _month = 1 THEN 12 ELSE _month - 1 END;

  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, _year, _month, 'opening', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, kind, quantity, unit_value)
  SELECT r.scope, r.item_id, v_prev_year, v_prev_month, 'closing', r.quantity, r.unit_value
  FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
  WHERE r.scope IN ('product','stock_item') AND r.item_id IS NOT NULL
  ON CONFLICT (scope, item_id, year, month, kind)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  IF (_year, _month) = (EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int) THEN
    UPDATE public.products p
      SET opening_stock = r.quantity
      FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
      WHERE r.scope = 'product' AND p.id = r.item_id AND p.deleted_at IS NULL;
    UPDATE public.stock_items s
      SET opening_stock = r.quantity, updated_at = now()
      FROM jsonb_to_recordset(_rows) AS r(scope text, item_id uuid, quantity numeric, unit_value numeric)
      WHERE r.scope = 'stock_item' AND s.id = r.item_id AND s.deleted_at IS NULL;
  END IF;

  RETURN v_count;
END $function$;

-- Staff invoices: an app installed before staff bills shipped has no staff
-- column, no balance function and no trigger, so the link silently fails.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS staff_id uuid;

CREATE OR REPLACE FUNCTION public.recompute_staff_katha(_staff_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE v_buy numeric; v_pay numeric;
BEGIN
  IF _staff_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_buy
    FROM public.sales
    WHERE staff_id = _staff_id AND deleted_at IS NULL AND NOT hidden AND status='completed' AND katha;
  SELECT COALESCE(SUM(amount),0) INTO v_pay
    FROM public.staff_payments WHERE staff_id = _staff_id AND kind = 'katha_receipt';
  UPDATE public.staff
     SET katha_balance = round(COALESCE(opening_katha,0) + v_buy - v_pay, 2), updated_at = now()
   WHERE id = _staff_id;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_sale_staff_katha()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.staff_id IS NOT NULL THEN
    PERFORM public.recompute_staff_katha(OLD.staff_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.staff_id IS NOT NULL THEN
    PERFORM public.recompute_staff_katha(NEW.staff_id);
  END IF;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_sale_staff_katha ON public.sales;
CREATE TRIGGER trg_sale_staff_katha AFTER INSERT OR DELETE OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_sale_staff_katha();

-- Digi Katha: the fixed opening balance is the position at the start of its own
-- date, so katha entries dated before that date must not be counted again.
CREATE OR REPLACE FUNCTION public.digi_katha_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_get numeric := 0; v_prev_give numeric := 0;
  v_katha_sales numeric := 0; v_loan_given numeric := 0; v_loan_recovered numeric := 0;
  v_pur_katha numeric := 0; v_exp_katha numeric := 0; v_loan_taken numeric := 0; v_loan_repaid numeric := 0;
  v_p_sales numeric := 0; v_p_given numeric := 0; v_p_recovered numeric := 0;
  v_p_pur numeric := 0; v_p_exp numeric := 0; v_p_taken numeric := 0; v_p_repaid numeric := 0;
  v_open_get numeric := 0; v_open_give numeric := 0; v_from date;
BEGIN
  SELECT COALESCE(opening_loan_to_get,0), COALESCE(opening_loan_to_give,0), as_of_date
    INTO v_open_get, v_open_give, v_from FROM public.katha_opening WHERE id = 1;
  v_open_get := COALESCE(v_open_get,0); v_open_give := COALESCE(v_open_give,0);
  v_from := COALESCE(v_from, '1900-01-01'::date);

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_p_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
      AND public.business_date_of(sale_date) >= v_from
      AND public.business_date_of(sale_date) < _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_p_given, v_p_recovered, v_p_taken, v_p_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date >= v_from AND business_date < _date;
  SELECT COALESCE(SUM(grand_total),0) INTO v_p_pur FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date >= v_from AND date < _date;
  SELECT COALESCE(SUM(amount),0) INTO v_p_exp FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date >= v_from AND date < _date;

  v_prev_get  := v_open_get + v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_open_give + v_p_pur + v_p_exp + v_p_taken - v_p_repaid;

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_katha_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
      AND public.business_date_of(sale_date) = _date AND _date >= v_from;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_loan_given, v_loan_recovered, v_loan_taken, v_loan_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(grand_total),0) INTO v_pur_katha FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(amount),0) INTO v_exp_katha FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date AND _date >= v_from;

  RETURN jsonb_build_object(
    'business_date', _date,
    'opening_loan_to_get', v_open_get,
    'opening_loan_to_give', v_open_give,
    'previous_loan_to_get', v_prev_get,
    'previous_loan_to_give', v_prev_give,
    'katha_sales', v_katha_sales,
    'loan_given', v_loan_given,
    'loan_recovered', v_loan_recovered,
    'purchase_katha', v_pur_katha,
    'expense_katha', v_exp_katha,
    'loan_taken', v_loan_taken,
    'loan_repaid', v_loan_repaid,
    'expected_loan_to_get', v_prev_get + v_katha_sales + v_loan_given - v_loan_recovered,
    'expected_loan_to_give', v_prev_give + v_pur_katha + v_exp_katha + v_loan_taken - v_loan_repaid
  );
END $function$;
`;
