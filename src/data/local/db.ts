/**
 * Local SQLite database — Phase 2 (design only).
 *
 * This module is currently NOT imported by any route, component, or hook.
 * It is deliberately inert. Nothing initialises the database, and nothing
 * reads from or writes to it. Runtime behaviour is unchanged.
 *
 * When Phase 3 begins we will:
 *   1. Import `openLocalDb()` from a top-level provider.
 *   2. Seed the database from Lovable Cloud on first login.
 *   3. Introduce the repository layer that wraps this API.
 *
 * The database uses the official `@sqlite.org/sqlite-wasm` build with the
 * OPFS SAH Pool VFS for persistent storage inside the browser origin. If
 * OPFS is not available (older browsers), `openLocalDb()` throws so callers
 * can fall back to cloud-only mode.
 */

import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import schemaSql from "./schema.sql?raw";

export type LocalDb = Database;

/** Schema revision applied by schema.sql. Stored in `_meta`. */
export const LOCAL_SCHEMA_VERSION = 1;

export type LocalStorageMode = "opfs" | "memory";

let sqlite3: Sqlite3Static | null = null;
let dbPromise: Promise<LocalDb> | null = null;
let storageMode: LocalStorageMode | null = null;
let sqliteVersion: string | null = null;
let initializedAt: string | null = null;

/** Read-only facts about the current local database instance. */
export function localDbFacts() {
  return {
    storageMode,
    sqliteVersion,
    initializedAt,
    opened: dbPromise !== null,
  };
}

/**
 * Open (or reopen) the local SQLite database. Idempotent — subsequent calls
 * return the same instance. Safe to call multiple times.
 *
 * Throws if the WASM module fails to load. When OPFS is unavailable the
 * database falls back to a non-persistent in-memory instance, reported via
 * `localDbFacts().storageMode === "memory"`.
 */
export function openLocalDb(): Promise<LocalDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    // Dynamic import so the WASM bundle is only fetched on demand.
    const mod = await import("@sqlite.org/sqlite-wasm");
    const init = (mod as unknown as { default: (opts?: unknown) => Promise<Sqlite3Static> }).default;
    sqlite3 = await init({
      print: () => {},
      printErr: (msg: string) => console.error("[sqlite]", msg),
    });
    sqliteVersion = (sqlite3 as any)?.version?.libVersion ?? null;

    // Prefer OPFS SAH Pool (persistent, fast, WAL-like semantics).
    let OpfsSAHPool: any = null;
    if ((sqlite3 as any).installOpfsSAHPoolVfs) {
      try {
        OpfsSAHPool = await (sqlite3 as any).installOpfsSAHPoolVfs({ name: "kdf-pos-pool" });
      } catch (err) {
        console.warn("[sqlite] OPFS SAH Pool could not be installed", err);
        OpfsSAHPool = null;
      }
    }

    let db: LocalDb;
    if (OpfsSAHPool?.OpfsSAHPoolDb) {
      db = new OpfsSAHPool.OpfsSAHPoolDb("/kdf-pos.sqlite3");
      storageMode = "opfs";
    } else {
      // Fallback: transient in-memory DB. Data does NOT persist across reloads.
      console.warn("[sqlite] OPFS SAH Pool unavailable — using in-memory DB");
      db = new (sqlite3 as any).oo1.DB(":memory:", "ct");
      storageMode = "memory";
    }

    // Apply schema (idempotent — uses IF NOT EXISTS everywhere).
    db.exec(schemaSql);
    // Foreign keys are per-connection, so re-assert after opening.
    db.exec("PRAGMA foreign_keys = ON");

    // Ensure a stable device_id for this browser install.
    ensureDeviceId(db);
    ensureSchemaVersion(db);
    initializedAt = new Date().toISOString();

    return db;
  })().catch((err) => {
    dbPromise = null; // allow retry
    storageMode = null;
    throw err;
  });
  return dbPromise;
}


/**
 * Runs `fn` inside a SQLite transaction. Rolls back on any thrown error so
 * multi-table writes (invoice + stock + money movement) stay ACID.
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

/**
 * Returns the device_id for this browser install, generating one if
 * necessary. Stamped into every locally-written row.
 */
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

function fallbackUuid(): string {
  // RFC 4122 v4-ish fallback for browsers without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Test-only helper: fully close and drop the current instance so the next
 * call to openLocalDb() re-initialises. Not used in production code.
 */
export async function _resetForTests() {
  const pending = dbPromise;
  dbPromise = null;
  sqlite3 = null;
  storageMode = null;
  initializedAt = null;
  if (pending) {
    try {
      (await pending).close();
    } catch {
      // ignore close errors
    }
  }
}
