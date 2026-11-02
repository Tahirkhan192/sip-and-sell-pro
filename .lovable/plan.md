# One-click Stock Tracking & Auto Calculation controls + faster Stock screen

Two goals, nothing else changes: bulk + per-product toggles for the two stock switches on Products, and a faster Stock screen load/calculation. All formulas, figures, and data stay exactly as they are.

## 1. Bulk + individual tracking switches (Products page — `src/routes/_authenticated/products.tsx`)

The two per-product switches today (both buried inside the edit dialog):
- **Stock Tracking** (`track_stock`) — ON = the product's own stock reduces and POS validates availability; OFF = unlimited.
- **Auto Calculation** (`auto_calc`) — ON = Remaining is rebuilt by the formula from history; OFF = manual Current Stock.

Add:
- **Header buttons: "Tracking ON for all" and "Tracking OFF for all"** — one click sets `track_stock` on every product, with a confirm step first ("This will turn stock tracking ON/OFF for ALL products"). Runs as a single batched update (`.in("id", ids)`) instead of one request per product, then invalidates the stock/inventory queries.
- **Header buttons: "Auto Calc ON for all" and "Auto Calc OFF for all"** — same pattern for `auto_calc`, with a confirm warning that Remaining will then be rebuilt from history for every product.
- **Per-row switches in the products table** — a small Stock Tracking switch and Auto Calc switch on each row that save immediately on click (single-row update, no dialog). The edit-dialog switches stay unchanged.
- Toasts confirm the count of products updated; failures show the error without changing other rows.

## 2. Faster stock load & calculation (`src/lib/inventory-engine.ts`, `src/routes/_authenticated/stock.tsx`)

No number changes — only how the numbers are fetched and computed:

- **Stop recursive re-fetching.** Today, when a month has no saved opening, the engine re-calls itself once per anchor date, and every one of those calls re-reads the full products and stock_items master lists plus every history table again. Rework it so the full history is fetched once and each anchor's sub-totals (opening → carry-forward, including manual adjustments) are sliced from that single read in memory. Results must be bit-identical; the existing `inventory-engine.test.ts` cases must still pass unchanged.
- **Remove duplicate master-list reads on the Stock page.** `CurrentStock` reads products and stock_items separately even though the engine already loads both; reuse the engine's data instead of a second copy.
- **Cache + prefetch.** Give the inventory-engine query a short stale time so switching between Stock tabs/months reuses the just-calculated snapshot instead of recalculating from scratch, and reuse the existing 5-second sub-range memo.

## 3. Test

- Add a small vitest case next to `inventory-engine.test.ts` covering the anchor/carry-forward path with a manual adjustment included, asserting the same figures the current engine produces (guards the speed refactor against changing any number).

## Verification

- Run the existing + new vitest tests and the typecheck.
- Playwright check on the preview: toggling per-row switches updates immediately, "ON for all"/"OFF for all" updates every row after confirm, and the Stock page renders the same figures as before.
