
-- 1. Extend categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS icon text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique_active ON public.categories(lower(name)) WHERE deleted_at IS NULL;

-- 2. Extend stock_items
ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS notes text;

-- backfill so existing rows pass NOT NULL
UPDATE public.stock_items SET category = COALESCE(category,
  (SELECT name FROM public.categories WHERE deleted_at IS NULL ORDER BY sort_order, name LIMIT 1),
  'Snacks') WHERE category IS NULL;
ALTER TABLE public.stock_items ALTER COLUMN category SET NOT NULL;

-- 3. stock_purchases: auto-fill category from stock_item if missing
CREATE OR REPLACE FUNCTION public.fn_purchase_sync_category()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT category INTO NEW.category FROM public.products WHERE id = NEW.product_id;
  ELSIF NEW.stock_item_id IS NOT NULL THEN
    SELECT category INTO NEW.category FROM public.stock_items WHERE id = NEW.stock_item_id;
  END IF;
  IF NEW.category IS NULL OR trim(NEW.category) = '' THEN
    NEW.category := COALESCE((SELECT name FROM public.categories WHERE deleted_at IS NULL ORDER BY sort_order, name LIMIT 1), 'Snacks');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_sync_category ON public.stock_purchases;
CREATE TRIGGER trg_purchase_sync_category BEFORE INSERT OR UPDATE ON public.stock_purchases
  FOR EACH ROW EXECUTE FUNCTION public.fn_purchase_sync_category();

-- backfill existing stock_item purchases that have wrong category
UPDATE public.stock_purchases sp SET category = si.category
  FROM public.stock_items si WHERE sp.stock_item_id = si.id AND si.category IS NOT NULL;

-- 4. customers: extend
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_visit timestamptz,
  ADD COLUMN IF NOT EXISTS total_orders integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_purchases numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outstanding_balance numeric(14,2) NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON public.customers(phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;

-- 5. sales: add katha + customer_id + customer_phone
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS katha boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_phone text;

-- 6. Updated save_sale with customer + katha
CREATE OR REPLACE FUNCTION public.save_sale(
  _items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0, _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in', _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL, _katha boolean DEFAULT false
) RETURNS sales LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_remaining numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  -- Upsert customer
  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers
      WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone))
        RETURNING id INTO v_customer_id;
    ELSE
      UPDATE public.customers SET name = COALESCE(NULLIF(trim(_customer_name),''), name) WHERE id = v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.sales (grand_total, created_by, customer_name, status, delivery_charges, payment_method,
    cash_paid, online_paid, order_type, delivery_boy, customer_id, customer_phone, katha)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, v_delivery, _payment_method,
    COALESCE(_cash_paid,0), COALESCE(_online_paid,0), _order_type, NULLIF(trim(_delivery_boy), ''),
    v_customer_id, NULLIF(trim(_customer_phone),''), COALESCE(_katha,false))
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

  UPDATE public.sales SET grand_total = v_subtotal + v_delivery WHERE id = v_sale.id RETURNING * INTO v_sale;

  IF v_customer_id IS NOT NULL AND _status = 'completed' THEN
    v_remaining := GREATEST(v_sale.grand_total - COALESCE(_cash_paid,0) - COALESCE(_online_paid,0), 0);
    UPDATE public.customers SET
      last_visit = now(),
      total_orders = total_orders + 1,
      total_purchases = total_purchases + v_sale.grand_total,
      outstanding_balance = outstanding_balance + CASE WHEN COALESCE(_katha,false) THEN v_remaining ELSE 0 END
    WHERE id = v_customer_id;
  END IF;
  RETURN v_sale;
END $$;

-- 7. Updated update_pending_sale
CREATE OR REPLACE FUNCTION public.update_pending_sale(
  _sale_id uuid, _items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'pending',
  _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0, _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in', _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL, _katha boolean DEFAULT false
) RETURNS sales LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid;
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

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone)) RETURNING id INTO v_customer_id;
    END IF;
  END IF;

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

  UPDATE public.sales SET grand_total = v_subtotal + v_delivery,
    customer_name = NULLIF(trim(_customer_name), ''), status = _status,
    delivery_charges = v_delivery, payment_method = _payment_method,
    cash_paid = COALESCE(_cash_paid,0), online_paid = COALESCE(_online_paid,0),
    order_type = _order_type, delivery_boy = NULLIF(trim(_delivery_boy), ''),
    customer_id = v_customer_id, customer_phone = NULLIF(trim(_customer_phone),''),
    katha = COALESCE(_katha,false)
  WHERE id = _sale_id RETURNING * INTO v_sale;
  RETURN v_sale;
END $$;

