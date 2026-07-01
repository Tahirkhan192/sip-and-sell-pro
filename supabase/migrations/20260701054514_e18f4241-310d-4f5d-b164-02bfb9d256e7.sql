
-- 1. Discount on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount','percent')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_address text;

-- 2. Recipes: allow component to be a stock item OR a product
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS component_stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE RESTRICT;
ALTER TABLE public.recipes ALTER COLUMN component_product_id DROP NOT NULL;
-- Enforce exactly one component type
ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_component_xor;
ALTER TABLE public.recipes ADD CONSTRAINT recipes_component_xor
  CHECK ((component_product_id IS NOT NULL)::int + (component_stock_item_id IS NOT NULL)::int = 1);

-- 3. Product priority: last_sold_at
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_sold_at timestamptz;

-- 4. Production batches
CREATE TABLE IF NOT EXISTS public.production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  batch_date date NOT NULL DEFAULT (public.business_date(now())),
  notes text,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  unit_cost numeric(12,4) NOT NULL DEFAULT 0,
  target_category text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_batches TO authenticated;
GRANT ALL ON public.production_batches TO service_role;
ALTER TABLE public.production_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all production_batches" ON public.production_batches;
CREATE POLICY "auth all production_batches" ON public.production_batches
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.production_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.production_batches(id) ON DELETE CASCADE,
  component_type text NOT NULL CHECK (component_type IN ('product','stock_item')),
  component_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  component_stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL,
  unit_cost numeric(12,4) NOT NULL,
  total_cost numeric(14,2) NOT NULL,
  source_category text,
  target_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_batch_items TO authenticated;
GRANT ALL ON public.production_batch_items TO service_role;
ALTER TABLE public.production_batch_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth all production_batch_items" ON public.production_batch_items;
CREATE POLICY "auth all production_batch_items" ON public.production_batch_items
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- 5. Updated apply_stock_for_sale_item to handle stock_item recipe components
CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(_product_id uuid, _quantity numeric, _sign integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_has_recipe boolean;
  v_track boolean;
  v_allow_neg boolean;
  v_comp RECORD;
  v_new_stock numeric;
  v_product_name text;
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT track_stock, name INTO v_track, v_product_name FROM public.products WHERE id = _product_id;
  IF v_track IS NULL THEN v_track := true; END IF;

  SELECT EXISTS(SELECT 1 FROM public.recipes WHERE parent_product_id = _product_id AND deleted_at IS NULL)
    INTO v_has_recipe;

  IF v_has_recipe THEN
    -- Products as components
    FOR v_comp IN
      SELECT p.id AS pid, r.quantity * _quantity AS qty, p.name, p.allow_negative_stock AS p_allow_neg
      FROM public.recipes r
      JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_product_id IS NOT NULL
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
    -- Stock items as components
    FOR v_comp IN
      SELECT si.id AS sid, r.quantity * _quantity AS qty, si.name
      FROM public.recipes r
      JOIN public.stock_items si ON si.id = r.component_stock_item_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_stock_item_id IS NOT NULL
    LOOP
      UPDATE public.stock_items
        SET current_stock = current_stock - (_sign * v_comp.qty), updated_at = now()
        WHERE id = v_comp.sid;
    END LOOP;
  ELSIF v_track THEN
    UPDATE public.products SET current_stock = current_stock - (_sign * _quantity)
      WHERE id = _product_id RETURNING current_stock INTO v_new_stock;
    IF _sign > 0 AND v_new_stock < 0 AND NOT v_allow_neg THEN
      PERFORM 1 FROM public.products WHERE id = _product_id AND allow_negative_stock = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient stock for %', v_product_name;
      END IF;
    END IF;
    UPDATE public.stock_items
      SET current_stock = current_stock - (_sign * _quantity), updated_at = now()
      WHERE lower(trim(v_product_name)) = lower(trim(name)) AND deleted_at IS NULL;
  END IF;
END $function$;

-- 6. save_sale with discount + delivery_address + last_sold_at bumping
CREATE OR REPLACE FUNCTION public.save_sale(
  _items jsonb,
  _customer_name text DEFAULT NULL,
  _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0,
  _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0,
  _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in',
  _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL,
  _katha boolean DEFAULT false,
  _discount_type text DEFAULT 'amount',
  _discount_value numeric DEFAULT 0,
  _delivery_address text DEFAULT NULL
) RETURNS sales
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_remaining numeric; v_discount_amt numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;
  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

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
    cash_paid, online_paid, order_type, delivery_boy, customer_id, customer_phone, katha,
    discount_type, discount_value, discount_amount, delivery_address)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, v_delivery, _payment_method,
    COALESCE(_cash_paid,0), COALESCE(_online_paid,0), _order_type, NULLIF(trim(_delivery_boy), ''),
    v_customer_id, NULLIF(trim(_customer_phone),''), COALESCE(_katha,false),
    _discount_type, COALESCE(_discount_value,0), 0, NULLIF(trim(_delivery_address),''))
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
      UPDATE public.products SET last_sold_at = now() WHERE id = v_product.id;
    END IF;
  END LOOP;

  -- Compute discount amount
  IF _discount_type = 'percent' THEN
    v_discount_amt := round(v_subtotal * LEAST(GREATEST(COALESCE(_discount_value,0),0),100) / 100.0, 2);
  ELSE
    v_discount_amt := LEAST(GREATEST(COALESCE(_discount_value,0),0), v_subtotal);
  END IF;

  UPDATE public.sales
    SET grand_total = GREATEST(v_subtotal - v_discount_amt, 0) + v_delivery,
        discount_amount = v_discount_amt
    WHERE id = v_sale.id RETURNING * INTO v_sale;

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
END $function$;

