/**
 * DATA ACCESS LAYER — contract (preparation only, no behaviour change).
 *
 * Architecture the app is being prepared for:
 *
 *   Existing UI → Existing Business Logic → Data Repository → Database
 *
 * Today the only implementation is `CloudRepository`, which is a thin
 * pass-through to the existing Supabase client. It performs the *exact* same
 * calls the screens already make, so swapping a screen over to the repository
 * cannot change a single number. A `LocalRepository` (SQLite / WASM, and later
 * better-sqlite3 inside a Windows desktop shell) implements the same contract
 * and can be dropped in without touching UI or business logic.
 *
 * NOTHING in this folder is wired into a route yet. It is inert scaffolding.
 */

/** Every table the application persists. Mirrors the cloud schema 1:1. */
export type TableName =
  | "audit_log"
  | "branches"
  | "cash_movements"
  | "categories"
  | "customers"
  | "daily_closings"
  | "delivery_expenses"
  | "employees"
  | "expense_categories"
  | "expenses"
  | "katha_opening"
  | "money_movement_subcategories"
  | "monthly_stock_overrides"
  | "production_batch_items"
  | "production_batches"
  | "products"
  | "purchase_items"
  | "purchases"
  | "recipes"
  | "sale_items"
  | "sales"
  | "settings"
  | "staff"
  | "staff_attendance"
  | "staff_month_carry"
  | "staff_payments"
  | "stock_adjustments"
  | "stock_items"
  | "stock_opening_snapshots"
  | "stock_purchases"
  | "stock_transfers"
  | "suppliers"
  | "user_roles";

export type Row = Record<string, any>;

export type Order = { column: string; ascending?: boolean };

/** Declarative filter set — deliberately small and portable to SQL. */
export type Filter = {
  eq?: Record<string, any>;
  neq?: Record<string, any>;
  gte?: Record<string, any>;
  lte?: Record<string, any>;
  in?: Record<string, any[]>;
  /** `{ deleted_at: null }` → `IS NULL`; `{ deleted_at: "not" }` → `IS NOT NULL`. */
  is?: Record<string, null | "not">;
};

export type SelectOptions = {
  /** Column projection. Defaults to `*`. */
  columns?: string;
  filter?: Filter;
  order?: Order | Order[];
  /** Page size for the internal paged fetch. Defaults to 1000 (cloud page cap). */
  pageSize?: number;
  /** Hard cap on returned rows. Omit to fetch every matching row. */
  limit?: number;
};

/**
 * The portable data-access contract.
 *
 * Business logic must never assume which implementation is behind it, and no
 * implementation may add, reinterpret, or "repair" data. Reads read, writes
 * write, and calculations stay in the business layer (inventory engine,
 * report engine, money-movement rules) exactly where they are today.
 */
export interface DataRepository {
  readonly kind: "cloud" | "local";

  /** Fetch every matching row (transparently paged — no 1000-row cap). */
  list<T = Row>(table: TableName, options?: SelectOptions): Promise<T[]>;

  /** Fetch a single row by primary key, or null. */
  getById<T = Row>(table: TableName, id: string | number, columns?: string): Promise<T | null>;

  /** Fetch the first matching row, or null. */
  findOne<T = Row>(table: TableName, options?: SelectOptions): Promise<T | null>;

  /** Count matching rows without transferring them. */
  count(table: TableName, filter?: Filter): Promise<number>;

  /** Insert one or many rows. IDs supplied by the caller are preserved verbatim. */
  insert<T = Row>(table: TableName, values: Row | Row[]): Promise<T[]>;

  /** Update the rows matching `filter`. */
  update<T = Row>(table: TableName, values: Row, filter: Filter): Promise<T[]>;

  /** Insert-or-update on the given conflict target. */
  upsert<T = Row>(table: TableName, values: Row | Row[], onConflict?: string): Promise<T[]>;

  /** Hard delete. The app's normal delete path is a soft delete via `update`. */
  remove(table: TableName, filter: Filter): Promise<void>;

  /**
   * Stored-procedure call. On cloud this is a Postgres RPC; the local
   * implementation will reimplement each procedure in TypeScript/SQLite with
   * identical semantics.
   */
  rpc<T = any>(fn: string, args?: Record<string, any>): Promise<T>;
}
