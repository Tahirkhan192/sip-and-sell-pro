CREATE OR REPLACE FUNCTION public.staff_salary_summary(_month date)
RETURNS TABLE(staff_id uuid, name text, monthly_salary numeric, present_days integer, absent_days integer, deduction numeric, advance_taken numeric, salary_paid numeric, katha_purchases numeric, carry_in numeric, prev_remaining numeric, prev_advance numeric, payment_this_month numeric, katha_this_month numeric, remaining_salary numeric, katha_balance numeric)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_target date := date_trunc('month', _month)::date;
  s RECORD; m date; v_carry numeric; v_daily numeric;
  v_present int; v_absent int; v_ded numeric; v_adv numeric; v_paid numeric;
  v_katha_buy numeric; v_katha_pay numeric; v_katha_net numeric;
  v_carry_in numeric; v_manual RECORD;
  v_start date; v_end date; v_elapsed int; v_today date;
BEGIN
  v_today := public.business_date(now());
  FOR s IN SELECT * FROM public.staff WHERE deleted_at IS NULL ORDER BY name LOOP
    v_carry := 0;
    v_daily := COALESCE(s.monthly_salary,0) / 30.0;
    m := date_trunc('month', s.joining_date)::date;
    IF m > v_target THEN m := v_target; END IF;

    SELECT * INTO v_manual FROM public.staff_month_carry c
      WHERE c.staff_id = s.id
        AND c.year = EXTRACT(YEAR FROM v_target)::int
        AND c.month = EXTRACT(MONTH FROM v_target)::int;

    WHILE m <= v_target LOOP
      -- Absent days are the only manually recorded state; everything else counts as Present.
      SELECT COUNT(*) FILTER (WHERE status='absent')
        INTO v_absent
        FROM public.staff_attendance
        WHERE staff_attendance.staff_id = s.id AND date >= m AND date < (m + interval '1 month')::date;
      v_absent := COALESCE(v_absent, 0);

      v_start := GREATEST(m, s.joining_date);
      v_end := LEAST((m + interval '1 month')::date - 1, v_today);
      v_elapsed := GREATEST(0, (v_end - v_start) + 1);
      v_present := GREATEST(0, v_elapsed - v_absent);

      SELECT COALESCE(SUM(amount) FILTER (WHERE kind='advance'),0),
             COALESCE(SUM(amount) FILTER (WHERE kind='salary'),0),
             COALESCE(SUM(amount) FILTER (WHERE kind='katha_receipt'),0)
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
      v_ded := round(v_daily * v_absent, 2);

      IF m = v_target THEN
        v_carry_in := round(v_carry, 2);
        IF v_manual.id IS NOT NULL THEN
          v_carry_in := round(COALESCE(v_manual.prev_remaining,0) - COALESCE(v_manual.prev_advance,0), 2);
        END IF;
        staff_id := s.id; name := s.name; monthly_salary := COALESCE(s.monthly_salary,0);
        present_days := v_present; absent_days := v_absent;
        deduction := v_ded; advance_taken := v_adv; salary_paid := v_paid;
        katha_purchases := round(COALESCE(v_katha_buy,0), 2);
        carry_in := v_carry_in;
        prev_remaining := GREATEST(v_carry_in, 0);
        prev_advance := GREATEST(-v_carry_in, 0);
        payment_this_month := round(COALESCE(v_paid,0) + COALESCE(v_adv,0), 2);
        katha_this_month := round(v_katha_net, 2);
        remaining_salary := round(v_carry_in + COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv - v_katha_net, 2);
        katha_balance := COALESCE(s.katha_balance,0);
        RETURN NEXT;
      END IF;

      v_carry := v_carry + COALESCE(s.monthly_salary,0) - v_ded - v_paid - v_adv - v_katha_net;
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
END
$function$;