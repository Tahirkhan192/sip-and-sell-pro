/**
 * Full database export. READ-ONLY: it issues nothing but `select` calls.
 *
 * Trustworthiness rules (Phase 1 hardening):
 *  - a valid authenticated session is required before and after the export;
 *  - pagination is keyset based (`pk > lastPk`), never offset based, so
 *    concurrent inserts cannot make rows be skipped;
 *  - every table records countBefore / exportedCount / countAfter and all
 *    three must be equal for the backup to be considered complete;
 *  - secret settings columns are redacted;
 *  - the file carries a deterministic row-count digest and a SHA-256 checksum.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  RLS_LIMITED_TABLES,
  SENSITIVE_FIELDS,
  computeChecksum,
  primaryKeyOf,
  redactRow,
  type BackupFile,
  type BackupPayload,
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

export class BackupError extends Error {}

async function requireSession(phase: "before" | "during" | "after") {
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || !session.user?.id) {
    throw new BackupError(
      phase === "before"
        ? "Backup failed: your session is not authenticated. Please log in again."
        : "Backup aborted: your session ended during the export. Please log in again and retry.",
    );
  }
  const expiresAt = session.expires_at ? session.expires_at * 1000 : null;
  if (expiresAt && expiresAt <= Date.now()) {
    throw new BackupError(
      "Backup failed: your session is not authenticated. Please log in again.",
    );
  }
  return session;
}

async function countRows(table: TableName): Promise<number> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new BackupError(`${table}: ${error.message}`);
  if (count === null || count === undefined) {
    throw new BackupError(`${table}: the database did not return a row count.`);
  }
  return count;
}

/**
 * Fetch every row of a table using keyset pagination on the primary key.
 * Works for both uuid/text and integer keys — PostgREST `gt` compares in the
 * column's own type, and the same ordering is used for the cursor.
 */
async function fetchAll(table: TableName, onPage?: (n: number) => void) {
  const pk = primaryKeyOf(table);
  const rows: Record<string, any>[] = [];
  const seen = new Set<any>();
  let cursor: any = null;

  for (;;) {
    let q = (supabase as any).from(table).select("*").order(pk, { ascending: true }).limit(PAGE);
    if (cursor !== null) q = q.gt(pk, cursor);
    const { data, error } = await q;
    if (error) throw new BackupError(`${table}: ${error.message}`);
    const page = (data ?? []) as Record<string, any>[];

    for (const row of page) {
      const key = row[pk];
      if (key === undefined || key === null) {
        throw new BackupError(`${table}: a row has no ${pk} — cannot page safely.`);
      }
      if (seen.has(key)) continue; // defensive: never duplicate a row
      seen.add(key);
      rows.push(redactRow(table, row));
    }

    onPage?.(rows.length);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1][pk];
  }
  return rows;
}

export async function exportFullBackup(
  onProgress?: (p: ExportProgress) => void,
): Promise<BackupFile> {
  const session = await requireSession("before");

  const tables: BackupTable[] = [];
  const rowCountByTable: Record<string, number> = {};
  const notes: string[] = [];
  const redactedFields: Record<string, string[]> = {};
  let total = 0;

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const table = BACKUP_TABLES[i];
    onProgress?.({ table, index: i, total: BACKUP_TABLES.length, rows: 0 });

    const countBefore = await countRows(table);
    const rows = await fetchAll(table, (n) =>
      onProgress?.({ table, index: i, total: BACKUP_TABLES.length, rows: n }),
    );
    const countAfter = await countRows(table);

    if (countBefore !== rows.length || rows.length !== countAfter) {
      throw new BackupError(
        `Backup failed verification: ${table} changed during export ` +
          `(before: ${countBefore}, exported: ${rows.length}, after: ${countAfter}). ` +
          `Please run the backup again.`,
      );
    }

    if (SENSITIVE_FIELDS[table]?.length) redactedFields[table] = [...SENSITIVE_FIELDS[table]];

    tables.push({
      table,
      primaryKey: primaryKeyOf(table),
      countBefore,
      exportedCount: rows.length,
      countAfter,
      rows,
    });
    rowCountByTable[table] = rows.length;
    total += rows.length;
  }

  // Session must still be valid — an expired session would have produced
  // RLS-filtered (possibly empty) results without any error.
  await requireSession("after");

  if (total === 0) {
    throw new BackupError(
      "Backup failed: every table came back empty. This usually means the session is not authorised. Please log in again and retry.",
    );
  }

  for (const t of RLS_LIMITED_TABLES) {
    notes.push(
      `${t}: row-level security limits this table to rows visible to the authenticated user — this backup is NOT a complete export of ${t}.`,
    );
  }
  if (Object.keys(redactedFields).length) {
    notes.push(
      `Redacted secret fields: ${Object.entries(redactedFields)
        .map(([t, f]) => `${t}.${f.join(", ")}`)
        .join("; ")}.`,
    );
  }

  const payload: BackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: "Khyber Delicious Food POS",
    masterBase: "7 August 4:15 PM — Fixed stock engine & POS Bugs",
    createdAt: new Date().toISOString(),
    source: "cloud",
    complete: true,
    meta: {
      authUserId: session.user.id,
      authEmail: session.user.email ?? null,
      appVersion: (import.meta as any).env?.VITE_APP_VERSION ?? null,
      redactedFields,
      rlsLimitedTables: [...RLS_LIMITED_TABLES],
      notes,
    },
    rowCountByTable,
    tables,
    totals: { tables: tables.length, rows: total },
  };

  const checksum = await computeChecksum(payload);
  return { ...payload, integrity: { algorithm: "SHA-256", checksum } };
}

/** Human-readable per-table verification report. */
export function verificationReport(backup: BackupFile) {
  return backup.tables.map((t) => ({
    table: t.table,
    inDatabase: t.countBefore,
    exported: t.exportedCount,
    after: t.countAfter,
    ok: t.countBefore === t.exportedCount && t.exportedCount === t.countAfter,
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
