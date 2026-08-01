ALTER TABLE public.products ADD COLUMN IF NOT EXISTS avg_price_override numeric;
ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS avg_price_override numeric;

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
  v_open_get numeric := 0; v_open_give numeric := 0;
BEGIN
  SELECT COALESCE(opening_loan_to_get,0), COALESCE(opening_loan_to_give,0)
    INTO v_open_get, v_open_give FROM public.katha_opening WHERE id = 1;
  v_open_get := COALESCE(v_open_get,0); v_open_give := COALESCE(v_open_give,0);

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_p_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
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

  v_prev_get  := v_open_get + v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_open_give + v_p_pur + v_p_exp + v_p_taken - v_p_repaid;

  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_katha_sales
    FROM public.sales WHERE deleted_at IS NULL AND NOT hidden AND status='completed' AND katha
      AND staff_id IS NULL
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

DROP FUNCTION IF EXISTS public.staff_salary_summary(date);
CREATE OR REPLACE FUNCTION public.staff_salary_summary(_month date)
 RETURNS TABLE(staff_id uuid, name text, monthly_salary numeric, present_days integer, absent_days integer, deduction numeric, advance_taken numeric, salary_paid numeric, katha_purchases numeric, carry_in numeric, remaining_salary numeric, katha_balance numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target date := date_trunc('month', _month)::date;
  s RECORD; m date; v_carry numeric; v_daily numeric;
  v_present int; v_absent int; v_ded numeric; v_adv numeric; v_paid numeric;
  v_katha_buy numeric; v_katha_pay numeric; v_katha_net numeric;
BEGIN
  FOR s IN SELECT * FROM public.staff WHERE deleted_at IS NULL ORDER BY name LOOP
    v_carry := 0;
    v_daily := COALESCE(s.monthly_salary,0) / 30.0;
    m := date_trunc('month', s.joining_date)::date;
    IF m > v_target THEN m := v_target; END IF;
    WHILE m <= v_target LOOP
      SELECT COUNT(*) FILTER (WHERE status='present'), COUNT(*) FILTER (WHERE status='absent')
        INTO v_present, v_absent
        FROM public.staff_attendance
        WHERE staff_attendance.staff_id = s.id AND date >= m AND date < (m + interval '1 month')::date;
      SELECT COALESCE(SUM(amount) FILTER (WHERE kind='advance'),0),
             COALESCE(SUM(amount) FILTER (WHERE kind='salary'),0),
             COALESCE(SUM(amount) FILTER (WHERE kind='katha'),0)
        INTO v_adv, v_paid, v_katha_pay
        FROM public.staff_payments
        WHERE staff_payments.staff_id = s.id AND date >= m AND date < (m + interval '1 month')::date;
      SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0)
        INTO v_katha_buy
        FROM public.sales
        WHERE sales.staff_id = s.id AND deleted_at IS NULL AND NOT hidden
          AND status='completed' AND katha
          AND public.business_date_of(sale_date) >= m
          AND public.business_date_of(sale_date) < (m + interval '1 month')::date;
      v_katha_net := COALESCE(v_katha_buy,0) - COALESCE(v_katha_pay,0);
      v_ded := round(v_daily * COALESCE(v_absent,0), 2);
      v_carry := v_carry + COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv - v_katha_net;
      IF m = v_target THEN
        staff_id := s.id; name := s.name; monthly_salary := COALESCE(s.monthly_salary,0);
        present_days := COALESCE(v_present,0); absent_days := COALESCE(v_absent,0);
        deduction := v_ded; advance_taken := v_adv; salary_paid := v_paid;
        katha_purchases := round(COALESCE(v_katha_buy,0), 2);
        carry_in := round(v_carry - (COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv - v_katha_net), 2);
        remaining_salary := round(v_carry, 2);
        katha_balance := COALESCE(s.katha_balance,0);
        RETURN NEXT;
      END IF;
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
END $function$;