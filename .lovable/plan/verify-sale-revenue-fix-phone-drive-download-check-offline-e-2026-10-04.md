# Verify sale revenue, fix phone Drive download, check offline entries

Nothing else changes: bills, stock, Katha, salary, POS and all other screens stay exactly as they are.

## 1. Report sale = quantity x selling price (checked)

- Checked every saved bill line (15,820 lines): line total equals quantity x price on every line. Totals match: 4,158,360.78.
- The report already uses the line total, with no delivery charge and no discount added.
- To match your rule exactly, the report will read **quantity x price** directly for each product, category, day and month total (today, previous day, this month, last month, older months, all time).
- Monthly Total Sales = sum of quantity x price for that month. Discount and delivery stay on their own lines and are not added to sales.
- A small automatic check: 2 x 1,450 = 2,900 even when the bill has delivery and discount.
- Some entries are still showing wrong revenue check and fix them. 

## 2. Getting data from Drive on the phone fails

- Cause not confirmed yet. First step: open the phone viewer page in a test browser, try "get data from Drive", and read the exact error.
- Likely areas: the phone has no Google account connected on it, or the file is too large for the download step.
- Fix only that step, so the phone downloads the latest Drive copy and shows it.

## 3. All entries work offline

- Run the existing offline self-test (sale, pending bill, purchase, money movement, stock transfer, expense, delivery expense, staff payment) with the internet switched off in a test browser.
- Fix only any entry type that fails. Report the result per entry type.

## Technical notes

- `src/lib/report-engine.ts`: per-item revenue = `num(it.quantity) * num(it.price)` for `totalSales`, `day.totalSales`, `cat.sales`, `productMap.rev`; add a vitest case.
- Drive: reproduce `/api/drive?download=1` via the mobile viewer path with Playwright; check `fetchDriveSnapshot` and the Android viewer.
- Offline: Playwright with `context.set_offline(True)` running `runOfflineSelfTest` plus `staff_pay`.