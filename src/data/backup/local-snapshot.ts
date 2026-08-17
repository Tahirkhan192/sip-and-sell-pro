/**
 * PHASE 8 — consistent local snapshot + transactional restore (worker side).
 *
 * Runs INSIDE the SQLite worker (and directly in Node tests). Two operations,
 * both all-or-nothing:
 *
 *   snapshotLocal(db)   BEGIN → read every table → COMMIT
 *                       One transaction, so the backup is a single consistent
 *                       database state and never a mix of "before" and "after"
 *                       a concurrent business mutation.
 *
 *   restoreLocal(db, …) BEGIN → replace every table → verify → COMMIT/ROLLBACK
 *                       Verification (row counts, primary-key uniqueness,
 *                       foreign keys) happens INSIDE the transaction, so a bad
 *                       backup leaves the healthy database exactly as it was.
 *
 * The operational store is the `cloud_*` mirror set — the same tables the local
 * repository reads and the local mutation engine writes. Internal tables
 * (`_meta`, `_local_*`, `_diagnostic_probe`) are deliberately NOT part of a
 * backup: they hold device identity, the outbox and the offline auth material,
 * none of which may travel to another device.
 */

import { BACKUP_TABLES, primaryKeyOf, redactRow, SENSITIVE_FIELDS } from "./format";
import type { BackupTable } from "./format";
import { getDeviceId, getSchemaVersion, type LocalDb } from "../local/engine";
import { mirrorColumns, mirrorTable } from "../local/mirror";
import type { SqliteValue } from "../local/seed-format";

export class LocalSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalSnapshotError";
  }
}

export type LocalSnapshot = {
  tables: BackupTable[];
  rowCountByTable: Record<string, number>;
  totalRows: number;
  deviceId: string;
  schemaVersion: number;
  takenAt: string;
  redactedFields: Record<string, string[]>;
};

function countOf(db: LocalDb, table: string): number {
  const v = db.selectValues(`SELECT COUNT(*) FROM "${table}"`) as number[];
  return Number(v[0] ?? 0);
}

/**
 * Reads every backup table inside ONE transaction. SQLite gives a read
 * transaction a stable view of the database, so all tables are as of the same
 * instant even if the UI keeps working while the snapshot runs.
 */
export function snapshotLocal(db: LocalDb, at = new Date()): LocalSnapshot {
  db.exec("BEGIN");
  try {
    const tables: BackupTable[] = [];
    const rowCountByTable: Record<string, number> = {};
    const redactedFields: Record<string, string[]> = {};
    let totalRows = 0;

    for (const table of BACKUP_TABLES) {
      const physical = mirrorTable(table);
      const pk = primaryKeyOf(table);
      const countBefore = countOf(db, physical);
      const raw = db.selectObjects(
        `SELECT * FROM "${physical}" ORDER BY "${pk}"`,
      ) as Record<string, any>[];
      const rows = raw.map((r) => redactRow(table, r));
      const countAfter = countOf(db, physical);

      if (countBefore !== rows.length || rows.length !== countAfter) {
        throw new LocalSnapshotError(
          `${table} changed during the snapshot (before: ${countBefore}, read: ${rows.length}, after: ${countAfter}).`,
        );
      }
      if (SENSITIVE_FIELDS[table]?.length) redactedFields[table] = [...SENSITIVE_FIELDS[table]];

      tables.push({
        table,
        primaryKey: pk,
        countBefore,
        exportedCount: rows.length,
        countAfter,
        rows,
      });
      rowCountByTable[table] = rows.length;
      totalRows += rows.length;
    }

    const snapshot: LocalSnapshot = {
      tables,
      rowCountByTable,
      totalRows,
      deviceId: getDeviceId(db),
      schemaVersion: getSchemaVersion(db),
      takenAt: at.toISOString(),
      redactedFields,
    };
    db.exec("COMMIT");
    return snapshot;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* the read transaction may already be closed */
    }
    throw err;
  }
}

export type RestoreOutcome = {
  restored: true;
  tables: number;
  rows: number;
  /** Row counts read back from SQLite AFTER the insert, before COMMIT. */
  verifiedCounts: Record<string, number>;
};

function insertRows(db: LocalDb, table: string, rows: Record<string, any>[]): void {
  if (rows.length === 0) return;
  const columns = mirrorColumns(db, table).map((c) => c.name);
  if (columns.length === 0) {
    throw new LocalSnapshotError(`${table}: this build has no local table to restore into.`);
  }
  const known = new Set(columns);
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        throw new LocalSnapshotError(
          `${table}.${key}: the backup has a column this build does not know — refusing to restore.`,
        );
      }
    }
  }
  const sql =
    `INSERT INTO "${mirrorTable(table)}" (${columns.map((c) => `"${c}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;
  const stmt = (db as any).prepare(sql);
  try {
    for (const row of rows) {
      const bind: SqliteValue[] = columns.map((c) => {
        const v = row[c];
        if (v === undefined || v === null) return null;
        if (typeof v === "boolean") return v ? 1 : 0;
        if (typeof v === "number" || typeof v === "string") return v;
        return JSON.stringify(v);
      });
      stmt.bind(bind as any[]);
      stmt.stepReset();
    }
  } finally {
    stmt.finalize();
  }
}

