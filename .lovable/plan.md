# Katha Detail List — cross-check every entry

A new page that lists every single katha entry behind the Digi Katha Closing totals, so you can tick them off one by one and see immediately if something is missing or counted twice.

## Where it lives

- New page "Katha Details" in the menu, right under Digi Katha Closing.
- The Digi Katha Closing page gets a "View details" button that opens it for the same date.

## What it shows

Two columns, exactly matching the closing page:

**Loan To Get**
- Katha POS bills — invoice no, business date, customer, bill total, paid, unpaid amount counted
- Loan Given (Katha Out) — date, amount, source (cash/online), note
- Loan Recovered (Katha In) — same, shown as minus

**Loan To Give**
- Katha Purchases — date, supplier, category, amount
- Katha Expenses — date, category, description, amount (internal stock-to-expense transfers are excluded and not listed)
- Katha Delivery Expenses — date, fuel + maintenance, description
- Loan Taken (Loan Get In) — date, amount
- Loan Paid (Loan Paid Out) — date, amount, shown as minus

Each section shows its own count and total. At the bottom:

```text
Fixed Opening (31-07-2026)  +  all listed entries  =  Current Loan To Get / To Give
```

and both figures are compared against the Digi Katha Closing page. If they ever differ, a red warning line appears naming the difference — that is your miss-entry alarm.

## Date range

- Default: from the fixed opening date (31 July 2026) up to the business date you were viewing — this is the exact set of entries making up today's balance.
- Two date boxes to narrow it to a single day or any period.
- Quick buttons: Today, Yesterday, Since opening.

## Rules applied (same as the closing page, nothing new)

- Only entries on or after the opening date.
- Katha bills count the unpaid remainder only; staff bills excluded (they belong to staff katha).
- Deleted, hidden and pending bills excluded.
- Stock-to-expense transfers excluded from katha expenses.
- Sales count by business date; purchases, expenses, delivery expenses and money movements count by the date on the entry.

## Also

- Print / PDF button, same style as the other pages.
- Each row is clickable and jumps to that entry on its own page (bill, purchase, expense, money movement).

## Technical notes

- New `digi_katha_entries(_from date, _to date)` SQL function returning a jsonb list per source (id, date, label, amount, sign) plus per-source totals; reuses the identical filters already in `digi_katha_summary`, so the two can never drift.
- Migration on the cloud database, mirrored into `public/seed/schema.sql`, `electron/db/schema.sql` and an idempotent re-create in `src/lib/local-db/upgrades.ts` so installed Chrome/desktop copies pick it up at next start.
- New route `src/routes/_authenticated/katha-details.tsx` + menu entry in `src/lib/menu-visibility.ts` and `src/components/AppShell.tsx`.
- Read-only: no stored data is changed, no existing calculation is altered.
