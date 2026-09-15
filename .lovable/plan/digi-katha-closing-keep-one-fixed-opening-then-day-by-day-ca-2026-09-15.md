# Digi Katha Closing — keep one fixed opening, then day-by-day carry forward

## What is already in place

There is no monthly filter on Digi Katha Closing. The page has one date box (the business date you are looking at), and the calculation already works exactly the way you describe:

```text
Fixed Opening (entered once, with its date)
   + everything from that date up to the day before  = Previous balance
   + today's katha sales / purchases / expenses / loans
   = Today's Current balance  ->  becomes the opening of the next day
```

So the structure stays untouched. Nothing about it will be changed.

## The real cause of the morning difference

Katha sales are counted by business date (with your 08:00 changeover), but katha purchases, expenses, delivery expenses and stock transfers are saved with a date taken from the computer clock in UTC, not your business date. In Karachi that clock is 5 hours behind, so:

- anything entered before 5:00 in the morning is stamped with the previous day
- anything entered between 5:00 and 8:00 is stamped with the next day, while the sales of the same shift still belong to the previous business day

That is why the balance looks correct during the day and jumps in the morning: the same shift's entries land on two different days.

## The fix

1. Make every entry screen default its date to your business date (same 08:00 changeover and time zone used everywhere else) instead of the UTC clock date: Purchases, Expenses, Delivery Expenses, Stock Transfer, Stock to Expense, Stock Item purchase date.
2. Leave the date field editable exactly as it is today — only the default value changes.
3. In the Digi Katha calculation, keep the fixed opening, the previous-days carry forward and today's movements exactly as they are now. No formula change, no filter change.
4. Apply the same change to the installed desktop and Chrome copies so they behave identically after their next start.

Already-saved records keep their stored dates; nothing existing is rewritten.

## Technical notes

- `today()` in `src/lib/format.ts` returns `new Date().toISOString().slice(0,10)` (UTC). Entry screens listed above call it for their default date.
- `businessToday()` in `src/lib/business-date.ts` already applies the configured time zone, business day start time and month start day.
- Change is limited to the default value passed into each form's initial state; `digi_katha_summary` and the report engine stay as they are.
