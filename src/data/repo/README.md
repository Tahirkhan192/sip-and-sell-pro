# Data Access Layer (offline preparation)

**Status: inert.** No route, component, or hook imports this folder. The
application still calls the Supabase client directly and behaves exactly as it
does in the locked master version. Nothing here changes a calculation, a
record, or a screen.

## Purpose

Prepare the architecture so the existing business logic becomes portable:

```text
Existing UI
   ↓
Existing Business Logic   (inventory engine, report engine, money-movement rules)
   ↓
Data Repository           (this folder)
   ↓
Database                  (cloud today → local SQLite later)
```

## Files

| File | Purpose |
|---|---|
| `types.ts` | The `DataRepository` contract, the full `TableName` union, and a small SQL-portable filter type. |
| `cloud-repository.ts` | Pass-through implementation over the existing Supabase client. Same queries the screens already make, transparently paged so nothing is capped at 1000 rows. |
| `local-repository.ts` | Skeleton for the future SQLite implementation, plus `REQUIRED_LOCAL_PROCEDURES` — every cloud RPC that needs a local twin. |
| `index.ts` | `repo()` accessor and `setRepository()` for the one-line switch-over. |

## Rules for the future conversion

- Preserve all existing IDs and foreign keys verbatim — never regenerate.
- No new business logic in the repository. Reads read, writes write.
- No automatic two-way sync, no conflict resolution, no overwriting in either
  direction. Any data transfer is a deliberate manual operation.
- Cloud stays active until the manual conversion is done.

## Local schema coverage

`src/data/local/schema.sql` mirrors every cloud table, including staff,
attendance, payments, carry-forward, Digi Katha opening, manual stock
adjustments, opening snapshots, user roles, and the audit log.

## Phase 5E — offline-first expenses

`expenses` is the first transactional table with a local write path, and only
in its plain, bookkeeping-only form.

Audit that allowed it: the cloud `expenses` table has **no triggers**, and no
cash movement, stock quantity or balance is derived from an expense row. The
reports simply read it.

| Operation | Path |
|---|---|
| Add / edit / soft delete a plain expense | Local SQLite → outbox → cloud sync |
| Anything with `is_stock_transfer = 1` or `payment_method = 'stock_transfer'` | Cloud only, always |
| Delivery expenses | Cloud only (different table, out of scope) |

Stock-transfer expenses move product and stock-item quantities through
`stock_to_expense_transfer`, `update_stock_transfer_expense` and
`delete_stock_transfer_expense`. Writing only the money half offline would
leave stock wrong, so three independent gates block it: the column contract
(`is_stock_transfer` and every `source_*` column non-writable,
`payment_method` limited to cash/online), the worker `rowGuard`, and the
routing in `src/data/writes/expenses.ts`.

Reads go through `listExpenses()` in `src/data/reads/reference.ts`, so an
expense created offline appears in the list immediately.

Proof: `src/data/local/mutations/expenses.sqlite.test.ts`.
