/**
 * Full database export. READ-ONLY: it issues nothing but `select` calls.
 *
 * Pagination is mandatory — the cloud API caps a single response at 1000 rows,
 * so every table is fetched page by page until a short page comes back. The
 * exported row count is then compared with a `count` query taken from the
 * database; a mismatch marks the backup incomplete instead of silently
 * truncating.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  primaryKeyOf,
  type BackupFile,
  type BackupTable,
} from "./format";
import type { TableName } from "@/data/repo";

const PAGE = 1000;

export type ExportProgress = {
  table: TableName;
  index: number;
  total: number;
  rows: number;
};

async function countRows(table: TableName): Promise<number> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/** Fetch every row of a table, paged, ordered by primary key for stability. */
async function fetchAll(table: TableName, onPage?: (n: number) => void) {
  const pk = primaryKeyOf(table);
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase as any)
      .from(table)
      .select("*")
      .order(pk, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Record<string, any>[];
    rows.push(...page);
    onPage?.(rows.length);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function exportFullBackup(
  onProgress?: (p: ExportProgress) => void,
): Promise<BackupFile> {
  const tables: BackupTable[] = [];
  let total = 0;

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const table = BACKUP_TABLES[i];
    onProgress?.({ table, index: i, total: BACKUP_TABLES.length, rows: 0 });

    const expectedCount = await countRows(table);
    const rows = await fetchAll(table, (n) =>
      onProgress?.({ table, index: i, total: BACKUP_TABLES.length, rows: n }),
    );

    tables.push({
      table,
      primaryKey: primaryKeyOf(table),
      expectedCount,
      exportedCount: rows.length,
      rows,
    });
    total += rows.length;
  }

  const complete = tables.every((t) => t.exportedCount >= t.expectedCount);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: "Khyber Delicious Food POS",
    masterBase: "7 August 4:15 PM — Fixed stock engine & POS Bugs",
    createdAt: new Date().toISOString(),
    source: "cloud",
    complete,
    tables,
    totals: { tables: tables.length, rows: total },
  };
}

/** Human-readable per-table verification report (exported vs database count). */
export function verificationReport(backup: BackupFile) {
  return backup.tables.map((t) => ({
    table: t.table,
    inDatabase: t.expectedCount,
    exported: t.exportedCount,
    ok: t.exportedCount >= t.expectedCount,
  }));
}

/** Trigger a browser download of the backup as pretty-printed JSON. */
export function downloadBackup(backup: BackupFile) {
  const stamp = backup.createdAt.replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kdf-pos-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
