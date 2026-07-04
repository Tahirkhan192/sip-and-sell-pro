
-- Business date helper (08:00 Asia/Karachi rollover)
CREATE OR REPLACE FUNCTION public.business_date_of(_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ((_ts AT TIME ZONE 'Asia/Karachi') - interval '8 hours')::date;
$$;

-- expenses.payment_method
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_method_chk') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_chk
      CHECK (payment_method IN ('cash','online'));
  END IF;
END $$;

-- Cash movements
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL DEFAULT public.business_date_of(now()),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('cash_in','cash_out')),
  amount numeric NOT NULL CHECK (amount >= 0),
  reason text,
  notes text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_movements TO authenticated;
GRANT ALL ON public.cash_movements TO service_role;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage cash_movements" ON public.cash_movements;
CREATE POLICY "auth manage cash_movements" ON public.cash_movements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Daily closings
CREATE TABLE IF NOT EXISTS public.daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL UNIQUE,
  actual_cash numeric NOT NULL DEFAULT 0,
  actual_wallet numeric NOT NULL DEFAULT 0,
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_closings TO authenticated;
GRANT ALL ON public.daily_closings TO service_role;
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth manage daily_closings" ON public.daily_closings;
CREATE POLICY "auth manage daily_closings" ON public.daily_closings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_cash_movements_updated ON public.cash_movements;
CREATE TRIGGER trg_cash_movements_updated BEFORE UPDATE ON public.cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_daily_closings_updated ON public.daily_closings;
CREATE TRIGGER trg_daily_closings_updated BEFORE UPDATE ON public.daily_closings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Copy current stock -> opening stock (products + stock_items)
CREATE OR REPLACE FUNCTION public.set_opening_stock_from_current()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products SET opening_stock = current_stock WHERE deleted_at IS NULL;
  UPDATE public.stock_items SET opening_stock = current_stock WHERE deleted_at IS NULL;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_opening_stock_from_current() TO authenticated;

-- Daily closing summary
CREATE OR REPLACE FUNCTION public.daily_closing_summary(_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  WHERE deleted_at IS NULL AND status = 'completed'
    AND public.business_date_of(sale_date) = _date;

  SELECT
    COALESCE(SUM(CASE WHEN type='cash_in' THEN amount END),0),
    COALESCE(SUM(CASE WHEN type='cash_out' THEN amount END),0)
  INTO v_cash_in, v_cash_out
  FROM public.cash_movements
  WHERE deleted_at IS NULL AND business_date = _date;

  SELECT
    COALESCE(SUM(CASE WHEN COALESCE(payment_method,'cash')='cash' THEN amount END),0),
    COALESCE(SUM(CASE WHEN payment_method='online' THEN amount END),0)
  INTO v_cash_exp, v_online_exp
  FROM public.expenses
  WHERE deleted_at IS NULL AND date = _date;

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
    'cash_expenses', v_cash_exp,
    'online_expenses', v_online_exp,
    'invoices', v_invoices,
    'expected_cash', v_opening_cash + v_cash_sales + v_cash_in - v_cash_out - v_cash_exp,
    'expected_wallet', v_opening_wallet + v_online_sales - v_online_exp,
    'actual_cash', CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_cash ELSE NULL END,
    'actual_wallet', CASE WHEN v_curr.id IS NOT NULL THEN v_curr.actual_wallet ELSE NULL END,
    'closed', v_curr.id IS NOT NULL,
    'notes', v_curr.notes
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.daily_closing_summary(date) TO authenticated;
