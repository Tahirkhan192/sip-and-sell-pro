-- 1. Settings: PIN lock config + staff invoice colour
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS pin_locks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS staff_invoice_color text NOT NULL DEFAULT '#DBEAFE';

-- 2. Per-period opening stock snapshots (historical months are locked)
CREATE TABLE IF NOT EXISTS public.stock_opening_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('product','stock_item')),
  item_id uuid NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  quantity numeric NOT NULL DEFAULT 0,
  unit_value numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, item_id, year, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_opening_snapshots TO authenticated;
GRANT ALL ON public.stock_opening_snapshots TO service_role;
ALTER TABLE public.stock_opening_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage stock_opening_snapshots" ON public.stock_opening_snapshots;
CREATE POLICY "auth manage stock_opening_snapshots" ON public.stock_opening_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_sos_updated_at ON public.stock_opening_snapshots;
CREATE TRIGGER trg_sos_updated_at BEFORE UPDATE ON public.stock_opening_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Snapshot current stock as the opening stock for ONE period only.
CREATE OR REPLACE FUNCTION public.set_opening_stock_for_period(_year integer, _month integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, quantity, unit_value)
  SELECT 'product', p.id, _year, _month, p.current_stock, COALESCE(p.avg_price_override, p.cost_price)
  FROM public.products p WHERE p.deleted_at IS NULL
  ON CONFLICT (scope, item_id, year, month)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  INSERT INTO public.stock_opening_snapshots (scope, item_id, year, month, quantity, unit_value)
  SELECT 'stock_item', s.id, _year, _month, s.current_stock, COALESCE(s.avg_price_override, s.purchase_price)
  FROM public.stock_items s WHERE s.deleted_at IS NULL
  ON CONFLICT (scope, item_id, year, month)
  DO UPDATE SET quantity = EXCLUDED.quantity, unit_value = EXCLUDED.unit_value, updated_at = now();

  -- Keep the live opening_stock column aligned only when snapshotting the current month.
  IF (_year, _month) = (EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM CURRENT_DATE)::int) THEN
    UPDATE public.products SET opening_stock = current_stock WHERE deleted_at IS NULL;
    UPDATE public.stock_items SET opening_stock = current_stock WHERE deleted_at IS NULL;
  END IF;
END $$;

-- 3. Staff month carry-forward (owner editable)
CREATE TABLE IF NOT EXISTS public.staff_month_carry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  prev_remaining numeric NOT NULL DEFAULT 0,
  prev_advance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, year, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_month_carry TO authenticated;
GRANT ALL ON public.staff_month_carry TO service_role;
ALTER TABLE public.staff_month_carry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage staff_month_carry" ON public.staff_month_carry;
CREATE POLICY "auth manage staff_month_carry" ON public.staff_month_carry
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_smc_updated_at ON public.staff_month_carry;
CREATE TRIGGER trg_smc_updated_at BEFORE UPDATE ON public.staff_month_carry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Salary summary with explicit previous-month remaining / advance
DROP FUNCTION IF EXISTS public.staff_salary_summary(date);
CREATE OR REPLACE FUNCTION public.staff_salary_summary(_month date)
RETURNS TABLE(
  staff_id uuid, name text, monthly_salary numeric, present_days integer, absent_days integer,
  deduction numeric, advance_taken numeric, salary_paid numeric, katha_purchases numeric,
  carry_in numeric, prev_remaining numeric, prev_advance numeric,
  payment_this_month numeric, katha_this_month numeric,
  remaining_salary numeric, katha_balance numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_target date := date_trunc('month', _month)::date;
  s RECORD; m date; v_carry numeric; v_daily numeric;
  v_present int; v_absent int; v_ded numeric; v_adv numeric; v_paid numeric;
  v_katha_buy numeric; v_katha_pay numeric; v_katha_net numeric;
  v_carry_in numeric; v_manual RECORD;
BEGIN
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
      SELECT COUNT(*) FILTER (WHERE status='present'), COUNT(*) FILTER (WHERE status='absent')
        INTO v_present, v_absent
        FROM public.staff_attendance
        WHERE staff_attendance.staff_id = s.id AND date >= m AND date < (m + interval '1 month')::date;
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
      v_ded := round(v_daily * COALESCE(v_absent,0), 2);

      IF m = v_target THEN
        v_carry_in := round(v_carry, 2);
        IF v_manual.id IS NOT NULL THEN
          v_carry_in := round(COALESCE(v_manual.prev_remaining,0) - COALESCE(v_manual.prev_advance,0), 2);
        END IF;
        staff_id := s.id; name := s.name; monthly_salary := COALESCE(s.monthly_salary,0);
        present_days := COALESCE(v_present,0); absent_days := COALESCE(v_absent,0);
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
END $$;

-- 5. Keep staff katha balance in sync with staff katha invoices and receipts
CREATE OR REPLACE FUNCTION public.recompute_staff_katha(_staff_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.fn_sale_staff_katha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.staff_id IS NOT NULL THEN
    PERFORM public.recompute_staff_katha(OLD.staff_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.staff_id IS NOT NULL THEN
    PERFORM public.recompute_staff_katha(NEW.staff_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sale_staff_katha ON public.sales;
CREATE TRIGGER trg_sale_staff_katha
  AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_sale_staff_katha();

CREATE OR REPLACE FUNCTION public.fn_staff_payment_katha()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM public.recompute_staff_katha(OLD.staff_id); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM public.recompute_staff_katha(NEW.staff_id); END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_staff_payment_katha ON public.staff_payments;
CREATE TRIGGER trg_staff_payment_katha
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_staff_payment_katha();