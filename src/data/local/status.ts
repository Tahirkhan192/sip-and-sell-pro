/**
 * Local SQLite activation + diagnostics — Phase 2B.
 *
 * The local database is only ever opened when the build-time feature flag
 * `VITE_ENABLE_LOCAL_SQLITE` is exactly "true", and it is always opened
 * inside the dedicated SQLite worker. It is NEVER the application's data
 * source in this phase: nothing reads business data from it, nothing writes
 * business data to it, and Supabase remains authoritative.
 */

import {
  LOCAL_DB_NAME,
  LOCAL_DB_POOL,
  LOCAL_SCHEMA_VERSION,
  closeLocalDb,
  engineStatus,
  initEngine,
  probePersistence,
  workerStatus,
  type WorkerState,
} from "./db";

export type LocalDbStatus = {
  enabled: boolean;
  initialized: boolean;
  /** true only when the database is OPFS-backed and survives a reload. */
  persistent: boolean;
  storage: "opfs" | "memory" | "none";
  vfs: string | null;
  databaseName: string;
  poolName: string;
  worker: WorkerState;
  workerKind: "worker" | "inline" | null;
  sqliteVersion: string | null;
  schemaVersion: number;
  expectedSchemaVersion: number;
  deviceId: string;
  tableCount: number;
  totalRows: number;
  lastInitializedAt: string | null;
  error: string | null;
};

export { LOCAL_DB_NAME, LOCAL_DB_POOL };

/** Values that switch a Phase 10 production flag back OFF. */
export const FLAG_OFF_VALUES = new Set(["false", "0", "off", "no", "disabled"]);

/**
 * PHASE 10 cutover — the local database is ON by default and only an explicit
 * opt-out ("false"/"0"/"off"/"no"/"disabled") turns it off. Enabling the flag
 * never makes local data authoritative on its own: every read and write still
 * has to pass the health gate in `src/data/repo/health.ts`.
 */
export function isLocalSqliteEnabled(): boolean {
  const fromVite = (import.meta as any).env?.VITE_ENABLE_LOCAL_SQLITE;
  const fromNode =
    typeof process !== "undefined" ? process.env?.VITE_ENABLE_LOCAL_SQLITE : undefined;
  const raw = fromVite ?? fromNode;
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  return !FLAG_OFF_VALUES.has(String(raw).trim().toLowerCase());
}

export function emptyStatus(overrides: Partial<LocalDbStatus> = {}): LocalDbStatus {
  const w = workerStatus();
  return {
    enabled: isLocalSqliteEnabled(),
    initialized: false,
    persistent: false,
    storage: "none",
    vfs: null,
    databaseName: LOCAL_DB_NAME,
    poolName: LOCAL_DB_POOL,
    worker: w.state,
    workerKind: w.kind,
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

/**
 * Initialize the local database (through the worker) when the flag allows it.
 * Idempotent: repeated calls reuse the same worker and connection.
 *
 * Diagnostics only — this never imports cloud data, never modifies any
 * production table, and never switches the application repository.
 */
export async function initLocalDatabase(): Promise<LocalDbStatus> {
  if (!isLocalSqliteEnabled()) {
    return emptyStatus({ error: null });
  }
  try {
    const s = await initEngine();
    const w = workerStatus();
    return emptyStatus({
      initialized: s.initialized,
      persistent: s.persistent,
      storage: s.storage,
      vfs: s.vfs,
      worker: w.state,
      workerKind: w.kind,
      sqliteVersion: s.sqliteVersion,
      schemaVersion: s.schemaVersion,
      deviceId: s.deviceId,
      tableCount: s.tableCount,
      totalRows: s.totalRows,
      lastInitializedAt: s.lastInitializedAt,
    });
  } catch (e: any) {
    return emptyStatus({ error: e?.message ?? String(e) });
  }
}

/** Status without forcing initialization (safe to call any time). */
export async function getLocalDbStatus(): Promise<LocalDbStatus> {
  if (!isLocalSqliteEnabled() || workerStatus().state !== "running") return emptyStatus();
  try {
    await engineStatus();
  } catch {
    return emptyStatus();
  }
  return initLocalDatabase();
}

/**
 * Diagnostic persistence check used by the browser test and the settings
 * card: writes an isolated probe row, closes the worker, restarts it, and
 * reports whether the value survived. Touches only `_diagnostic_probe`.
 */
export async function runPersistenceProbe(key = "phase2b"): Promise<{
  wrote: string;
  read: string | null;
  survived: boolean;
  before: LocalDbStatus;
  after: LocalDbStatus;
}> {
  const value = `probe-${Date.now()}`;
  const before = await initLocalDatabase();
  await probePersistence("write", key, value);
  await closeLocalDb();
  const after = await initLocalDatabase();
  const read = await probePersistence("read", key);
  return { wrote: value, read, survived: read === value, before, after };
}
