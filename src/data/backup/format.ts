/**
 * BACKUP FORMAT — v2 (export / restore preparation only).
 *
 * Read-only with respect to the live cloud database. Nothing in this folder
 * writes, repairs, recalculates or deletes anything. It only reads every row
 * of every table and packages it verbatim so a future Windows/offline build
 * can import it into a local SQLite database, keeping the original IDs and
 * every relationship intact.
 *
 * v2 adds trustworthiness data: before/exported/after row counts, a
 * deterministic row-count digest, provenance metadata (authenticated user)
 * and a SHA-256 checksum over a canonical serialization of the payload.
 */

import type { TableName } from "@/data/repo";

export const BACKUP_FORMAT_VERSION = 2 as const;

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

/**
 * Secret-bearing columns that must never leave the database in plain text.
 * They are redacted from the backup; the rest of the row is preserved.
 */
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  settings: ["whatsapp_token"],
};

export const REDACTED = "__REDACTED__" as const;

/** Tables whose contents are limited by RLS to the current user's own rows. */
export const RLS_LIMITED_TABLES: TableName[] = ["user_roles"];

export type BackupTable = {
  /** Table name, identical to the cloud/local schema name. */
  table: TableName;
  /** Primary key column — restore must upsert on this, never insert blindly. */
  primaryKey: string;
  /** Row count reported by the database BEFORE the rows were fetched. */
  countBefore: number;
  /** Row count actually exported. */
  exportedCount: number;
  /** Row count reported by the database AFTER the rows were fetched. */
  countAfter: number;
  /** Raw rows, exactly as stored: no rounding, no date/timezone conversion. */
  rows: Record<string, any>[];
};

export type BackupMeta = {
  /** Supabase auth user id whose RLS visibility produced this backup. */
  authUserId: string;
  authEmail: string | null;
  appVersion: string | null;
  /** e.g. { settings: ["whatsapp_token"] } */
  redactedFields: Record<string, string[]>;
  /** Tables whose rows are limited to what the authenticated user may read. */
  rlsLimitedTables: string[];
  notes: string[];
};

export type BackupIntegrity = {
  algorithm: "SHA-256";
  /** Lowercase hex SHA-256 over the canonical payload (integrity excluded). */
  checksum: string;
};

export type BackupFile = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  app: "Khyber Delicious Food POS";
  /** The locked master base this backup belongs to. */
  masterBase: "7 August 4:15 PM — Fixed stock engine & POS Bugs";
  /** ISO timestamp of when the export ran (informational only). */
  createdAt: string;
  source: "cloud";
  /** true only when every table's before/exported/after counts matched. */
  complete: boolean;
  meta: BackupMeta;
  /** Deterministic table → exported row count digest. */
  rowCountByTable: Record<string, number>;
  tables: BackupTable[];
  totals: { tables: number; rows: number };
  integrity: BackupIntegrity;
};

/** Everything that is hashed. `integrity` itself is deliberately excluded. */
export type BackupPayload = Omit<BackupFile, "integrity">;

export type BackupValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Per-table row counts found in the file. */
  counts: Record<string, number>;
};

/**
 * Deterministic JSON serialization: object keys are emitted in sorted order at
 * every depth, arrays keep their order. Used for both checksum creation and
 * verification, so formatting can never influence the digest.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  }
  return `{${parts.join(",")}}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 (Web Crypto) over the canonical serialization of the payload. */
export async function computeChecksum(payload: BackupPayload): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable — cannot produce a verified backup.");
  const bytes = new TextEncoder().encode(canonicalStringify(payload));
  return toHex(await subtle.digest("SHA-256", bytes));
}

/** Strip the integrity block so a stored backup can be re-hashed identically. */
export function payloadOf(backup: BackupFile): BackupPayload {
  const { integrity: _integrity, ...payload } = backup;
  return payload as BackupPayload;
}

/** Redacted copy of a row when the table carries secret columns. */
export function redactRow(table: string, row: Record<string, any>): Record<string, any> {
  const fields = SENSITIVE_FIELDS[table];
  if (!fields?.length) return row;
  let copy: Record<string, any> | null = null;
  for (const f of fields) {
    if (row[f] === undefined || row[f] === null || row[f] === "") continue;
    copy ??= { ...row };
    copy[f] = REDACTED;
  }
  return copy ?? row;
}
