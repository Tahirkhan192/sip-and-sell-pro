/**
 * Local SQLite activation + diagnostics — Phase 2.
 *
 * The local database is only ever opened when the build-time feature flag
 * `VITE_ENABLE_LOCAL_SQLITE` is exactly "true". It is NEVER used as the
 * application's data source in this phase: nothing reads business data from
 * it, nothing writes business data to it, and Supabase remains authoritative.
 */

import {
  LOCAL_SCHEMA_VERSION,
  getDeviceId,
  getSchemaVersion,
  localDbFacts,
  openLocalDb,
  type LocalDb,
} from "./db";

export type LocalDbStatus = {
  enabled: boolean;
  initialized: boolean;
  /** true only when the database is OPFS-backed and survives a reload. */
  persistent: boolean;
  storage: "opfs" | "memory" | "none";
  databaseName: string;
  sqliteVersion: string | null;
  schemaVersion: number;
  expectedSchemaVersion: number;
  deviceId: string;
  tableCount: number;
  totalRows: number;
  lastInitializedAt: string | null;
  error: string | null;
};

export const LOCAL_DB_NAME = "/kdf-pos.sqlite3";
export const LOCAL_DB_POOL = "kdf-pos-pool";

/** Build-time flag. Defaults to disabled when unset or not exactly "true". */
export function isLocalSqliteEnabled(): boolean {
  const fromVite = (import.meta as any).env?.VITE_ENABLE_LOCAL_SQLITE;
  const fromNode = typeof process !== "undefined" ? process.env?.VITE_ENABLE_LOCAL_SQLITE : undefined;
  return String(fromVite ?? fromNode) === "true";
}

export function emptyStatus(overrides: Partial<LocalDbStatus> = {}): LocalDbStatus {
  return {
    enabled: isLocalSqliteEnabled(),
    initialized: false,
    persistent: false,
    storage: "none",
    databaseName: LOCAL_DB_NAME,
    sqliteVersion: null,
    schemaVersion: 0,
    expectedSchemaVersion: LOCAL_SCHEMA_VERSION,
    deviceId: "",
    tableCount: 0,
    totalRows: 0,
    lastInitializedAt: null,
    error: null,
    ...overrides,
  };
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
    if (t.startsWith("_")) continue; // metadata tables are not business rows
    const rows = db.selectValues(`SELECT COUNT(*) FROM "${t}"`) as number[];
    total += Number(rows[0] ?? 0);
  }
  return total;
}

/** Diagnostic snapshot of an already-open (or freshly opened) local database. */
export function describeLocalDb(db: LocalDb): LocalDbStatus {
  const facts = localDbFacts();
  const tables = localTableNames(db);
  return emptyStatus({
    initialized: true,
    persistent: facts.storageMode === "opfs",
    storage: facts.storageMode ?? "memory",
    sqliteVersion: facts.sqliteVersion,
    schemaVersion: getSchemaVersion(db),
    deviceId: getDeviceId(db),
    tableCount: tables.length,
    totalRows: countAllRows(db, tables),
    lastInitializedAt: facts.initializedAt,
  });
}

/**
 * Initialize the local database when the flag allows it. Idempotent: repeated
 * calls reuse the same instance (openLocalDb caches the promise).
 *
 * Diagnostics only — this never imports cloud data, never modifies any
 * production table, and never switches the application repository.
 */
export async function initLocalDatabase(): Promise<LocalDbStatus> {
  if (!isLocalSqliteEnabled()) {
    return emptyStatus({ error: null });
  }
  try {
    const db = await openLocalDb();
    return describeLocalDb(db);
  } catch (e: any) {
    return emptyStatus({ error: e?.message ?? String(e) });
  }
}

/** Status without forcing initialization (safe to call any time). */
export async function getLocalDbStatus(): Promise<LocalDbStatus> {
  const facts = localDbFacts();
  if (!isLocalSqliteEnabled() || !facts.opened) return emptyStatus();
  return initLocalDatabase();
}
