
-- 1) Money movement subcategories (separate list per category)
CREATE TABLE IF NOT EXISTS public.money_movement_subcategories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('Expense','Owner','Customer','Other')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (category, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.money_movement_subcategories TO authenticated;
GRANT ALL ON public.money_movement_subcategories TO service_role;

ALTER TABLE public.money_movement_subcategories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read mm subcats" ON public.money_movement_subcategories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage mm subcats" ON public.money_movement_subcategories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_mm_subcats_updated_at ON public.money_movement_subcategories;
CREATE TRIGGER trg_mm_subcats_updated_at BEFORE UPDATE ON public.money_movement_subcategories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults
INSERT INTO public.money_movement_subcategories (category, name, sort_order) VALUES
  ('Expense','Salary',1),('Expense','Electricity',2),('Expense','Gas',3),('Expense','Maintenance',4),('Expense','Internet',5),('Expense','Cleaning',6),('Expense','Miscellaneous',7),
  ('Owner','Owner Investment',1),('Owner','Owner Withdrawal',2),('Owner','Owner Loan',3),
  ('Customer','Customer Payment Received',1),('Customer','Customer Refund',2),('Customer','Customer Advance',3),
  ('Other','Bank Transfer',1),('Other','Cash Adjustment',2),('Other','Miscellaneous',3)
ON CONFLICT (category, name) DO NOTHING;

-- 2) Money movement: add category grouping + reference link
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS movement_category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS reference_id uuid;

CREATE INDEX IF NOT EXISTS idx_cash_movements_reference ON public.cash_movements(reference_type, reference_id);

-- 3) Expenses: paid/unpaid + payment source
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','unpaid','partial')),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'cash' CHECK (payment_source IN ('cash','online')),
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS notes text;

-- Backfill paid_amount for existing rows
UPDATE public.expenses SET paid_amount = amount, paid_at = COALESCE(paid_at, created_at)
  WHERE paid_amount = 0 AND payment_status = 'paid';

-- 4) Stock purchases: paid/unpaid
ALTER TABLE public.stock_purchases
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','unpaid','partial')),
  ADD COLUMN IF NOT EXISTS paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'cash' CHECK (payment_source IN ('cash','online'));

UPDATE public.stock_purchases SET paid_amount = total_cost, paid_at = COALESCE(paid_at, created_at)
  WHERE paid_amount = 0 AND payment_status = 'paid';

-- 5) Helper: monthly financial summary for reports
CREATE OR REPLACE FUNCTION public.monthly_financial_summary(_month_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_month_end date := (date_trunc('month', _month_start) + interval '1 month')::date;
  v_sales numeric := 0;
  v_cash_sales numeric := 0;
  v_online_sales numeric := 0;
  v_katha numeric := 0;
  v_expenses numeric := 0;
  v_expenses_unpaid numeric := 0;
  v_purchases numeric := 0;
  v_purchases_unpaid numeric := 0;
  v_delivery_revenue numeric := 0;
  v_delivery_cost numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(grand_total),0),
    COALESCE(SUM(cash_paid),0),
    COALESCE(SUM(online_paid),0),
    COALESCE(SUM(CASE WHEN katha THEN GREATEST(grand_total - cash_paid - online_paid,0) ELSE 0 END),0),
    COALESCE(SUM(delivery_charges),0)
  INTO v_sales, v_cash_sales, v_online_sales, v_katha, v_delivery_revenue
  FROM public.sales
  WHERE deleted_at IS NULL AND status='completed'
    AND public.business_date_of(sale_date) >= _month_start
    AND public.business_date_of(sale_date) <  v_month_end;

  SELECT COALESCE(SUM(amount),0), COALESCE(SUM(CASE WHEN payment_status<>'paid' THEN amount - paid_amount ELSE 0 END),0)
  INTO v_expenses, v_expenses_unpaid
  FROM public.expenses WHERE deleted_at IS NULL AND date >= _month_start AND date < v_month_end;

  SELECT COALESCE(SUM(total_cost),0), COALESCE(SUM(CASE WHEN payment_status<>'paid' THEN total_cost - paid_amount ELSE 0 END),0)
  INTO v_purchases, v_purchases_unpaid
  FROM public.stock_purchases WHERE deleted_at IS NULL AND date >= _month_start AND date < v_month_end;

  SELECT COALESCE(SUM(amount),0) INTO v_delivery_cost
  FROM public.delivery_expenses WHERE deleted_at IS NULL AND date >= _month_start AND date < v_month_end;

  RETURN jsonb_build_object(
    'month_start', _month_start,
    'sales', v_sales,
    'cash_sales', v_cash_sales,
    'online_sales', v_online_sales,
    'katha', v_katha,
    'expenses', v_expenses,
    'expenses_unpaid', v_expenses_unpaid,
    'purchases', v_purchases,
    'purchases_unpaid', v_purchases_unpaid,
    'delivery_revenue', v_delivery_revenue,
    'delivery_cost', v_delivery_cost
  );
END $$;
