
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_payment_method_chk;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_method_chk
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'online'::text, 'stock_transfer'::text]));

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

  INSERT INTO public.expenses (date, category, amount, description, payment_method, payment_status, paid_amount, is_stock_transfer)
  VALUES (
    COALESCE(_date, (now() AT TIME ZONE 'Asia/Karachi')::date),
    _expense_category,
    v_amount,
    COALESCE(NULLIF(_reason,'') || CASE WHEN _notes IS NOT NULL AND length(_notes)>0 THEN ' — ' || _notes ELSE '' END, v_desc),
    'stock_transfer',
    'paid',
    v_amount,
    true
  )
  RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END $function$;
