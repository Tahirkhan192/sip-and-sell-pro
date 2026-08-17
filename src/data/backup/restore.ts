/**
 * RESTORE PREPARATION — validation + an idempotent restore plan.
 *
 * Nothing here runs against the cloud. It exists so the future Windows/offline
 * build (and any manual Visual Studio work) has one authoritative definition
 * of how a backup must be imported into the local SQLite database:
 *
 *   Google Drive backup → download → validate → import → rebuild relationships
 *
 * Duplication rule: every table is restored with `INSERT ... ON CONFLICT(pk)
 * DO UPDATE` (upsert) using the ORIGINAL primary key from the backup. A backup
 * containing Purchase X can be restored any number of times and always yields
 * exactly one Purchase X.
 */

import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  computeChecksum,
  payloadOf,
  primaryKeyOf,
  type BackupFile,
  type BackupValidation,
} from "./format";
import type { TableName } from "@/data/repo";

/** Parent → child relationships that must still resolve after import. */
export const RELATIONSHIPS: { child: TableName; column: string; parent: TableName }[] = [
  { child: "sale_items", column: "sale_id", parent: "sales" },
  { child: "sale_items", column: "product_id", parent: "products" },
  { child: "purchase_items", column: "purchase_id", parent: "purchases" },
  { child: "purchase_items", column: "product_id", parent: "products" },
  { child: "purchase_items", column: "stock_item_id", parent: "stock_items" },
  { child: "recipes", column: "parent_product_id", parent: "products" },
  { child: "recipes", column: "component_product_id", parent: "products" },
  { child: "recipes", column: "component_stock_item_id", parent: "stock_items" },
  { child: "production_batch_items", column: "batch_id", parent: "production_batches" },
  { child: "production_batches", column: "product_id", parent: "products" },
  { child: "stock_transfers", column: "product_id", parent: "products" },
  { child: "stock_transfers", column: "stock_item_id", parent: "stock_items" },
  { child: "stock_adjustments", column: "product_id", parent: "products" },
  { child: "stock_adjustments", column: "stock_item_id", parent: "stock_items" },
  { child: "staff_attendance", column: "staff_id", parent: "staff" },
  { child: "staff_payments", column: "staff_id", parent: "staff" },
  { child: "staff_month_carry", column: "staff_id", parent: "staff" },
  { child: "sales", column: "staff_id", parent: "staff" },
  { child: "sales", column: "customer_id", parent: "customers" },
];

/** Structural + referential validation of a backup file, before any import. */
export function validateBackup(input: unknown): BackupValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const backup = input as BackupFile;

  if (!backup || typeof backup !== "object" || !Array.isArray(backup.tables)) {
    return { ok: false, errors: ["File is not a recognised backup."], warnings, counts };
  }
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    errors.push(`Unsupported backup format version: ${backup.formatVersion}`);
  }
  if (backup.complete === false) {
    errors.push("Backup is marked incomplete — one or more tables were truncated during export.");
  }

  const byTable = new Map<string, Record<string, any>[]>();
  for (const t of backup.tables) {
    counts[t.table] = t.rows?.length ?? 0;
    byTable.set(t.table, t.rows ?? []);
    if (t.exportedCount < t.expectedCount) {
      errors.push(`${t.table}: exported ${t.exportedCount} of ${t.expectedCount} rows.`);
    }
    const pk = primaryKeyOf(t.table);
    const seen = new Set<any>();
    for (const row of t.rows ?? []) {
      if (row[pk] === undefined || row[pk] === null) {
        errors.push(`${t.table}: a row has no ${pk}.`);
        break;
      }
      if (seen.has(row[pk])) {
        errors.push(`${t.table}: duplicate primary key ${row[pk]} inside the backup.`);
        break;
      }
      seen.add(row[pk]);
    }
  }

  for (const table of BACKUP_TABLES) {
    if (!byTable.has(table)) warnings.push(`${table}: missing from the backup.`);
  }

  for (const rel of RELATIONSHIPS) {
    const children = byTable.get(rel.child);
    const parents = byTable.get(rel.parent);
    if (!children || !parents) continue;
    const ids = new Set(parents.map((p) => p[primaryKeyOf(rel.parent)]));
    const orphan = children.find(
      (c) => c[rel.column] != null && !ids.has(c[rel.column]),
    );
    if (orphan) {
      warnings.push(`${rel.child}.${rel.column} → ${rel.parent}: at least one reference has no parent row.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, counts };
}

/** Ordered, idempotent import steps for the future local database. */
export type RestoreStep = {
  table: TableName;
  primaryKey: string;
  rowCount: number;
  /** Always an upsert on the original primary key — never a plain insert. */
  mode: "upsert-on-primary-key";
};

export function planRestore(backup: BackupFile): RestoreStep[] {
  const order = new Map(BACKUP_TABLES.map((t, i) => [t, i]));
  return [...backup.tables]
    .sort((a, b) => (order.get(a.table) ?? 999) - (order.get(b.table) ?? 999))
    .map((t) => ({
      table: t.table,
      primaryKey: t.primaryKey ?? primaryKeyOf(t.table),
      rowCount: t.rows?.length ?? 0,
      mode: "upsert-on-primary-key" as const,
    }));
}
