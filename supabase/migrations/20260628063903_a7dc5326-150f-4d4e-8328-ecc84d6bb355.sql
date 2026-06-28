
-- 1. PRODUCTS additions
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'pcs',
  ADD COLUMN IF NOT EXISTS selling_method text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_unit_check;
ALTER TABLE public.products ADD CONSTRAINT products_unit_check CHECK (unit IN ('pcs','kg','ltr'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_selling_method_check;
ALTER TABLE public.products ADD CONSTRAINT products_selling_method_check CHECK (selling_method IN ('fixed','weight'));

-- 2. RECIPES table
CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'pcs',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all recipes" ON public.recipes;
CREATE POLICY "auth all recipes" ON public.recipes
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX IF NOT EXISTS recipes_parent_idx ON public.recipes(parent_product_id) WHERE deleted_at IS NULL;

-- 3. SALES additions
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_paid numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS online_paid numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'walk_in',
  ADD COLUMN IF NOT EXISTS delivery_boy text;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_order_type_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_order_type_check CHECK (order_type IN ('walk_in','take_away','delivery'));

-- 4. SALE_ITEMS additions
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit text;

-- 5. SETTINGS table (singleton)
CREATE TABLE IF NOT EXISTS public.settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  allow_negative_stock boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all settings" ON public.settings;
CREATE POLICY "auth all settings" ON public.settings
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
INSERT INTO public.settings (id, allow_negative_stock) VALUES (1, false) ON CONFLICT (id) DO NOTHING;

-- 6. STOCK DEDUCTION HELPER (recipe-aware)
CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(_product_id uuid, _quantity numeric, _sign int)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_has_recipe boolean;
  v_allow_neg boolean;
  v_comp RECORD;
  v_new_stock numeric;
  v_product_name text;
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT EXISTS(SELECT 1 FROM public.recipes WHERE parent_product_id = _product_id AND deleted_at IS NULL)
    INTO v_has_recipe;

  IF v_has_recipe THEN
    FOR v_comp IN
      SELECT r.component_product_id AS pid, r.quantity * _quantity AS qty, p.name, p.allow_negative_stock AS p_allow_neg
      FROM public.recipes r JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
    LOOP
      UPDATE public.products SET current_stock = current_stock - (_sign * v_comp.qty)
        WHERE id = v_comp.pid RETURNING current_stock INTO v_new_stock;
      IF _sign > 0 AND v_new_stock < 0 AND NOT v_allow_neg AND NOT v_comp.p_allow_neg THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_comp.name;
      END IF;
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE lower(trim(name)) = lower(trim(v_comp.name)) AND deleted_at IS NULL;
    END LOOP;
  ELSE
    UPDATE public.products SET current_stock = current_stock - (_sign * _quantity)
      WHERE id = _product_id RETURNING current_stock, name INTO v_new_stock, v_product_name;
    IF _sign > 0 AND v_new_stock < 0 AND NOT v_allow_neg THEN
      -- check product-level allow flag
      PERFORM 1 FROM public.products WHERE id = _product_id AND allow_negative_stock = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_product_name;
      END IF;
    END IF;
    UPDATE public.stock_items
      SET current_stock = current_stock - (_sign * _quantity), updated_at = now()
      WHERE lower(trim(v_product_name)) = lower(trim(name)) AND deleted_at IS NULL;
  END IF;
END $$;

-- 7. SAVE_SALE rewrite
CREATE OR REPLACE FUNCTION public.save_sale(
  _items jsonb,
  _customer_name text DEFAULT NULL,
  _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0,
  _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in',
  _delivery_boy text DEFAULT NULL
) RETURNS sales
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_product public.products;
  v_uid uuid := auth.uid();
  v_qty numeric;
  v_rate numeric;
  v_total numeric;
  v_delivery numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  INSERT INTO public.sales (grand_total, created_by, customer_name, status, delivery_charges, payment_method, cash_paid, online_paid, order_type, delivery_boy)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, v_delivery, _payment_method,
          COALESCE(_cash_paid,0), COALESCE(_online_paid,0), _order_type, NULLIF(trim(_delivery_boy), ''))
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    v_qty := (v_item->>'quantity')::numeric;
    v_rate := COALESCE(NULLIF(v_item->>'rate','')::numeric, v_product.sale_price);
    v_total := round(v_qty * v_rate, 2);

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total, unit)
    VALUES (v_sale.id, v_product.id, v_qty, v_rate, v_total, COALESCE(v_item->>'unit', v_product.unit));
    v_subtotal := v_subtotal + v_total;

    IF _status = 'completed' THEN
      PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1);
    END IF;
  END LOOP;

  UPDATE public.sales SET grand_total = v_subtotal + v_delivery WHERE id = v_sale.id
    RETURNING * INTO v_sale;
  RETURN v_sale;
