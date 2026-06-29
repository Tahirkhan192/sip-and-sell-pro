# Café POS — Extension Plan (No Redesign)

Keeps every existing page, layout, route and feature intact. Only adds new tables, columns, a new Categories page, a Customers module, WhatsApp hook, payment/Katha status, and fixes the category-purchase report bug.

## 1. Database migration (single migration)

**`categories`** — extend existing table:
- add `description text`, `color text`, `icon text`, `active boolean default true`
- keep existing `name` (unique), `sort_order`, `deleted_at`
- soft-delete only when products exist; hard delete allowed otherwise

**`stock_items`** — add:
- `category text not null` (validated against `categories.name`)
- `supplier_id uuid`, `purchase_date date`, `notes text`
- trigger: on insert/update, if `category` is null → reject

**`stock_purchases`** — already has `category`. Add trigger:
- when `stock_item_id` is set, auto-fill `category` from `stock_items.category` (mirror of existing product trigger)

**`customers`** — extend (already has 8 cols). Ensure:
- `phone` unique (partial index where phone not null)
- `last_visit timestamptz`, `total_orders int`, `total_purchases numeric`, `outstanding_balance numeric`

**`sales`** — add:
- `katha boolean default false`
- `customer_id uuid references customers(id)`
- derive `payment_status` view-side: paid = (cash_paid+online_paid >= grand_total)

**RPC updates:**
- `save_sale` / `update_pending_sale`: accept `_customer_name`, `_customer_phone`, `_katha`. Upsert customer by phone, link `customer_id`, bump `total_orders`, `total_purchases`, `last_visit`, and `outstanding_balance += remaining` (subtract on edit/delete).
- `category_monthly_report` — **BUG FIX**: split `purchased_value` into `product_purchased_value` and `stock_purchased_value`. For each `stock_purchases` row:
  - if `product_id` → category from products
  - if `stock_item_id` → category from stock_items
  - Already grouping by `sp.category` which the new trigger fills correctly; add separate sums by source.
- New RPC `dashboard_category_cards(_from, _to)` returning per-category today/month sales, profit, orders, top product — driven by `categories` table so new categories appear automatically.

## 2. New page: Categories (`/categories`)

- Sidebar entry between Products and Stock Items.
- CRUD + search + sort + display order drag (or numeric input) + active toggle.
- Fields: name (unique), description, color (color picker), icon (lucide name text), display_order, active.
- Delete guard: if any product or stock_item references it, force "Mark Inactive" instead.

## 3. Stock Items page

- Add required Category dropdown (loads `categories` where active).
- Add Supplier select, Purchase Date, Notes fields to existing form.
- Block save if no category.
- No layout changes — fields appended to existing form grid.

## 4. Remove default zeros

- All numeric inputs across POS, Products, Purchases, Expenses, Stock Items: change `value={n}` to `value={n || ""}` and store as `null`/empty until typed. Calculated totals still render computed values.

## 5. Customers module

- New `/customers` page: list, search, view orders, edit, outstanding balance.
- POS: replace plain customer name input with combobox that searches `customers` by name/phone; on select fills name+phone; on save passes both to RPC which upserts.

## 6. POS payment & Katha UI

- Compute `remaining = grand_total - cash_paid - online_paid`.
- Badge:
  - remaining=0 → green "✓ FULLY PAID"
  - remaining>0 & katha=false → red "🔴 NOT PAID FULLY"
  - remaining>0 & katha=true → green "🟢 ADDED TO KATHA"
- "Add Remaining to Katha" checkbox enabled only when remaining>0.

## 7. Daily Sales / Sales page

- Add Status column with same 3 badges.
- Add filter chips: Fully Paid / Not Paid / Katha / Walk-in / Take-away / Delivery.

## 8. WhatsApp invoice (silent)

- After successful save, call new server fn `sendWhatsappInvoice({sale_id})`.
- Server fn: generate plain-text invoice summary, POST to WhatsApp Cloud API using `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` secrets.
- Wrap in try/catch — failure shows toast "WhatsApp not sent, saved" and adds a "Resend WhatsApp" button on the sale row. Invoice save never blocks on WhatsApp.
- If secrets not configured, skip silently with one-time toast.
- **Needs from user**: WhatsApp Cloud API token + phone number ID (or confirm to stub the integration until they provide them).

## 9. Dynamic dashboard & reports

- Dashboard: replace hardcoded category grid with map over `categories` (active) using new RPC. Cards: today sales, month sales, month profit, orders, top product.
- Reports page: same — iterate active categories. Show new columns: Product Purchases, Stock Item Purchases (separate), Stock Used, Gross Profit, Expenses, Net Profit, Current Stock Value, Best Seller.

## 10. Auto-refresh

- Already on TanStack Query. Add `queryClient.invalidateQueries` for `["dashboard"]`, `["reports"]`, `["sales"]`, `["stock"]`, `["purchases"]` inside each mutation's `onSuccess`. No manual refresh anywhere.

## 11. Edit invoice cascade

- `update_pending_sale` already restores stock then re-applies. Extend to:
  - recompute customer outstanding (subtract old remaining, add new)
  - re-evaluate katha flag
- All downstream pages refresh via query invalidation.

---

## What I need from you before building

1. **WhatsApp**: do you have a WhatsApp Cloud API token + phone number ID ready? If yes I'll request them via the secrets flow after the migration. If not, I'll build the hook + UI now and leave the send as a no-op stub you can enable later.
2. **Confirm execution order**: migration → Categories page → Stock fields → Customers → POS payment/Katha/customer combobox → Dashboard/Reports rewrite → WhatsApp.

Approve and I'll build straight through.