-- 7. update_pending_sale with discount
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
  _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL,
  _katha boolean DEFAULT false,
  _discount_type text DEFAULT 'amount',
  _discount_value numeric DEFAULT 0,
  _delivery_address text DEFAULT NULL
) RETURNS sales
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_discount_amt numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;
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
      UPDATE public.products SET last_sold_at = now() WHERE id = v_product.id;
    END IF;
  END LOOP;

  IF _discount_type = 'percent' THEN
    v_discount_amt := round(v_subtotal * LEAST(GREATEST(COALESCE(_discount_value,0),0),100) / 100.0, 2);
  ELSE
    v_discount_amt := LEAST(GREATEST(COALESCE(_discount_value,0),0), v_subtotal);
  END IF;

  UPDATE public.sales SET
    grand_total = GREATEST(v_subtotal - v_discount_amt, 0) + v_delivery,
    customer_name = NULLIF(trim(_customer_name), ''), status = _status,
    delivery_charges = v_delivery, payment_method = _payment_method,
    cash_paid = COALESCE(_cash_paid,0), online_paid = COALESCE(_online_paid,0),
    order_type = _order_type, delivery_boy = NULLIF(trim(_delivery_boy), ''),
    customer_id = v_customer_id, customer_phone = NULLIF(trim(_customer_phone),''),
    katha = COALESCE(_katha,false),
    discount_type = _discount_type, discount_value = COALESCE(_discount_value,0),
    discount_amount = v_discount_amt,
    delivery_address = NULLIF(trim(_delivery_address),'')
  WHERE id = _sale_id RETURNING * INTO v_sale;
  RETURN v_sale;
END $function$;

