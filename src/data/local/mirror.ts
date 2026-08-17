/**
 * Cloud mirror tables — Phase 3 (worker side).
 *
 * Owns everything that touches the `cloud_*` mirror tables inside the SQLite
 * worker: schema application, the seed transaction, row insertion, counts,
 * primary-key listing, per-table digests and the seed metadata record.
 *
 * This module NEVER drops a table, never deletes the OPFS database and never
 * touches the Phase-2 `schema.sql` tables or `_diagnostic_probe`.
 */

import mirrorSchemaSql from "./mirror-schema.sql?raw";
import type { LocalDb } from "./engine";
import { canonicalRow, digestRows, type SqliteValue } from "./seed-format";

export const MIRROR_PREFIX = "cloud_";

/** `sales` → `cloud_sales`. */
export function mirrorTable(table: string): string {
  return `${MIRROR_PREFIX}${table}`;
}

/** Applies the mirror schema. Idempotent (`CREATE TABLE IF NOT EXISTS`). */
export function applyMirrorSchema(db: LocalDb): void {
  db.exec(mirrorSchemaSql);
}

/** Mirror tables that actually exist in this database. */
export function mirrorTableNames(db: LocalDb): string[] {
  return db.selectValues(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '${MIRROR_PREFIX}%' ORDER BY name`,
  ) as string[];
}

export type MirrorColumn = { name: string; declType: string; notNull: boolean; pk: boolean };

export function mirrorColumns(db: LocalDb, table: string): MirrorColumn[] {
  const rows = db.selectObjects(`PRAGMA table_info("${mirrorTable(table)}")`) as any[];
  return rows.map((r) => ({
    name: String(r.name),
    declType: String(r.type ?? "").toUpperCase(),
    notNull: Number(r.notnull) === 1,
    pk: Number(r.pk) > 0,
  }));
}

export function mirrorCount(db: LocalDb, table: string): number {
  const v = db.selectValues(`SELECT COUNT(*) FROM "${mirrorTable(table)}"`) as number[];
  return Number(v[0] ?? 0);
}

/** Row counts for every mirror table present (keyed by cloud table name). */
export function mirrorCounts(db: LocalDb): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of mirrorTableNames(db)) {
    const v = db.selectValues(`SELECT COUNT(*) FROM "${name}"`) as number[];
    out[name.slice(MIRROR_PREFIX.length)] = Number(v[0] ?? 0);
  }
  return out;
}

/** Total operational rows currently held by the mirror. */
export function mirrorTotalRows(db: LocalDb): number {
  return Object.values(mirrorCounts(db)).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ *
 * Seed transaction                                                    *
 * ------------------------------------------------------------------ */

let seedOpen = false;

export function seedTxOpen(): boolean {
  return seedOpen;
}

export function seedBegin(db: LocalDb): void {
  if (seedOpen) throw new Error("A seed transaction is already open.");
  applyMirrorSchema(db);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  seedOpen = true;
}

export function seedCommit(db: LocalDb): void {
  if (!seedOpen) throw new Error("No seed transaction is open.");
  // Surfaces any deferred FK problem before the data becomes visible.
  const violations = db.selectObjects("PRAGMA foreign_key_check") as any[];
  if (violations.length > 0) {
    const first = violations[0];
    seedRollback(db);
    throw new Error(
      `Foreign key violation in ${first?.table ?? "unknown table"} (parent: ${first?.parent ?? "?"}) — seed rolled back.`,
    );
  }
  db.exec("COMMIT");
  seedOpen = false;
}

export function seedRollback(db: LocalDb): void {
  if (!seedOpen) return;
  try {
    db.exec("ROLLBACK");
  } finally {
    seedOpen = false;
  }
}

/**
 * Inserts a batch of already-coerced rows into one mirror table. Plain
 * INSERT: a duplicate primary key or a broken relationship raises and the
 * caller rolls the whole seed back.
 */
export function seedInsert(
  db: LocalDb,
  table: string,
  columns: string[],
  rows: SqliteValue[][],
): number {
  if (!seedOpen) throw new Error("Refusing to write outside a seed transaction.");
  if (rows.length === 0) return 0;
  const sql =
    `INSERT INTO "${mirrorTable(table)}" (${columns.map((c) => `"${c}"`).join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")})`;
  const stmt = (db as any).prepare(sql);
  try {
    for (const row of rows) {
      stmt.bind(row as any[]);
      stmt.stepReset();
    }
  } finally {
    stmt.finalize();
  }
  return rows.length;
}

/* ------------------------------------------------------------------ *
 * Verification                                                        *
 * ------------------------------------------------------------------ */

/** Every primary key currently stored locally, ordered. */
export function mirrorPrimaryKeys(db: LocalDb, table: string, pk: string): SqliteValue[] {
  return db.selectValues(
    `SELECT "${pk}" FROM "${mirrorTable(table)}" ORDER BY "${pk}"`,
  ) as SqliteValue[];
}

/**
 * Deterministic digest of the whole local table: canonical row content in
 * primary-key order, hashed with SHA-256. Compared against the digest the
 * seed computed from the cloud rows it sent.
 */
export async function mirrorDigest(
  db: LocalDb,
  table: string,
  pk: string,
): Promise<{ digest: string; rows: number }> {
  const columns = mirrorColumns(db, table).map((c) => c.name);
  const rows = db.selectObjects(
    `SELECT * FROM "${mirrorTable(table)}" ORDER BY "${pk}"`,
  ) as Record<string, unknown>[];
  const lines = rows.map((r) => `${String(r[pk])}\t${canonicalRow(columns, r)}`);
  return { digest: await digestRows(lines), rows: rows.length };
}

/* ------------------------------------------------------------------ *
 * Seed metadata                                                       *
 * ------------------------------------------------------------------ */

export const SEED_META_KEY = "cloud_seed";

export type SeedMetaRecord = {
  status: "verified" | "failed";
  seededAt: string;
  authUserId: string;
  source: "supabase";
  tables: number;
  rows: number;
  schemaVersion: number;
  verification: "passed" | "failed";
  overallDigest: string;
  rlsLimitedTables: string[];
};

/** Writes the seed record. Never stores tokens, keys or credentials. */
export function writeSeedMeta(db: LocalDb, meta: SeedMetaRecord): void {
  db.exec({
    sql: `INSERT INTO _meta(key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: [SEED_META_KEY, JSON.stringify(meta)],
  });
}

export function readSeedMeta(db: LocalDb): SeedMetaRecord | null {
  const rows = db.selectValues("SELECT value FROM _meta WHERE key = ?", [
    SEED_META_KEY,
  ]) as string[];
  if (!rows.length) return null;
  try {
    return JSON.parse(String(rows[0])) as SeedMetaRecord;
  } catch {
    return null;
  }
}