/**
 * Replaces the operational tables with the backup's rows, atomically.
 *
 * The whole thing is one transaction: the existing rows are only removed
 * inside it, so a failure at ANY point (bad row, duplicate primary key, broken
 * relationship, count mismatch) rolls back to the healthy database. That is the
 * "restore into a temporary state and swap" guarantee, expressed with SQLite's
 * own transaction semantics instead of a second database file.
 */
export function restoreLocal(db: LocalDb, tables: BackupTable[]): RestoreOutcome {
  const byName = new Map(tables.map((t) => [t.table, t]));
  for (const table of BACKUP_TABLES) {
    if (!byName.has(table)) {
      throw new LocalSnapshotError(`${table}: required table missing from the backup.`);
    }
  }

  db.exec("BEGIN");
  try {
    // Children first, so the deletes never trip a foreign key on their own.
    for (const table of [...BACKUP_TABLES].reverse()) {
      db.exec(`DELETE FROM "${mirrorTable(table)}"`);
    }
    for (const table of BACKUP_TABLES) {
      insertRows(db, table, byName.get(table)!.rows ?? []);
    }

    // ---- verification, still inside the transaction ---------------------
    const verifiedCounts: Record<string, number> = {};
    let rows = 0;
    for (const table of BACKUP_TABLES) {
      const expected = byName.get(table)!.rows?.length ?? 0;
      const actual = countOf(db, mirrorTable(table));
      verifiedCounts[table] = actual;
      rows += actual;
      if (actual !== expected) {
        throw new LocalSnapshotError(
          `${table}: restored ${actual} rows but the backup holds ${expected}.`,
        );
      }
      const pk = primaryKeyOf(table);
      const distinct = db.selectValues(
        `SELECT COUNT(DISTINCT "${pk}") FROM "${mirrorTable(table)}"`,
      ) as number[];
      if (Number(distinct[0] ?? 0) !== actual) {
        throw new LocalSnapshotError(`${table}: duplicate ${pk} values after restore.`);
      }
    }

    const violations = db.selectObjects("PRAGMA foreign_key_check") as any[];
    if (violations.length > 0) {
      const first = violations[0];
      throw new LocalSnapshotError(
        `Foreign key violation in ${first?.table ?? "unknown table"} (parent: ${first?.parent ?? "?"}) — restore rolled back.`,
      );
    }

    db.exec("COMMIT");
    return { restored: true, tables: BACKUP_TABLES.length, rows, verifiedCounts };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Post-restore read-back: counts straight from SQLite, outside any transaction. */
export function localTableCounts(db: LocalDb): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of BACKUP_TABLES) out[table] = countOf(db, mirrorTable(table));
  return out;
}

/* ------------------------------------------------------------------ *
 * Backup bookkeeping (local only — never uploaded, never in a backup) *
 * ------------------------------------------------------------------ */

export const BACKUP_META_KEY = "backup_state";

export type LocalBackupState = {
  lastBackupAt: string | null;
  lastChecksum: string | null;
  lastRows: number | null;
  lastRemoteId: string | null;
  lastError: string | null;
  lastRestoreAt: string | null;
  /** Set by the mutation pipeline; a backup only runs when something changed. */
  dirtySince: string | null;
};

export const EMPTY_BACKUP_STATE: LocalBackupState = {
  lastBackupAt: null,
  lastChecksum: null,
  lastRows: null,
  lastRemoteId: null,
  lastError: null,
  lastRestoreAt: null,
  dirtySince: null,
};

export function readBackupState(db: LocalDb): LocalBackupState {
  const rows = db.selectValues("SELECT value FROM _meta WHERE key = ?", [
    BACKUP_META_KEY,
  ]) as string[];
  if (!rows.length) return { ...EMPTY_BACKUP_STATE };
  try {
    return { ...EMPTY_BACKUP_STATE, ...(JSON.parse(String(rows[0])) as LocalBackupState) };
  } catch {
    return { ...EMPTY_BACKUP_STATE };
  }
}

/** Stores backup bookkeeping. Never stores a Google token or any credential. */
export function writeBackupState(db: LocalDb, patch: Partial<LocalBackupState>): LocalBackupState {
  const next = { ...readBackupState(db), ...patch };
  db.exec({
    sql: `INSERT INTO _meta(key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: [BACKUP_META_KEY, JSON.stringify(next)],
  });
  return next;
}
