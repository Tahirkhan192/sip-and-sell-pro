# Local SQLite Database — Phases 2 & 3

## Status

**Inert.** These files exist but are not imported by any route, component, hook, or provider. Runtime behaviour is unchanged. Reports, POS, purchases, and every other screen still read and write exclusively to Lovable Cloud. The Phase 3 data copy runs only when the user explicitly invokes it from the browser console.

Phase 2's deliverable is the schema itself and the WASM plumbing to open it — not any behaviour change.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Full DDL: 24 business tables + 4 summary tables + outbox + local metadata. |
| `db.ts` | `openLocalDb()` lazy singleton that boots `@sqlite.org/sqlite-wasm` with the OPFS SAH Pool VFS. `withTransaction()` for ACID multi-writes. |
| `types.ts` | Row TypeScript types matching every SQLite table. |
| `migrate.ts` | Phase 3 copy from Lovable Cloud into local SQLite. Idempotent, verified, non-destructive. Not auto-invoked. |

## Design summary

**Storage.** `@sqlite.org/sqlite-wasm` + OPFS SAH Pool VFS. Persistent per browser origin. In-memory fallback logged as a warning when OPFS is unavailable; a real IndexedDB fallback ships in a later phase.

**Sync envelope.** Every business row carries `id` (UUID), `created_at`, `updated_at`, `deleted_at`, `business_date`, `business_time`, `version`, `server_version`, `device_id`, `sync_status`.

**Integrity.**

- `PRAGMA foreign_keys = ON` enforced at open time.
- Migrations run with `PRAGMA defer_foreign_keys = ON` so parent/child rows can be inserted in one transaction.
- Referential integrity via `REFERENCES ... ON DELETE RESTRICT` (soft delete is the real delete path).
- `CHECK` constraints on discriminated unions (a recipe row references either a product OR a stock item, never both/neither).
- Unique invoice numbers scoped to non-deleted rows.

**Indexes.** Every table has `(sync_status)` and `(updated_at)` for the sync scanner, plus domain indexes on business date, customer, supplier, product, category, invoice number, and status.

**Summary tables.** `summary_daily_sales`, `summary_category_sales`, `summary_product_sales`, `summary_dashboard`. Local-only, never synced, always recomputable. Populated by triggers in a later phase.

**Outbox.** Local-only queue for the sync engine. Empty for now; populated when writes flip to local-first in Phase 5.

## Verifying inertness

```
$ rg -n "from ['\"]@/data/local" src/
# → no matches (outside src/data/local itself)
```

If that command ever returns a hit before Phase 4, the isolation guarantee is broken.

## How to run the Phase 3 migration

The migration copies every row from Lovable Cloud into local SQLite, preserving UUIDs and relationships. It never writes to cloud and never deletes anything. Running it twice is safe — the second run is a no-op via `INSERT OR REPLACE` on the primary key.

1. Open the preview app and sign in as the owner.
2. Open browser DevTools → Console.
3. Paste and run:

   ```js
   const m = await import('/src/data/local/migrate.ts');
   const report = await m.migrateCloudToLocal();
   console.table(report.tables);
   console.log('mismatches:', report.mismatches);
   console.log('errors:', report.errors);
   console.log('ok:', report.ok);
   ```

4. Expected result: `report.ok === true`, `mismatches` is `[]`, `errors` is `[]`, and every row of the printed table has `cloudCount === localCount`.

To re-verify later without copying anything, run:

```js
const m = await import('/src/data/local/migrate.ts');
console.table((await m.verifyMigration()).tables);
```

To retry a single table:

```js
const m = await import('/src/data/local/migrate.ts');
await m.migrateCloudToLocalTables(['sales', 'sale_items']);
```

### Order and safety

Tables are copied parents-first (branches, categories, products, ...) then children (sale_items, purchase_items, ...). Each table's copy is a single SQLite transaction with `PRAGMA defer_foreign_keys = ON`, so foreign-key checks happen at COMMIT. If any row fails, the whole table rolls back and is reported in `report.errors`.

`user_roles` and `audit_log` are intentionally NOT migrated: they live server-side and never need a local copy.

## What ships next

Phase 4 (subject to your approval):

1. Add a top-level provider that calls `openLocalDb()` after login.
2. Introduce `src/data/repo/*.ts` — the only allowed callers of `openLocalDb()`.
3. Run in shadow mode: cloud is still authoritative; local is validated against cloud in the background.
