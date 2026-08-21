/**
 * Phase 3 — Safe data migration: Lovable Cloud -> local SQLite.
 *
 * Guarantees
 * ----------
 *   * Idempotent. Every write uses INSERT OR REPLACE on the primary key
 *     (UUID). Running it twice produces the same result as running once.
 *   * Non-destructive. No cloud data is ever written or deleted.
 *   * UUIDs preserved. The cloud `id` becomes the local `id` unchanged.
 *   * Relationships preserved. Tables are copied in FK-safe order and the
 *     migration runs with `PRAGMA defer_foreign_keys = ON` so cross-references
 *     resolve at COMMIT time.
 *   * Verified. After each table copies, the migration counts rows on both
 *     sides and reports any drift.
 *   * Application unchanged. This module is NOT imported by any route,
 *     component, or provider. Nothing runs unless the user calls
 *     `migrateCloudToLocal()` explicitly (e.g. from the browser console).
 *
 * How to run (dev / preview)
 * --------------------------
 *   1. Open the preview and sign in.
 *   2. Open browser DevTools console.
 *   3. Paste:
 *
 *        const m = await import('/src/data/local/migrate.ts');
 *        const report = await m.migrateCloudToLocal();
 *        console.table(report.tables);
 *        console.log(report);
 *
 *   4. Inspect `report.mismatches` — should be empty for a healthy run.
 */

import { supabase } from "@/integrations/supabase/client";
import { openLocalDb, getDeviceId, type LocalDb } from "./db";

/* ------------------------------------------------------------------ */
/* Table order — parents before children, so FKs resolve on COMMIT.    */
/* ------------------------------------------------------------------ */

const TABLE_ORDER = [
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
] as const;

type TableName = (typeof TABLE_ORDER)[number];

/* ------------------------------------------------------------------ */
/* Per-table shape adapters                                            */
/* ------------------------------------------------------------------ */

type CloudRow = Record<string, unknown>;
type LocalRow = Record<string, unknown>;
type RowTransform = (row: CloudRow, deviceId: string) => LocalRow;

/**
 * Default transform: pass every cloud column through, fill the sync
 * envelope with sensible defaults, and mark the row as `synced` since
 * it just came from the authoritative store.
 */
function defaultTransform(row: CloudRow, deviceId: string): LocalRow {
  const now = new Date().toISOString();
  const version = numberOr(row.version, 1);
  return {
    ...row,
    created_at: (row.created_at as string | null | undefined) ?? now,
    updated_at: (row.updated_at as string | null | undefined) ?? now,
    deleted_at: (row.deleted_at as string | null | undefined) ?? null,
    business_date: (row.business_date as string | null | undefined) ?? null,
    business_time: (row.business_time as string | null | undefined) ?? null,
    version,
    server_version: numberOr(row.server_version, version),
    device_id: (row.device_id as string | null | undefined) ?? deviceId,
    sync_status: "synced",
  };
}

/**
 * Cloud `settings` has a variable schema. Store each row as JSON keyed by
 * its UUID so nothing is lost, without forcing a rigid column mapping now.
 */
const settingsTransform: RowTransform = (row, deviceId) => {
  const base = defaultTransform(row, deviceId);
  return {
    ...base,
    key: (row.key as string | undefined) ?? String(row.id),
    value_json: JSON.stringify(row),
  };
};

const TRANSFORMS: Partial<Record<TableName, RowTransform>> = {
  settings: settingsTransform,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export interface TableReport {
  table: TableName;
  cloudCount: number;
  localCount: number;
  copied: number;
  match: boolean;
  errors: string[];
  durationMs: number;
}

export interface MigrationReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  deviceId: string;
  tables: TableReport[];
  mismatches: Array<{ table: TableName; cloudCount: number; localCount: number }>;
  errors: Array<{ table: TableName; message: string }>;
  ok: boolean;
}

