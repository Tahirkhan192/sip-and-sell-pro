# Fix Digi Katha Closing – wrong "Previous Loan To Get / Give"

## What is wrong

The Digi Katha page adds your fixed opening balances on top of **every** katha entry ever recorded, including the ones that happened **before** the opening date.

Checked against your live data (opening dated 31 July 2026):

- Katha sales before 31 July: 439,585.76
- Katha purchases before 31 July: 113,819.66
- Katha expenses before 31 July: 27,850.00
- 8 katha money movements before 31 July

All of that is counted a second time, because the fixed opening (186,760 to get / 638,668 to give) already represents the position up to that date. So "Previous Loan To Get" and "Previous Loan To Give" are inflated, and each time the opening figure is corrected to make today look right, the error is carried into the following days.

The page also opens on the previous business day before 8am, because the business day starts at 08:00 — that part is working as configured, not a fault.

## The fix

1. The fixed opening is treated as the position **at the start of its date**. Only katha entries dated on or after that date are added to it. Anything older is already inside the opening figure and is no longer counted twice.
2. Same rule for both sides of the book:
   - Loan To Get: opening + katha sales + loan given − loan recovered, all from the opening date onward.
   - Loan To Give: opening + katha purchases + katha expenses + loan taken − loan repaid, all from the opening date onward.
3. The opening card gets a short line explaining that its date is the cut-off, so entries before it must not be added again.
4. Everything else on the page — layout, rows, printing, PIN protection, the daily figures — stays exactly as it is.

## Technical notes

- Change `digi_katha_summary(_date date)` so each "previous" and "today" aggregate carries an extra lower bound of `katha_opening.as_of_date` (inclusive).
- Applies to the cloud function (migration) and the mirrored copies in `public/seed/schema.sql` and `electron/db/schema.sql`, plus an idempotent re-create in `src/lib/local-db/upgrades.ts` so existing offline/Chrome databases pick the corrected function up on next start.
- No stored data is changed; only the way totals are read.
- Verification: run the corrected summary for today and for 31 July against the live data and confirm the previous balances match opening plus post-cut-off movements only.

## Note

Katha purchases and expenses are filtered on their own entered date, while katha sales use the business date. That mismatch is left untouched here — say the word if you want it aligned too.
