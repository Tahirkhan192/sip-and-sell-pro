
# Local-First Architecture & Migration Plan

This plan is architecture and design only. No runtime behavior changes until you approve each phase individually. Existing data, features, UI, and reports remain untouched during Phase 1.

---

## 1. Current State (baseline)

**Stack:** TanStack Start (React 19) in the browser + Lovable Cloud (Postgres via Supabase) as the only data store. Every page in `src/routes/_authenticated/*` calls `supabase.from(...)` directly. Server-side Postgres functions (`save_sale`, `update_sale`, `restore_sale_stock`, etc.) enforce ACID for invoices + stock + money movement.

**Tables in use (24):** sales, sale_items, purchases, purchase_items, stock_purchases, stock_items, products, categories, recipes, production_batches, production_batch_items, customers, suppliers, expenses, expense_categories, delivery_expenses, cash_movements, money_movement_subcategories, monthly_stock_overrides, daily_closings, stock_transfers, branches, employees, user_roles, audit_log, settings.

**Gaps that force this project:**
- No offline capability (browser can't reach Postgres without internet).
- Reports scan `sales` + `sale_items` on every load.
- No client-side idempotency — a retried save can create a duplicate invoice.
- No change tracking beyond `updated_at`.

---

## 2. Target Architecture

```text
+---------------------------------------------------+
|                 Browser (Client)                  |
|                                                   |
|   UI (unchanged)                                  |
|      |                                            |
|      v                                            |
|   Repository layer  (new)  <----- single API      |
|      |                                            |
|      v                                            |
|   Local SQLite (wa-sqlite + OPFS)   <-- primary   |
|      |         ^                                  |
|      |         |  triggers -> summary tables      |
|      v         |                                  |
|   Outbox queue + Sync Worker (Web Worker)         |
|      |         ^                                  |
+------|---------|----------------------------------+
       |         |
       v         |  realtime + pull
+---------------------------------------------------+
|          Lovable Cloud (Postgres)                 |
|   - authoritative long-term store                 |
|   - RLS unchanged                                 |
|   - new columns: version, device_id, deleted_at   |
|   - server-side conflict resolution RPC           |
+---------------------------------------------------+
```

**Key decisions:**
- **Local DB:** wa-sqlite with OPFS persistence (real SQLite in the browser, survives reload, ~GB capacity). Fallback: IndexedDB via Dexie if OPFS unavailable (older Safari).
- **Sync engine:** custom outbox + pull loop. No ElectricSQL / PowerSync — they'd require schema and RLS changes we don't want on your live data.
- **Cloud role:** authoritative store, backup target, cross-device sync hub. UI never reads from cloud directly after Phase 3 — always local first.
- **ACID:** all multi-table writes (invoice + stock + recipe consumption + money movement) run inside a single local SQLite transaction, then are pushed as one atomic operation to the existing Postgres RPC (`save_sale` etc.) so both sides stay ACID.

---

## 3. Local SQLite Schema

Mirrors Postgres 1:1 for the 24 tables, plus mandatory sync columns on every row:

```text
id             TEXT PRIMARY KEY   -- UUID (generated client-side)
business_date  TEXT               -- YYYY-MM-DD
business_time  TEXT               -- HH:MM:SS
created_at     TEXT NOT NULL
updated_at     TEXT NOT NULL
deleted_at     TEXT NULL          -- soft delete
version        INTEGER NOT NULL   -- monotonic per row
device_id      TEXT NOT NULL      -- this browser's install
sync_status    TEXT NOT NULL      -- 'local' | 'pending' | 'synced' | 'conflict'
server_version INTEGER NULL       -- last version confirmed by cloud
```

**Summary tables (new, local only, maintained by triggers):**
- `summary_daily_sales(business_date, total_sales, total_qty, cash, online, katha, delivery)`
- `summary_category_sales(business_date, category, sales, qty, cogs)`
- `summary_product_sales(business_date, product_id, qty, revenue, cogs)`
- `summary_dashboard(business_date, revenue, cogs, gross_profit, expenses, delivery_profit, net_profit)`

Reports read only from summary tables. Detail tables are queried only for drill-down.

**Indexes (local + cloud):**
- `sales(business_date)`, `sales(invoice_no)` UNIQUE, `sales(customer_id)`, `sales(status)`
- `sale_items(sale_id)`, `sale_items(product_id)`
- `stock_purchases(date, product_id)`, `stock_purchases(supplier_id)`
- `expenses(date, category_id)`, `cash_movements(business_date, kind)`
- `products(category)`, `products(name)`, `stock_items(category)`
- Every table: `(sync_status)`, `(updated_at)` for the sync scanner.

**Outbox table (local only):**
```text
outbox(id, table_name, row_id, op, payload_json, attempts, last_error, created_at)
op in ('insert','update','delete')
```

---

## 4. Sync Engine

**Push (local → cloud), runs in a Web Worker:**
1. Scan `outbox` in FIFO order.
2. For each entry, call the existing Postgres RPC (`save_sale`, `update_sale`, generic upsert for simple tables) with `{ row, base_version }`.
3. On success: mark row `synced`, store `server_version`, delete outbox entry.
4. On version mismatch: mark row `conflict`, keep outbox entry, surface to conflict queue.
5. On network error: exponential backoff (1s, 5s, 30s, 2m, 10m, 30m, cap 1h).

**Pull (cloud → local):**
1. Subscribe to Supabase Realtime on all tables (already available).
2. On event, upsert into local SQLite if `event.version > local.version`.
3. Every 5 min (and on tab focus): incremental pull `WHERE updated_at > last_pull_at` as a safety net for missed realtime events.

**Ordering guarantees:**
- Outbox is per-device FIFO.
- Dependency order enforced by natural FKs (e.g. product must exist before sale_item referencing it).
- Invoices are pushed as one RPC payload containing sale + sale_items + stock deltas + money movement — the server transaction is unchanged.

---

## 5. Conflict Handling

**Detection:** every update sends `expected_version`. Postgres RPC checks `WHERE version = expected_version`. Mismatch = conflict.

**Resolution rules:**
| Row type | Default policy |
|---|---|
| products, customers, suppliers, categories, recipes, settings | Last-Writer-Wins by `updated_at` with owner review UI |
| sales, purchases, expenses, cash_movements, stock_transfers | Never auto-merge. Flag both versions. Owner picks. |
| Soft-deleted row edited elsewhere | Delete wins. |
| Stock levels | Never synced directly — always recomputed from sales + purchases + transfers on the authoritative side. |

**Conflict UI:** new `/settings/sync` page (Phase 5) lists conflicts, shows both versions side by side, owner-only.

---

## 6. Data Integrity Rules

- All writes go through the repository layer — no route calls `supabase.from(...)` directly after Phase 3.
- Every mutation runs in a local SQLite `BEGIN...COMMIT`. Any failure rolls back everything and no outbox entry is created.
- `invoice_no` uniqueness enforced by local `UNIQUE` index AND server constraint.
- Client generates UUIDs; server never generates IDs for synced rows.
- Validation (negative stock, broken recipe links, missing FK) runs pre-transaction in the repository.

---

## 7. Backup & Restore

- **Automatic:** nightly (business-day boundary) dump of the entire local SQLite file into an encrypted blob (AES-GCM, key derived from user password via PBKDF2), uploaded to Supabase Storage bucket `backups/{user_id}/`.
- **Manual:** Settings → "Download backup" (encrypted `.db` file) and "Restore from backup".
- **Retention:** last 30 daily + last 12 monthly.
- Backup includes the outbox so an unsynced-then-restored device does not lose pending writes.

---

## 8. UUIDs & Versioning

- All PKs become client-generated UUIDs. Existing integer/UUID IDs are preserved (already UUIDs in your schema — verified against `supabase-tables`).
- `version` starts at 1, incremented on every update by the writer.
- `device_id` generated once per browser install, stored in OPFS + localStorage backup.
- `invoice_no` remains the human-readable identifier; it stays unique globally via a per-branch counter allocated by the server on first sync (prevents two offline devices minting the same number).

---

## 9. Migration Phases

Each phase is a separate approval + implementation cycle. No phase modifies user-visible behavior of the previous phase's stable surface.

### Phase 1 — Cloud schema prep (this plan)
**Deliverable:** this document. No code changes.

### Phase 2 — Cloud schema alignment (low risk)
- Migration adds `version INTEGER DEFAULT 1`, `device_id TEXT`, ensures `deleted_at`/`updated_at`/`created_at` on every synced table.
- Add missing indexes.
- Add server-side RPC `sync_upsert(table, row, expected_version)` returning `{ok, server_version, conflict?}`.
- **UI:** no change. **Risk:** additive only, all defaults populated.
- **Test gate:** every existing screen still works; run full report against known dates and compare totals to pre-migration snapshot.

### Phase 3 — Local SQLite + repository layer (shadow mode)
- Add wa-sqlite + OPFS, create local schema, create empty summary tables + triggers.
- Introduce `src/data/repo/*.ts` — the only module that talks to storage.
- On login, seed local DB from cloud (paged pull of all 24 tables).
- **Reads and writes still go to cloud.** Local DB is populated in the background and validated against cloud results (mismatch logged, not surfaced).
- **Test gate:** 48h of shadow-mode running with zero divergence in logs.

### Phase 4 — Local-first reads
- Switch reads (dashboard, reports, sales list, POS product picker) to the repository layer, which reads from local SQLite + summary tables.
- Writes still go cloud-first, then mirrored to local.
- Realtime pull keeps local fresh.
- **Test gate:** measured report load time < 200ms; totals identical to cloud query for the last 90 business days.

### Phase 5 — Local-first writes + outbox + conflict UI
- Writes go local-first inside a local transaction.
- Outbox pushes to cloud in background worker.
- Conflict queue + resolution UI ships.
- Offline banner appears when sync is behind > 30s.
- **Test gate:** airplane-mode test creating invoices, purchases, expenses, then reconnecting → all synced, zero duplicates, zero data loss.

### Phase 6 — Backups + hardening
- Encrypted backup/restore.
- Scheduled backup job.
- Load test with 100k invoices in local DB.
- Remove any remaining direct `supabase.from(...)` calls in routes.

---

## 10. Guarantees During Migration

1. **Data safety:** Phases 2–4 are additive. Cloud remains the source of truth until Phase 5. If Phase 5 misbehaves, we flip a feature flag back to Phase 4 (cloud-first writes) with zero data loss because the outbox is drained before the flip.
2. **Feature parity:** every existing route is smoke-tested after each phase.
3. **No duplicates:** enforced at three layers — client-generated UUIDs, local UNIQUE index on `invoice_no`, server UNIQUE constraint + `sync_upsert` version check.
4. **No missing records:** outbox is durable in OPFS, survives crashes; realtime + 5-min pull catches any missed events.
5. **No broken reports:** summary tables are validated against detail-table aggregates on every write in Phase 4; mismatch logs an error and rebuilds the affected summary row.
6. **No UI redesign:** only two new screens ship — conflict resolution and backup/restore, both under Settings.

---

## 11. Technical Details (skip if non-technical)

- **wa-sqlite** chosen over sql.js: real SQLite (triggers, WAL-ish behavior via OPFS SAH pool), persistent, ~2ms per simple query.
- **Repository layer**: one file per aggregate (`SalesRepo`, `PurchasesRepo`, ...) exposing `list/get/save/delete` returning plain DTOs. Existing hooks (`useReportEngine`, etc.) migrate to call the repo instead of `supabase.from`.
- **Server RPC `sync_upsert`**: takes JSONB row + expected_version + table name, dispatches to per-table handlers that reuse existing logic (`save_sale`, `update_sale`) where possible. Keeps all existing stock/COGS invariants server-side.
- **Realtime**: one subscription per synced table, filtered by RLS. Payload → local upsert if `new.version > local.version`.
- **Web Worker**: sync loop runs off the main thread so UI never blocks even during large pulls.
- **Feature flags**: `local_first_reads`, `local_first_writes` in `settings` table, togglable per user for safe rollout.

---

## 12. What I need from you before Phase 2

1. Confirm this plan.
2. Confirm the phase gating (no phase starts until previous is stable for at least 48h of your real usage).
3. Confirm the two new UI surfaces (conflict list, backup/restore) are acceptable under Settings.
4. Confirm you're okay with a one-time full pull on first login after Phase 3 (may be 5–30s depending on data size).

Approve this plan and I'll proceed to Phase 2: the cloud schema alignment migration, presented for your review before it runs.
