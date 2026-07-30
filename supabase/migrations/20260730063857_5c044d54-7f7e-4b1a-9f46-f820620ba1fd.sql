ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_katha_category_chk;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_katha_category_chk
  CHECK (katha_category = ANY (ARRAY['transaction'::text,'katha'::text,'loan_get'::text,'loan_paid'::text]));

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS sales_hidden_idx ON public.sales (hidden);

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
BEGIN
  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_p_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND public.business_date_of(sale_date) < _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_p_given, v_p_recovered, v_p_taken, v_p_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date < _date;
  SELECT COALESCE(SUM(grand_total),0) INTO v_p_pur FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date < _date;
  SELECT COALESCE(SUM(amount),0) INTO v_p_exp FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date < _date;

  v_prev_get  := v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_p_pur + v_p_exp + v_p_taken - v_p_repaid;

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_katha_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND public.business_date_of(sale_date) = _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_get'  AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_loan_given, v_loan_recovered, v_loan_taken, v_loan_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date = _date;
  SELECT COALESCE(SUM(grand_total),0) INTO v_pur_katha FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date;
  SELECT COALESCE(SUM(amount),0) INTO v_exp_katha FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date = _date;

  RETURN jsonb_build_object(
    'business_date', _date,
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

CREATE OR REPLACE FUNCTION public.daily_closing_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev public.daily_closings%ROWTYPE;
  v_curr public.daily_closings%ROWTYPE;
  v_opening_cash numeric := 0;
  v_opening_wallet numeric := 0;
  v_cash_sales numeric := 0;
  v_online_sales numeric := 0;
  v_katha numeric := 0;
  v_cash_in numeric := 0;
  v_cash_out numeric := 0;
  v_online_in numeric := 0;
  v_online_out numeric := 0;
  v_cash_exp numeric := 0;
  v_online_exp numeric := 0;
  v_invoices int := 0;
BEGIN
  SELECT * INTO v_prev FROM public.daily_closings
   WHERE closing_date < _date ORDER BY closing_date DESC LIMIT 1;
  IF FOUND THEN
    v_opening_cash := v_prev.actual_cash;
    v_opening_wallet := v_prev.actual_wallet;
  END IF;

  SELECT
    COALESCE(SUM(cash_paid),0),
    COALESCE(SUM(online_paid),0),
    COALESCE(SUM(CASE WHEN katha THEN GREATEST(grand_total - cash_paid - online_paid, 0) ELSE 0 END),0),
    COUNT(*)
  INTO v_cash_sales, v_online_sales, v_katha, v_invoices
  FROM public.sales
  WHERE deleted_at IS NULL AND NOT hidden AND status = 'completed'
    AND public.business_date_of(sale_date) = _date;

  SELECT
    COALESCE(SUM(CASE WHEN type='cash_in'  AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND COALESCE(payment_source,'cash')='cash'   THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_in'  AND payment_source='online' THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' AND payment_source='online' THEN amount END),0)
  INTO v_cash_in, v_cash_out, v_online_in, v_online_out
  FROM public.cash_movements
  WHERE deleted_at IS NULL AND business_date = _date;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='cash'   AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0),
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'')='online' AND COALESCE(payment_status,'paid')='paid' AND NOT COALESCE(is_stock_transfer,false) THEN amount END),0)
  INTO v_cash_exp, v_online_exp
  FROM public.expenses
  WHERE deleted_at IS NULL AND date = _date;

  v_cash_exp := v_cash_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'cash'
  ), 0);
  v_online_exp := v_online_exp + COALESCE((
    SELECT SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0))
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND date = _date
      AND payment_status = 'paid' AND payment_method = 'online'
  ), 0);

  SELECT * INTO v_curr FROM public.daily_closings WHERE closing_date = _date;

  RETURN jsonb_build_object(
    'closing_date', _date,
    'opening_cash', v_opening_cash,
    'opening_wallet', v_opening_wallet,
    'cash_sales', v_cash_sales,
    'online_sales', v_online_sales,
    'katha', v_katha,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'online_in', v_online_in,
    'online_out', v_online_out,
    'cash_expenses', v_cash_exp,
    'online_expenses', v_online_exp,
    'invoices', v_invoices,
    'expected_cash',   v_opening_cash   + v_cash_sales   + v_cash_in   - v_cash_out   - v_cash_exp,
    'expected_wallet', v_opening_wallet + v_online_sales + v_online_in - v_online_out - v_online_exp,
    'actual_cash',   CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_cash   ELSE NULL END,
    'actual_wallet', CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_wallet ELSE NULL END,
    'closed', v_curr.id IS NOT NULL,
    'notes', v_curr.notes
  );
END; $function$;