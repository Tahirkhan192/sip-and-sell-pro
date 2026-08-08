-- 1. Mirror rows must die with their purchase line (was ON DELETE SET NULL,
--    which orphaned them and double-counted every purchase edit).
ALTER TABLE public.stock_purchases DROP CONSTRAINT stock_purchases_purchase_item_id_fkey;
ALTER TABLE public.stock_purchases
  ADD CONSTRAINT stock_purchases_purchase_item_id_fkey
  FOREIGN KEY (purchase_item_id) REFERENCES public.purchase_items(id) ON DELETE CASCADE;

-- 2. Remove leftovers created by past edits (orphans made after multi-item
--    purchases went live). Legacy pre-multi-item rows are untouched.
DELETE FROM public.stock_purchases
 WHERE purchase_item_id IS NULL
   AND created_at > '2026-07-14 12:33:42.452932+00';

-- 3. Rebuild current stock from transaction history for every item.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.products WHERE deleted_at IS NULL AND COALESCE(auto_calc,false) LOOP
    PERFORM public.rebuild_item_remaining('product', r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.stock_items WHERE deleted_at IS NULL AND COALESCE(auto_calc,false) LOOP
    PERFORM public.rebuild_item_remaining('stock_item', r.id);
  END LOOP;
END $$;