# Katha (Loan) Audit + Katha option for Delivery Expenses

Goal: every katha entry in the system counts once — nothing missed, nothing doubled — and Delivery Expenses gets a "Katha" option that adds to Loan To Give.

## 1. Delivery Expenses — add "Katha"

- Payment status choices become: Unpaid, Paid, Katha (today only Unpaid/Paid exist).
- Katha means the amount is owed, so it is added to **Loan To Give** on the Digi Katha Closing page, on the entry's own date.
- Paid still requires Cash or Online. Katha requires no method.
- The list shows a Katha badge and a Katha total, same style as Expenses.
- When you later settle it, change the entry from Katha to Paid — that removes it from Loan To Give. Do not also record a "Loan Paid Out" money movement for the same bill, or it would be subtracted twice.

## 2. Digi Katha Closing — new line

Loan To Give card gets a new row, in both the previous-balance carry-forward and today's figures:

```text
Loan To Give = Opening
             + Katha Purchases
             + Katha Expenses
             + Katha Delivery Expenses   <-- new
             + Loan Taken (Loan Get In)
             - Loan Paid (Loan Paid Out)
```

Loan To Get stays as it is: Opening + unpaid part of katha POS bills + Loan Given − Loan Recovered.

## 3. Full audit — no duplicate, no missed entry

Checked every place a katha amount can be created; the fixes below are the only gaps found.

- **POS katha bills** — counted once, only the unpaid remainder; staff bills stay out (they sit in the staff member's own katha). Pending, hidden and deleted bills excluded. No change.
- **Purchases (Katha)** — counted once from the purchase total. The stock rows a purchase generates are not counted again, so no doubling. No change.
- **Expenses (Katha)** — counted once. Fix: expenses that are actually stock-to-expense transfers (no money owed to anyone) will be excluded from katha, so an internal transfer can never inflate Loan To Give.
- **Delivery Expenses** — currently has no katha option at all, so katha delivery bills are missed entirely. Fixed by section 1.
- **Money Movement** — Katha Out / Katha In / Loan Get In / Loan Paid Out counted once each. Movements the system creates automatically for a paid purchase or a sale are plain transactions and are correctly left out of the loan book. No change.
- **Cut-off date** — only entries on or after the opening date count, so old history can never be added on top of the opening you set. No change.
- **Deleted entries** — every source already skips deleted rows. No change.
- Purchases list gets a "Katha only" filter so katha purchases can be reviewed against the closing page (it currently offers only Paid/Unpaid).

## 4. Verification after the change

Recompute today's Loan To Get and Loan To Give from the raw entries and confirm the page matches to the rupee, and that the delivery-expense katha total appears exactly once.

## Technical notes

- Migration updating `digi_katha_summary` to add a `delivery_expense_katha` term (previous-carry and current-day) and to exclude `expenses.is_stock_transfer = true` from `expense_katha`.
- `delivery_expenses.payment_status` accepts `katha`; UI in `src/routes/_authenticated/delivery-expenses.tsx`.
- Mirror the same function and status into the offline copies: `public/seed/schema.sql`, `electron/db/schema.sql`, and an idempotent startup upgrade in `src/lib/local-db/upgrades.ts` so existing installed Chrome/desktop databases pick it up.
- No change to sale, stock, report or salary logic.
