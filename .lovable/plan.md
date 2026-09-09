# Stock month view + accurate sold quantity in Reports

Two changes only. Nothing else in the app is touched.

## 1. Stock screens: current month by default, previous month read-only

Today every stock screen offers "All time / This Month / Last Month" and starts on All time.

- Remove the "All time" option everywhere (Current Stock, Product Stock Available, Stock Item Available).
- Default and normal view: **This Month** — opening, purchase, direct sale, recipe usage, transfer out, adjustment and the remaining/closing figure all belong to the running business month.
- **Last Month** stays as a read-only look-back: same table, month's own figures, no editing of stock values while it is selected.
- When the month rolls over, the new month's opening is the previous month's saved closing, so the screens automatically show the fresh month's remaining stock.
- The full product and stock-item lists always show, regardless of the month picked.

## 2. Reports → Sales quantity mismatch (17 sold shows as 19)

The sold quantity must be the plain sum of item quantities across every invoice in the chosen business-date window — today, previous day, this month, or overall.

Checks already done on the live data: no duplicate invoices, no duplicate invoice line rows. So the extra quantity is coming from which invoices are being counted, not from doubled rows.

Confirmed differences in how invoices are treated today:
- Pending invoices (9 of them) are excluded from money totals but **are** added to sold quantity and to product rows.
- 89 invoices are marked hidden and are excluded from reports entirely.

Work:
1. First step is a verification pass: take the product you counted as 17, list every invoice line for it in that business-date window, and show exactly which lines make up the difference. The fix follows what that shows.
2. Make the counting rule one rule, applied to all four windows (today / previous day / this month / overall): quantity comes from invoice lines of the invoices included in the report, keyed on **business date**, not clock date.
3. Align quantity with the money totals so a pending or hidden invoice is not counted in one place and skipped in another.
4. Add a small per-product breakdown on the sales report row so any future number can be traced back to the invoices behind it.

## Technical notes

- `src/components/StockAvailability.tsx`: drop the `"all"` mode from `StockPeriodMode`, `STOCK_PERIOD_OPTIONS` and `stockPeriodFor`; default state becomes `"month"`. Keep `stockPeriod` exported for callers that still need a concrete period, pointing at the current business month.
- `src/routes/_authenticated/stock.tsx`: default mode `"month"`; disable inline stock edits/transfer actions while `lastMonth` is selected. Master lists stay unfiltered.
- `src/lib/report-engine.ts`: the sales fetch filters `sale_date` on the business-date UTC window and drops `hidden`/`deleted_at`. Quantity accumulation (`totalQtySold`, `day.totalQtySold`, `cat.revenueQty`, `productMap[pid].qty`) currently includes pending while money does not — reconcile after the verification pass.
- No schema changes, no data changes.
