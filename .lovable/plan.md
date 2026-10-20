# Make loading, saving, bill search and reports fast

Targets: screens open in a few seconds, a new sale saves within 3 seconds, bill search answers within 5 seconds, reports show within a few seconds. No figure, formula, bill number or saved data changes.

## Step 1 — Measure first
Open the app with your real-sized data (about 17,000 bills) and time: app start, saving a sale, Sales page search, Monthly report, Stock page. Every later change is checked against these times, and report totals are compared before vs after (must be identical).

## Step 2 — Saving a sale (target under 3 s)
- After saving, the app currently re-reads the bill twice and immediately recalculates stock and reports in the background while you wait. Stock and report screens will be marked "out of date" and recalculated only when you open them.
- Remove the duplicate re-read of the same bill (keep one check so the staff link is still confirmed).

## Step 3 — Bill search (target under 5 s)
- The Sales page currently builds the whole report for the month just to show the bill list, then searches it. It will instead read only the bill list for the chosen period, and searching by bill number or customer will ask the database directly (using the new lookup shortcuts).
- Totals shown on the Sales page still come from the same report calculation, unchanged.

## Step 4 — Reports and Stock (target a few seconds)
- Reports read only the columns they use and only the chosen period, in parallel instead of one after another.
- Results for months that are already closed are kept in memory, so opening "Last Month" again is instant; they refresh automatically if anything in that month is edited.

## Step 5 — App start
- Load only today's essentials (products, categories, settings) at start; everything else loads when its screen opens.

## What will NOT change
Revenue (quantity x selling price), discounts, profit, opening/closing, salary, Katha, invoice numbers, screens and buttons stay exactly as they are.

## Technical details
- POS `onSuccess`: `invalidateQueries({ queryKey, refetchType: "none" })` for `inventory-engine`, `stock`, `report`; keep active refetch for `sales`/`products`.
- POS mutation: merge staff-link update + read-back; drop the earlier `select("*")` when the staff check will re-read.
- `sales.tsx`: new lightweight `useQuery` on `sales` (selected columns, `gte/lt sale_date`, server-side `ilike` on `invoice_no`/`customer_name`, `limit`) for the list; totals stay on `useReportEngine`.
- `report-engine.ts` / `inventory-engine.ts`: narrow `select` columns, `Promise.all` independent reads, cache closed-month results keyed by period with invalidation on save.
- Verify with Playwright timings and `inventory-engine.test.ts`.
