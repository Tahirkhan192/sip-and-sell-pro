/**
 * PHASE 4 — local read health gate.
 *
 * The single invariant of this phase:
 *
 *   LOCAL READS MUST NEVER MAKE THE APPLICATION LOOK HEALTHY WHEN THE LOCAL
 *   DATA IS EMPTY, PARTIAL, STALE OR INVALID.
 *
 * Every condition below must hold before a single read is served from SQLite.
 * If any one of them fails — for any reason at all, including an unexpected
 * exception — the caller gets the CloudRepository instead. An unseeded or
 * empty local database can therefore never mask cloud data.
 */

import { LOCAL_SCHEMA_VERSION, engineStatus, mirrorStatus, workerStatus } from "@/data/local/db";
import { isLocalSqliteEnabled } from "@/data/local/status";
import { isLocalWritesEnabled } from "@/data/local/mutations/flags";
import { isMasterTable } from "@/data/local/mutations/master-tables";
import { LOCAL_READ_TABLE_SET, LOCAL_WRITE_TABLE_SET } from "./entity-classification";
import type { TableName } from "./types";

/**
 * Tables whose READ path may be served locally. PHASE 6: derived from the
 * single classification registry so the gate can never drift from the audit.
 */
export const LOCAL_READ_TABLES: TableName[] = LOCAL_READ_TABLE_SET;

export type LocalHealth = {
  usable: boolean;
  reason: string | null;
  checks: {
    flagEnabled: boolean;
    workerRunning: boolean;
    persistent: boolean;
    schemaCurrent: boolean;
    seedPresent: boolean;
    seedVerified: boolean;
    notInvalidated: boolean;
  };
  seededTables: Record<string, number>;
  seededAt: string | null;
  checkedAt: number;
};

const FAILED = (reason: string, checks: Partial<LocalHealth["checks"]> = {}): LocalHealth => ({
  usable: false,
  reason,
  checks: {
    flagEnabled: false,
    workerRunning: false,
    persistent: false,
    schemaCurrent: false,
    seedPresent: false,
    seedVerified: false,
    notInvalidated: !invalidated,
    ...checks,
  },
  seededTables: {},
  seededAt: null,
  checkedAt: Date.now(),
});

/** Manual kill switch. Set when anything makes the local copy untrustworthy. */
let invalidated = false;
let cached: LocalHealth | null = null;
let inflight: Promise<LocalHealth> | null = null;

/** Marks the local mirror unusable for reads until it is re-seeded/re-checked. */
export function invalidateLocalReads(reason = "invalidated"): void {
  invalidated = true;
  cached = FAILED(reason);
}

/** Clears the kill switch and forces the next call to re-evaluate. */
export function resetLocalReadHealth(): void {
  invalidated = false;
  cached = null;
  inflight = null;
}

/** Cached health snapshot, if one has already been computed. */
export function cachedLocalHealth(): LocalHealth | null {
  return cached;
}

async function evaluate(): Promise<LocalHealth> {
  if (invalidated) return FAILED("Local database was invalidated.");
  if (!isLocalSqliteEnabled()) return FAILED("VITE_ENABLE_LOCAL_SQLITE is not enabled.");

  try {
    const status = await engineStatus();
    const worker = workerStatus().state === "running";
    const checks = {
      flagEnabled: true,
      workerRunning: worker,
      persistent: status.persistent && status.storage === "opfs",
      schemaCurrent: status.schemaVersion === LOCAL_SCHEMA_VERSION,
      seedPresent: false,
      seedVerified: false,
      notInvalidated: true,
    };
    if (!checks.workerRunning) return FAILED("SQLite worker is not running.", checks);
    if (!checks.persistent) return FAILED("Local SQLite storage is not persistent OPFS.", checks);
    if (!checks.schemaCurrent) {
      return FAILED(
        `Local schema version ${status.schemaVersion} != expected ${LOCAL_SCHEMA_VERSION}.`,
        checks,
      );
    }

    const mirror = await mirrorStatus();
    checks.seedPresent = Boolean(mirror.seedMeta) && mirror.totalRows > 0;
    if (!checks.seedPresent) return FAILED("No Phase 3 seed exists in the local database.", checks);

    const meta = mirror.seedMeta!;
    checks.seedVerified =
      meta.status === "verified" &&
      meta.verification === "passed" &&
      meta.schemaVersion === LOCAL_SCHEMA_VERSION;
    if (!checks.seedVerified) {
      return FAILED("The local seed did not complete verification.", checks);
    }

    return {
      usable: true,
      reason: null,
      checks,
      seededTables: mirror.counts,
      seededAt: meta.seededAt,
      checkedAt: Date.now(),
    };
  } catch (e: any) {
    return FAILED(e?.message ?? String(e));
  }
}

/**
 * Health of the local mirror. Cached after the first successful evaluation;
 * failures are cached too, but `resetLocalReadHealth()` (called after a fresh
 * seed) forces a re-check.
 */
export async function localReadHealth(force = false): Promise<LocalHealth> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = evaluate().then((h) => {
    cached = h;
    inflight = null;
    return h;
  });
  return inflight;
}

/**
 * Can THIS table be read locally right now? A table the seed left empty falls
 * back to the cloud rather than reporting "no rows".
 */
export async function canReadLocally(table: TableName): Promise<boolean> {
  if (!LOCAL_READ_TABLES.includes(table)) return false;
  const health = await localReadHealth();
  if (!health.usable) return false;
  return (health.seededTables[table] ?? 0) > 0;
}

/* ------------------------------------------------------------------ *
 * PHASE 5C — master-data WRITE gate.
 *
 * A local master-data write needs everything a local read needs (flags,
 * running worker, persistent OPFS, current schema, a verified seed, not
 * invalidated) PLUS the local-writes flag and a table that the Phase 5B
 * procedure layer actually supports. Anything else → the cloud path.
 * ------------------------------------------------------------------ */

/**
 * Tables whose WRITE path may be served locally. PHASE 6: derived from the
 * classification registry (see `entity-classification.ts` for each blocker).
 */
export const LOCAL_WRITE_TABLES: TableName[] = LOCAL_WRITE_TABLE_SET;

/**
 * May this master-data table be written locally right now? Never throws:
 * any doubt at all resolves to `false`, and the caller keeps its existing
 * Supabase mutation. A table the seed left empty is still writable —
 * unlike a read, an empty table cannot mislead a write.
 */
export async function canWriteLocally(table: string): Promise<boolean> {
  try {
    if (!isMasterTable(table)) return false;
    if (!LOCAL_WRITE_TABLES.includes(table as TableName)) return false;
    if (!isLocalWritesEnabled()) return false;
    const health = await localReadHealth();
    return health.usable;
  } catch {
    return false;
  }
}
