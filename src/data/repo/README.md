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

## Phase 5F / 5G / 5H — purchases, POS and inventory audit

The cloud implementation was traced before anything was written. Result:

### 5F — Purchases: CLOUD-ONLY (blocked)

The screen writes `purchases` + `purchase_items` as plain rows, but the cloud
does the rest through triggers:

* `trg_purchases_cash_movement` (BEFORE INSERT/UPDATE/DELETE, `fn_purchase_cash_movement`)
  creates/deletes a `cash_movements` row with a **server-generated UUID** and
  `business_date_of(now())` evaluated at cloud-commit time, and writes the
  derived `purchases.cash_movement_id`.
* `trg_purchase_items_apply` (`fn_purchase_item_apply`) inserts/deletes the
  `stock_purchases` ledger row, again with a server-generated UUID.

An offline purchase would either (a) mint local UUIDs for those child rows,
which the same triggers would then duplicate at sync time, or (b) skip them,
leaving local stock and local cash wrong until the next reseed. It would also
book an offline purchase into the cash movement of the day it *syncs*, not the
day it happened. Neither is acceptable for money, so purchases stay on the
cloud path unchanged. Note: `fn_purchase_recalc_wac` exists but is attached to
no trigger — purchases currently do not move WAC at all, so there is no WAC
parity work to port.

### 5G — Sales / POS: CLOUD-ONLY (blocked)

* `sales.invoice_no` defaults to `'INV-' || nextval('invoice_seq')` — a
  **Postgres sequence**. A device cannot allocate a number offline without
  either colliding or changing the invoice format that is printed, searched
  and shown across the app.
* `save_sale` / `update_sale` require `auth.uid()`, upsert `customers` and
  mutate their aggregates (`total_orders`, `total_purchases`,
  `outstanding_balance`).
* `sales` carries `trg_sale_staff_katha` → `recompute_staff_katha` and
  `trg_sale_cash_movement_cleanup`; staff/Katha is explicitly out of scope for
  this phase.

POS therefore keeps its existing cloud path in full.

### 5H — Inventory: manual stock adjustments are offline-capable

`stock_adjustments` was audited and has **no triggers and no RPC**: the
Products screen inserts one plain ledger row, and the Remaining quantity is
recomputed client-side by the inventory engine (and by
`rebuild_item_remaining`) as a simple `SUM(quantity)` over that ledger. That
insert is reproducible locally without loss, so it is routed through
`src/data/writes/inventory.ts` → `createStockAdjustment` → one SQLite
transaction (row + audit event + outbox) → the existing sync engine.

Still cloud-only inside inventory: `rebuild_item_remaining` (writes the derived
`current_stock`), opening-stock snapshots, monthly overrides, stock transfers,
stock-to-expense transfers and WAC recomputation.

### 5G — Purchase READS are offline-capable (writes remain cloud-only)

The purchase *write* audit above is unchanged: purchases still save through the
cloud so the two triggers keep owning `cash_movements` and `stock_purchases`.
Reading them, however, needs no server logic — the Purchases screen issues a
single embedded select:

```
purchases select *, purchase_items(*, products(name,unit), stock_items(name,unit))
        where deleted_at is null order by date desc
```

`src/data/reads/purchases.ts` reproduces that exact shape from the local mirror
(`purchases`, `purchase_items`, `products`, `stock_items`) with a pure
assembler, so the screen receives identical objects whether it read the cloud
or SQLite. `purchases`, `purchase_items` and `stock_purchases` are therefore in
`LOCAL_READ_TABLES`; the usual health gate still applies, and a table the seed
left empty falls back to the cloud.

Parity is proven twice: `purchases.test.ts` compares the assembler output
field-for-field against the literal PostgREST shape, and
`purchases.sqlite.test.ts` writes rows into the real `cloud_*` mirror and reads
them back through the same path, asserting ordering, soft-delete filtering and
exact money/quantity round-trips.

### 5L — Offline auth foundation

`src/data/auth/offline-identity.ts` adds `_local_identities` and
`_local_sessions`. The design constraints, all covered by tests:

* **No secret is ever stored.** The unlock code is kept only as a PBKDF2-SHA-256
  hash + per-identity salt; `assertNoSecrets` rejects anything token-shaped
  (JWTs, `sb_secret_*`, `refresh_token`) before it can be written.
* **No session token is stored.** `_local_sessions` holds ids, role, device,
  timestamps and origin — nothing replayable against the cloud.
* **Enrolment requires the cloud.** A device can only be enrolled while online
  and authenticated; there is no offline account creation.
* **Offline access expires.** Each identity carries a grace window from the last
  verified online contact; past it, offline unlock is refused until the user
  signs in online again.
* **Failed attempts lock the device**, sessions expire, logout revokes
  immediately, and `reconcileIdentity` applies the cloud's role (narrowing only)
  or revokes the identity and kills its sessions when the account is gone.

This is foundation only: it gates local UI/read access, never cloud
authorization. Every cloud call still carries a real Supabase token and is
still checked by RLS.

## Phase 5J / 5K — derived calculations & offline reporting reads

**Audit result:** none of the reporting SQL functions
(`monthly_financial_summary`, `category_monthly_report`,
`dashboard_category_cards`) is called by the UI. Every reported number is
already computed client-side by `src/lib/report-engine.ts` from fourteen raw
row sets, so no server calculation had to be ported.

What changed:

* `report-engine.ts` was split into `fetchCloudReportInputs()` (I/O) and
  `computeReport()` (pure). **The formulas were not touched** — cloud and local
  inputs run through the same function, so a report cannot differ by source.
* `src/data/reads/report-inputs.ts` loads the same row sets out of the mirror,
  rebuilds the PostgREST embeds (`sale_items → products`,
  `production_batch_items`) and re-applies the exact WHERE clauses of the cloud
  queries in `filterReportInputs()`.
* **Online always reads the cloud.** Sales, purchases and stock movements are
  still cloud writes, so the mirror can be behind. Local reporting is served
  only when `navigator.onLine === false`, with a verified seed and every core
  table (`sales`, `sale_items`, `products`) non-empty. The result carries
  `source: "local"` and `asOf` (seed timestamp) so staleness is visible.
* Parity is proven in `src/data/reads/report-inputs.test.ts`: the same fixture
  expressed as cloud rows and as flat mirror rows produces field-for-field
  identical `computeReport` output (compared with `calc-parity`).

## Phase 10 — cutover

* `VITE_ENABLE_LOCAL_SQLITE` and `VITE_ENABLE_LOCAL_WRITES` are **ON by
  default**; only an explicit `false`/`0`/`off`/`no`/`disabled` turns them off.
* `localReadHealth()` now additionally requires a passing SQLite
  `integrity_check` + `foreign_key_check` and an authenticated device (live
  cloud session or Phase 7 enrolled local identity). Any failure degrades to
  the cloud repository — a corrupt or unauthenticated local database is never
  authoritative.
* `operations.ts` is the machine-readable audit: every table read/write, every
  RPC, and every screen is classified `LOCAL`, `LOCAL+SYNC`, `CLOUD` or
  `CLOUD-ONLY`, with a reason. `operations.test.ts` fails if anything is
  missing or contradicts `entity-classification.ts`.
* Settings → "Offline capability" renders that matrix plus the live health
  gate, so owners can see exactly what works without Internet.
