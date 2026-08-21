/**
 * BACKUP FORMAT — v1 (export / restore preparation only).
 *
 * Read-only with respect to the live cloud database. Nothing in this folder
 * writes, repairs, recalculates or deletes anything. It only reads every row
 * of every table and packages it verbatim so a future Windows/offline build
 * can import it into a local SQLite database, keeping the original IDs and
 * every relationship intact.
 */

import type { TableName } from "@/data/repo";

export const BACKUP_FORMAT_VERSION = 1 as const;

/**
 * Every table that is part of an application backup, in a dependency-safe
 * order: a table only ever references tables that appear before it, so a
 * restore can insert straight down this list without deferring constraints.
 */
export const BACKUP_TABLES: TableName[] = [
  // configuration / reference data
  "settings",
  "branches",
  "categories",
  "expense_categories",
  "money_movement_subcategories",
  "user_roles",
  // master data
  "suppliers",
  "customers",
  "employees",
  "staff",
  "products",
  "stock_items",
  "recipes",
  // transactions
  "purchases",
  "purchase_items",
  "stock_purchases",
  "production_batches",
  "production_batch_items",
  "sales",
  "sale_items",
  "stock_transfers",
  "stock_adjustments",
  "expenses",
  "delivery_expenses",
  "cash_movements",
  // staff ledgers
  "staff_attendance",
  "staff_payments",
  "staff_month_carry",
  // katha / closings / snapshots
  "katha_opening",
  "daily_closings",
  "stock_opening_snapshots",
  "monthly_stock_overrides",
  // audit
  "audit_log",
];

/** Primary key column per table (used by the future de-duplicating restore). */
export const PRIMARY_KEYS: Record<string, string> = {
  settings: "id",
  katha_opening: "id",
  // everything else is a uuid `id`
};

export function primaryKeyOf(table: TableName): string {
  return PRIMARY_KEYS[table] ?? "id";
}

export type BackupTable = {
  /** Table name, identical to the cloud/local schema name. */
  table: TableName;
  /** Primary key column — restore must upsert on this, never insert blindly. */
  primaryKey: string;
  /** Row count reported by the database before the rows were fetched. */
  expectedCount: number;
  /** Row count actually exported. Must equal `expectedCount`. */
  exportedCount: number;
  /** Raw rows, exactly as stored: no rounding, no date/timezone conversion. */
  rows: Record<string, any>[];
};

export type BackupFile = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  app: "Khyber Delicious Food POS";
  /** The locked master base this backup belongs to. */
  masterBase: "7 August 4:15 PM — Fixed stock engine & POS Bugs";
  /** ISO timestamp of when the export ran (informational only). */
  createdAt: string;
  source: "cloud";
  /** true only when every table's exported count matched its database count. */
  complete: boolean;
  tables: BackupTable[];
  totals: { tables: number; rows: number };
};

export type BackupValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Per-table row counts found in the file. */
  counts: Record<string, number>;
};
