# Correct sale amounts in Reports + add Discount

Only the report numbers change. Bills, stock, POS, Katha, salary and every other screen stay exactly as they are. Nothing saved in the database is changed, so all past months correct themselves automatically.

## What is wrong (confirmed)

Each bill total = items − discount + delivery charge. The report spreads this whole bill total over the products on the bill.

- Karahi Full: 2 x 1,450 = 2,900, plus a 250 delivery charge on the same bill = 3,150 shown. The delivery charge was counted as karahi sales.
- Delivery charges are counted twice in profit: once inside sales, and again as delivery profit.
- Discounts are hidden inside product sales instead of being shown on their own.

Checked on all completed bills: items 3,877,599 − discount 13,753 + delivery 216,010 = 4,079,856, which is exactly what the report shows as sales today. So the monthly sale figure is too high by the delivery charges (216,010 overall).

## The fix

1. **Product and category sales** = quantity x the price on the bill (the line total). Karahi Full shows 2,900.
2. **Total Sales** = sum of all products sold (before discount, no delivery charge). This total matches the product list exactly.
3. **Delivery charges** stay in their own line and are counted in profit only once, as now.
4. **New Discount line** in Daily (today, previous day, any chosen day) and in Monthly: total discount given in that period.
5. **Profit**: Net Profit after salary − Discount = **Profit after Discount**, shown as its own line.
6. Same rule for every period: today, previous day, this month, last month, any older month, overall. Pending, hidden and deleted bills stay excluded as now.
7. Cash, online, Katha and change figures stay unchanged (they are real money received).

## Technical notes

- `src/lib/report-engine.ts` only (plus the display in `src/routes/_authenticated/reports.tsx`):
  - per item revenue = `it.total` instead of the grand-total share; `totalSales`, `day.totalSales`, `cat.sales`, `productMap.rev` use item totals.
  - add `totalDiscount` and `day.discount` from `sales.discount_amount` (add the column to the select).
  - `netProfit` formula keeps its parts; add `profitAfterDiscount = netProfit − totalDiscount`.
  - `adjustToTotal` / validity check keep working since both sides become item sums.
- Add a small test: bill of 2 x 1,450 with 250 delivery and 100 discount gives sales 2,900, discount 100, delivery 250.
- No database or data changes.
