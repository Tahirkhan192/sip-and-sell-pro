# Month-End Stock Lock: Set As Opening Stock

## Current state (verified)

- The Stock page already has a "Set Current Stock As Opening Stock" button, but it calls a function that only overwrites the live `opening_stock` column on products and stock items. It does **not** save a month record and does **not** store a closing figure for the previous month.
- A snapshot table (`stock_opening_snapshots`) exists with scope, item, year, month, quantity and unit value, and reports already read the locked opening from it — but nothing writes to it from the button, and the cloud database currently contains **zero** snapshot rows. So there is no saved previous-month opening/closing history yet; history starts the first time the new button is used.
- The number the button copies today comes from the stored `current_stock` column, not from the calculated stock engine (Opening + Purchases + Production − Recipe Usage − Sales − Transfer Out + Adjustments).

## What will change

One action, "Set As Opening Stock", on the Stock page:

1. It reads each product's and stock item's **current stock exactly as the app shows it now** — from the inventory engine when Auto Calculation is ON, from the stored current stock when it is OFF, after all adjustments.
2. That exact figure is written into the **new month's Opening box** — replacing it, never added to the old opening. Chicken current 6 becomes opening 6.
3. The same figure is saved as the **previous month's Closing** record.
4. Unit price is carried automatically from purchases (weighted average purchase price, or the manual price override where one is set) — no manual price entry.
5. The record is permanent. Re-running for the same month updates that month only; earlier months stay frozen.

A confirmation dialog will state clearly which month is being opened and which month is being closed, with the item count, before anything is saved.

## Viewing history

A new "Opening / Closing History" tab on the Stock page:

- Month picker (any month that has a saved record).
- Table per Products and Stock Items: item, opening quantity, unit price, opening value, and the closing quantity/value recorded for that month (which is the next month's opening).
- Totals row, plus print/PDF using the existing report print button.

## Technical notes

- New database function `lock_month_opening(_year, _month, _rows jsonb)`: upserts the passed quantities/unit values into `stock_opening_snapshots` for `(year, month)` as opening, and into the same table for the previous month as the closing record (a `kind` column — `opening` / `closing` — added with a default of `opening` so existing rows and report reads stay valid). Also keeps the live `opening_stock` column aligned for the current month, as today.
- Quantities are computed client-side by `fetchInventoryEngine` (already the single source of truth used by POS, Products and Reports) and posted to the function, so the saved figure always matches what the screen shows.
- Unit value: products use `avg_price_override ?? cost_price`; stock items use `avg_price_override ?? purchase_price` (that column is already recalculated from purchases as a weighted average).
- `report-engine.ts` opening lookup keeps working unchanged (it filters on scope/item/year/month; the closing rows are filtered out by `kind`).
- Mirror the new function into `public/seed/schema.sql` and `electron/db/schema.sql` so the offline desktop build behaves identically.
- Nothing else on the Stock page, POS, reports or existing calculations changes.
