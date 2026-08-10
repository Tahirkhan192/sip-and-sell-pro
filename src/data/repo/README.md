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
