
# Café Management Overhaul

## 1. Database migration

**Drop:** `recipes`, `ingredient_movements`, `ingredients` tables and related triggers (`fn_purchase_to_movement`). Drop `save_sale` / `update_pending_sale` recipe-consumption logic.

**Modify `products`:** add `opening_stock numeric`, `current_stock numeric`, `minimum_stock numeric`, `deleted_at timestamptz` (soft delete). Keep `category` as free text (soft enum — UI restricts to 5).

**Modify `sales`:** add `delivery_charges numeric default 0`, `payment_method text default 'cash'` (cash/card), `deleted_at`.

**Modify `stock_purchases`:** point `product_id` at `products` instead of `ingredients` (drop old FK, add new). Add `supplier text`, `notes text`, `deleted_at`.

**New `stock_items`** (name-matched non-product stock): `id, name (unique), unit, opening_stock, current_stock, minimum_stock, purchase_price, deleted_at`.

**New `monthly_stock_overrides`:** `id, scope ('product'|'stock_item'|'category'), ref_id uuid null, category text null, year int, month int, opening_value numeric, closing_value numeric` — manual overrides for monthly reports.

**New `delivery_expenses`:** `id, date, fuel_cost, maintenance_cost, description, deleted_at`.

**Modify `expenses`:** ensure category enum-ish list (Salary, Electricity, Gas, Maintenance, Internet, Cleaning, Misc), add `deleted_at`.

**RPC updates:**
- `save_sale(_items, _customer_name, _status, _delivery_charges, _payment_method)` — inserts sale, line items, and for each line decrements `products.current_stock` where `lower(trim(products.name)) = lower(trim(item.name))` AND product not deleted; falls back to `stock_items` name match. Only on `status='completed'`.
- `update_pending_sale` updated to same shape (no stock change since pending).
- New `restore_sale_stock(sale_id)` used when a completed sale is deleted/soft-deleted to re-increment stock.

All tables get `deleted_at` for soft delete; queries filter `deleted_at IS NULL`.

## 2. Remove modules

Delete route files: `src/routes/_authenticated/ingredients.tsx`, `recipes.tsx`. Remove nav links in `AppShell`. Remove ingredient/recipe types from generated supabase types (regenerated post-migration).

## 3. Products page

Form fields: name, category (Select with 5 fixed options), sale_price, cost_price (= purchase price), opening_stock, current_stock, minimum_stock, active. Table: search, sort by column header click, filter by category dropdown. Soft delete via `deleted_at`. Edit/delete on every row.

## 4. Stock items page (new)

For non-product stock (e.g. raw materials). Same CRUD pattern. Name-match deduction also runs against this table.

## 5. POS page

Add Delivery Charges input above Save. Invoice preview shows line items + delivery + grand total. Sale payload includes delivery_charges and payment_method (cash default; card option for future). Pending search by customer name retained.

## 6. Sales page

Search, filter (date range, status, payment method), sort. Edit (pending only) and delete (with stock restore for completed) on every row.

## 7. Purchases page

Rework to reference products. Fields: date, product, supplier, qty, unit price, total (auto), notes. Add/edit/delete/search/sort. Purchases increment `products.current_stock` via trigger.

## 8. Expenses page

Category dropdown with fixed list, search, filter by category & date, sort. Edit/delete.

## 9. Delivery modules (new)

- **Delivery Report page** — lists sales with `delivery_charges > 0`: date, invoice no, customer, charges, status. Total at bottom.
- **Delivery Expenses page** — CRUD: date, fuel_cost, maintenance_cost, description. Search/filter.
- **Delivery Profit Report** — daily & monthly: sum(delivery_charges) − sum(fuel+maintenance).

## 10. Reports page (rebuilt tabs)

- **Dashboard** — cards: today sales, today profit, today delivery charges, today delivery profit, monthly sales, monthly business profit, monthly delivery profit, overall monthly profit, low-stock list (current_stock < minimum_stock).
- **Daily Report** — date, total sales, invoice count, cash, card, delivery charges, grand total.
- **Monthly Report** — month picker. Shows: monthly sales − opening stock + purchases − closing stock − general expenses = business profit; per-category profit; delivery profit; final overall = business + delivery.
- **Category Report** — per category: opening, purchased, sales, closing, COGS, gross profit, allocated expenses (proportional to sales), net profit, qty sold, revenue.
- **Stock Report** — opening, purchased, sold, remaining, stock value per product + stock_item.
- **Purchase / Expense / Sales Reports** — filterable tables with totals.

Opening/closing default to auto-from-movements; if a matching `monthly_stock_overrides` row exists for the (category|product, year, month) it overrides.

## 11. Shared

- `CrudDialog` already exists; add `SortableHeader`, `SearchInput`, `DateRangeFilter` reusable components.
- All list pages: search input, sort by header click, filter chips, soft delete with confirm.
- Printable invoice already in POS; update to include delivery line.
- Low-stock badge in nav.

## 12. Future-ready (schema only, no UI)

Add empty tables: `customers (katha)`, `suppliers`, `branches`, `employees`, `audit_log`. Add `branch_id` nullable on sales/purchases/expenses. No UI this pass.

## Execution order

1. Migration (drops + new tables + new RPCs + future-ready stubs).
2. Wait for type regen.
3. Delete ingredients/recipes routes + nav.
4. Rewrite products, purchases, expenses, POS, sales pages.
5. Add stock_items, delivery_expenses, delivery_report, delivery_profit pages.
6. Rebuild reports page with all tabs.
7. Update dashboard (`index.tsx`).
8. Verify build, click through preview.

This is large — expect ~10-15 file writes plus the migration. I'll proceed step by step.
