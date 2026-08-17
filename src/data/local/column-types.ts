/**
 * PHASE 4 — cloud value shapes.
 *
 * SQLite has no boolean, json or array storage class, so the Phase-3 seed
 * stored booleans as 0/1 and json/array columns as canonical JSON text. To
 * make a local read indistinguishable from a cloud read, those columns are
 * hydrated back to their cloud representation here — and nothing else is
 * touched: uuids, timestamps, dates, times, numerics, nulls and soft-delete
 * markers are returned exactly as stored.
 *
 * The lists below come from the live cloud `information_schema`, not from
 * guesswork.
 */

import type { SqliteValue } from "./seed-format";

/** Columns Postgres reports as `boolean`. */
export const BOOLEAN_COLUMNS: Record<string, string[]> = {
  categories: ["active"],
  employees: ["active"],
  expense_categories: ["active"],
  expenses: ["is_stock_transfer"],
  money_movement_subcategories: ["active"],
  products: ["active", "allow_negative_stock", "track_stock", "auto_calc"],
  sales: ["katha", "hidden"],
  settings: ["allow_negative_stock", "whatsapp_auto_send"],
  stock_items: ["auto_calc"],
};

/** Columns Postgres reports as `jsonb` or as an array type. */
export const JSON_COLUMNS: Record<string, string[]> = {
  audit_log: ["details"],
  recipes: ["applies_to"],
  settings: ["pin_locks"],
};

export function isBooleanColumn(table: string, column: string): boolean {
  return (BOOLEAN_COLUMNS[table] ?? []).includes(column);
}

export function isJsonColumn(table: string, column: string): boolean {
  return (JSON_COLUMNS[table] ?? []).includes(column);
}

/**
 * Turns one raw mirror row into the shape a Supabase read would return.
 * NULL stays null for every column type — a nullable boolean is not coerced
 * to `false`, and a nullable json column is not coerced to `{}`.
 */
export function hydrateRow<T = Record<string, any>>(
  table: string,
  row: Record<string, SqliteValue>,
): T {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      out[key] = null;
      continue;
    }
    if (isBooleanColumn(table, key)) {
      out[key] = value === 1 || value === "1";
      continue;
    }
    if (isJsonColumn(table, key)) {
      try {
        out[key] = JSON.parse(String(value));
      } catch {
        out[key] = value;
      }
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

export function hydrateRows<T = Record<string, any>>(
  table: string,
  rows: Record<string, SqliteValue>[],
): T[] {
  return rows.map((r) => hydrateRow<T>(table, r));
}
