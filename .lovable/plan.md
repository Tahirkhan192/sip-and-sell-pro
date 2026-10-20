# Speed up saving bills and reports (no change to any figure or logic)

## Why it is slow (what I found)
The shop now has about 17,000 bills and their item lines stored on the computer. Three things scale badly with that much data:

1. **No lookup shortcuts on the biggest lists.** The local database has no search shortcut (index) for bill date, bill items by bill, purchase/expense/transfer dates. Every report, the stock screen and pending-bill search read through every bill line one by one.
2. **Whole-database copy after every save.** 5 seconds after each saved bill, the app copies the entire database to the data folder, and every minute it copies it again to prepare the Google Drive upload. On a busy counter this runs almost continuously and blocks the till while it works.
3. **Stock/report history recalculated repeatedly.** The stock engine re-reads full history again for each saved-opening start date, and every save refreshes all open screens at once.

## What will be changed
- Add search shortcuts to the local database (one-time, automatic on next start). Pure speed — no data is altered.
- Copy to the data folder only after the counter is quiet (about 60 seconds without a new save) instead of 5 seconds after each bill; keep the 2-minute safety copy and the copy on closing.
- Prepare the Drive upload every 5 minutes instead of every minute, and skip it while a bill is being saved.
- Reuse stock history already loaded for the same month instead of reading it again within one screen open.
- After a sale, refresh only the screens that the sale affects instead of every screen.

## What will NOT change
All formulas, revenue (quantity x selling price), opening/closing, salary, Katha, invoice numbers, saved data and screens stay exactly the same.

## Check before finishing
- Existing inventory test must still pass, and report totals for September/October compared before vs after — must be identical.
- Time a sale save and the Monthly report before and after.

## Technical details
- `src/lib/local-db/upgrades.ts`: `CREATE INDEX IF NOT EXISTS` on `sale_items(sale_id)`, `sale_items(product_id)`, `sales(sale_date)`, `sales(status, deleted_at)`, `stock_purchases(date)`, `expenses(date)`, `production_batches(batch_date)`, `stock_transfers(created_at)`, `stock_adjustments(date)`, `cash_movements(business_date)`, `staff_payments(staff_id,date)`; mirror into `public/seed/schema.sql` and `electron/db/schema.sql`.
- `src/lib/data-folder.ts`: `SAVE_DEBOUNCE_MS` 5s -> 60s.
- `src/lib/drive-sync.ts`: `SYNC_INTERVAL_MS` 60s -> 5 min; skip cycle while `qc.isMutating() > 0`.
- `src/lib/inventory-engine.ts`: memoize sub-range `fetchInventoryEngine` calls per (from,to) within one top-level call; outputs unchanged.
- POS save: narrow `invalidateQueries` to sales/stock/report keys.
