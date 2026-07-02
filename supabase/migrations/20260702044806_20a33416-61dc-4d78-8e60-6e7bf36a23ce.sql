
-- 1) Stock Transfers table
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('product','stock_item')),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  from_category text NOT NULL,
  to_category text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'pcs',
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  reason text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfers TO authenticated;
GRANT ALL ON public.stock_transfers TO service_role;

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view transfers" ON public.stock_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert transfers" ON public.stock_transfers FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update transfers" ON public.stock_transfers FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete transfers" ON public.stock_transfers FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_created_at ON public.stock_transfers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from ON public.stock_transfers(from_category);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to ON public.stock_transfers(to_category);

-- 2) save_stock_transfer RPC
CREATE OR REPLACE FUNCTION public.save_stock_transfer(
  _item_type text,
  _product_id uuid,
  _stock_item_id uuid,
  _from_category text,
  _to_category text,
  _quantity numeric,
  _reason text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS public.stock_transfers
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.stock_transfers;
  v_uid uuid := auth.uid();
  v_name text; v_unit text; v_unit_cost numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _item_type NOT IN ('product','stock_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
  IF COALESCE(_quantity,0) <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF NULLIF(trim(_from_category),'') IS NULL OR NULLIF(trim(_to_category),'') IS NULL THEN
    RAISE EXCEPTION 'From and To categories are required';
  END IF;
  IF trim(_from_category) = trim(_to_category) THEN RAISE EXCEPTION 'From and To categories must differ'; END IF;

  IF _item_type = 'product' THEN
    SELECT name, unit, COALESCE(cost_price,0) INTO v_name, v_unit, v_unit_cost
    FROM public.products WHERE id = _product_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;
  ELSE
    SELECT name, unit, COALESCE(purchase_price,0) INTO v_name, v_unit, v_unit_cost
    FROM public.stock_items WHERE id = _stock_item_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Stock item not found'; END IF;
  END IF;

  INSERT INTO public.stock_transfers(
    item_type, product_id, stock_item_id, item_name,
    from_category, to_category, quantity, unit, unit_cost, total_cost,
    reason, notes, created_by
  ) VALUES (
    _item_type,
    CASE WHEN _item_type='product' THEN _product_id ELSE NULL END,
    CASE WHEN _item_type='stock_item' THEN _stock_item_id ELSE NULL END,
    v_name, trim(_from_category), trim(_to_category),
    _quantity, COALESCE(v_unit,'pcs'), v_unit_cost, round(_quantity * v_unit_cost, 2),
    NULLIF(trim(_reason),''), NULLIF(trim(_notes),''), v_uid
  ) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- 3) update_sale RPC — edit ANY sale (pending or completed)
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
LANGUAGE plpgsql
SET search_path = public
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

  -- Revert stock if the sale was completed
  IF v_was_completed THEN
    FOR v_old_item IN SELECT product_id, quantity FROM public.sale_items WHERE sale_id = _sale_id LOOP
      PERFORM public.apply_stock_for_sale_item(v_old_item.product_id, v_old_item.quantity, -1);
    END LOOP;
  END IF;

  -- Revert previous customer aggregates
  IF v_sale.customer_id IS NOT NULL AND v_was_completed THEN
    UPDATE public.customers SET
      total_orders = GREATEST(total_orders - 1, 0),
      total_purchases = GREATEST(total_purchases - v_sale.grand_total, 0),
      outstanding_balance = GREATEST(outstanding_balance - (CASE WHEN v_sale.katha THEN v_old_remaining ELSE 0 END), 0)
    WHERE id = v_sale.customer_id;
  END IF;

  v_delivery := COALESCE(_delivery_charges,0);
  IF _order_type <> 'delivery' THEN v_delivery := 0; END IF;

  -- Upsert customer
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

  -- Re-apply customer aggregates
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
