-- Make Lovable Cloud a passive backup: remove all business-logic triggers.
-- The browser's local trigger engine will produce these derived rows now, so
-- keeping the cloud-side copies would duplicate cash_movements, stock_purchases,
-- and stock adjustments on every sync.
--
-- Timestamp-only triggers (touch_updated_at / set_updated_at) are intentionally
-- kept — they are bookkeeping, not business rules.

DROP TRIGGER IF EXISTS trg_purchase_cash_movement ON public.purchases;
DROP TRIGGER IF EXISTS trg_purchase_cash_movement_del ON public.purchases;

DROP TRIGGER IF EXISTS trg_purchase_item_apply ON public.purchase_items;

DROP TRIGGER IF EXISTS trg_purchase_sync_category ON public.stock_purchases;
DROP TRIGGER IF EXISTS trg_purchase_update_stock ON public.stock_purchases;
DROP TRIGGER IF EXISTS trg_purchase_recalc_wac ON public.stock_purchases;

DROP TRIGGER IF EXISTS trg_stock_transfer_reverse ON public.stock_transfers;

-- Functions are intentionally kept in place (unused) so any old client build
-- that still calls them via RPC will not error. They are no longer wired to
-- any table event, so the cloud will not run them automatically.