END $$;

-- 8. UPDATE_PENDING_SALE rewrite (also allows complete-from-pending)
CREATE OR REPLACE FUNCTION public.update_pending_sale(
  _sale_id uuid,
  _items jsonb,
  _customer_name text DEFAULT NULL,
  _status text DEFAULT 'pending',
  _delivery_charges numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0,
  _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in',
  _delivery_boy text DEFAULT NULL
) RETURNS sales
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_subtotal numeric(14,2) := 0;
  v_product public.products;
  v_uid uuid := auth.uid();
  v_qty numeric;
  v_rate numeric;
  v_total numeric;
  v_delivery numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status <> 'pending' THEN RAISE EXCEPTION 'Only pending sales can be edited'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    v_qty := (v_item->>'quantity')::numeric;
    v_rate := COALESCE(NULLIF(v_item->>'rate','')::numeric, v_product.sale_price);
    v_total := round(v_qty * v_rate, 2);

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total, unit)
    VALUES (_sale_id, v_product.id, v_qty, v_rate, v_total, COALESCE(v_item->>'unit', v_product.unit));
    v_subtotal := v_subtotal + v_total;

    IF _status = 'completed' THEN
      PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1);
    END IF;
  END LOOP;

  UPDATE public.sales
  SET grand_total = v_subtotal + v_delivery,
      customer_name = NULLIF(trim(_customer_name), ''),
      status = _status,
      delivery_charges = v_delivery,
      payment_method = _payment_method,
      cash_paid = COALESCE(_cash_paid,0),
      online_paid = COALESCE(_online_paid,0),
      order_type = _order_type,
      delivery_boy = NULLIF(trim(_delivery_boy), '')
  WHERE id = _sale_id
  RETURNING * INTO v_sale;
  RETURN v_sale;
END $$;

-- 9. RESTORE_SALE_STOCK rewrite (recipe-aware)
CREATE OR REPLACE FUNCTION public.restore_sale_stock(_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_sale public.sales;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL OR v_sale.status <> 'completed' THEN RETURN; END IF;
  FOR v_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_item.product_id, v_item.quantity, -1);
  END LOOP;
END $$;

-- 10. CATEGORY_MONTHLY_REPORT — recipe-aware COGS
CREATE OR REPLACE FUNCTION public.category_monthly_report(_month date)
RETURNS TABLE(category text, opening_value numeric, purchased_value numeric, sales_qty numeric, sales_revenue numeric, sales_cogs numeric, closing_value numeric, gross_profit numeric, expenses_allocated numeric, net_profit numeric)
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $$
DECLARE
  v_month_start date := date_trunc('month', _month)::date;
  v_month_end date := (date_trunc('month', _month) + interval '1 month')::date;
  v_total_expenses numeric;
  v_total_revenue numeric;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_total_expenses
    FROM public.expenses WHERE deleted_at IS NULL
      AND date >= v_month_start AND date < v_month_end;

  SELECT COALESCE(SUM(si.total),0) INTO v_total_revenue
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end;

  RETURN QUERY
  WITH cats AS (SELECT name FROM public.categories WHERE deleted_at IS NULL),
  purchased AS (
    SELECT sp.category, SUM(sp.total_cost) AS val FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  -- expand sale items via recipes when present, fall back to own cost
  item_costs AS (
    SELECT p.category AS category,
           si.quantity AS qty,
           si.total AS revenue,
           CASE
             WHEN EXISTS(SELECT 1 FROM public.recipes r WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL)
             THEN COALESCE((SELECT SUM(r.quantity * COALESCE(cp.cost_price,0))
                            FROM public.recipes r JOIN public.products cp ON cp.id = r.component_product_id
                            WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL), 0) * si.quantity
             ELSE COALESCE(p.cost_price,0) * si.quantity
           END AS cogs
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end
  ),
  sold AS (
    SELECT category, SUM(qty) AS qty, SUM(revenue) AS revenue, SUM(cogs) AS cogs
    FROM item_costs GROUP BY category
  ),
  overrides AS (
    SELECT category, opening_value FROM public.monthly_stock_overrides WHERE month_start = v_month_start
  ),
  prev_closing AS (
    SELECT p.category, SUM(COALESCE(p.current_stock,0) * COALESCE(p.cost_price,0)) AS val
    FROM public.products p WHERE p.deleted_at IS NULL GROUP BY p.category
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

-- 11. updated_at trigger for recipes
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_recipes_updated_at ON public.recipes;
CREATE TRIGGER trg_recipes_updated_at BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
