
-- save_sale: deduct stock for BOTH pending and completed. Customer aggregates
-- still only apply for completed sales.
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
) RETURNS public.sales
LANGUAGE plpgsql SET search_path = public
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
    -- Deduct stock for pending AND completed (pending = order served, financial only pending)
    PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1);
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

-- update_sale: previous sale (pending or completed) had stock deducted, so
-- always revert. New sale (pending or completed) always applies stock.
-- Customer aggregates still keyed to completed status transitions.
CREATE OR REPLACE FUNCTION public.update_sale(
  _sale_id uuid,
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
  _delivery_address text DEFAULT NULL,
  _sale_date timestamptz DEFAULT NULL
) RETURNS public.sales
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_sale public.sales; v_item jsonb; v_subtotal numeric(14,2) := 0;
  v_product public.products; v_uid uuid := auth.uid();
  v_qty numeric; v_rate numeric; v_total numeric; v_delivery numeric;
  v_customer_id uuid; v_discount_amt numeric(14,2);
  v_old_item RECORD; v_old_remaining numeric; v_new_remaining numeric;
  v_was_completed boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF _payment_method NOT IN ('cash','card') THEN _payment_method := 'cash'; END IF;
  IF _order_type NOT IN ('walk_in','take_away','delivery') THEN _order_type := 'walk_in'; END IF;
  IF _discount_type NOT IN ('amount','percent') THEN _discount_type := 'amount'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id AND deleted_at IS NULL;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  v_was_completed := (v_sale.status = 'completed');
  v_old_remaining := GREATEST(v_sale.grand_total - COALESCE(v_sale.cash_paid,0) - COALESCE(v_sale.online_paid,0), 0);

  -- Both pending & completed previously reduced stock — always revert.
  FOR v_old_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_old_item.product_id, v_old_item.quantity, -1);
  END LOOP;

  IF v_sale.customer_id IS NOT NULL AND v_was_completed THEN
    UPDATE public.customers SET
      total_orders = GREATEST(total_orders - 1, 0),
      total_purchases = GREATEST(total_purchases - v_sale.grand_total, 0),
      outstanding_balance = GREATEST(outstanding_balance - (CASE WHEN v_sale.katha THEN v_old_remaining ELSE 0 END), 0)
    WHERE id = v_sale.customer_id;
  END IF;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  IF NULLIF(trim(_customer_phone),'') IS NOT NULL THEN
    SELECT id INTO v_customer_id FROM public.customers WHERE phone = trim(_customer_phone) AND deleted_at IS NULL LIMIT 1;
    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone) VALUES (COALESCE(NULLIF(trim(_customer_name),''),'Guest'), trim(_customer_phone)) RETURNING id INTO v_customer_id;
    ELSE
      UPDATE public.customers SET name = COALESCE(NULLIF(trim(_customer_name),''), name) WHERE id = v_customer_id;
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
    -- Apply stock for pending AND completed.
    PERFORM public.apply_stock_for_sale_item(v_product.id, v_qty, 1);
    IF _status = 'completed' THEN
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
    customer_name = NULLIF(trim(_customer_name), ''),
    status = _status,
    delivery_charges = v_delivery,
    payment_method = _payment_method,
    cash_paid = COALESCE(_cash_paid,0),
    online_paid = COALESCE(_online_paid,0),
    order_type = _order_type,
    delivery_boy = NULLIF(trim(_delivery_boy), ''),
    customer_id = v_customer_id,
    customer_phone = NULLIF(trim(_customer_phone),''),
    katha = COALESCE(_katha,false),
    discount_type = _discount_type,
    discount_value = COALESCE(_discount_value,0),
    discount_amount = v_discount_amt,
    delivery_address = NULLIF(trim(_delivery_address),''),
    sale_date = COALESCE(_sale_date, sale_date)
  WHERE id = _sale_id
  RETURNING * INTO v_sale;

  v_new_remaining := GREATEST(v_sale.grand_total - COALESCE(v_sale.cash_paid,0) - COALESCE(v_sale.online_paid,0), 0);

  IF v_customer_id IS NOT NULL AND _status = 'completed' THEN
    UPDATE public.customers SET
      last_visit = now(),
      total_orders = total_orders + 1,
      total_purchases = total_purchases + v_sale.grand_total,
      outstanding_balance = outstanding_balance + CASE WHEN COALESCE(_katha,false) THEN v_new_remaining ELSE 0 END
    WHERE id = v_customer_id;
  END IF;

  RETURN v_sale;
END $$;

-- restore_sale_stock: restore stock for pending OR completed sales (both
-- deducted at save time). Called before soft-delete.
CREATE OR REPLACE FUNCTION public.restore_sale_stock(_sale_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_sale public.sales;
  v_item RECORD;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL OR v_sale.status NOT IN ('pending','completed') THEN RETURN; END IF;
  FOR v_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
    PERFORM public.apply_stock_for_sale_item(v_item.product_id, v_item.quantity, -1);
  END LOOP;
END $$;
