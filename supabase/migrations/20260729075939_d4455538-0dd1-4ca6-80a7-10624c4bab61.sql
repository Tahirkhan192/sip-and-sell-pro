ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS katha_category text NOT NULL DEFAULT 'transaction';
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_katha_category_chk;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_katha_category_chk CHECK (katha_category IN ('transaction','katha','loan_paid'));

ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_payment_status_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_payment_status_check CHECK (payment_status IN ('paid','unpaid','katha'));

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_status_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_status_check CHECK (payment_status IN ('paid','unpaid','partial','katha'));

CREATE OR REPLACE FUNCTION public.digi_katha_summary(_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prev_get numeric := 0; v_prev_give numeric := 0;
  v_katha_sales numeric := 0; v_loan_given numeric := 0; v_loan_recovered numeric := 0;
  v_pur_katha numeric := 0; v_exp_katha numeric := 0; v_loan_taken numeric := 0; v_loan_repaid numeric := 0;
  v_p_sales numeric := 0; v_p_given numeric := 0; v_p_recovered numeric := 0;
  v_p_pur numeric := 0; v_p_exp numeric := 0; v_p_taken numeric := 0; v_p_repaid numeric := 0;
BEGIN
  -- previous (strictly before _date)
  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_p_sales
    FROM public.sales WHERE deleted_at IS NULL AND status='completed' AND katha
      AND public.business_date_of(sale_date) < _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_out' THEN amount END),0)
  INTO v_p_given, v_p_recovered, v_p_taken, v_p_repaid
  FROM public.cash_movements WHERE deleted_at IS NULL AND business_date < _date;
  SELECT COALESCE(SUM(grand_total),0) INTO v_p_pur FROM public.purchases
    WHERE deleted_at IS NULL AND payment_status='katha' AND date < _date;
  SELECT COALESCE(SUM(amount),0) INTO v_p_exp FROM public.expenses
    WHERE deleted_at IS NULL AND payment_status='katha' AND date < _date;

  v_prev_get  := v_p_sales + v_p_given - v_p_recovered;
  v_prev_give := v_p_pur + v_p_exp + v_p_taken - v_p_repaid;

  -- today
  SELECT COALESCE(SUM(GREATEST(grand_total - cash_paid - online_paid, 0)),0) INTO v_katha_sales
    FROM public.sales WHERE deleted_at IS NULL AND status='completed' AND katha
      AND public.business_date_of(sale_date) = _date;
  SELECT
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_out' THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='loan_paid' AND type='cash_in'  THEN amount END),0),
    COALESCE(SUM(CASE WHEN katha_category='katha'     AND type='cash_in'  THEN amount END),0),
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
END $$;

GRANT EXECUTE ON FUNCTION public.digi_katha_summary(date) TO authenticated;