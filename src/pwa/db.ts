/**
 * IndexedDB (Dexie) mirror of the Lovable Cloud tables.
 *
 * Purpose: hold a local copy of business data so the app can render and edit
 * without a network. A sync layer (see `sync.ts`) hydrates these stores from
 * Supabase on login and pushes local changes back when the browser is online.
 *
 * Schema mirrors the cloud tables — column list is illustrative; Dexie only
 * needs indexed fields declared in the version() call. All rows include `id`
 * (uuid, primary key). Add indexes as new queries need them.
 */

import Dexie, { type Table } from "dexie";

/* Shared envelope – kept on every business row for sync tracking. */
export type SyncMeta = {
  updated_at?: string | null;
  deleted_at?: string | null;
  _dirty?: 0 | 1; // 1 when local write pending push
  _op?: "insert" | "update" | "delete" | null;
};

export type Row<T> = T & { id: string } & SyncMeta;

export type OutboxEntry = {
  id?: number;
  table: string;
  row_id: string;
  op: "insert" | "update" | "delete";
  payload: unknown;
  attempts: number;
  last_error?: string | null;
  created_at: string;
  next_retry_at?: string | null;
};

export type MetaEntry = { key: string; value: string };

class CafeDB extends Dexie {
  branches!: Table<Row<Record<string, unknown>>, string>;
  categories!: Table<Row<Record<string, unknown>>, string>;
  expense_categories!: Table<Row<Record<string, unknown>>, string>;
  money_movement_subcategories!: Table<Row<Record<string, unknown>>, string>;
  employees!: Table<Row<Record<string, unknown>>, string>;
  customers!: Table<Row<Record<string, unknown>>, string>;
  suppliers!: Table<Row<Record<string, unknown>>, string>;
  products!: Table<Row<Record<string, unknown>>, string>;
  stock_items!: Table<Row<Record<string, unknown>>, string>;
  recipes!: Table<Row<Record<string, unknown>>, string>;
  sales!: Table<Row<Record<string, unknown>>, string>;
  sale_items!: Table<Row<Record<string, unknown>>, string>;
  purchases!: Table<Row<Record<string, unknown>>, string>;
  purchase_items!: Table<Row<Record<string, unknown>>, string>;
  stock_purchases!: Table<Row<Record<string, unknown>>, string>;
  expenses!: Table<Row<Record<string, unknown>>, string>;
  delivery_expenses!: Table<Row<Record<string, unknown>>, string>;
  cash_movements!: Table<Row<Record<string, unknown>>, string>;
  daily_closings!: Table<Row<Record<string, unknown>>, string>;
  stock_transfers!: Table<Row<Record<string, unknown>>, string>;
  monthly_stock_overrides!: Table<Row<Record<string, unknown>>, string>;
  production_batches!: Table<Row<Record<string, unknown>>, string>;
  production_batch_items!: Table<Row<Record<string, unknown>>, string>;
  settings!: Table<Row<Record<string, unknown>>, string>;
  user_roles!: Table<Row<Record<string, unknown>>, string>;

  /* Local-only stores */
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor() {
    super("cafe_manager");
    this.version(1).stores({
      branches: "id, name, updated_at",
      categories: "id, name, kind, parent_id, updated_at",
      expense_categories: "id, name, updated_at",
      money_movement_subcategories: "id, name, kind, updated_at",
      employees: "id, name, active, updated_at",
      customers: "id, name, phone, updated_at",
      suppliers: "id, name, phone, updated_at",
      products: "id, name, category, sku, updated_at",
      stock_items: "id, name, category, updated_at",
      recipes: "id, parent_product_id, component_product_id, component_stock_item_id, updated_at",
      sales: "id, invoice_no, business_date, sale_date, status, customer_id, updated_at",
      sale_items: "id, sale_id, product_id, updated_at",
      purchases: "id, invoice_no, date, business_date, supplier_id, updated_at",
      purchase_items: "id, purchase_id, product_id, stock_item_id, updated_at",
      stock_purchases: "id, date, business_date, product_id, stock_item_id, updated_at",
      expenses: "id, date, business_date, category_id, payment_status, updated_at",
      delivery_expenses: "id, date, business_date, updated_at",
      cash_movements: "id, date, business_date, kind, updated_at",
      daily_closings: "id, business_date, updated_at",
      stock_transfers: "id, date, business_date, product_id, stock_item_id, updated_at",
      monthly_stock_overrides: "id, year, month, scope, product_id, updated_at",
      production_batches: "id, date, business_date, product_id, updated_at",
      production_batch_items: "id, batch_id, updated_at",
      settings: "id, updated_at",
      user_roles: "id, user_id, role",
      outbox: "++id, table, row_id, next_retry_at, created_at",
      meta: "key",
    });
  }
}

let _db: CafeDB | null = null;
export function localDb(): CafeDB {
  if (typeof window === "undefined") {
    throw new Error("localDb() must be called in the browser");
  }
  if (!_db) _db = new CafeDB();
  return _db;
}

export const SYNCED_TABLES = [
  "branches",
  "categories",
  "expense_categories",
  "money_movement_subcategories",
  "employees",
  "customers",
  "suppliers",
  "products",
  "stock_items",
  "recipes",
  "sales",
  "sale_items",
  "purchases",
  "purchase_items",
  "stock_purchases",
  "expenses",
  "delivery_expenses",
  "cash_movements",
  "daily_closings",
  "stock_transfers",
  "monthly_stock_overrides",
  "production_batches",
  "production_batch_items",
  "settings",
  "user_roles",
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
