
-- 1. Categories table (future-ready)
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read categories" ON public.categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage categories" ON public.categories
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed (idempotent)
INSERT INTO public.categories (name, sort_order) VALUES
  ('Karahi', 10), ('Fast Food', 20), ('Snacks', 30),
  ('Juices', 40), ('Cold Drinks', 50), ('Biryani', 60)
ON CONFLICT (name) DO NOTHING;

-- 2. Business-date helper (08:00 Asia/Karachi rollover)
CREATE OR REPLACE FUNCTION public.business_date(ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE
SET search_path = public AS $$
  SELECT (((ts AT TIME ZONE 'Asia/Karachi') - interval '8 hours'))::date
$$;

-- 3. Products.category NOT NULL
UPDATE public.products SET category = 'Snacks' WHERE category IS NULL OR trim(category) = '';
ALTER TABLE public.products ALTER COLUMN category SET NOT NULL;

-- 4. stock_purchases: add category column
ALTER TABLE public.stock_purchases ADD COLUMN IF NOT EXISTS category text;

UPDATE public.stock_purchases sp
  SET category = COALESCE(
    (SELECT p.category FROM public.products p WHERE p.id = sp.product_id),
    'Snacks'
  )
  WHERE sp.category IS NULL;

ALTER TABLE public.stock_purchases ALTER COLUMN category SET NOT NULL;

-- Keep purchase.category in sync with chosen product
CREATE OR REPLACE FUNCTION public.fn_purchase_sync_category()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT category INTO NEW.category FROM public.products WHERE id = NEW.product_id;
  END IF;
  IF NEW.category IS NULL OR trim(NEW.category) = '' THEN
    NEW.category := 'Snacks';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_sync_category ON public.stock_purchases;
CREATE TRIGGER trg_purchase_sync_category
  BEFORE INSERT OR UPDATE ON public.stock_purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_sync_category();

-- 5. Category monthly report RPC
CREATE OR REPLACE FUNCTION public.category_monthly_report(_month date)
RETURNS TABLE (
  category text,
  opening_value numeric,
  purchased_value numeric,
  sales_qty numeric,
  sales_revenue numeric,
  sales_cogs numeric,
  closing_value numeric,
  gross_profit numeric,
  expenses_allocated numeric,
  net_profit numeric
)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_month_start date := date_trunc('month', _month)::date;
  v_month_end date := (date_trunc('month', _month) + interval '1 month')::date;
  v_total_expenses numeric;
  v_total_revenue numeric;
BEGIN
  -- General expenses for the month (by business_date)
  SELECT COALESCE(SUM(amount),0) INTO v_total_expenses
    FROM public.expenses
    WHERE deleted_at IS NULL
      AND date >= v_month_start AND date < v_month_end;

  -- Total sales revenue (ex-delivery) by business_date for allocation share
  SELECT COALESCE(SUM(si.total),0) INTO v_total_revenue
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end;

  RETURN QUERY
  WITH cats AS (
    SELECT name FROM public.categories WHERE deleted_at IS NULL
  ),
  purchased AS (
    SELECT sp.category, SUM(sp.total_cost) AS val
    FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL
      AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  sold AS (
    SELECT p.category, SUM(si.quantity) AS qty, SUM(si.total) AS revenue,
           SUM(si.quantity * COALESCE(p.cost_price,0)) AS cogs
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end
    GROUP BY p.category
  ),
  overrides AS (
    SELECT category, opening_value
    FROM public.monthly_stock_overrides
    WHERE month_start = v_month_start
  ),
  prev_closing AS (
    -- Approximate: current stock value per category (cost_price * current_stock)
    -- as a fallback for first month. For subsequent months, compute prior closing
    -- via the same formula on prior month (recursive). Here we use a simple
    -- snapshot: opening = (current_stock value) for now if no override.
    SELECT p.category,
           SUM(COALESCE(p.current_stock,0) * COALESCE(p.cost_price,0)) AS val
    FROM public.products p
    WHERE p.deleted_at IS NULL
    GROUP BY p.category
  )
  SELECT
    c.name AS category,
    COALESCE(o.opening_value, pc.val, 0) AS opening_value,
    COALESCE(pu.val,0) AS purchased_value,
    COALESCE(sd.qty,0) AS sales_qty,
    COALESCE(sd.revenue,0) AS sales_revenue,
    COALESCE(sd.cogs,0) AS sales_cogs,
    GREATEST(COALESCE(o.opening_value, pc.val, 0) + COALESCE(pu.val,0) - COALESCE(sd.cogs,0), 0) AS closing_value,
    COALESCE(sd.revenue,0) - COALESCE(sd.cogs,0) AS gross_profit,
    CASE WHEN v_total_revenue > 0
         THEN v_total_expenses * (COALESCE(sd.revenue,0) / v_total_revenue)
         ELSE 0 END AS expenses_allocated,
    (COALESCE(sd.revenue,0) - COALESCE(sd.cogs,0)) -
      CASE WHEN v_total_revenue > 0
           THEN v_total_expenses * (COALESCE(sd.revenue,0) / v_total_revenue)
           ELSE 0 END AS net_profit
  FROM cats c
  LEFT JOIN purchased pu ON pu.category = c.name
  LEFT JOIN sold sd ON sd.category = c.name
  LEFT JOIN overrides o ON o.category = c.name
  LEFT JOIN prev_closing pc ON pc.category = c.name
  ORDER BY c.name;
END $$;

GRANT EXECUTE ON FUNCTION public.category_monthly_report(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.business_date(timestamptz) TO authenticated, anon;
