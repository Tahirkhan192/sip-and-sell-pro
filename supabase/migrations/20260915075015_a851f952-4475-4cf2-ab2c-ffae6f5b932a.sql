CREATE OR REPLACE FUNCTION public.digi_katha_summary(_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_get numeric := 0; v_prev_give numeric := 0;
  v_katha_sales numeric := 0; v_loan_given numeric := 0; v_loan_recovered numeric := 0;
  v_pur_katha numeric := 0; v_exp_katha numeric := 0; v_del_katha numeric := 0;
  v_loan_taken numeric := 0; v_loan_repaid numeric := 0;
  v_p_sales numeric := 0; v_p_given numeric := 0; v_p_recovered numeric := 0;
  v_p_pur numeric := 0; v_p_exp numeric := 0; v_p_del numeric := 0; v_p_taken numeric := 0; v_p_repaid numeric := 0;
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
    WHERE deleted_at IS NULL AND payment_status='katha' AND COALESCE(is_stock_transfer,false) = false
      AND date >= v_from AND date < _date;
  SELECT COALESCE(SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0)),0) INTO v_p_del
    FROM public.delivery_expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date >= v_from AND date < _date;

  v_prev_get  := v_open_get + v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_open_give + v_p_pur + v_p_exp + v_p_del + v_p_taken - v_p_repaid;

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
    WHERE deleted_at IS NULL AND payment_status='katha' AND COALESCE(is_stock_transfer,false) = false
      AND date = _date AND _date >= v_from;
  SELECT COALESCE(SUM(COALESCE(fuel_cost,0) + COALESCE(maintenance_cost,0)),0) INTO v_del_katha
    FROM public.delivery_expenses
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
    'delivery_expense_katha', v_del_katha,
    'loan_taken', v_loan_taken,
    'loan_repaid', v_loan_repaid,
    'expected_loan_to_get', v_prev_get + v_katha_sales + v_loan_given - v_loan_recovered,
    'expected_loan_to_give', v_prev_give + v_pur_katha + v_exp_katha + v_del_katha + v_loan_taken - v_loan_repaid
  );
END $function$;