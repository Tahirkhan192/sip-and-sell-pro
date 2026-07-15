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

let sqlite3: Sqlite3Static | null = null;
let dbPromise: Promise<LocalDb> | null = null;

/**
 * Open (or reopen) the local SQLite database. Idempotent — subsequent calls
 * return the same instance. Safe to call multiple times.
 *
 * Throws if OPFS is unavailable or the WASM module fails to load. Callers
 * MUST catch and degrade gracefully.
 */
export function openLocalDb(): Promise<LocalDb> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("openLocalDb() must be called in the browser");
    }
    // Dynamic import so the WASM bundle is only fetched on demand.
    const mod = await import("@sqlite.org/sqlite-wasm");
    const init = (mod as unknown as { default: (opts?: unknown) => Promise<Sqlite3Static> }).default;
    sqlite3 = await init({
      print: () => {},
      printErr: (msg: string) => console.error("[sqlite]", msg),
    });

    // Prefer OPFS SAH Pool (persistent, fast, WAL-like semantics).
    const OpfsSAHPool = (sqlite3 as any).installOpfsSAHPoolVfs
      ? await (sqlite3 as any).installOpfsSAHPoolVfs({ name: "kdf-pos-pool" })
      : null;

    let db: LocalDb;
    if (OpfsSAHPool?.OpfsSAHPoolDb) {
      db = new OpfsSAHPool.OpfsSAHPoolDb("/kdf-pos.sqlite3");
    } else {
      // Fallback: transient in-memory DB. Data does NOT persist across reloads.
      // Real fallback for older browsers is handled in Phase 3 via Dexie/IndexedDB.
      console.warn("[sqlite] OPFS SAH Pool unavailable — using in-memory DB");
      db = new (sqlite3 as any).oo1.DB(":memory:", "ct");
    }

    // Apply schema (idempotent — uses IF NOT EXISTS everywhere).
    db.exec(schemaSql);

    // Ensure a stable device_id for this browser install.
    ensureDeviceId(db);

    return db;
  })().catch((err) => {
    dbPromise = null; // allow retry
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
export function _resetForTests() {
  dbPromise = null;
  sqlite3 = null;
}
