/**
 * BACKUP FORMAT — v2.
 *
 * v2 carries trustworthiness data: before/exported/after row counts, a
 * deterministic row-count digest, provenance metadata and a SHA-256 checksum
 * over a canonical serialization of the payload.
 *
 * PHASE 8 extends — never replaces — that same v2 design so old cloud backups
 * stay readable:
 *
 *   * `source` is now "cloud" | "local". A LOCAL backup is a snapshot of the
 *     local SQLite database (the authoritative operational store for the
 *     migrated operations); a CLOUD backup is the original read-only Supabase
 *     export. Both share this one format and one validator.
 *   * local backups additionally record `deviceId` and `schemaVersion`, so a
 *     restore can refuse an incompatible database before touching anything.
 *   * table ordering, primary keys and the redaction rules are unchanged.
 */

import type { TableName } from "@/data/repo";

export const BACKUP_FORMAT_VERSION = 2 as const;

/** Where the rows in a backup came from. */
export type BackupSource = "cloud" | "local";

/** Transport-level compression of the backup bytes (never of the payload). */
export type BackupCompression = "none" | "gzip";


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
  source: BackupSource;
  /** true only when every table's before/exported/after counts matched. */
  complete: boolean;
  meta: BackupMeta;
  /** Deterministic table → exported row count digest. */
  rowCountByTable: Record<string, number>;
  tables: BackupTable[];
  totals: { tables: number; rows: number };
  integrity: BackupIntegrity;
  /* ---- PHASE 8: present on local snapshots only ---- */
  /** Local SQLite schema revision the snapshot was taken from. */
  schemaVersion?: number;
  /** Stable local install id the snapshot came from. */
  deviceId?: string;
};

/**
 * A local backup always carries its provenance. Restore refuses anything that
 * claims `source: "local"` without it.
 */
export type LocalBackupFile = BackupFile & {
  source: "local";
  schemaVersion: number;
  deviceId: string;
};

/**
 * Schema compatibility for restore: a backup may be restored into the same
 * schema revision or a NEWER one (the local schema is additive), never into an
 * older application build that does not know the newer tables/columns.
 */
export function isSchemaCompatible(backupSchema: number, localSchema: number): boolean {
  return Number.isInteger(backupSchema) && backupSchema > 0 && backupSchema <= localSchema;
}


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

/* ------------------------------------------------------------------ *
 * PHASE 8 — credential guard                                          *
 * ------------------------------------------------------------------ */

/**
 * Column names that must never appear in a backup at all, in any table.
 * `SENSITIVE_FIELDS` redacts known secret columns; this is the belt-and-braces
 * check that runs over the finished payload before it is hashed or uploaded.
 */
export const FORBIDDEN_KEY_PATTERN =
  /(access_token|refresh_token|id_token|service_role|client_secret|private_key|api_key|apikey|password|secret_hash)/i;

/** Value shapes that are always a credential, whatever the column is called. */
export const FORBIDDEN_VALUE_PATTERNS: RegExp[] = [
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT (Supabase access/refresh)
  /\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/, // new-format Supabase keys
  /\bya29\.[A-Za-z0-9_-]{10,}/, // Google OAuth access token
  /\bGOCSPX-[A-Za-z0-9_-]{8,}/, // Google OAuth client secret
  /\bEAA[A-Za-z0-9]{20,}/, // WhatsApp / Meta graph token
];

export class BackupCredentialError extends Error {
  constructor(what: string) {
    super(`Refusing to produce a backup that contains credentials (${what}).`);
    this.name = "BackupCredentialError";
  }
}

/**
 * Walks the whole payload and throws when a credential-shaped key or value is
 * found. Called on every backup before checksum and before upload, so no
 * password, Supabase key, OAuth token or WhatsApp token can ever leave the
 * device inside a backup file.
 */
export function assertNoCredentials(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value === REDACTED) return;
    for (const re of FORBIDDEN_VALUE_PATTERNS) {
      if (re.test(value)) throw new BackupCredentialError(`${path} looks like a token`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoCredentials(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(k) && v !== null && v !== "" && v !== REDACTED) {
      throw new BackupCredentialError(`${path}.${k}`);
    }
    assertNoCredentials(v, `${path}.${k}`);
  }
}
