# Café Management Upgrade Plan

## 1. Database changes (single migration)

**New `categories` table** (future-ready, owner-editable later):
- `id uuid pk`, `name text unique not null`, `sort_order int`, `deleted_at timestamptz`
- Seeded with: Karahi, Fast Food, Snacks, Juices, Cold Drinks, **Biryani** (new)
- RLS: authenticated read; admin write
- `products.category` and `stock_purchases` keep using text name (soft FK to `categories.name`) so existing rows stay valid. New rows validated by trigger that ensures `category` exists in `categories` and is not soft-deleted.

**Products**: make `category` NOT NULL (after backfilling any nulls to 'Snacks'). UI dropdown sourced from `categories` table.

**Stock purchases**: add `category text not null` (backfill from joined product's category; for `stock_item` rows default to 'Snacks' or pick from form). New trigger keeps `category` in sync with chosen product on insert/update.

**Business-day helper**:
```sql
create function business_date(ts timestamptz)
returns date language sql immutable as $$
  select ((ts at time zone 'Asia/Karachi') - interval '8 hours')::date
$$;
```
All report queries use `business_date(sale_date)` etc. instead of `sale_date::date`.

**Monthly stock snapshot RPC** `category_monthly_report(_month date)`:
Returns per-category: opening_value, purchased_value, sales_revenue, sales_cogs, closing_value, gross_profit, expenses_allocated, net_profit. Opening = manual override from `monthly_stock_overrides` if exists, else previous month's closing. Closing = opening + purchased − COGS-of-sales for category (valued at avg cost). Expenses allocated by category-sales share.

## 2. Frontend changes

**Categories source**: new `src/lib/use-categories.ts` hook → React Query fetch from `categories` table. Replaces hardcoded `CATEGORIES` in `src/lib/categories.ts` (file kept as fallback constant only).

**Purchases page**: add required **Category** select (sourced from categories table). Required even for stock-item purchases. Existing product select filters by chosen category.

**Products page**: enforce required category dropdown (same source). No save without category.

**Reports page** (`reports.tsx`) — full rewrite into tabs:
- **Daily** — uses business-date filter
- **Monthly Dashboard** — month picker; shows Overall + per-category cards (Qty/Revenue/Gross/Net), plus footer: Monthly Sales, Expenses, Business Profit, Delivery Profit, Final Profit
- **Category P&L** — per-category table: Opening / Purchased / Sales / Closing / Gross / Expenses / Net (with manual opening-override editor)
- **Monthly Stock** — per product: Opening, Purchased, Sold, Remaining, Closing
- **Sales / Purchases / Expenses** tables with filters

**Filter presets** (shared component `DateRangePicker`): Today, Yesterday, This Week, This Month, Last Month, Custom — all computed against business date in Asia/Karachi.

**Dashboard** (`index.tsx`): add cards for Today's Business Profit, Today's Total Profit, and a **Category Sales Summary** grid showing Today's Sales / Monthly Sales / Monthly Profit per category. All metrics use business-date.

**Business-date util** (`src/lib/business-date.ts`): functions for today, yesterday, week, month, lastMonth, customRange — all returning UTC `timestamptz` boundaries based on 08:00 PKT day rollover.

**CRUD additions**: add **Duplicate** action to Products, Purchases, Expenses, Sales tables. Already have create/edit/delete/search/filter/sort and soft-delete.

**Auto-refresh**: existing React Query `invalidateQueries` on mutations covers this; verify dashboard + reports queries are invalidated on every mutation.

## 3. Out of scope (not requested in this turn)

- Undo-last-delete UI beyond existing soft delete (records remain restorable in DB; no toast-level undo widget added unless asked).
- Allocation of *general* expenses to categories uses revenue-share; if user prefers another method we'll adjust.

## 4. Execution order

1. Migration (categories table + seed Biryani + business_date fn + purchases.category column + category_monthly_report RPC + override semantics)
2. Categories hook + business-date util
3. Update Products, Purchases forms (category required + dropdown from DB)
4. Rewrite Reports page with tabs and presets
5. Update Dashboard cards + category summary
6. Add Duplicate buttons across modules
7. Verify build + smoke-test the preview

Confirm to proceed and I'll execute.