-- 8. Production RPC: consumes recipe ingredients, adds finished stock, updates WAC
CREATE OR REPLACE FUNCTION public.save_production(
  _product_id uuid,
  _quantity numeric,
  _notes text DEFAULT NULL
) RETURNS production_batches
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_batch public.production_batches;
  v_product public.products;
  v_recipe RECORD;
  v_qty numeric;
  v_unit_cost numeric;
  v_line_cost numeric;
  v_total_cost numeric := 0;
  v_new_stock numeric;
  v_existing_stock numeric;
  v_existing_cost numeric;
  v_new_wac numeric;
  v_source_cat text;
  v_src_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = _product_id AND deleted_at IS NULL;
  IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.recipes WHERE parent_product_id = _product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Product % has no recipe', v_product.name;
  END IF;

  INSERT INTO public.production_batches (product_id, quantity, notes, total_cost, unit_cost, target_category, created_by)
  VALUES (_product_id, _quantity, NULLIF(trim(_notes),''), 0, 0, v_product.category, v_uid)
  RETURNING * INTO v_batch;

  -- Product components
  FOR v_recipe IN
    SELECT r.quantity, p.id AS pid, p.name, p.category, p.cost_price, p.current_stock, p.allow_negative_stock
    FROM public.recipes r JOIN public.products p ON p.id = r.component_product_id
    WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
      AND r.component_product_id IS NOT NULL
  LOOP
    v_qty := v_recipe.quantity * _quantity;
    v_unit_cost := COALESCE(v_recipe.cost_price, 0);
    v_line_cost := round(v_qty * v_unit_cost, 2);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE public.products SET current_stock = current_stock - v_qty
      WHERE id = v_recipe.pid RETURNING current_stock INTO v_new_stock;
    IF v_new_stock < 0 AND NOT v_recipe.allow_negative_stock THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_recipe.name;
    END IF;
    INSERT INTO public.production_batch_items (batch_id, component_type, component_product_id,
      quantity, unit_cost, total_cost, source_category, target_category)
    VALUES (v_batch.id, 'product', v_recipe.pid, v_qty, v_unit_cost, v_line_cost,
      v_recipe.category, v_product.category);
    -- Mirror to stock_items with matching name
    UPDATE public.stock_items SET current_stock = current_stock - v_qty, updated_at = now()
      WHERE lower(trim(name)) = lower(trim(v_recipe.name)) AND deleted_at IS NULL;
  END LOOP;

  -- Stock item components
  FOR v_recipe IN
    SELECT r.quantity, si.id AS sid, si.name, si.category, si.purchase_price, si.current_stock
    FROM public.recipes r JOIN public.stock_items si ON si.id = r.component_stock_item_id
    WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
      AND r.component_stock_item_id IS NOT NULL
  LOOP
    v_qty := v_recipe.quantity * _quantity;
    v_unit_cost := COALESCE(v_recipe.purchase_price, 0);
    v_line_cost := round(v_qty * v_unit_cost, 2);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE public.stock_items SET current_stock = current_stock - v_qty, updated_at = now()
      WHERE id = v_recipe.sid;
    INSERT INTO public.production_batch_items (batch_id, component_type, component_stock_item_id,
      quantity, unit_cost, total_cost, source_category, target_category)
    VALUES (v_batch.id, 'stock_item', v_recipe.sid, v_qty, v_unit_cost, v_line_cost,
      v_recipe.category, v_product.category);
  END LOOP;

  -- Add finished stock + update WAC on product
  v_existing_stock := GREATEST(COALESCE(v_product.current_stock, 0), 0);
  v_existing_cost := COALESCE(v_product.cost_price, 0);
  IF (v_existing_stock + _quantity) > 0 THEN
    v_new_wac := round(((v_existing_stock * v_existing_cost) + v_total_cost) / (v_existing_stock + _quantity), 4);
  ELSE
    v_new_wac := v_existing_cost;
  END IF;

  UPDATE public.products SET current_stock = current_stock + _quantity,
    cost_price = v_new_wac
    WHERE id = _product_id;

  UPDATE public.production_batches
    SET total_cost = v_total_cost,
        unit_cost = CASE WHEN _quantity > 0 THEN round(v_total_cost / _quantity, 4) ELSE 0 END
    WHERE id = v_batch.id RETURNING * INTO v_batch;
  RETURN v_batch;
END $function$;

-- 9. Delete a production batch (restores ingredients, removes finished stock)
CREATE OR REPLACE FUNCTION public.delete_production_batch(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_batch public.production_batches;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_batch FROM public.production_batches WHERE id = _batch_id AND deleted_at IS NULL;
  IF v_batch IS NULL THEN RETURN; END IF;
  FOR v_item IN SELECT * FROM public.production_batch_items WHERE batch_id = _batch_id LOOP
    IF v_item.component_type = 'product' AND v_item.component_product_id IS NOT NULL THEN
      UPDATE public.products SET current_stock = current_stock + v_item.quantity
        WHERE id = v_item.component_product_id;
    ELSIF v_item.component_type = 'stock_item' AND v_item.component_stock_item_id IS NOT NULL THEN
      UPDATE public.stock_items SET current_stock = current_stock + v_item.quantity, updated_at = now()
        WHERE id = v_item.component_stock_item_id;
    END IF;
  END LOOP;
  UPDATE public.products SET current_stock = GREATEST(current_stock - v_batch.quantity, 0)
    WHERE id = v_batch.product_id;
  UPDATE public.production_batches SET deleted_at = now() WHERE id = _batch_id;
END $function$;
