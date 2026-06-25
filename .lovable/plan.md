## Café Management App — Build Plan

A full single-café management web app on TanStack Start + Lovable Cloud (Supabase) + Tailwind, with responsive UI, dark/light mode, and printable invoices.

### Tech & setup
- TanStack Start (existing template), Tailwind v4, shadcn/ui
- Lovable Cloud (Supabase) for DB + auth
- React Query for data, Zod for validation
- Recharts for dashboard charts
- Sidebar nav (collapsible, mobile-friendly)
- Light/dark theme toggle

### Auth
- Email/password sign-in (single café — staff login required)
- All routes under `_authenticated`, except `/auth`

### Database schema (Supabase migrations)
Tables exactly as requested:
- `products`, `ingredients`, `recipes`, `stock_purchases`
- `expenses`, `sales`, `sale_items`
- `ingredient_movements` (purchase / consumption ledger)
- `stock_summary` view (derived from movements)

Plus:
- `user_roles` table + `has_role()` for admin/staff separation
- RLS: authenticated users can read/write; admin-only for deletes
- DB function `save_sale(invoice jsonb)` that atomically:
  1. inserts sale + items
  2. inserts consumption movements (per recipe × qty)
  3. validates stock if available

### Modules / Routes
```
/                    Dashboard (today/month sales, profit, low-stock)
/pos                 POS — search, cart, save & print invoice
/sales               Daily Sales (filter by date / invoice no)
/sales/$id           Invoice detail + print view
/products            Products CRUD
/ingredients         Ingredients CRUD
/recipes             Recipes per product (add/edit/delete lines)
/purchases           Stock Purchases CRUD
/expenses            Expenses CRUD
/stock               Stock Dashboard + Monthly Stock matrix (date columns)
/reports             Daily / Monthly / Product / Ingredient reports
/auth                Sign in / sign up
```

### POS behavior
- Type-ahead search (name prefix, case-insensitive)
- Cart: qty editable, auto line total, grand total, remove item
- Save → calls `save_sale` RPC → success toast → print dialog
- Printable invoice (clean print stylesheet)

### Stock & profit logic
- Purchases insert `ingredient_movements` (type=purchase)
- Sale save inserts consumption movements (type=consumption, qty = recipe × sold)
- Remaining = Σ purchases − Σ consumption
- Low stock when remaining < `minimum_stock`
- Monthly stock matrix: per ingredient, per day → Purchase / Sell / Remaining (computed client-side from movements)
- Profit: Revenue (sales) − COGS (sum of consumption × ingredient avg cost) − Expenses

### Reports
- Daily, Monthly, Product sales, Ingredient (purchased/consumed/remaining)
- Date-range pickers, CSV-ready tables

### Design
- Warm café palette (deep espresso, cream, accent amber) in oklch tokens
- Sidebar layout, sticky header, mobile drawer
- Cards for KPIs, charts for trends

### Future-ready
- Schema designed so adding `customers`, `orders` (delivery), `riders`, `branches` is additive
- No hard-coded café_id; can be added later

### Out of scope (now)
- WhatsApp integration, delivery, multi-branch (schema-ready only)

This is a large build — I'll ship it in one pass: enable Cloud → migrations → server fns → UI modules → polish.
