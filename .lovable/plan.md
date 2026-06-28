# POS Complete Business Logic — Implementation Plan

Big change. Confirm before I build.

## 1. Database (one migration)

### `products` — add columns
- `unit` text not null default `'pcs'` (`pcs` | `kg` | `ltr`)
- `selling_method` text not null default `'fixed'` (`fixed` | `weight`)
- `allow_negative_stock` boolean default false

`sale_price` keeps its meaning: price per piece for `fixed`, price per KG/LTR for `weight`.

### `recipes` (new) — linked products / BOM
```
id, parent_product_id (fk products), component_product_id (fk products),
quantity numeric not null,          -- amount of component per 1 parent sold
unit text not null,                 -- kg / ltr / pcs (informational)
deleted_at, created_at, updated_at
```
GRANT + RLS + service_role as per project rules.

### `sales` — add columns
- `cash_paid numeric default 0`
- `online_paid numeric default 0`
- `order_type text default 'walk_in'` (`walk_in` | `take_away` | `delivery`)
- `delivery_boy text`
Keep existing `payment_method` for back-compat (derived = cash if cash_paid>0 && online=0 etc).

### `sale_items` — add columns
- `unit text`
- so quantity can be decimal (already numeric).

### `settings` (new, single row) — owner toggles
- `allow_negative_stock boolean default false`
- (room for future: tax %, currency, etc.)

### RPC rewrites
**`save_sale` / `update_pending_sale`** — accept items shape:
```
{ product_id, quantity, rate, total, unit }
```
Server recomputes `total = round(quantity * rate, 2)` defensively; persists rate as `price`. Stock deduction order:
1. If product has rows in `recipes` → for each component, subtract `quantity_sold * recipe.quantity` from component product `current_stock` and from matching `stock_items`.
2. Else → subtract `quantity_sold` from product's own `current_stock` and matching `stock_items`.

Negative-stock guard: if `settings.allow_negative_stock = false` and resulting stock < 0 → raise. (POS UI shows a soft warning before save regardless.)

**`restore_sale_stock`** — mirror new path (recipe-aware).

## 2. UI — POS rewrite (`src/routes/_authenticated/pos.tsx`)

Cart line columns: **Product | Unit | Qty | Rate | Total | ✕**

- Search field stays; results show name + category + stock badge.
- After add, line shows unit chip (`KG` / `LTR` / `PCS`).
- **Fixed products**: rate readonly (from product), qty editable → total auto.
- **Weight products**: three editable fields with live two-way bind:
  - edit qty → total = qty × rate
  - edit total → qty = total / rate
  - edit rate → total = qty × rate
  - last-edited-field tracking prevents loops.
- Live low-stock badge per line (red if requested > available; still allow save).
- Footer:
  - Order Type tabs: Walk-in / Take-away / Delivery (Walk-in forces delivery=0 and disables delivery boy)
  - Delivery Charges + Delivery Boy (only when Delivery)
  - **Payment** grid: Grand Total | Cash Paid | Online Paid | Remaining | Change
    - Remaining = max(0, Grand − Cash − Online); Change = max(0, Cash+Online − Grand)
  - Save Pending / Save Complete / Print Last

Keyboard: `/` focuses search, Enter adds first match, Tab cycles cart fields, Esc closes invoice search popover.

## 3. UI — Products page (`products.tsx`)
Add Unit + Selling Method selects. When `selling_method=weight`, label price as "Price per KG/LTR".

## 4. UI — Recipes (new page `recipes.tsx`)
Parent product → list of (component product, quantity, unit). CRUD + soft delete + duplicate. Added to AppShell nav.

## 5. UI — Settings (new minimal page `settings.tsx`)
Single toggle: Allow negative stock. Owner only.

## 6. Reports / Dashboard
No structural change — already category-driven and uses business_date. They automatically reflect new sale_items because COGS now flows through recipes:
- Update `category_monthly_report` so `sales_cogs` uses recipe expansion (sum of component cost_price × component qty) when recipes exist, else falls back to product cost_price as today.

## 7. Out of scope this round
- Barcode scanning, KDS, WhatsApp invoice, employee/role pages beyond existing — already future-stubbed.
- Tax/discount fields on invoice (not requested).

## Execution order
1. Migration (schema + RPC rewrites + report RPC update)
2. POS rewrite with live calc + payments + order type
3. Products form: unit + selling_method
4. Recipes CRUD page + nav entry
5. Settings page + negative-stock guard wiring
6. Smoke test: create weight product, recipe, sell, verify stock + reports

Approve and I'll build it straight through.
