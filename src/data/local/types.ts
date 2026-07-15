/**
 * Row types for the local SQLite database (Phase 2).
 *
 * These mirror the SQLite schema in `schema.sql`. They are intentionally
 * decoupled from `src/integrations/supabase/types.ts` (which is auto-
 * generated from the cloud schema) so we can evolve either side independently
 * during the migration. A mapping layer in Phase 3 will translate between the
 * two.
 */

export type SyncStatus = "local" | "pending" | "synced" | "conflict";

/** Sync envelope present on every business table. */
export interface SyncEnvelope {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  business_date: string | null;
  business_time: string | null;
  version: number;
  server_version: number | null;
  device_id: string;
  sync_status: SyncStatus;
}

export interface BranchRow extends SyncEnvelope {
  name: string;
  address: string | null;
  phone: string | null;
}

export interface CategoryRow extends SyncEnvelope {
  name: string;
  kind: string | null;
  parent_id: string | null;
  sort_order: number | null;
  color: string | null;
  icon: string | null;
}

export interface ExpenseCategoryRow extends SyncEnvelope {
  name: string;
  description: string | null;
}

export interface MoneyMovementSubcategoryRow extends SyncEnvelope {
  name: string;
  kind: "cash_in" | "cash_out" | "online_in" | "online_out";
}

export interface EmployeeRow extends SyncEnvelope {
  name: string;
  role: string | null;
  phone: string | null;
  address: string | null;
  hire_date: string | null;
  active: 0 | 1;
}

export interface CustomerRow extends SyncEnvelope {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  balance: number;
}

export interface SupplierRow extends SyncEnvelope {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface ProductRow extends SyncEnvelope {
  name: string;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  price: number;
  cost_price: number;
  opening_stock: number;
  current_stock: number;
  min_stock: number | null;
  is_service: 0 | 1;
  has_recipe: 0 | 1;
  image_url: string | null;
}

export interface StockItemRow extends SyncEnvelope {
  name: string;
  category: string | null;
  unit: string | null;
  current_stock: number;
  min_stock: number | null;
  purchase_price: number;
  supplier_id: string | null;
  notes: string | null;
}

export interface RecipeRow extends SyncEnvelope {
  parent_product_id: string;
  component_product_id: string | null;
  component_stock_item_id: string | null;
  quantity: number;
  unit: string | null;
  notes: string | null;
}

export interface SaleRow extends SyncEnvelope {
  invoice_no: string;
  sale_date: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  employee_id: string | null;
  branch_id: string | null;
  order_type: string | null;
  status: "completed" | "pending" | "cancelled";
  subtotal: number;
  discount: number;
  tax: number;
  delivery_charges: number;
  grand_total: number;
  cash_paid: number;
  online_paid: number;
  payment_method: string | null;
  katha: 0 | 1;
  notes: string | null;
}

export interface SaleItemRow extends SyncEnvelope {
  sale_id: string;
  product_id: string;
  quantity: number;
  unit: string | null;
  price: number;
  total: number;
  discount: number;
}

export interface PurchaseRow extends SyncEnvelope {
  invoice_no: string | null;
  date: string;
  supplier_id: string | null;
  supplier_name: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  grand_total: number;
  cash_paid: number;
  online_paid: number;
  payment_method: string | null;
  notes: string | null;
}

export interface PurchaseItemRow extends SyncEnvelope {
  purchase_id: string;
  product_id: string | null;
  stock_item_id: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  total_cost: number;
}

export interface StockPurchaseRow extends SyncEnvelope {
  date: string;
  product_id: string | null;
  stock_item_id: string | null;
  category: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  total_cost: number;
  payment_method: string | null;
  notes: string | null;
}

export interface ExpenseRow extends SyncEnvelope {
  date: string;
  category_id: string | null;
  category_name: string | null;
  amount: number;
  payment_method: string | null;
  description: string | null;
  supplier_id: string | null;
  reference: string | null;
}

export interface DeliveryExpenseRow extends SyncEnvelope {
  date: string;
  fuel_cost: number;
  maintenance_cost: number;
  description: string | null;
}

export interface CashMovementRow extends SyncEnvelope {
  date: string;
  time: string | null;
  kind: "cash_in" | "cash_out" | "online_in" | "online_out";
  amount: number;
  subcategory_id: string | null;
  subcategory_name: string | null;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
}

export interface DailyClosingRow extends SyncEnvelope {
  opening_cash: number;
  closing_cash: number;
  expected_cash: number;
  variance: number;
  notes: string | null;
  closed_by: string | null;
}

export interface StockTransferRow extends SyncEnvelope {
  date: string;
  from_branch_id: string | null;
  to_branch_id: string | null;
  product_id: string | null;
  stock_item_id: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  status: "pending" | "completed" | "cancelled";
  notes: string | null;
}

export interface MonthlyStockOverrideRow extends SyncEnvelope {
  year: number;
  month: number;
  scope: "category" | "product";
  category: string | null;
  product_id: string | null;
  opening_value: number | null;
  closing_value: number | null;
}

export interface ProductionBatchRow extends SyncEnvelope {
  date: string;
  product_id: string;
  quantity: number;
  unit: string | null;
  cost: number | null;
  notes: string | null;
  status: "pending" | "completed" | "cancelled";
}

export interface ProductionBatchItemRow extends SyncEnvelope {
  batch_id: string;
  component_product_id: string | null;
  component_stock_item_id: string | null;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  total_cost: number;
}

export interface SettingsRow extends SyncEnvelope {
  key: string;
  value_json: string | null;
}

/* ---- Local-only tables (do not sync) --------------------------------- */

export interface OutboxRow {
  id: string;
  table_name: string;
  row_id: string;
  op: "insert" | "update" | "delete";
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_retry_at: string | null;
}

export interface SummaryDailySales {
  business_date: string;
  invoice_count: number;
  total_qty: number;
  total_sales: number;
  delivery: number;
  cash: number;
  online: number;
  katha: number;
  updated_at: string;
}

export interface SummaryCategorySales {
  business_date: string;
  category: string;
  qty: number;
  sales: number;
  cogs: number;
  updated_at: string;
}

export interface SummaryProductSales {
  business_date: string;
  product_id: string;
  qty: number;
  revenue: number;
  cogs: number;
  updated_at: string;
}

export interface SummaryDashboard {
  business_date: string;
  revenue: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  delivery_profit: number;
  net_profit: number;
  updated_at: string;
}
