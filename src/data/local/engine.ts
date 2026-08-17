/**
 * Local SQLite engine — Phase 2B.
 *
 * This module owns the actual SQLite/WASM connection. It is executed inside
 * the dedicated SQLite Web Worker (`sqlite.worker.ts`) in the browser, and
 * directly inside the Node test runner for unit tests (where no Worker /
 * OPFS exists and the engine honestly reports the memory fallback).
 *
 * React / main-thread code must NEVER import this module. Use `db.ts`, which
 * talks to the worker through the typed RPC protocol.
 *
 * Nothing here reads or writes business data: the app remains cloud-backed.
 */

import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import schemaSql from "./schema.sql?raw";

export type LocalDb = Database;

/** Schema revision applied by schema.sql. Stored in `_meta`. */
export const LOCAL_SCHEMA_VERSION = 2;

/** Persistent database identity — must never change silently. */
export const LOCAL_DB_NAME = "/kdf-pos.sqlite3";
export const LOCAL_DB_POOL = "kdf-pos-pool";

/** Dedicated diagnostic table. Never a production business table. */
export const PROBE_TABLE = "_diagnostic_probe";

export type LocalStorageMode = "opfs" | "memory";

export type EngineFacts = {
  storageMode: LocalStorageMode | null;
  sqliteVersion: string | null;
  initializedAt: string | null;
  opened: boolean;
  vfs: string | null;
  databaseName: string;
  poolName: string;
};

export type EngineStatus = {
  initialized: boolean;
  persistent: boolean;
  storage: LocalStorageMode;
  vfs: string | null;
  databaseName: string;
  poolName: string;
  sqliteVersion: string | null;
  schemaVersion: number;
  expectedSchemaVersion: number;
  deviceId: string;
  tableCount: number;
  totalRows: number;
  lastInitializedAt: string | null;
};

let sqlite3: Sqlite3Static | null = null;
let dbPromise: Promise<LocalDb> | null = null;
let storageMode: LocalStorageMode | null = null;
let sqliteVersion: string | null = null;
let initializedAt: string | null = null;
let vfsName: string | null = null;

/** Read-only facts about the current local database instance. */
export function engineFacts(): EngineFacts {
  return {
    storageMode,
    sqliteVersion,
    initializedAt,
    opened: dbPromise !== null,
    vfs: vfsName,
    databaseName: LOCAL_DB_NAME,
    poolName: LOCAL_DB_POOL,
  };
}

/**
 * Open (or reopen) the local SQLite database. Idempotent — subsequent calls
 * return the same instance.
 *
 * Uses the OPFS SAH Pool VFS (persistent) when the host context supports it
 * — which in practice means a Worker, because `createSyncAccessHandle` is
 * worker-only. Falls back to a transient in-memory database elsewhere and
 * reports `storageMode === "memory"` so callers never mistake it for
 * persistent storage.
 */
export function openEngine(): Promise<LocalDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const mod = await import("@sqlite.org/sqlite-wasm");
    const init = (mod as unknown as { default: (opts?: unknown) => Promise<Sqlite3Static> }).default;
    sqlite3 = await init({
      print: () => {},
      printErr: (msg: string) => console.error("[sqlite]", msg),
    });
    sqliteVersion = (sqlite3 as any)?.version?.libVersion ?? null;

    // Prefer OPFS SAH Pool (persistent, synchronous access handles).
    let pool: any = null;
    if ((sqlite3 as any).installOpfsSAHPoolVfs) {
      try {
        pool = await (sqlite3 as any).installOpfsSAHPoolVfs({ name: LOCAL_DB_POOL });
      } catch (err) {
        console.warn("[sqlite] OPFS SAH Pool could not be installed", err);
        pool = null;
      }
    }

    let db: LocalDb;
    if (pool?.OpfsSAHPoolDb) {
      db = new pool.OpfsSAHPoolDb(LOCAL_DB_NAME);
      storageMode = "opfs";
      vfsName = pool.vfsName ?? LOCAL_DB_POOL;
    } else {
      // Fallback: transient in-memory DB. Data does NOT persist across reloads.
      console.warn("[sqlite] OPFS SAH Pool unavailable — using in-memory DB");
      db = new (sqlite3 as any).oo1.DB(":memory:", "ct");
      storageMode = "memory";
      vfsName = "memory";
    }

    // Apply schema (idempotent — uses IF NOT EXISTS everywhere). Never drops.
    db.exec(schemaSql);
    // Phase 3: the cloud-faithful `cloud_*` mirror tables (also additive).
    const { applyMirrorSchema } = await import("./mirror");
    applyMirrorSchema(db);
    // Foreign keys are per-connection, so re-assert after opening.
    db.exec("PRAGMA foreign_keys = ON");

    ensureDeviceId(db);
    ensureSchemaVersion(db);
    initializedAt = new Date().toISOString();

    return db;
  })().catch((err) => {
    dbPromise = null; // allow retry
    storageMode = null;
    vfsName = null;
    throw err;
  });
  return dbPromise;
}

