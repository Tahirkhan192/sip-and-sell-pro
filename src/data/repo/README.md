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
