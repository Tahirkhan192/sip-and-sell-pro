
-- Add customer name + status to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed'));

-- Replace save_sale to accept customer name + status
CREATE OR REPLACE FUNCTION public.save_sale(_items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'completed')
RETURNS public.sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_total numeric(14,2) := 0;
  v_product public.products;
  v_recipe RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  INSERT INTO public.sales (grand_total, created_by, customer_name, status)
  VALUES (0, v_uid, NULLIF(trim(_customer_name), ''), _status)
  RETURNING * INTO v_sale;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (v_sale.id, v_product.id, (v_item->>'quantity')::numeric, v_product.sale_price,
            v_product.sale_price * (v_item->>'quantity')::numeric);
    v_total := v_total + v_product.sale_price * (v_item->>'quantity')::numeric;

    IF _status = 'completed' THEN
      FOR v_recipe IN SELECT ingredient_id, quantity_required FROM public.recipes WHERE product_id = v_product.id LOOP
        INSERT INTO public.ingredient_movements (ingredient_id, movement_type, quantity, reference_type, reference_id)
        VALUES (v_recipe.ingredient_id, 'consumption',
                -(v_recipe.quantity_required * (v_item->>'quantity')::numeric),
                'sale', v_sale.id);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.sales SET grand_total = v_total WHERE id = v_sale.id RETURNING * INTO v_sale;
  RETURN v_sale;
END; $function$;

-- Update an existing pending sale (replace items, optionally complete it)
CREATE OR REPLACE FUNCTION public.update_pending_sale(_sale_id uuid, _items jsonb, _customer_name text DEFAULT NULL, _status text DEFAULT 'pending')
RETURNS public.sales
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_sale public.sales;
  v_item jsonb;
  v_total numeric(14,2) := 0;
  v_product public.products;
  v_recipe RECORD;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _status NOT IN ('pending','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.status <> 'pending' THEN RAISE EXCEPTION 'Only pending sales can be edited'; END IF;
  IF jsonb_array_length(_items) = 0 THEN RAISE EXCEPTION 'Empty cart'; END IF;

  DELETE FROM public.sale_items WHERE sale_id = _sale_id;
  DELETE FROM public.ingredient_movements WHERE reference_type = 'sale' AND reference_id = _sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

    INSERT INTO public.sale_items (sale_id, product_id, quantity, price, total)
    VALUES (_sale_id, v_product.id, (v_item->>'quantity')::numeric, v_product.sale_price,
            v_product.sale_price * (v_item->>'quantity')::numeric);
    v_total := v_total + v_product.sale_price * (v_item->>'quantity')::numeric;

    IF _status = 'completed' THEN
      FOR v_recipe IN SELECT ingredient_id, quantity_required FROM public.recipes WHERE product_id = v_product.id LOOP
        INSERT INTO public.ingredient_movements (ingredient_id, movement_type, quantity, reference_type, reference_id)
        VALUES (v_recipe.ingredient_id, 'consumption',
                -(v_recipe.quantity_required * (v_item->>'quantity')::numeric),
                'sale', _sale_id);
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.sales
  SET grand_total = v_total,
      customer_name = NULLIF(trim(_customer_name), ''),
      status = _status
  WHERE id = _sale_id
  RETURNING * INTO v_sale;
  RETURN v_sale;
END; $function$;
