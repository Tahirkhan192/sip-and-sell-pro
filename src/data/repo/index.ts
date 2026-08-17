/**
 * Repository entry point.
 *
 * PHASE 4 selection rules
 *   * `repo()` is unchanged and always returns the cloud repository. Every
 *     mutation in the application keeps going straight to Lovable Cloud.
 *   * `readRepo(table)` is the new *read-only* selector. It returns the local
 *     SQLite repository only when the local mirror passes the full health gate
 *     (flag on, worker running, persistent OPFS, current schema, a verified
 *     Phase 3 seed, not invalidated, and that specific table actually seeded).
 *     In every other case it returns the cloud repository, so an empty or
 *     stale local database can never mask cloud data.
 *   * `writeRepo()` exists so call sites can be explicit: it is always the
 *     cloud repository in this phase.
 */

import { CloudRepository } from "./cloud-repository";
import { LocalRepository } from "./local-repository";
import { canReadLocally } from "./health";
import type { DataRepository, TableName } from "./types";

export * from "./types";
export { CloudRepository } from "./cloud-repository";
export { LocalRepository, REQUIRED_LOCAL_PROCEDURES, READ_ONLY_MESSAGE } from "./local-repository";
export {
  LOCAL_READ_TABLES,
  canReadLocally,
  cachedLocalHealth,
  invalidateLocalReads,
  localReadHealth,
  resetLocalReadHealth,
  type LocalHealth,
} from "./health";

const cloud = new CloudRepository();
let local: LocalRepository | null = null;

function localRepo(): LocalRepository {
  if (!local) local = new LocalRepository();
  return local;
}

let active: DataRepository = cloud;

/** The authoritative repository. Cloud in Phase 4 — all writes go here. */
export function repo(): DataRepository {
  return active;
}

/** Explicit write path. Always the cloud repository in this phase. */
export function writeRepo(): DataRepository {
  return cloud;
}

/**
 * Read path for one table: local when the mirror is proven healthy for that
 * table, cloud otherwise. Never throws on a health problem — it degrades to
 * cloud.
 */
export async function readRepo(table: TableName): Promise<DataRepository> {
  try {
    return (await canReadLocally(table)) ? localRepo() : active;
  } catch {
    return active;
  }
}

/** Swap the backing store. Intended for the manual offline conversion only. */
export function setRepository(next: DataRepository) {
  active = next;
}

/** Test helper: restore the default (cloud) active repository. */
export function resetRepository() {
  active = cloud;
}
