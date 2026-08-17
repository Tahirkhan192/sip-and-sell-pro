/**
 * PHASE 5C — master-data write routing.
 *
 * ONE decision, taken per mutation, per entity:
 *
 *   LOCAL MASTER-DATA MODE  → the Phase 5B SQLite procedure (one transaction,
 *                             one audit event, no cloud call at all).
 *   SAFE FALLBACK MODE      → the screen's existing Supabase mutation, byte
 *                             for byte what it did before.
 *
 * Rules that never bend:
 *   * A mutation is never lost. If the local path cannot run — flags off, no
 *     worker, memory fallback, no verified seed, another tab holding OPFS —
 *     the cloud mutation runs instead.
 *   * There is NO dual-write. Exactly one of the two paths executes.
 *   * A local success queues its Phase 5D outbox record (committed in the same
 *     SQLite transaction) and asks the sync engine to upload it. The mutation
 *     itself never waits for the network.
 *   * A real rejection (duplicate name, FK violation, validation) is NOT
 *     retried against the cloud: it is the same rejection the cloud would
 *     give, and re-running it there would only produce a second error.
 */

import { LocalMutationError } from "@/data/local/mutations/errors";
import type { MasterMutationResult } from "@/data/local/mutations/procedures/run";
import { canWriteLocally } from "@/data/repo/health";
import { requestSync } from "@/data/sync/sync-engine";
import { markLocalChange } from "@/data/backup/local-backup";

export type WritePath = "local" | "cloud";

export type WriteOutcome = {
  path: WritePath;
  /** Present only for a local write — the Phase 5B transaction result. */
  local?: MasterMutationResult;
  /** Why the cloud path was chosen, when it was not simply "local disabled". */
  fallbackReason?: string;
};

/**
 * Error codes that mean "the local database was not usable", i.e. nothing was
 * written locally and the cloud must handle this mutation. Everything else is
 * a genuine rejection of the data and must surface to the user.
 */
const ENVIRONMENT_CODES = new Set([
  "LOCAL_WRITES_DISABLED",
  "LOCAL_SQLITE_DISABLED",
  "NOT_PERSISTENT",
  "DATABASE_LOCKED",
  "WORKER_UNAVAILABLE",
]);

export function isEnvironmentFailure(err: unknown): boolean {
  return err instanceof LocalMutationError && ENVIRONMENT_CODES.has(err.code);
}

/**
 * Runs `local` when the gate allows it, `cloud` otherwise.
 *
 * `cloud` must be the mutation the screen already performed, unchanged.
 */
export async function routeMasterWrite(
  table: string,
  local: () => Promise<MasterMutationResult>,
  cloud: () => Promise<void>,
): Promise<WriteOutcome> {
  if (await canWriteLocally(table)) {
    try {
      const result = await local();
      // Fire-and-forget: the write is already durable locally.
      requestSync();
      // Phase 8: only a committed local transaction marks the database as
      // needing a fresh backup, so an idle café never re-uploads the same data.
      void markLocalChange();
      return { path: "local", local: result };
    } catch (err) {
      if (!isEnvironmentFailure(err)) throw err;
      await cloud();
      return { path: "cloud", fallbackReason: (err as LocalMutationError).code };
    }
  }
  await cloud();
  return { path: "cloud" };
}
