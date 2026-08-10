-- ============================================================================
-- LOCAL SQLITE SCHEMA — Phase 2 (design only, not yet used at runtime)
-- ============================================================================
-- Mirrors the Lovable Cloud (Postgres) schema for the 24 business tables and
-- adds the mandatory sync envelope columns to every row.
--
-- CONVENTIONS
--   * All primary keys are TEXT UUIDs (client-generated, never auto-increment).
--   * TEXT is used for all dates/times so we can round-trip Postgres ISO
--     timestamps and business dates ('YYYY-MM-DD') without lossy parsing.
--   * REAL is used for money to match the Postgres numeric handling in the app
--     (existing code already normalises with num()); precision is preserved on
--     round-trip via the sync engine, not by column type.
--   * Foreign keys are declared and enforced (PRAGMA foreign_keys = ON in db.ts).
--   * "ON DELETE" behaviour is intentionally RESTRICTIVE — soft-delete via
--     deleted_at is the app's delete path; hard deletes are used only by the
--     sync engine after a successful cloud confirmation.
--   * Every table carries the same sync envelope so the sync engine can treat
--     them uniformly.
-- ============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;
PRAGMA mmap_size    = 268435456; -- 256 MB

-- ---------------------------------------------------------------------------
-- Local-only metadata
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The device_id is generated once per browser install and stamped into every
-- row this device writes. It lets the sync engine attribute conflicts.
--   INSERT OR IGNORE INTO _meta(key, value) VALUES ('device_id', <uuid>);
--   INSERT OR IGNORE INTO _meta(key, value) VALUES ('schema_version', '1');

CREATE TABLE IF NOT EXISTS _schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- SYNC ENVELOPE (documentation)
-- ---------------------------------------------------------------------------
-- Every business table MUST include these columns. They are repeated inline
-- (SQLite has no macros / inheritance) so each CREATE TABLE remains explicit.
--
--   id             TEXT    PRIMARY KEY               -- UUID
--   created_at     TEXT    NOT NULL                  -- ISO 8601 UTC
--   updated_at     TEXT    NOT NULL                  -- ISO 8601 UTC
--   deleted_at     TEXT    NULL                      -- soft delete (ISO 8601)
--   business_date  TEXT    NULL                      -- 'YYYY-MM-DD'
--   business_time  TEXT    NULL                      -- 'HH:MM:SS'
--   version        INTEGER NOT NULL DEFAULT 1        -- monotonic per row
--   server_version INTEGER NULL                      -- last version confirmed by cloud
--   device_id      TEXT    NOT NULL                  -- writer device
--   sync_status    TEXT    NOT NULL DEFAULT 'local'  -- local|pending|synced|conflict
--
-- Standard indexes on every table (declared after each CREATE TABLE):
--   idx_<t>_sync_status  (sync_status)   — outbox scanner
--   idx_<t>_updated_at   (updated_at)    — incremental pull
--   idx_<t>_business_date (business_date) — report queries
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- REFERENCE / LOOKUP TABLES
-- ===========================================================================

