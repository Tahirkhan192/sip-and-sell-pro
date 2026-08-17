-- ============================================================================
-- CLOUD MIRROR SCHEMA — Phase 3 (seed target only)
-- ============================================================================
-- These `cloud_*` tables are a byte-faithful mirror of the Lovable Cloud
-- (Postgres) `public` tables covered by the backup system. They are generated
-- from the live cloud column list, so every cloud column exists here with the
-- same name, the same nullability and no extra application columns.
--
-- WHY A SEPARATE SET OF TABLES
--   The Phase-2 hand-written tables in `schema.sql` are an *offline design*
--   schema: they add a sync envelope, drop some cloud columns and tighten some
--   constraints. Seeding cloud rows into them would silently lose data. The
--   Phase-3 seed therefore targets these exact mirrors instead, and nothing in
--   `schema.sql` is dropped, altered or rewritten.
--
-- RULES
--   * TEXT for uuid / text / date / timestamptz / time / json / arrays,
--     REAL for numeric, INTEGER for integers and booleans (0/1).
--   * Values are stored verbatim: no timezone conversion, no rounding,
--     no recalculation, no id regeneration.
--   * Foreign keys are declared and enforced (PRAGMA foreign_keys = ON);
--     references to auth.users are intentionally not modelled locally.
--   * Insert order is the dependency-safe BACKUP_TABLES order.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cloud_settings (
  id INTEGER NOT NULL,
  allow_negative_stock INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  whatsapp_token TEXT,
  whatsapp_phone_id TEXT,
  whatsapp_business_id TEXT,
  whatsapp_country_code TEXT,
  whatsapp_auto_send INTEGER,
  timezone TEXT NOT NULL,
  business_day_start_time TEXT NOT NULL,
  business_month_start_day INTEGER NOT NULL,
  pin_locks TEXT NOT NULL,
  staff_invoice_color TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_branches (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_categories (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  description TEXT,
  color TEXT,
  icon TEXT,
  active INTEGER NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_expense_categories (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_money_movement_subcategories (
  id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_user_roles (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_suppliers (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  balance REAL NOT NULL,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_customers (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  balance REAL NOT NULL,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  last_visit TEXT,
  total_orders INTEGER NOT NULL,
  total_purchases REAL NOT NULL,
  outstanding_balance REAL NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_employees (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  salary REAL NOT NULL,
  joined_on TEXT,
  active INTEGER NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_staff (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  father_name TEXT,
  phone TEXT,
  cnic TEXT,
  joining_date TEXT NOT NULL,
  monthly_salary REAL NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  opening_katha REAL NOT NULL,
  katha_balance REAL NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_products (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  sale_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  opening_stock REAL NOT NULL,
  current_stock REAL NOT NULL,
  minimum_stock REAL NOT NULL,
  deleted_at TEXT,
  unit TEXT NOT NULL,
  selling_method TEXT NOT NULL,
  allow_negative_stock INTEGER NOT NULL,
  track_stock INTEGER NOT NULL,
  last_sold_at TEXT,
  avg_price_override REAL,
  auto_calc INTEGER NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_stock_items (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  opening_stock REAL NOT NULL,
  current_stock REAL NOT NULL,
  minimum_stock REAL NOT NULL,
  purchase_price REAL NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  category TEXT NOT NULL,
  supplier_id TEXT,
  purchase_date TEXT,
  notes TEXT,
  avg_price_override REAL,
  auto_calc INTEGER NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_recipes (
  id TEXT NOT NULL,
  parent_product_id TEXT NOT NULL,
  component_product_id TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  component_stock_item_id TEXT,
  applies_to TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (parent_product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (component_product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (component_stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_purchases (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  supplier TEXT,
  category TEXT,
  payment_status TEXT NOT NULL,
  payment_method TEXT,
  grand_total REAL NOT NULL,
  notes TEXT,
  created_by TEXT,
  cash_movement_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_purchase_items (
  id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  product_id TEXT,
  stock_item_id TEXT,
  category TEXT,
  quantity REAL NOT NULL,
  unit TEXT,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (purchase_id) REFERENCES cloud_purchases(id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_stock_purchases (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  product_id TEXT,
  stock_item_id TEXT,
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  supplier TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  category TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  paid_amount REAL NOT NULL,
  paid_at TEXT,
  payment_source TEXT NOT NULL,
  purchase_item_id TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (stock_item_id) REFERENCES cloud_stock_items(id),
  FOREIGN KEY (purchase_item_id) REFERENCES cloud_purchase_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_production_batches (
  id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  batch_date TEXT NOT NULL,
  notes TEXT,
  total_cost REAL NOT NULL,
  unit_cost REAL NOT NULL,
  target_category TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id)
);

CREATE TABLE IF NOT EXISTS cloud_production_batch_items (
  id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  component_type TEXT NOT NULL,
  component_product_id TEXT,
  component_stock_item_id TEXT,
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  source_category TEXT,
  target_category TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (batch_id) REFERENCES cloud_production_batches(id),
  FOREIGN KEY (component_product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (component_stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_sales (
  id TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  sale_date TEXT NOT NULL,
  grand_total REAL NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  customer_name TEXT,
  status TEXT NOT NULL,
  delivery_charges REAL NOT NULL,
  payment_method TEXT NOT NULL,
  deleted_at TEXT,
  cash_paid REAL NOT NULL,
  online_paid REAL NOT NULL,
  order_type TEXT NOT NULL,
  delivery_boy TEXT,
  katha INTEGER NOT NULL,
  customer_id TEXT,
  customer_phone TEXT,
  whatsapp_status TEXT,
  whatsapp_sent_at TEXT,
  discount_type TEXT NOT NULL,
  discount_value REAL NOT NULL,
  discount_amount REAL NOT NULL,
  delivery_address TEXT,
  hidden INTEGER NOT NULL,
  staff_id TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (customer_id) REFERENCES cloud_customers(id),
  FOREIGN KEY (staff_id) REFERENCES cloud_staff(id)
);

CREATE TABLE IF NOT EXISTS cloud_sale_items (
  id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  total REAL NOT NULL,
  unit TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (sale_id) REFERENCES cloud_sales(id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id)
);

CREATE TABLE IF NOT EXISTS cloud_stock_transfers (
  id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  product_id TEXT,
  stock_item_id TEXT,
  item_name TEXT NOT NULL,
  from_category TEXT NOT NULL,
  to_category TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_cost REAL NOT NULL,
  total_cost REAL NOT NULL,
  reason TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_stock_adjustments (
  id TEXT NOT NULL,
  scope TEXT NOT NULL,
  product_id TEXT,
  stock_item_id TEXT,
  quantity REAL NOT NULL,
  reason TEXT,
  notes TEXT,
  date TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_expenses (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  paid_amount REAL NOT NULL,
  paid_at TEXT,
  payment_source TEXT NOT NULL,
  supplier TEXT,
  notes TEXT,
  is_stock_transfer INTEGER NOT NULL,
  source_product_id TEXT,
  source_stock_item_id TEXT,
  source_quantity REAL,
  source_unit_cost REAL,
  PRIMARY KEY (id),
  FOREIGN KEY (source_product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (source_stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_delivery_expenses (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  fuel_cost REAL NOT NULL,
  maintenance_cost REAL NOT NULL,
  description TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_method TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_cash_movements (
  id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT,
  notes TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payment_source TEXT NOT NULL,
  movement_category TEXT,
  subcategory TEXT,
  reference_type TEXT,
  reference_id TEXT,
  katha_category TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_staff_attendance (
  id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (staff_id) REFERENCES cloud_staff(id)
);

CREATE TABLE IF NOT EXISTS cloud_staff_payments (
  id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL,
  remark TEXT,
  date TEXT NOT NULL,
  cash_movement_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (staff_id) REFERENCES cloud_staff(id)
);

CREATE TABLE IF NOT EXISTS cloud_staff_month_carry (
  id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  prev_remaining REAL NOT NULL,
  prev_advance REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (staff_id) REFERENCES cloud_staff(id)
);

CREATE TABLE IF NOT EXISTS cloud_katha_opening (
  id INTEGER NOT NULL,
  opening_loan_to_get REAL NOT NULL,
  opening_loan_to_give REAL NOT NULL,
  as_of_date TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_daily_closings (
  id TEXT NOT NULL,
  closing_date TEXT NOT NULL,
  actual_cash REAL NOT NULL,
  actual_wallet REAL NOT NULL,
  notes TEXT,
  closed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_stock_opening_snapshots (
  id TEXT NOT NULL,
  scope TEXT NOT NULL,
  item_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_value REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS cloud_monthly_stock_overrides (
  id TEXT NOT NULL,
  scope TEXT NOT NULL,
  product_id TEXT,
  stock_item_id TEXT,
  category TEXT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  opening_value REAL,
  closing_value REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (product_id) REFERENCES cloud_products(id),
  FOREIGN KEY (stock_item_id) REFERENCES cloud_stock_items(id)
);

CREATE TABLE IF NOT EXISTS cloud_audit_log (
  id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_sale_items_sale ON cloud_sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sale_items_product ON cloud_sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sales_date ON cloud_sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_cloud_cash_movements_date ON cloud_cash_movements(business_date);
CREATE INDEX IF NOT EXISTS idx_cloud_expenses_date ON cloud_expenses(date);
CREATE INDEX IF NOT EXISTS idx_cloud_stock_purchases_date ON cloud_stock_purchases(date);
CREATE INDEX IF NOT EXISTS idx_cloud_purchase_items_purchase ON cloud_purchase_items(purchase_id);