-- 8. category_monthly_report — split product vs stock-item purchases
DROP FUNCTION IF EXISTS public.category_monthly_report(date);
CREATE OR REPLACE FUNCTION public.category_monthly_report(_month date)
 RETURNS TABLE(category text, opening_value numeric, product_purchased_value numeric,
   stock_purchased_value numeric, purchased_value numeric, sales_qty numeric,
   sales_revenue numeric, sales_cogs numeric, closing_value numeric,
   gross_profit numeric, expenses_allocated numeric, net_profit numeric)
 LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_month_start date := date_trunc('month', _month)::date;
  v_month_end date := (date_trunc('month', _month) + interval '1 month')::date;
  v_total_expenses numeric; v_total_revenue numeric;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_total_expenses FROM public.expenses
    WHERE deleted_at IS NULL AND date >= v_month_start AND date < v_month_end;

  SELECT COALESCE(SUM(si.total),0) INTO v_total_revenue
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end;

  RETURN QUERY
  WITH cats AS (SELECT name FROM public.categories WHERE deleted_at IS NULL),
  prod_pur AS (
    SELECT sp.category, SUM(sp.total_cost) AS val FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL AND sp.product_id IS NOT NULL
      AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  stock_pur AS (
    SELECT sp.category, SUM(sp.total_cost) AS val FROM public.stock_purchases sp
    WHERE sp.deleted_at IS NULL AND sp.stock_item_id IS NOT NULL
      AND sp.date >= v_month_start AND sp.date < v_month_end
    GROUP BY sp.category
  ),
  item_costs AS (
    SELECT p.category AS category, si.quantity AS qty, si.total AS revenue,
      CASE WHEN EXISTS(SELECT 1 FROM public.recipes r WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL)
        THEN COALESCE((SELECT SUM(r.quantity * COALESCE(cp.cost_price,0))
            FROM public.recipes r JOIN public.products cp ON cp.id = r.component_product_id
            WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL), 0) * si.quantity
        ELSE COALESCE(p.cost_price,0) * si.quantity END AS cogs
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
      AND public.business_date(s.sale_date) <  v_month_end
  ),
  sold AS (SELECT category, SUM(qty) AS qty, SUM(revenue) AS revenue, SUM(cogs) AS cogs FROM item_costs GROUP BY category),
  overrides AS (SELECT category, opening_value FROM public.monthly_stock_overrides WHERE month_start = v_month_start),
  prev_closing AS (
    SELECT p.category, SUM(COALESCE(p.current_stock,0) * COALESCE(p.cost_price,0)) AS val
    FROM public.products p WHERE p.deleted_at IS NULL GROUP BY p.category
  )
  SELECT c.name,
    COALESCE(o.opening_value, pc.val, 0),
    COALESCE(pp.val,0) AS product_purchased_value,
    COALESCE(sp2.val,0) AS stock_purchased_value,
    COALESCE(pp.val,0) + COALESCE(sp2.val,0) AS purchased_value,
    COALESCE(sd.qty,0), COALESCE(sd.revenue,0), COALESCE(sd.cogs,0),
    GREATEST(COALESCE(o.opening_value, pc.val, 0) + COALESCE(pp.val,0) + COALESCE(sp2.val,0) - COALESCE(sd.cogs,0), 0),
    COALESCE(sd.revenue,0) - COALESCE(sd.cogs,0),
    CASE WHEN v_total_revenue > 0 THEN v_total_expenses * (COALESCE(sd.revenue,0) / v_total_revenue) ELSE 0 END,
    (COALESCE(sd.revenue,0) - COALESCE(sd.cogs,0)) -
      CASE WHEN v_total_revenue > 0 THEN v_total_expenses * (COALESCE(sd.revenue,0) / v_total_revenue) ELSE 0 END
  FROM cats c
  LEFT JOIN prod_pur pp ON pp.category = c.name
  LEFT JOIN stock_pur sp2 ON sp2.category = c.name
  LEFT JOIN sold sd ON sd.category = c.name
  LEFT JOIN overrides o ON o.category = c.name
  LEFT JOIN prev_closing pc ON pc.category = c.name
  ORDER BY c.name;
END $$;

-- 9. Dashboard category cards RPC
CREATE OR REPLACE FUNCTION public.dashboard_category_cards()
 RETURNS TABLE(category text, color text, icon text,
   today_sales numeric, month_sales numeric, today_orders bigint, month_orders bigint,
   month_cogs numeric, month_profit numeric, top_product text)
 LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_today date := public.business_date(now()); v_month_start date := date_trunc('month', v_today)::date;
BEGIN
  RETURN QUERY
  WITH cats AS (SELECT name, color, icon FROM public.categories WHERE deleted_at IS NULL AND active),
  rows AS (
    SELECT p.category AS cat, public.business_date(s.sale_date) AS bd,
      si.total AS revenue, si.quantity AS qty, si.id AS si_id, s.id AS sale_id, p.name AS pname,
      CASE WHEN EXISTS(SELECT 1 FROM public.recipes r WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL)
        THEN COALESCE((SELECT SUM(r.quantity * COALESCE(cp.cost_price,0))
            FROM public.recipes r JOIN public.products cp ON cp.id = r.component_product_id
            WHERE r.parent_product_id = p.id AND r.deleted_at IS NULL), 0) * si.quantity
        ELSE COALESCE(p.cost_price,0) * si.quantity END AS cogs
    FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
    JOIN public.products p ON p.id = si.product_id
    WHERE s.deleted_at IS NULL AND s.status = 'completed'
      AND public.business_date(s.sale_date) >= v_month_start
  ),
  agg AS (
    SELECT cat,
      SUM(CASE WHEN bd = v_today THEN revenue ELSE 0 END) AS today_sales,
      SUM(revenue) AS month_sales,
      COUNT(DISTINCT CASE WHEN bd = v_today THEN sale_id END) AS today_orders,
      COUNT(DISTINCT sale_id) AS month_orders,
      SUM(cogs) AS month_cogs
    FROM rows GROUP BY cat
  ),
  top AS (
    SELECT DISTINCT ON (cat) cat, pname FROM (
      SELECT cat, pname, SUM(qty) AS q FROM rows GROUP BY cat, pname
    ) z ORDER BY cat, q DESC
  )
  SELECT c.name, c.color, c.icon,
    COALESCE(a.today_sales,0), COALESCE(a.month_sales,0),
    COALESCE(a.today_orders,0), COALESCE(a.month_orders,0),
    COALESCE(a.month_cogs,0), COALESCE(a.month_sales,0) - COALESCE(a.month_cogs,0),
    t.pname
  FROM cats c LEFT JOIN agg a ON a.cat = c.name LEFT JOIN top t ON t.cat = c.name
  ORDER BY c.name;
END $$;
