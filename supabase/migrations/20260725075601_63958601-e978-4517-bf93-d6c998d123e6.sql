
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_product_id uuid REFERENCES public.products(id),
  ADD COLUMN IF NOT EXISTS source_stock_item_id uuid REFERENCES public.stock_items(id),
  ADD COLUMN IF NOT EXISTS source_quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS source_unit_cost numeric(14,4);

CREATE OR REPLACE FUNCTION public.stock_to_expense_transfer(_product_id uuid, _stock_item_id uuid, _quantity numeric, _expense_category text, _reason text, _notes text, _date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cost numeric := 0;
  v_amount numeric := 0;
  v_expense_id uuid;
  v_desc text;
BEGIN
  IF _quantity IS NULL OR _quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;
  IF (_product_id IS NULL AND _stock_item_id IS NULL) OR (_product_id IS NOT NULL AND _stock_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Provide exactly one of product or stock item';
  END IF;
  IF _expense_category IS NULL OR length(trim(_expense_category)) = 0 THEN
    RAISE EXCEPTION 'Expense category required';
  END IF;

  IF _product_id IS NOT NULL THEN
    SELECT COALESCE(cost_price,0) INTO v_cost FROM public.products WHERE id = _product_id;
    v_amount := round(v_cost * _quantity, 2);
    UPDATE public.products
      SET current_stock = COALESCE(current_stock,0) - _quantity
      WHERE id = _product_id;
    SELECT 'Stock transfer: ' || name || ' × ' || _quantity INTO v_desc FROM public.products WHERE id = _product_id;
  ELSE
    SELECT COALESCE(purchase_price,0) INTO v_cost FROM public.stock_items WHERE id = _stock_item_id;
    v_amount := round(v_cost * _quantity, 2);
    UPDATE public.stock_items
      SET current_stock = COALESCE(current_stock,0) - _quantity,
          updated_at = now()
      WHERE id = _stock_item_id;
    SELECT 'Stock transfer: ' || name || ' × ' || _quantity INTO v_desc FROM public.stock_items WHERE id = _stock_item_id;
  END IF;

  INSERT INTO public.expenses (
    date, category, amount, description, payment_method, payment_status, paid_amount, is_stock_transfer,
    source_product_id, source_stock_item_id, source_quantity, source_unit_cost, notes
  )
  VALUES (
    COALESCE(_date, (now() AT TIME ZONE 'Asia/Karachi')::date),
    _expense_category,
    v_amount,
    COALESCE(_reason, v_desc),
    'stock_transfer',
    'paid',
    v_amount,
    TRUE,
    _product_id,
    _stock_item_id,
    _quantity,
    v_cost,
    _notes
  ) RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END;
$function$;

-- Update a stock-transfer expense: adjusts source stock by (old_qty - new_qty), recomputes amount at original unit cost.
CREATE OR REPLACE FUNCTION public.update_stock_transfer_expense(
  _expense_id uuid,
  _quantity numeric,
  _date date,
  _category text,
  _description text,
  _notes text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.expenses%ROWTYPE;
  v_delta numeric;
  v_new_amount numeric;
BEGIN
  SELECT * INTO r FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF NOT r.is_stock_transfer THEN RAISE EXCEPTION 'Not a stock transfer expense'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be > 0'; END IF;

  v_delta := COALESCE(r.source_quantity,0) - _quantity; -- positive => restore stock; negative => reduce more
  v_new_amount := round(COALESCE(r.source_unit_cost,0) * _quantity, 2);

  IF r.source_product_id IS NOT NULL THEN
    UPDATE public.products SET current_stock = COALESCE(current_stock,0) + v_delta WHERE id = r.source_product_id;
  ELSIF r.source_stock_item_id IS NOT NULL THEN
    UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + v_delta, updated_at = now() WHERE id = r.source_stock_item_id;
  END IF;

  UPDATE public.expenses
    SET source_quantity = _quantity,
        amount = v_new_amount,
        paid_amount = v_new_amount,
        date = COALESCE(_date, r.date),
        category = COALESCE(NULLIF(trim(_category),''), r.category),
        description = _description,
        notes = _notes
    WHERE id = _expense_id;
END;
$$;

-- Delete (soft) a stock-transfer expense and restore stock.
CREATE OR REPLACE FUNCTION public.delete_stock_transfer_expense(_expense_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.expenses%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF NOT r.is_stock_transfer THEN RAISE EXCEPTION 'Not a stock transfer expense'; END IF;

  IF r.source_product_id IS NOT NULL AND COALESCE(r.source_quantity,0) > 0 THEN
    UPDATE public.products SET current_stock = COALESCE(current_stock,0) + r.source_quantity WHERE id = r.source_product_id;
  ELSIF r.source_stock_item_id IS NOT NULL AND COALESCE(r.source_quantity,0) > 0 THEN
    UPDATE public.stock_items SET current_stock = COALESCE(current_stock,0) + r.source_quantity, updated_at = now() WHERE id = r.source_stock_item_id;
  END IF;

  UPDATE public.expenses SET deleted_at = now() WHERE id = _expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_stock_transfer_expense(uuid, numeric, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stock_transfer_expense(uuid) TO authenticated;
