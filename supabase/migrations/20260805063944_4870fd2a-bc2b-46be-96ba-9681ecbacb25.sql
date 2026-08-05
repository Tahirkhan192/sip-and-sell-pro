ALTER TABLE public.products ADD COLUMN IF NOT EXISTS auto_calc boolean NOT NULL DEFAULT false;
ALTER TABLE public.stock_items ADD COLUMN IF NOT EXISTS auto_calc boolean NOT NULL DEFAULT false;

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
  v_received numeric := 0;
  v_sold numeric := 0;
  v_transferred numeric := 0;
  v_consumed numeric := 0;
  v_remaining numeric := 0;
BEGIN
  IF _scope = 'product' THEN
    SELECT COALESCE(opening_stock, 0) INTO v_opening FROM public.products WHERE id = _id;

    SELECT COALESCE(SUM(quantity), 0) INTO v_purchases
      FROM public.stock_purchases WHERE product_id = _id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(quantity), 0) INTO v_produced
      FROM public.production_batches WHERE product_id = _id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(quantity), 0) INTO v_sold
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
      WHERE si.product_id = _id AND s.deleted_at IS NULL AND s.hidden = false AND s.status = 'completed';

    SELECT COALESCE(SUM(quantity), 0) INTO v_transferred
      FROM public.stock_transfers WHERE product_id = _id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(pbi.quantity), 0) INTO v_consumed
      FROM public.production_batch_items pbi
      JOIN public.production_batches pb ON pb.id = pbi.batch_id
      WHERE pbi.component_product_id = _id AND pb.deleted_at IS NULL;

    v_remaining := v_opening + v_purchases + v_produced + v_received - v_sold - v_transferred - v_consumed;
    UPDATE public.products SET current_stock = v_remaining WHERE id = _id;

  ELSIF _scope = 'stock_item' THEN
    SELECT COALESCE(opening_stock, 0) INTO v_opening FROM public.stock_items WHERE id = _id;

    SELECT COALESCE(SUM(quantity), 0) INTO v_purchases
      FROM public.stock_purchases WHERE stock_item_id = _id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(quantity), 0) INTO v_transferred
      FROM public.stock_transfers WHERE stock_item_id = _id AND deleted_at IS NULL;

    SELECT COALESCE(SUM(pbi.quantity), 0) INTO v_consumed
      FROM public.production_batch_items pbi
      JOIN public.production_batches pb ON pb.id = pbi.batch_id
      WHERE pbi.component_stock_item_id = _id AND pb.deleted_at IS NULL;

    v_remaining := v_opening + v_purchases + v_received - v_transferred - v_consumed;
    UPDATE public.stock_items SET current_stock = v_remaining WHERE id = _id;
  ELSE
    RAISE EXCEPTION 'unknown scope %', _scope;
  END IF;

  RETURN v_remaining;
END;
$$;