# Make the new month's opening match last month's closing

## What is going wrong
- Today is the first day of October. No month has been saved with "Save as Opening" yet, so October has no saved opening.
- When a month has no saved opening, the stock screen uses each product's very first opening figure and then subtracts only this month's sales. Everything bought, made or sold in earlier months is skipped, so some products go negative. (In the online copy, 7 products already show negative current stock and 2 show a negative opening.)
- Last month's profit changed (14,444 yesterday, about 61,000 now) because September's closing stock is now worked out the same incomplete way. When closing stock changes, profit changes.

## Fix (only stock opening/closing; nothing else changes)
1. **Carry forward automatically.** If a month has no saved opening, its opening = the previous month's closing worked out from the full history (first opening + every purchase, production, sale, recipe use, transfer and adjustment up to the end of last month). So October opening = September closing.
2. **A saved opening still wins.** Once you press "Save as Opening", that saved number is used and never recalculated.
3. **Products with Formula OFF** keep the stock number you typed in by hand, as they do now.
4. **Reports use the same rule.** Last month's closing stock and profit in Reports read the same carried-forward figure, so September goes back to its correct closing and profit.
5. **Check first, then fix.** Before changing anything I'll list the products that are negative now and show their September closing compared with their October opening, so you can see exactly where the difference comes from.

You do not need to type in numbers again. After this, pressing "Save as Opening" on 1 October saves the same figures you see on screen.

## Technical notes
- `src/lib/inventory-engine.ts`: when there is no `kind='opening'` snapshot for (year, month), build the opening by running the same movement totals from `2000-01-01` up to the day before `period.from` (auto items only); otherwise use the snapshot. One function, no second calculation system.
- `src/lib/report-engine.ts`: opening/closing valuation uses the same helper so monthly P&L closing = next month's opening.
- No database schema changes and no data writes; works the same in the offline copy.
