# Fix offline entries + Drive account switching

## What I verified

I signed the app in offline and wrote directly to the embedded local database:

- POS sale (`save_sale`), expense, stock-to-expense transfer, purchase and stock transfer all **do save** — the database itself is fine.
- The real defect is how dates come back out of the local database. Daily Closing shows rows as `2026-08-20T00:00:00.000Z` instead of `2026-08-20`, and today's saved sale shows as **Cash Sales Rs 0** while Cash Out shows Rs 632,080 for "today" — i.e. day matching is comparing a plain date (`2026-08-22`) against a full timestamp string, so entries land in the wrong day or vanish from lists, reports, POS, Daily Closing and Digi Katha.

In the cloud, the API returned `date` columns as `"YYYY-MM-DD"`. The embedded engine returns JavaScript `Date` objects, which are then converted to full ISO timestamps. Every screen that compares or displays a date string breaks.

## Fix 1 — Dates behave exactly like they did online

- Teach the local database engine which columns are real `date` columns (read once from the schema, same way array columns are already detected).
- Return those columns as plain `YYYY-MM-DD` strings, and keep `timestamptz` columns as full ISO strings (as the cloud did).
- Apply the same conversion on the way **in**, so filters like "date equals today" and "date between X and Y" compare like-for-like.
- Re-check the affected screens after the fix: POS save, Sales, Purchases, Expenses, Delivery Expenses, Money Movements, Stock Transfer, Daily Closing, Digi Katha, Reports.

## Fix 2 — Entry screens verified end-to-end offline

With dates corrected, drive each entry flow through the real UI with no network:
POS sale (cash/online/katha + change), Money Movement popup, Purchase with multiple items, Expense, Delivery Expense, Stock Transfer and Stock-to-Expense. Confirm each new record appears immediately in its own history, in Daily Closing for the right business date, and in Reports.

## Fix 3 — Changing the Google Drive account keeps the data

Today, switching account only changes which account is read from — the next pull can overwrite local data or the new account looks empty.

New behaviour when an account is changed in Settings:

1. Local data is never touched by the switch.
2. Immediately after switching, the current local database is exported and **pushed** to the new account, so the new Drive becomes a full copy.
3. Only after that push succeeds does normal sync (pull on start, push every few minutes) resume against the new account.
4. If the new account already holds a snapshot, ask which to keep — "Upload my data to this account" (default) or "Load this account's data into this computer" — instead of silently overwriting either side.

## Technical notes

- `src/lib/local-db/engine.ts`: add a date-column map to `Meta` and make `normalize` column-aware; `src/lib/local-db/postgrest.ts` passes column context and normalizes filter values for date columns.
- `src/lib/drive-sync.ts`: `writeDriveAccountKey` becomes async — set key, `exportFullBackup`, `pushToDrive(force)`, then restart the sync timer; add a conflict check against the remote snapshot's timestamp.
- `src/components/DriveAccountCard.tsx`: switch flow shows progress and the keep-which-copy choice.
- No schema changes, no data changes, no UI redesign.
