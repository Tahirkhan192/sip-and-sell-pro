-- Purchases must never permanently increment stored stock; the purchase
-- records themselves are the single source of purchase quantity.
DROP TRIGGER IF EXISTS trg_stock_purchases_stock ON public.stock_purchases;
DROP FUNCTION IF EXISTS public.fn_purchase_update_stock();

-- One-time rebuild for auto-calculated items (manual items keep their value).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.products WHERE deleted_at IS NULL AND auto_calc = true LOOP
    PERFORM public.rebuild_item_remaining('product', r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.stock_items WHERE deleted_at IS NULL AND auto_calc = true LOOP
    PERFORM public.rebuild_item_remaining('stock_item', r.id);
  END LOOP;
END $$;