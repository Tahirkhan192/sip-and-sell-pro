CREATE OR REPLACE FUNCTION public.rebuild_item_remaining(_scope text, _id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opening numeric := 0;
  v_purchases numeric := 0;
  v_produced numeric := 0;
  v_recipe numeric := 0;
  v_sold numeric := 0;
  v_transferred numeric := 0;
  v_consumed numeric := 0;
  v_adjust numeric := 0;
  v_has_recipe boolean := false;
  v_remaining numeric := 0;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO v_adjust
    FROM public.stock_adjustments
   WHERE deleted_at IS NULL
     AND ((_scope = 'product' AND product_id = _id) OR (_scope = 'stock_item' AND stock_item_id = _id));

  SELECT COALESCE(SUM(quantity), 0) INTO v_purchases
    FROM public.stock_purchases
   WHERE deleted_at IS NULL
     AND ((_scope = 'product' AND product_id = _id) OR (_scope = 'stock_item' AND stock_item_id = _id));

  SELECT COALESCE(SUM(quantity), 0) INTO v_transferred
    FROM public.stock_transfers
   WHERE deleted_at IS NULL
     AND ((_scope = 'product' AND product_id = _id) OR (_scope = 'stock_item' AND stock_item_id = _id));

  SELECT COALESCE(SUM(source_quantity), 0) INTO v_consumed
    FROM public.expenses
   WHERE deleted_at IS NULL AND is_stock_transfer = true
     AND ((_scope = 'product' AND source_product_id = _id) OR (_scope = 'stock_item' AND source_stock_item_id = _id));

  -- Recipe usage: ingredient qty x sold qty of every parent product, plus production batch components
  SELECT COALESCE(SUM(r.quantity * si.quantity), 0) INTO v_recipe
    FROM public.recipes r
    JOIN public.sale_items si ON si.product_id = r.parent_product_id
    JOIN public.sales s ON s.id = si.sale_id
   WHERE r.deleted_at IS NULL
     AND s.deleted_at IS NULL AND s.hidden = false AND s.status IN ('completed','pending')
     AND (COALESCE(array_length(r.applies_to, 1), 0) = 0 OR COALESCE(s.order_type, 'walk_in') = ANY (r.applies_to))
     AND ((_scope = 'product' AND r.component_product_id = _id) OR (_scope = 'stock_item' AND r.component_stock_item_id = _id));

  SELECT v_recipe + COALESCE(SUM(pbi.quantity), 0) INTO v_recipe
    FROM public.production_batch_items pbi
    JOIN public.production_batches pb ON pb.id = pbi.batch_id
   WHERE pb.deleted_at IS NULL
     AND ((_scope = 'product' AND pbi.component_product_id = _id) OR (_scope = 'stock_item' AND pbi.component_stock_item_id = _id));

  IF _scope = 'product' THEN
    SELECT COALESCE(opening_stock, 0) INTO v_opening FROM public.products WHERE id = _id;

    SELECT COALESCE(SUM(quantity), 0) INTO v_produced
      FROM public.production_batches WHERE product_id = _id AND deleted_at IS NULL;

    SELECT EXISTS (SELECT 1 FROM public.recipes WHERE parent_product_id = _id AND deleted_at IS NULL) INTO v_has_recipe;

    IF NOT v_has_recipe THEN
      SELECT COALESCE(SUM(si.quantity), 0) INTO v_sold
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
       WHERE si.product_id = _id AND s.deleted_at IS NULL AND s.hidden = false
         AND s.status IN ('completed','pending');
    END IF;

    v_remaining := v_opening + v_purchases + v_produced - v_recipe - v_sold - v_transferred - v_consumed + v_adjust;
    UPDATE public.products SET current_stock = v_remaining WHERE id = _id;

  ELSIF _scope = 'stock_item' THEN
    SELECT COALESCE(opening_stock, 0) INTO v_opening FROM public.stock_items WHERE id = _id;
    v_remaining := v_opening + v_purchases - v_recipe - v_transferred - v_consumed + v_adjust;
    UPDATE public.stock_items SET current_stock = v_remaining WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'unknown scope %', _scope;
  END IF;

  RETURN v_remaining;
END;
$$;