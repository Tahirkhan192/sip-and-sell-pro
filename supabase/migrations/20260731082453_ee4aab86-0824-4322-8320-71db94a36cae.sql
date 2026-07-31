-- ============ Digi Katha opening balance ============
CREATE TABLE IF NOT EXISTS public.katha_opening (
  id integer PRIMARY KEY DEFAULT 1,
  opening_loan_to_get numeric(14,2) NOT NULL DEFAULT 0,
  opening_loan_to_give numeric(14,2) NOT NULL DEFAULT 0,
  as_of_date date NOT NULL DEFAULT current_date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT katha_opening_singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.katha_opening TO authenticated;
GRANT ALL ON public.katha_opening TO service_role;
ALTER TABLE public.katha_opening ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "katha_opening_auth" ON public.katha_opening;
CREATE POLICY "katha_opening_auth" ON public.katha_opening FOR ALL TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.katha_opening (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
DROP TRIGGER IF EXISTS trg_katha_opening_updated ON public.katha_opening;
CREATE TRIGGER trg_katha_opening_updated BEFORE UPDATE ON public.katha_opening
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ Staff ============
CREATE TABLE IF NOT EXISTS public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  father_name text,
  phone text,
  cnic text,
  joining_date date NOT NULL DEFAULT current_date,
  monthly_salary numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  notes text,
  opening_katha numeric(14,2) NOT NULL DEFAULT 0,
  katha_balance numeric(14,2) NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_status_chk CHECK (status IN ('active','inactive'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_auth" ON public.staff;
CREATE POLICY "staff_auth" ON public.staff FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_staff_updated ON public.staff;
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_attendance_status_chk CHECK (status IN ('present','absent')),
  CONSTRAINT staff_attendance_uniq UNIQUE (staff_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_attendance TO authenticated;
GRANT ALL ON public.staff_attendance TO service_role;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_attendance_auth" ON public.staff_attendance;
CREATE POLICY "staff_attendance_auth" ON public.staff_attendance FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_staff_attendance_updated ON public.staff_attendance;
CREATE TRIGGER trg_staff_attendance_updated BEFORE UPDATE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.staff_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  remark text,
  date date NOT NULL DEFAULT current_date,
  cash_movement_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_payments_kind_chk CHECK (kind IN ('salary','advance','katha_receipt')),
  CONSTRAINT staff_payments_method_chk CHECK (payment_method IN ('cash','online'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_payments TO authenticated;
GRANT ALL ON public.staff_payments TO service_role;
ALTER TABLE public.staff_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff_payments_auth" ON public.staff_payments;
CREATE POLICY "staff_payments_auth" ON public.staff_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_staff_payments_staff_date ON public.staff_payments(staff_id, date);

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff(id);
CREATE INDEX IF NOT EXISTS idx_sales_staff_id ON public.sales(staff_id);

-- ============ Staff RPCs ============
CREATE OR REPLACE FUNCTION public.staff_pay(_staff_id uuid, _kind text, _amount numeric, _method text, _remark text DEFAULT NULL, _date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_staff public.staff; v_mv uuid; v_id uuid;
  v_date date := COALESCE(_date, public.business_date_of(now()));
  v_cat text; v_type text; v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero'; END IF;
  IF _kind NOT IN ('salary','advance','katha_receipt') THEN RAISE EXCEPTION 'Invalid payment kind'; END IF;
  IF _method NOT IN ('cash','online') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  SELECT * INTO v_staff FROM public.staff WHERE id = _staff_id AND deleted_at IS NULL;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Staff member not found'; END IF;

  v_cat := CASE _kind WHEN 'salary' THEN 'Staff Salary' WHEN 'advance' THEN 'Staff Salary Advance' ELSE 'Staff Katha Payment' END;
  v_type := CASE WHEN _kind = 'katha_receipt' THEN 'cash_in' ELSE 'cash_out' END;

  INSERT INTO public.cash_movements (business_date, occurred_at, type, payment_source, amount, movement_category, katha_category, reason, notes, reference_type, reference_id)
  VALUES (v_date, v_now, v_type, _method, _amount, v_cat, 'transaction',
          v_cat || ' — ' || v_staff.name, _remark, 'staff', _staff_id)
  RETURNING id INTO v_mv;

  INSERT INTO public.staff_payments (staff_id, kind, amount, payment_method, remark, date, cash_movement_id, created_by)
  VALUES (_staff_id, _kind, _amount, _method, NULLIF(trim(_remark),''), v_date, v_mv, auth.uid())
  RETURNING id INTO v_id;

  IF _kind = 'katha_receipt' THEN
    UPDATE public.staff SET katha_balance = katha_balance - _amount WHERE id = _staff_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_payment_delete(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.staff_payments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.staff_payments WHERE id = _payment_id;
  IF r IS NULL THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF r.cash_movement_id IS NOT NULL THEN
    UPDATE public.cash_movements SET deleted_at = now() WHERE id = r.cash_movement_id AND deleted_at IS NULL;
  END IF;
  IF r.kind = 'katha_receipt' THEN
    UPDATE public.staff SET katha_balance = katha_balance + r.amount WHERE id = r.staff_id;
  END IF;
  DELETE FROM public.staff_payments WHERE id = _payment_id;
END $$;

CREATE OR REPLACE FUNCTION public.staff_salary_summary(_month date)
RETURNS TABLE(
  staff_id uuid, name text, monthly_salary numeric, present_days integer, absent_days integer,
  deduction numeric, advance_taken numeric, salary_paid numeric, carry_in numeric,
  remaining_salary numeric, katha_balance numeric
) LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_target date := date_trunc('month', _month)::date;
  s RECORD; m date; v_carry numeric; v_daily numeric;
  v_present int; v_absent int; v_ded numeric; v_adv numeric; v_paid numeric;
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
      SELECT COALESCE(SUM(amount) FILTER (WHERE kind='advance'),0), COALESCE(SUM(amount) FILTER (WHERE kind='salary'),0)
        INTO v_adv, v_paid
        FROM public.staff_payments
        WHERE staff_payments.staff_id = s.id AND date >= m AND date < (m + interval '1 month')::date;
      v_ded := round(v_daily * COALESCE(v_absent,0), 2);
      v_carry := v_carry + COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv;
      IF m = v_target THEN
        staff_id := s.id; name := s.name; monthly_salary := COALESCE(s.monthly_salary,0);
        present_days := COALESCE(v_present,0); absent_days := COALESCE(v_absent,0);
        deduction := v_ded; advance_taken := v_adv; salary_paid := v_paid;
        carry_in := round(v_carry - (COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv), 2);
        remaining_salary := round(v_carry, 2);
        katha_balance := COALESCE(s.katha_balance,0);
        RETURN NEXT;
      END IF;
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
END $$;

-- ============ Digi Katha summary with opening balance ============
CREATE OR REPLACE FUNCTION public.digi_katha_summary(_date date)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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