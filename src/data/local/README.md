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

## Design summary

**Storage.** `@sqlite.org/sqlite-wasm` + OPFS SAH Pool VFS. Persistent per browser origin. In-memory fallback logged as a warning when OPFS is unavailable; a real IndexedDB fallback ships in Phase 3.

**Sync envelope.** Every business row carries `id` (UUID), `created_at`, `updated_at`, `deleted_at`, `business_date`, `business_time`, `version`, `server_version`, `device_id`, `sync_status`.

**Integrity.**

- `PRAGMA foreign_keys = ON` enforced at open time.
- Referential integrity via `REFERENCES ... ON DELETE RESTRICT` (soft delete is the real delete path).
- `CHECK` constraints on discriminated unions (a recipe row references either a product OR a stock item, never both/neither).
- Unique invoice numbers scoped to non-deleted rows.

**Indexes.** Every table has `(sync_status)` and `(updated_at)` for the sync scanner, plus domain indexes on business date, customer, supplier, product, category, invoice number, and status.

**Summary tables.** `summary_daily_sales`, `summary_category_sales`, `summary_product_sales`, `summary_dashboard`. Local-only, never synced, always recomputable. Populated by triggers introduced in Phase 4.

**Outbox.** Local-only queue for the sync engine. Empty in Phase 2; populated when writes flip to local-first in Phase 5.

## Verifying inertness

```
$ rg -n "from ['\"]@/data/local" src/
# → no matches
```

If that command ever returns a hit before Phase 3, the isolation guarantee is broken.

## What ships next

Phase 3 will:

1. Add a top-level provider that calls `openLocalDb()` after login.
2. Add the seeding routine that pages every cloud table into local SQLite once.
3. Introduce `src/data/repo/*.ts` — the only allowed callers of `openLocalDb()`.
4. Run in shadow mode: cloud is still authoritative; local is validated against cloud in the background.