export async function migrateCloudToLocal(): Promise<MigrationReport> {
  const startedAt = new Date();
  const db = await openLocalDb();
  const deviceId = getDeviceId(db);

  const report: MigrationReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    deviceId,
    tables: [],
    mismatches: [],
    errors: [],
    ok: true,
  };

  for (const table of TABLE_ORDER) {
    const tStart = performance.now();
    const tReport: TableReport = {
      table,
      cloudCount: 0,
      localCount: 0,
      copied: 0,
      match: false,
      errors: [],
      durationMs: 0,
    };

    try {
      const localCols = getLocalColumns(db, table);
      if (localCols.size === 0) {
        throw new Error(`Local table \`${table}\` not found in SQLite schema`);
      }

      const cloudCount = await getCloudCount(table);
      tReport.cloudCount = cloudCount;

      const cloudRows = await fetchAllPaged(table);
      const transform = TRANSFORMS[table] ?? defaultTransform;

      // Everything for this table is one transaction — no partial copies.
      db.exec("BEGIN");
      try {
        db.exec("PRAGMA defer_foreign_keys = ON");
        for (const row of cloudRows) {
          const shaped = transform(row as CloudRow, deviceId);
          insertOrReplace(db, table, shaped, localCols);
          tReport.copied += 1;
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }

      tReport.localCount = countLocal(db, table);
      tReport.match = tReport.cloudCount === tReport.localCount;
      if (!tReport.match) {
        report.mismatches.push({
          table,
          cloudCount: tReport.cloudCount,
          localCount: tReport.localCount,
        });
        report.ok = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tReport.errors.push(msg);
      report.errors.push({ table, message: msg });
      report.ok = false;
      console.error(`[migrate] ${table} failed:`, err);
    }

    tReport.durationMs = Math.round(performance.now() - tStart);
    report.tables.push(tReport);
    console.info(
      `[migrate] ${table}: cloud=${tReport.cloudCount} local=${tReport.localCount} copied=${tReport.copied} ok=${tReport.match} in ${tReport.durationMs}ms`,
    );
  }

  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  return report;
}

/**
 * Copy only tables the caller names. Same guarantees as
 * `migrateCloudToLocal()`; useful when re-verifying a single table.
 */
export async function migrateCloudToLocalTables(
  tables: TableName[],
): Promise<MigrationReport> {
  const original = TABLE_ORDER.slice();
  const filtered = original.filter((t) => tables.includes(t));
  // Reuse the same runner by temporarily narrowing the exported order.
  return migrateCloudToLocalInternal(filtered);
}

async function migrateCloudToLocalInternal(order: readonly TableName[]) {
  // Simple duplication of the loop above with a custom order to keep the
  // public entry point signature clean.
  const startedAt = new Date();
  const db = await openLocalDb();
  const deviceId = getDeviceId(db);
  const report: MigrationReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    deviceId,
    tables: [],
    mismatches: [],
    errors: [],
    ok: true,
  };
  for (const table of order) {
    const tStart = performance.now();
    const tReport: TableReport = { table, cloudCount: 0, localCount: 0, copied: 0, match: false, errors: [], durationMs: 0 };
    try {
      const localCols = getLocalColumns(db, table);
      if (localCols.size === 0) throw new Error(`Local table \`${table}\` not found`);
      tReport.cloudCount = await getCloudCount(table);
      const rows = await fetchAllPaged(table);
      const transform = TRANSFORMS[table] ?? defaultTransform;
      db.exec("BEGIN");
      try {
        db.exec("PRAGMA defer_foreign_keys = ON");
        for (const row of rows) {
          insertOrReplace(db, table, transform(row as CloudRow, deviceId), localCols);
          tReport.copied += 1;
        }
        db.exec("COMMIT");
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch { /* noop */ }
        throw err;
      }
      tReport.localCount = countLocal(db, table);
      tReport.match = tReport.cloudCount === tReport.localCount;
      if (!tReport.match) {
        report.mismatches.push({ table, cloudCount: tReport.cloudCount, localCount: tReport.localCount });
        report.ok = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tReport.errors.push(msg);
      report.errors.push({ table, message: msg });
      report.ok = false;
    }
    tReport.durationMs = Math.round(performance.now() - tStart);
    report.tables.push(tReport);
  }
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  return report;
}

/**
 * Read-only verification pass — no writes. Compares cloud vs local row
 * counts for every mapped table and returns the mismatches.
 */
export async function verifyMigration(): Promise<MigrationReport> {
  const db = await openLocalDb();
  const startedAt = new Date();
  const report: MigrationReport = {
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    deviceId: getDeviceId(db),
    tables: [],
    mismatches: [],
    errors: [],
    ok: true,
  };
  for (const table of TABLE_ORDER) {
    const tStart = performance.now();
    const tReport: TableReport = { table, cloudCount: 0, localCount: 0, copied: 0, match: false, errors: [], durationMs: 0 };
    try {
      tReport.cloudCount = await getCloudCount(table);
      tReport.localCount = countLocal(db, table);
      tReport.match = tReport.cloudCount === tReport.localCount;
      if (!tReport.match) {
        report.mismatches.push({ table, cloudCount: tReport.cloudCount, localCount: tReport.localCount });
        report.ok = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tReport.errors.push(msg);
      report.errors.push({ table, message: msg });
      report.ok = false;
    }
    tReport.durationMs = Math.round(performance.now() - tStart);
    report.tables.push(tReport);
  }
  const finishedAt = new Date();
  report.finishedAt = finishedAt.toISOString();
  report.durationMs = finishedAt.getTime() - startedAt.getTime();
  return report;
}

/* ------------------------------------------------------------------ */
/* Cloud helpers                                                       */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 1000;

async function getCloudCount(table: string): Promise<number> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`cloud count for ${table}: ${error.message}`);
  return count ?? 0;
}

async function fetchAllPaged(table: string): Promise<CloudRow[]> {
  const rows: CloudRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await (supabase as any)
      .from(table)
      .select("*")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`cloud fetch for ${table}: ${error.message}`);
    const page = (data ?? []) as CloudRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Local helpers                                                       */
/* ------------------------------------------------------------------ */

function getLocalColumns(db: LocalDb, table: string): Set<string> {
  const cols = new Set<string>();
  db.exec({
    sql: `PRAGMA table_info(${quoteIdent(table)})`,
    rowMode: "object",
    callback: (row: any) => {
      if (row?.name) cols.add(String(row.name));
    },
  });
  return cols;
}

function countLocal(db: LocalDb, table: string): number {
  const val = (db as any).selectValue(`SELECT COUNT(*) FROM ${quoteIdent(table)}`);
  return typeof val === "number" ? val : Number(val ?? 0);
}

function insertOrReplace(
  db: LocalDb,
  table: string,
  row: LocalRow,
  localCols: Set<string>,
) {
  const keys: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!localCols.has(k)) continue; // silently drop cloud-only columns
    keys.push(k);
    values.push(normalizeValue(v));
  }
  if (keys.length === 0) return;
  const placeholders = keys.map(() => "?").join(",");
  const sql = `INSERT OR REPLACE INTO ${quoteIdent(table)} (${keys
    .map(quoteIdent)
    .join(",")}) VALUES (${placeholders})`;
  db.exec({ sql, bind: values as any });
}

function normalizeValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}
