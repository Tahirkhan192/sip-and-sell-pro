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
`;