/**
 * Runs `fn` inside a SQLite transaction. Rolls back on any thrown error so
 * multi-table writes stay ACID.
 */
export function withTransaction<T>(db: LocalDb, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

/** device_id for this browser install; generated once, never rewritten. */
export function getDeviceId(db: LocalDb): string {
  const rows = db.selectValues("SELECT value FROM _meta WHERE key = 'device_id'") as string[];
  return rows[0] ?? "";
}

function ensureDeviceId(db: LocalDb) {
  const existing = db.selectValues("SELECT value FROM _meta WHERE key = 'device_id'") as string[];
  if (existing.length > 0) return;
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : fallbackUuid();
  db.exec({ sql: "INSERT INTO _meta(key, value) VALUES ('device_id', ?)", bind: [id] });
}

/** Records the schema revision once; never rewrites an existing value. */
function ensureSchemaVersion(db: LocalDb) {
  db.exec({
    sql: "INSERT OR IGNORE INTO _meta(key, value) VALUES ('schema_version', ?)",
    bind: [String(LOCAL_SCHEMA_VERSION)],
  });
  db.exec({
    sql: "INSERT OR IGNORE INTO _schema_migrations(version) VALUES (?)",
    bind: [LOCAL_SCHEMA_VERSION],
  });
}

/** Schema version recorded in the local database (0 when unknown). */
export function getSchemaVersion(db: LocalDb): number {
  const rows = db.selectValues("SELECT value FROM _meta WHERE key = 'schema_version'") as string[];
  return rows.length ? Number(rows[0]) : 0;
}

/** Names of every user table in the local database (excludes sqlite internals). */
export function localTableNames(db: LocalDb): string[] {
  return db.selectValues(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ) as string[];
}

function countAllRows(db: LocalDb, tables: string[]): number {
  let total = 0;
  for (const t of tables) {
    if (t.startsWith("_")) continue; // metadata / diagnostic tables are not business rows
    const rows = db.selectValues(`SELECT COUNT(*) FROM "${t}"`) as number[];
    total += Number(rows[0] ?? 0);
  }
  return total;
}

/** Diagnostic snapshot of the open database. */
export function describeEngine(db: LocalDb): EngineStatus {
  const facts = engineFacts();
  const tables = localTableNames(db);
  return {
    initialized: true,
    persistent: facts.storageMode === "opfs",
    storage: facts.storageMode ?? "memory",
    vfs: facts.vfs,
    databaseName: LOCAL_DB_NAME,
    poolName: LOCAL_DB_POOL,
    sqliteVersion: facts.sqliteVersion,
    schemaVersion: getSchemaVersion(db),
    deviceId: getDeviceId(db),
    expectedSchemaVersion: LOCAL_SCHEMA_VERSION,
    tableCount: tables.length,
    totalRows: countAllRows(db, tables),
    lastInitializedAt: facts.initializedAt,
  };
}

function ensureProbeTable(db: LocalDb) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL, written_at TEXT NOT NULL)`,
  );
}

/** Writes an isolated diagnostic probe value (never a business table). */
export function probeWrite(db: LocalDb, key: string, value: string): void {
  ensureProbeTable(db);
  db.exec({
    sql: `INSERT INTO ${PROBE_TABLE}(key, value, written_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, written_at = excluded.written_at`,
    bind: [key, value, new Date().toISOString()],
  });
}

/** Reads a diagnostic probe value, or null when absent. */
export function probeRead(db: LocalDb, key: string): string | null {
  ensureProbeTable(db);
  const rows = db.selectValues(`SELECT value FROM ${PROBE_TABLE} WHERE key = ?`, [key]) as string[];
  return rows.length ? String(rows[0]) : null;
}

/** Deletes a diagnostic probe row. Only ever touches the probe table. */
export function probeClear(db: LocalDb, key: string): void {
  ensureProbeTable(db);
  db.exec({ sql: `DELETE FROM ${PROBE_TABLE} WHERE key = ?`, bind: [key] });
}

/** Closes the connection. Does NOT delete the OPFS database file. */
export async function closeEngine(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  sqlite3 = null;
  storageMode = null;
  initializedAt = null;
  vfsName = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      // ignore close errors
    }
  }
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
