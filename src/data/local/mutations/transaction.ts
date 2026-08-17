/**
 * PHASE 5A — main-thread transaction client.
 *
 * The main thread never opens SQLite and never sends SQL. It sends a list of
 * typed steps to the worker, which runs them inside one BEGIN/COMMIT and rolls
 * everything back on any failure.
 *
 * Before any step is sent, the engine must be:
 *   * flag-enabled (local SQLite AND local writes),
 *   * running in a real worker,
 *   * OPFS-persistent — a memory-fallback database means another tab holds
 *     the SAH pool (or OPFS is unavailable), and writing there would silently
 *     lose data. We fail with a clear code instead of bypassing SQLite.
 */

import { engineStatus, initEngine } from "../db";
import {
  localMutationCounts,
  readLocalMutationEvents,
  readLocalTestRows,
  runLocalMutationTx,
} from "./client";
import {
  LocalMutationError,
  classifyLocalError,
  type LocalMutationErrorCode,
} from "./errors";
import { assertLocalWritesEnabled } from "./flags";
import type { MutationStep, MutationTxOutcome } from "./engine-mutations";

export type { MutationStep, MutationTxOutcome };
export { localMutationCounts, readLocalMutationEvents, readLocalTestRows };

export type WritableEngine = {
  deviceId: string;
  persistent: boolean;
  storage: "opfs" | "memory";
  schemaVersion: number;
};

/**
 * Verifies the local database may be written to, and returns the facts a
 * mutation needs (device id in particular). Throws a `LocalMutationError`
 * with a stable code otherwise — never a raw SQLite error.
 */
export async function requireWritableEngine(): Promise<WritableEngine> {
  assertLocalWritesEnabled();
  let status;
  try {
    status = await initEngine();
  } catch (err) {
    const code = classifyLocalError(err);
    throw new LocalMutationError(
      code === "UNKNOWN" ? "WORKER_UNAVAILABLE" : code,
      `The local database could not be opened: ${(err as any)?.message ?? err}`,
    );
  }
  if (!status.persistent || status.storage !== "opfs") {
    // Most common cause: a second tab already holds the OPFS SAH pool.
    throw new LocalMutationError(
      status.storage === "memory" ? "DATABASE_LOCKED" : "NOT_PERSISTENT",
      "The local database is not persistent on this device (another tab may already have it open), so local writes are refused.",
    );
  }
  return {
    deviceId: status.deviceId,
    persistent: status.persistent,
    storage: status.storage,
    schemaVersion: status.schemaVersion,
  };
}

/** Current engine writability without throwing. */
export async function localWriteReadiness(): Promise<{
  writable: boolean;
  reason: LocalMutationErrorCode | null;
  message: string | null;
  deviceId: string | null;
}> {
  try {
    const e = await requireWritableEngine();
    return { writable: true, reason: null, message: null, deviceId: e.deviceId };
  } catch (err: any) {
    return {
      writable: false,
      reason: classifyLocalError(err),
      message: err?.message ?? String(err),
      deviceId: null,
    };
  }
}

/**
 * Runs `steps` in one local transaction.
 * Resolves with the outcome; a rolled-back transaction is a normal (non-throwing)
 * `{ committed: false, rolledBack: true }` result.
 */
export async function runLocalTransaction(steps: MutationStep[]): Promise<MutationTxOutcome> {
  await requireWritableEngine();
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new LocalMutationError("INVALID_MUTATION", "A local transaction needs at least one step.");
  }
  try {
    return await runLocalMutationTx(steps);
  } catch (err) {
    // Transport/worker level failure — nothing was committed.
    throw new LocalMutationError(
      classifyLocalError(err),
      (err as any)?.message ?? String(err),
    );
  }
}

/** The stable device identity for this browser install (never regenerated). */
export async function getLocalDeviceId(): Promise<string> {
  const status = await engineStatus();
  if (!status.deviceId) {
    throw new LocalMutationError("UNKNOWN", "The local device id is missing.");
  }
  return status.deviceId;
}
