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

/**
 * Structural + integrity + referential validation of a backup file, before any
 * import. Async because the SHA-256 checksum is recomputed with Web Crypto.
 */
export async function validateBackup(input: unknown): Promise<BackupValidation> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const backup = input as BackupFile;

  if (!backup || typeof backup !== "object" || !Array.isArray(backup.tables)) {
    return { ok: false, errors: ["File is not a recognised backup."], warnings, counts };
  }
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [`Unsupported backup format version: ${String(backup.formatVersion)}`],
      warnings,
      counts,
    };
  }
  if (backup.complete !== true) {
    errors.push("Backup is not marked complete — it failed verification during export.");
  }

  // --- integrity metadata + checksum -------------------------------------
  const integrity = backup.integrity;
  if (!integrity || integrity.algorithm !== "SHA-256" || typeof integrity.checksum !== "string") {
    errors.push("Backup has no valid integrity metadata.");
  } else {
    try {
      const recomputed = await computeChecksum(payloadOf(backup));
      if (recomputed !== integrity.checksum) {
        errors.push("Checksum mismatch — the backup file is corrupt or was modified.");
      }
    } catch (e: any) {
      errors.push(`Checksum could not be verified: ${e?.message ?? e}`);
    }
  }

  const digest = backup.rowCountByTable;
  if (!digest || typeof digest !== "object") {
    errors.push("Backup has no row-count digest.");
  }

  const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

  const byTable = new Map<string, Record<string, any>[]>();
  for (const t of backup.tables) {
    const rows = t.rows ?? [];
    counts[t.table] = rows.length;
    byTable.set(t.table, rows);

    if (!isCount(t.countBefore) || !isCount(t.exportedCount) || !isCount(t.countAfter)) {
      errors.push(`${t.table}: invalid row counts.`);
    } else if (t.countBefore !== t.exportedCount || t.exportedCount !== t.countAfter) {
      errors.push(
        `${t.table}: row counts disagree (before: ${t.countBefore}, exported: ${t.exportedCount}, after: ${t.countAfter}).`,
      );
    }
    if (t.exportedCount !== rows.length) {
      errors.push(`${t.table}: exportedCount ${t.exportedCount} does not match ${rows.length} stored rows.`);
    }
    if (digest && digest[t.table] !== rows.length) {
      errors.push(`${t.table}: row-count digest mismatch (${digest[t.table]} vs ${rows.length}).`);
    }

    const pk = primaryKeyOf(t.table);
    const seen = new Set<any>();
    for (const row of rows) {
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

  if (digest) {
    for (const table of Object.keys(digest)) {
      if (!byTable.has(table)) errors.push(`${table}: present in the row-count digest but not exported.`);
    }
  }

  for (const table of BACKUP_TABLES) {
    if (!byTable.has(table)) errors.push(`${table}: required table missing from the backup.`);
  }

  for (const t of backup.meta?.rlsLimitedTables ?? []) {
    warnings.push(
      `${t}: limited by row-level security to rows visible to the backup's authenticated user — not a complete export.`,
    );
  }
  for (const [table, fields] of Object.entries(backup.meta?.redactedFields ?? {})) {
    warnings.push(`${table}: sensitive field(s) redacted in this backup — ${fields.join(", ")}.`);
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