CREATE TABLE IF NOT EXISTS branches (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  phone          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_branches_sync_status   ON branches(sync_status);
CREATE INDEX IF NOT EXISTS idx_branches_updated_at    ON branches(updated_at);

CREATE TABLE IF NOT EXISTS categories (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT,                          -- product | stock | expense (informational)
  parent_id      TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  sort_order     INTEGER,
  color          TEXT,
  icon           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_name         ON categories(name) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_categories_sync_status ON categories(sync_status);
CREATE INDEX        IF NOT EXISTS idx_categories_updated_at  ON categories(updated_at);
CREATE INDEX        IF NOT EXISTS idx_categories_parent      ON categories(parent_id);

CREATE TABLE IF NOT EXISTS expense_categories (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_categories_name       ON expense_categories(name) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_expense_categories_sync      ON expense_categories(sync_status);
CREATE INDEX        IF NOT EXISTS idx_expense_categories_updated   ON expense_categories(updated_at);

CREATE TABLE IF NOT EXISTS money_movement_subcategories (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,                 -- cash_in | cash_out | online_in | online_out
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_mm_subcat_kind        ON money_movement_subcategories(kind);
CREATE INDEX IF NOT EXISTS idx_mm_subcat_sync_status ON money_movement_subcategories(sync_status);
CREATE INDEX IF NOT EXISTS idx_mm_subcat_updated_at  ON money_movement_subcategories(updated_at);

CREATE TABLE IF NOT EXISTS employees (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  role           TEXT,
  phone          TEXT,
  address        TEXT,
  hire_date      TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_employees_sync_status ON employees(sync_status);
CREATE INDEX IF NOT EXISTS idx_employees_updated_at  ON employees(updated_at);

CREATE TABLE IF NOT EXISTS customers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  city           TEXT,
  notes          TEXT,
  balance        REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone        ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name         ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_sync_status  ON customers(sync_status);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at   ON customers(updated_at);

CREATE TABLE IF NOT EXISTS suppliers (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name         ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone        ON suppliers(phone);
CREATE INDEX IF NOT EXISTS idx_suppliers_sync_status  ON suppliers(sync_status);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_at   ON suppliers(updated_at);

-- ===========================================================================
-- INVENTORY MASTER
-- ===========================================================================

CREATE TABLE IF NOT EXISTS products (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  category           TEXT,                       -- denormalised for reports (matches cloud)
  sku                TEXT,
  barcode            TEXT,
  unit               TEXT,
  price              REAL NOT NULL DEFAULT 0,
  cost_price         REAL NOT NULL DEFAULT 0,
  opening_stock      REAL NOT NULL DEFAULT 0,
  current_stock      REAL NOT NULL DEFAULT 0,
  min_stock          REAL,
  is_service         INTEGER NOT NULL DEFAULT 0,
  has_recipe         INTEGER NOT NULL DEFAULT 0,
  image_url          TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT,
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX        IF NOT EXISTS idx_products_category     ON products(category);
CREATE INDEX        IF NOT EXISTS idx_products_name         ON products(name);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_barcode       ON products(barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_sku           ON products(sku)     WHERE sku     IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_products_sync_status  ON products(sync_status);
CREATE INDEX        IF NOT EXISTS idx_products_updated_at   ON products(updated_at);

CREATE TABLE IF NOT EXISTS stock_items (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT,
  unit           TEXT,
  current_stock  REAL NOT NULL DEFAULT 0,
  min_stock      REAL,
  purchase_price REAL NOT NULL DEFAULT 0,
  supplier_id    TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_stock_items_category      ON stock_items(category);
CREATE INDEX IF NOT EXISTS idx_stock_items_name          ON stock_items(name);
CREATE INDEX IF NOT EXISTS idx_stock_items_supplier      ON stock_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_items_sync_status   ON stock_items(sync_status);
CREATE INDEX IF NOT EXISTS idx_stock_items_updated_at    ON stock_items(updated_at);

CREATE TABLE IF NOT EXISTS recipes (
  id                        TEXT PRIMARY KEY,
  parent_product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id      TEXT REFERENCES products(id)    ON DELETE RESTRICT,
  component_stock_item_id   TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity                  REAL NOT NULL,
  unit                      TEXT,
  notes                     TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  deleted_at                TEXT,
  business_date             TEXT,
  business_time             TEXT,
  version                   INTEGER NOT NULL DEFAULT 1,
  server_version            INTEGER,
  device_id                 TEXT NOT NULL,
  sync_status               TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (
    (component_product_id IS NOT NULL AND component_stock_item_id IS NULL) OR
    (component_product_id IS NULL     AND component_stock_item_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_recipes_parent        ON recipes(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_comp_product  ON recipes(component_product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_comp_stock    ON recipes(component_stock_item_id);
CREATE INDEX IF NOT EXISTS idx_recipes_sync_status   ON recipes(sync_status);
CREATE INDEX IF NOT EXISTS idx_recipes_updated_at    ON recipes(updated_at);

-- ===========================================================================
-- SALES / INVOICES
-- ===========================================================================

CREATE TABLE IF NOT EXISTS sales (
  id                 TEXT PRIMARY KEY,
  invoice_no         TEXT NOT NULL,
  sale_date          TEXT NOT NULL,             -- ISO UTC timestamp (matches cloud)
  customer_id        TEXT REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name      TEXT,
  customer_phone     TEXT,
  employee_id        TEXT REFERENCES employees(id) ON DELETE RESTRICT,
  branch_id          TEXT REFERENCES branches(id)  ON DELETE RESTRICT,
  order_type         TEXT,                      -- dine_in | takeaway | delivery
  status             TEXT NOT NULL DEFAULT 'completed', -- completed | pending | cancelled
  subtotal           REAL NOT NULL DEFAULT 0,
  discount           REAL NOT NULL DEFAULT 0,
  tax                REAL NOT NULL DEFAULT 0,
  delivery_charges   REAL NOT NULL DEFAULT 0,
  grand_total        REAL NOT NULL DEFAULT 0,
  cash_paid          REAL NOT NULL DEFAULT 0,
  online_paid        REAL NOT NULL DEFAULT 0,
  payment_method     TEXT,                      -- cash | card | split | katha
  katha              INTEGER NOT NULL DEFAULT 0,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT NOT NULL,             -- required for reports
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
-- Global uniqueness of invoice_no is enforced only among non-deleted rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_invoice_no    ON sales(invoice_no) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_sales_business_date ON sales(business_date);
CREATE INDEX        IF NOT EXISTS idx_sales_sale_date     ON sales(sale_date);
CREATE INDEX        IF NOT EXISTS idx_sales_customer      ON sales(customer_id);
CREATE INDEX        IF NOT EXISTS idx_sales_status        ON sales(status);
CREATE INDEX        IF NOT EXISTS idx_sales_order_type    ON sales(order_type);
CREATE INDEX        IF NOT EXISTS idx_sales_sync_status   ON sales(sync_status);
CREATE INDEX        IF NOT EXISTS idx_sales_updated_at    ON sales(updated_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id             TEXT PRIMARY KEY,
  sale_id        TEXT NOT NULL REFERENCES sales(id)    ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity       REAL NOT NULL,
  unit           TEXT,
  price          REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale       ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product    ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sync       ON sale_items(sync_status);
CREATE INDEX IF NOT EXISTS idx_sale_items_updated_at ON sale_items(updated_at);

-- ===========================================================================
-- PURCHASES (product-level and stock-item-level)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS purchases (
  id                 TEXT PRIMARY KEY,
  invoice_no         TEXT,
  date               TEXT NOT NULL,
  supplier_id        TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name      TEXT,
  subtotal           REAL NOT NULL DEFAULT 0,
  discount           REAL NOT NULL DEFAULT 0,
  tax                REAL NOT NULL DEFAULT 0,
  grand_total        REAL NOT NULL DEFAULT 0,
  cash_paid          REAL NOT NULL DEFAULT 0,
  online_paid        REAL NOT NULL DEFAULT 0,
  payment_method     TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT NOT NULL,
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_purchases_invoice_no ON purchases(invoice_no) WHERE invoice_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_purchases_date      ON purchases(date);
CREATE INDEX        IF NOT EXISTS idx_purchases_business  ON purchases(business_date);
CREATE INDEX        IF NOT EXISTS idx_purchases_supplier  ON purchases(supplier_id);
CREATE INDEX        IF NOT EXISTS idx_purchases_sync      ON purchases(sync_status);
CREATE INDEX        IF NOT EXISTS idx_purchases_updated   ON purchases(updated_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id             TEXT PRIMARY KEY,
  purchase_id    TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id     TEXT REFERENCES products(id) ON DELETE RESTRICT,
  stock_item_id  TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity       REAL NOT NULL,
  unit           TEXT,
  unit_cost      REAL NOT NULL DEFAULT 0,
  total_cost     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (product_id IS NOT NULL OR stock_item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase   ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product    ON purchase_items(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_stock_item ON purchase_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_sync       ON purchase_items(sync_status);
CREATE INDEX IF NOT EXISTS idx_purchase_items_updated    ON purchase_items(updated_at);

-- stock_purchases is the app's active purchase log (mirrors cloud table used by report-engine).
CREATE TABLE IF NOT EXISTS stock_purchases (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,
  product_id     TEXT REFERENCES products(id) ON DELETE RESTRICT,
  stock_item_id  TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  category       TEXT,
  supplier_id    TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_name  TEXT,
  quantity       REAL NOT NULL,
  unit           TEXT,
  unit_cost      REAL NOT NULL DEFAULT 0,
  total_cost     REAL NOT NULL DEFAULT 0,
  payment_method TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT NOT NULL,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (product_id IS NOT NULL OR stock_item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_date       ON stock_purchases(date);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_business   ON stock_purchases(business_date);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_product    ON stock_purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_stock_item ON stock_purchases(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_supplier   ON stock_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_category   ON stock_purchases(category);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_sync       ON stock_purchases(sync_status);
CREATE INDEX IF NOT EXISTS idx_stock_purchases_updated    ON stock_purchases(updated_at);

-- ===========================================================================
-- EXPENSES
-- ===========================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id                  TEXT PRIMARY KEY,
  date                TEXT NOT NULL,
  category_id         TEXT REFERENCES expense_categories(id) ON DELETE RESTRICT,
  category_name       TEXT,
  amount              REAL NOT NULL,
  payment_method      TEXT,
  description         TEXT,
  supplier_id         TEXT REFERENCES suppliers(id) ON DELETE RESTRICT,
  reference           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  business_date       TEXT NOT NULL,
  business_time       TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  server_version      INTEGER,
  device_id           TEXT NOT NULL,
  sync_status         TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date          ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category      ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_sync_status   ON expenses(sync_status);
CREATE INDEX IF NOT EXISTS idx_expenses_updated_at    ON expenses(updated_at);

CREATE TABLE IF NOT EXISTS delivery_expenses (
  id                TEXT PRIMARY KEY,
  date              TEXT NOT NULL,
  fuel_cost         REAL NOT NULL DEFAULT 0,
  maintenance_cost  REAL NOT NULL DEFAULT 0,
  description       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  business_date     TEXT,
  business_time     TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  server_version    INTEGER,
  device_id         TEXT NOT NULL,
  sync_status       TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_date  ON delivery_expenses(date);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_sync  ON delivery_expenses(sync_status);
CREATE INDEX IF NOT EXISTS idx_delivery_expenses_upd   ON delivery_expenses(updated_at);

-- ===========================================================================
-- MONEY MOVEMENT & DAILY CLOSING
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cash_movements (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,
  time               TEXT,
  kind               TEXT NOT NULL,             -- cash_in | cash_out | online_in | online_out
  amount             REAL NOT NULL,
  subcategory_id     TEXT REFERENCES money_movement_subcategories(id) ON DELETE RESTRICT,
  subcategory_name   TEXT,
  reference_type     TEXT,                      -- sale | purchase | expense | manual | ...
  reference_id       TEXT,
  description        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT NOT NULL,
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_cash_mov_business_date ON cash_movements(business_date);
CREATE INDEX IF NOT EXISTS idx_cash_mov_kind          ON cash_movements(kind);
CREATE INDEX IF NOT EXISTS idx_cash_mov_reference     ON cash_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_cash_mov_sync_status   ON cash_movements(sync_status);
CREATE INDEX IF NOT EXISTS idx_cash_mov_updated_at    ON cash_movements(updated_at);

CREATE TABLE IF NOT EXISTS daily_closings (
  id                 TEXT PRIMARY KEY,
  business_date      TEXT NOT NULL,
  business_time      TEXT,
  opening_cash       REAL NOT NULL DEFAULT 0,
  closing_cash       REAL NOT NULL DEFAULT 0,
  expected_cash      REAL NOT NULL DEFAULT 0,
  variance           REAL NOT NULL DEFAULT 0,
  notes              TEXT,
  closed_by          TEXT REFERENCES employees(id) ON DELETE RESTRICT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_daily_closings_business_date ON daily_closings(business_date) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_daily_closings_sync         ON daily_closings(sync_status);
CREATE INDEX        IF NOT EXISTS idx_daily_closings_updated      ON daily_closings(updated_at);

-- ===========================================================================
-- STOCK TRANSFERS & MONTHLY OVERRIDES
-- ===========================================================================

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,
  from_branch_id     TEXT REFERENCES branches(id) ON DELETE RESTRICT,
  to_branch_id       TEXT REFERENCES branches(id) ON DELETE RESTRICT,
  product_id         TEXT REFERENCES products(id) ON DELETE RESTRICT,
  stock_item_id      TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity           REAL NOT NULL,
  unit               TEXT,
  unit_cost          REAL,
  total_cost         REAL,
  status             TEXT NOT NULL DEFAULT 'completed', -- pending | completed | cancelled
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT NOT NULL,
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (product_id IS NOT NULL OR stock_item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_date       ON stock_transfers(date);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_from       ON stock_transfers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_to         ON stock_transfers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_product    ON stock_transfers(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_stock_item ON stock_transfers(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status     ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_sync       ON stock_transfers(sync_status);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_updated    ON stock_transfers(updated_at);

CREATE TABLE IF NOT EXISTS monthly_stock_overrides (
  id             TEXT PRIMARY KEY,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  scope          TEXT NOT NULL,                 -- 'category' | 'product'
  category       TEXT,
  product_id     TEXT REFERENCES products(id) ON DELETE RESTRICT,
  opening_value  REAL,
  closing_value  REAL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_mso_year_month  ON monthly_stock_overrides(year, month);
CREATE INDEX IF NOT EXISTS idx_mso_product     ON monthly_stock_overrides(product_id);
CREATE INDEX IF NOT EXISTS idx_mso_category    ON monthly_stock_overrides(category);
CREATE INDEX IF NOT EXISTS idx_mso_sync_status ON monthly_stock_overrides(sync_status);
CREATE INDEX IF NOT EXISTS idx_mso_updated_at  ON monthly_stock_overrides(updated_at);

-- ===========================================================================
-- PRODUCTION
-- ===========================================================================

CREATE TABLE IF NOT EXISTS production_batches (
  id                 TEXT PRIMARY KEY,
  date               TEXT NOT NULL,
  product_id         TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity           REAL NOT NULL,
  unit               TEXT,
  cost               REAL,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'completed', -- pending | completed | cancelled
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  business_date      TEXT NOT NULL,
  business_time      TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  server_version     INTEGER,
  device_id          TEXT NOT NULL,
  sync_status        TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_production_batches_date     ON production_batches(date);
CREATE INDEX IF NOT EXISTS idx_production_batches_business ON production_batches(business_date);
CREATE INDEX IF NOT EXISTS idx_production_batches_product  ON production_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_production_batches_status   ON production_batches(status);
CREATE INDEX IF NOT EXISTS idx_production_batches_sync     ON production_batches(sync_status);
CREATE INDEX IF NOT EXISTS idx_production_batches_updated  ON production_batches(updated_at);

CREATE TABLE IF NOT EXISTS production_batch_items (
  id                   TEXT PRIMARY KEY,
  batch_id             TEXT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  component_product_id TEXT REFERENCES products(id)    ON DELETE RESTRICT,
  component_stock_item_id TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity             REAL NOT NULL,
  unit                 TEXT,
  unit_cost            REAL NOT NULL DEFAULT 0,
  total_cost           REAL NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT,
  business_date        TEXT,
  business_time        TEXT,
  version              INTEGER NOT NULL DEFAULT 1,
  server_version       INTEGER,
  device_id            TEXT NOT NULL,
  sync_status          TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (component_product_id IS NOT NULL OR component_stock_item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pbi_batch         ON production_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_pbi_comp_product  ON production_batch_items(component_product_id);
CREATE INDEX IF NOT EXISTS idx_pbi_comp_stock    ON production_batch_items(component_stock_item_id);
CREATE INDEX IF NOT EXISTS idx_pbi_sync          ON production_batch_items(sync_status);
CREATE INDEX IF NOT EXISTS idx_pbi_updated       ON production_batch_items(updated_at);

-- ===========================================================================
-- REPORT SUMMARY TABLES  (maintained by triggers in Phase 4; empty in Phase 2)
-- ===========================================================================
-- These are LOCAL-ONLY. They never sync. They are recomputable from detail
-- tables at any time, so treating them as a cache is safe.

CREATE TABLE IF NOT EXISTS summary_daily_sales (
  business_date  TEXT PRIMARY KEY,
  invoice_count  INTEGER NOT NULL DEFAULT 0,
  total_qty      REAL    NOT NULL DEFAULT 0,
  total_sales    REAL    NOT NULL DEFAULT 0,
  delivery       REAL    NOT NULL DEFAULT 0,
  cash           REAL    NOT NULL DEFAULT 0,
  online         REAL    NOT NULL DEFAULT 0,
  katha          REAL    NOT NULL DEFAULT 0,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS summary_category_sales (
  business_date  TEXT NOT NULL,
  category       TEXT NOT NULL,
  qty            REAL NOT NULL DEFAULT 0,
  sales          REAL NOT NULL DEFAULT 0,
  cogs           REAL NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (business_date, category)
);
CREATE INDEX IF NOT EXISTS idx_summary_cat_sales_date ON summary_category_sales(business_date);

CREATE TABLE IF NOT EXISTS summary_product_sales (
  business_date  TEXT NOT NULL,
  product_id     TEXT NOT NULL,
  qty            REAL NOT NULL DEFAULT 0,
  revenue        REAL NOT NULL DEFAULT 0,
  cogs           REAL NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (business_date, product_id)
);
CREATE INDEX IF NOT EXISTS idx_summary_prod_sales_date    ON summary_product_sales(business_date);
CREATE INDEX IF NOT EXISTS idx_summary_prod_sales_product ON summary_product_sales(product_id);

CREATE TABLE IF NOT EXISTS summary_dashboard (
  business_date    TEXT PRIMARY KEY,
  revenue          REAL NOT NULL DEFAULT 0,
  cogs             REAL NOT NULL DEFAULT 0,
  gross_profit     REAL NOT NULL DEFAULT 0,
  expenses         REAL NOT NULL DEFAULT 0,
  delivery_profit  REAL NOT NULL DEFAULT 0,
  net_profit       REAL NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);

-- ===========================================================================
-- OUTBOX (local only) — populated by Phase 5
-- ===========================================================================

CREATE TABLE IF NOT EXISTS outbox (
  id           TEXT PRIMARY KEY,
  table_name   TEXT    NOT NULL,
  row_id       TEXT    NOT NULL,
  op           TEXT    NOT NULL CHECK (op IN ('insert','update','delete')),
  payload_json TEXT    NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT    NOT NULL,
  next_retry_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_created  ON outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_table    ON outbox(table_name);
CREATE INDEX IF NOT EXISTS idx_outbox_retry_at ON outbox(next_retry_at);

-- ===========================================================================
-- SETTINGS (mirror of cloud settings row(s))
-- ===========================================================================

CREATE TABLE IF NOT EXISTS settings (
  id                     TEXT PRIMARY KEY,
  key                    TEXT NOT NULL,
  value_json             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT,
  business_date          TEXT,
  business_time          TEXT,
  version                INTEGER NOT NULL DEFAULT 1,
  server_version         INTEGER,
  device_id              TEXT NOT NULL,
  sync_status            TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_settings_key    ON settings(key) WHERE deleted_at IS NULL;
CREATE INDEX        IF NOT EXISTS idx_settings_sync  ON settings(sync_status);

-- ===========================================================================
-- STAFF (mirrors cloud staff / attendance / payments / carry-forward)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS staff (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  father_name    TEXT,
  phone          TEXT,
  cnic           TEXT,
  joining_date   TEXT NOT NULL,
  monthly_salary REAL NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'active',
  notes          TEXT,
  opening_katha  REAL NOT NULL DEFAULT 0,
  katha_balance  REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_staff_sync    ON staff(sync_status);
CREATE INDEX IF NOT EXISTS idx_staff_updated ON staff(updated_at);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id             TEXT PRIMARY KEY,
  staff_id       TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  date           TEXT NOT NULL,
  status         TEXT NOT NULL, -- present | absent | leave
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_attendance ON staff_attendance(staff_id, date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_att_sync    ON staff_attendance(sync_status);
CREATE INDEX IF NOT EXISTS idx_staff_att_updated ON staff_attendance(updated_at);

CREATE TABLE IF NOT EXISTS staff_payments (
  id                TEXT PRIMARY KEY,
  staff_id          TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  kind              TEXT NOT NULL, -- salary | advance | katha_payment
  amount            REAL NOT NULL,
  payment_method    TEXT NOT NULL,
  remark            TEXT,
  date              TEXT NOT NULL,
  cash_movement_id  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT,
  business_date     TEXT,
  business_time     TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  server_version    INTEGER,
  device_id         TEXT NOT NULL,
  sync_status       TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_staff_pay_staff   ON staff_payments(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_pay_date    ON staff_payments(date);
CREATE INDEX IF NOT EXISTS idx_staff_pay_sync    ON staff_payments(sync_status);
CREATE INDEX IF NOT EXISTS idx_staff_pay_updated ON staff_payments(updated_at);

CREATE TABLE IF NOT EXISTS staff_month_carry (
  id             TEXT PRIMARY KEY,
  staff_id       TEXT NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  prev_remaining REAL NOT NULL DEFAULT 0,
  prev_advance   REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_carry ON staff_month_carry(staff_id, year, month) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_carry_sync ON staff_month_carry(sync_status);

-- ===========================================================================
-- DIGI KATHA OPENING
-- ===========================================================================

CREATE TABLE IF NOT EXISTS katha_opening (
  id                     TEXT PRIMARY KEY,
  opening_loan_to_get    REAL NOT NULL DEFAULT 0,
  opening_loan_to_give   REAL NOT NULL DEFAULT 0,
  as_of_date             TEXT NOT NULL,
  note                   TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  deleted_at             TEXT,
  business_date          TEXT,
  business_time          TEXT,
  version                INTEGER NOT NULL DEFAULT 1,
  server_version         INTEGER,
  device_id              TEXT NOT NULL,
  sync_status            TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);

-- ===========================================================================
-- MANUAL STOCK ADJUSTMENTS + OPENING SNAPSHOTS
-- ===========================================================================

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id             TEXT PRIMARY KEY,
  scope          TEXT NOT NULL, -- 'product' | 'stock_item'
  product_id     TEXT REFERENCES products(id) ON DELETE RESTRICT,
  stock_item_id  TEXT REFERENCES stock_items(id) ON DELETE RESTRICT,
  quantity       REAL NOT NULL, -- may be negative
  reason         TEXT,
  notes          TEXT,
  date           TEXT NOT NULL,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict')),
  CHECK (product_id IS NOT NULL OR stock_item_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_stock_adj_product ON stock_adjustments(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_item    ON stock_adjustments(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_date    ON stock_adjustments(date);
CREATE INDEX IF NOT EXISTS idx_stock_adj_sync    ON stock_adjustments(sync_status);

CREATE TABLE IF NOT EXISTS stock_opening_snapshots (
  id             TEXT PRIMARY KEY,
  scope          TEXT NOT NULL, -- 'product' | 'stock_item'
  item_id        TEXT NOT NULL,
  year           INTEGER NOT NULL,
  month          INTEGER NOT NULL,
  quantity       REAL NOT NULL DEFAULT 0,
  unit_value     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_snapshot ON stock_opening_snapshots(scope, item_id, year, month);

-- ===========================================================================
-- USERS / PERMISSIONS / AUDIT
-- ===========================================================================

CREATE TABLE IF NOT EXISTS user_roles (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  role           TEXT NOT NULL, -- admin | staff
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_roles ON user_roles(user_id, role) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT PRIMARY KEY,
  user_id        TEXT,
  action         TEXT NOT NULL,
  entity         TEXT,
  entity_id      TEXT,
  details_json   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT,
  business_date  TEXT,
  business_time  TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  server_version INTEGER,
  device_id      TEXT NOT NULL,
  sync_status    TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local','pending','synced','conflict'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ===========================================================================
-- END OF SCHEMA v2
-- ===========================================================================
INSERT OR IGNORE INTO _schema_migrations(version) VALUES (1);
INSERT OR IGNORE INTO _schema_migrations(version) VALUES (2);

