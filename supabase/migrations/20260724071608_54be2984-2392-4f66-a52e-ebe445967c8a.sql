-- 1. Column: which order types this recipe applies to.
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS applies_to text[] NOT NULL DEFAULT ARRAY['walk_in','take_away','delivery'];

ALTER TABLE public.recipes DROP CONSTRAINT IF EXISTS recipes_applies_to_chk;
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_applies_to_chk CHECK (
    array_length(applies_to, 1) IS NOT NULL
    AND applies_to <@ ARRAY['walk_in','take_away','delivery']
  );

-- 2. apply_stock_for_sale_item now accepts order_type and filters recipes.
CREATE OR REPLACE FUNCTION public.apply_stock_for_sale_item(
  _product_id uuid, _quantity numeric, _sign integer, _order_type text DEFAULT 'walk_in'
)
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
  v_ot text := COALESCE(_order_type, 'walk_in');
BEGIN
  SELECT allow_negative_stock INTO v_allow_neg FROM public.settings WHERE id = 1;
  IF v_allow_neg IS NULL THEN v_allow_neg := false; END IF;

  SELECT track_stock, name INTO v_track, v_product_name FROM public.products WHERE id = _product_id;
  IF v_track IS NULL THEN v_track := true; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.recipes
    WHERE parent_product_id = _product_id AND deleted_at IS NULL AND v_ot = ANY(applies_to)
  ) INTO v_has_recipe;

  IF v_has_recipe THEN
    FOR v_comp IN
      SELECT p.id AS pid, r.quantity * _quantity AS qty, p.name, p.allow_negative_stock AS p_allow_neg
      FROM public.recipes r
      JOIN public.products p ON p.id = r.component_product_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_product_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
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
    FOR v_comp IN
      SELECT si.id AS sid, r.quantity * _quantity AS qty, si.name
      FROM public.recipes r
      JOIN public.stock_items si ON si.id = r.component_stock_item_id
      WHERE r.parent_product_id = _product_id AND r.deleted_at IS NULL
        AND r.component_stock_item_id IS NOT NULL
        AND v_ot = ANY(r.applies_to)
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

-- 3. Route save_sale and update_sale to pass order_type.
CREATE OR REPLACE FUNCTION public.save_sale(
  _items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0, _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in', _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL, _katha boolean DEFAULT false,
  _discount_type text DEFAULT 'amount', _discount_value numeric DEFAULT 0,
  _delivery_address text DEFAULT NULL
)
RETURNS sales
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_discount_amt numeric(14,2); v_remaining numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone)) RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.sales (
    grand_total, created_by, customer_name, status, delivery_charges, payment_method,
    cash_paid, online_paid, order_type, delivery_boy, customer_id, customer_phone,
    katha, discount_type, discount_value, discount_amount, delivery_address
  )
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status, v_delivery, _payment_method,
    COALESCE(_cash_paid,0), COALESCE(_online_paid,0), _order_type, NULLIF(trim(_delivery_boy),''),
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
    PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1, _order_type);
    IF _status = 'completed' THEN
      UPDATE public.products SET last_sold_at = now() WHERE id = v_product.id;
    END IF;
  END LOOP;

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

-- 4. restore_sale_stock passes order_type from the sale.
CREATE OR REPLACE FUNCTION public.restore_sale_stock(_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL OR v_sale.status NOT IN ('pending','completed') THEN RETURN; END IF;
  FOR v_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_item.product_id, v_item.quantity, -1, v_sale.order_type);
  END LOOP;
END $function$;

-- 5. update_sale: reverse using old order_type, re-apply using new. We rebuild by calling restore then re-apply.
-- Since update_sale is long, patch only the apply_stock_for_sale_item calls to include order type.
-- Replace the whole update_sale body to be safe.
CREATE OR REPLACE FUNCTION public.update_sale(
  _sale_id uuid, _items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'completed',
  _delivery_charges numeric DEFAULT 0, _payment_method text DEFAULT 'cash',
  _cash_paid numeric DEFAULT 0, _online_paid numeric DEFAULT 0,
  _order_type text DEFAULT 'walk_in', _delivery_boy text DEFAULT NULL,
  _customer_phone text DEFAULT NULL, _katha boolean DEFAULT false,
  _discount_type text DEFAULT 'amount', _discount_value numeric DEFAULT 0,
  _delivery_address text DEFAULT NULL, _sale_date timestamptz DEFAULT NULL
)
RETURNS sales
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_discount_amt numeric(14,2);
  v_old_item RECORD; v_old_order_type text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id AND deleted_at IS NULL;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  v_old_order_type := v_sale.order_type;

  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;

  -- Reverse old stock using old order type
  FOR v_old_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_old_item.product_id, v_old_item.quantity, -1, v_old_order_type);
  END LOOP;
  DELETE FROM public.sale_items WHERE sale_id = _sale_id;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone)) RETURNING id INTO v_customer_id;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND deleted_at IS NULL;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
    v_qty := (v_item->>'quantity')::numeric;
    v_rate := COALESCE(NULLIF(v_item->>'rate','')::numeric, v_product.sale_price);
    v_total := round(v_qty * v_rate, 2);
    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total, unit)
    VALUES (_sale_id, v_product.id, v_qty, v_rate, v_total, COALESCE(v_item->>'unit', v_product.unit));
    v_subtotal := v_subtotal + v_total;
    PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1, _order_type);
    IF _status = 'completed' THEN
      UPDATE public.products SET last_sold_at = now() WHERE id = v_product.id;
    END IF;
  END LOOP;

  IF _discount_type = 'percent' THEN
    v_discount_amt := round(v_subtotal * LEAST(GREATEST(COALESCE(_discount_value,0),0),100) / 100.0, 2);
  ELSE
    v_discount_amt := LEAST(GREATEST(COALESCE(_discount_value,0),0), v_subtotal);
  END IF;

  UPDATE public.sales
    SET customer_name = NULLIF(trim(_customer_name), ''),
        status = _status,
        delivery_charges = v_delivery,
        payment_method = _payment_method,
        cash_paid = COALESCE(_cash_paid, 0),
        online_paid = COALESCE(_online_paid, 0),
        order_type = _order_type,
        delivery_boy = NULLIF(trim(_delivery_boy), ''),
        customer_id = v_customer_id,
        customer_phone = NULLIF(trim(_customer_phone), ''),
        katha = COALESCE(_katha, false),
        discount_type = _discount_type,
        discount_value = COALESCE(_discount_value, 0),
        discount_amount = v_discount_amt,
        delivery_address = NULLIF(trim(_delivery_address), ''),
        grand_total = GREATEST(v_subtotal - v_discount_amt, 0) + v_delivery,
        sale_date = COALESCE(_sale_date, sale_date)
    WHERE id = _sale_id
    RETURNING * INTO v_sale;

  RETURN v_sale;
END $function$;