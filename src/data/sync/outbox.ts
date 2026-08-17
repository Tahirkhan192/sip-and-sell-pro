/**
 * PHASE 5D — the outbox, seen from the main thread.
 *
 * Two responsibilities, nothing else:
 *   1. build the outbox STEP that a Phase 5C local mutation commits inside its
 *      own SQLite transaction, and
 *   2. read / re-stamp those records for the sync engine and the UI.
 *
 * It never talks to Lovable Cloud (that is `sync-protocol.ts`) and it never
 * decides when to sync (that is `sync-engine.ts`).
 */

import { requestLocalDb } from "@/data/local/db";
import type { MutationStep } from "@/data/local/mutations/engine-mutations";
import { LocalMutationError } from "@/data/local/mutations/errors";
import { newUuid } from "@/data/local/mutations/ids";
import type { MasterTable } from "@/data/local/mutations/master-tables";
import { tableSpec } from "@/data/local/mutations/master-tables";
import {
  emptyCounts,
  MAX_AUTO_ATTEMPTS,
  nextRetryAt,
  OUTBOX_STATUSES,
  type OutboxCounts,
  type OutboxOperation,
  type OutboxRow,
  type OutboxStatus,
} from "@/data/local/mutations/outbox-schema";
import { runLocalTransaction } from "@/data/local/mutations/transaction";
import type { BusinessStamp } from "@/data/local/mutations/timestamps";
import { classifyFailure, encodeError, type FailureKind } from "./failure";

export type { OutboxRow, OutboxStatus, OutboxOperation, OutboxCounts };
export {
  BACKOFF_SECONDS,
  BACKOFF_CAP_SECONDS,
  MAX_AUTO_ATTEMPTS,
  backoffSeconds,
  isDue,
  nextRetryAt,
} from "@/data/local/mutations/outbox-schema";

export type BuildOutboxInput = {
  deviceId: string;
  schemaVersion: number;
  table: MasterTable;
  operation: OutboxOperation;
  /** The REAL entity primary key — generated once, never regenerated. */
  entityId: string;
  /** Exactly what was applied locally (insert row, or update SET values). */
  payload: Record<string, unknown>;
  stamp: BusinessStamp;
};

/**
 * Builds the outbox record plus the transaction step that persists it.
 *
 * The step is placed BEFORE the data step by the caller, so the worker can
 * read the pre-mutation row and store it as `base_snapshot`. That snapshot is
 * the only version information this schema offers, and it is what conflict
 * detection compares the cloud row against.
 */
export function buildOutboxStep(input: BuildOutboxInput): { row: OutboxRow; step: MutationStep } {
  const spec = tableSpec(input.table);
  const row: OutboxRow = {
    id: newUuid(),
    device_id: input.deviceId,
    // Globally unique: a v4 UUID minted once, on this device, for this action.
    operation_id: newUuid(),
    entity: input.table,
    entity_id: input.entityId,
    operation_type: input.operation,
    payload: JSON.stringify(input.payload ?? {}),
    base_snapshot: null,
    created_at: input.stamp.utc,
    updated_at: input.stamp.utc,
    business_date: input.stamp.businessDate,
    status: "pending",
    attempt_count: 0,
    last_error: null,
    next_retry_at: null,
    schema_version: input.schemaVersion,
    synced_at: null,
    conflict_details: null,
  };

  const captureBase =
    input.operation === "insert"
      ? undefined
      : {
          table: input.table,
          columns: Array.from(
            new Set([
              spec.pk,
              ...Object.keys(input.payload ?? {}),
              ...(spec.touchUpdatedAt ? ["updated_at"] : []),
              "deleted_at",
            ]),
          ),
        };

  return { row, step: { kind: "outbox", row, captureBase } };
}

/* ------------------------------------------------------------------ *
 * Reads                                                               *
 * ------------------------------------------------------------------ */

export async function listOutbox(
  filter: { statuses?: OutboxStatus[]; ids?: string[]; limit?: number } = {},
): Promise<OutboxRow[]> {
  const res = await requestLocalDb({ op: "outboxList", ...filter });
  return (res as { records: OutboxRow[] }).records;
}

export async function outboxCounts(): Promise<OutboxCounts> {
  const res = await requestLocalDb({ op: "outboxCounts" });
  const byStatus = (res as { byStatus: Record<string, number> }).byStatus;
  const counts = emptyCounts();
  for (const status of OUTBOX_STATUSES) {
    counts[status] = Number(byStatus[status] ?? 0);
    counts.total += counts[status];
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * State transitions — pending → syncing → synced | failed | conflict  *
 * ------------------------------------------------------------------ */

async function transition(step: MutationStep): Promise<void> {
  const outcome = await runLocalTransaction([step]);
  if (!outcome.committed) {
    throw new LocalMutationError("TRANSACTION_FAILED", outcome.message);
  }
}

export function markSyncing(record: OutboxRow, at = new Date()): Promise<void> {
  return transition({
    kind: "outboxStatus",
    id: record.id,
    status: "syncing",
    updatedAt: at.toISOString(),
  });
}

/** Success: the record is synced, and its previous error is cleared. */
export function markSynced(record: OutboxRow, at = new Date()): Promise<void> {
  return transition({
    kind: "outboxStatus",
    id: record.id,
    status: "synced",
    updatedAt: at.toISOString(),
    lastError: null,
    nextRetryAt: null,
    syncedAt: at.toISOString(),
  });
}

/**
 * Failure: keep the record, count the attempt, schedule the next try.
 *
 * PHASE 9 — the failure CLASS decides the schedule:
 *   * retryable (network / unknown) → bounded exponential backoff,
 *   * non-retryable (auth, validation, permanent) → no automatic retry at all.
 *     The record stays forever, flagged for a human, and cannot busy-loop.
 * The class is encoded into `last_error` so the UI and later runs can read it.
 */
export function markFailed(
  record: OutboxRow,
  error: unknown,
  at = new Date(),
): Promise<{ kind: FailureKind; retryable: boolean }> {
  const failure = classifyFailure(error);
  const attempt = Number(record.attempt_count ?? 0) + 1;
  const exhausted = attempt >= MAX_AUTO_ATTEMPTS;
  const retryAt = failure.retryable && !exhausted ? nextRetryAt(attempt, at) : null;
  return transition({
    kind: "outboxStatus",
    id: record.id,
    status: "failed",
    updatedAt: at.toISOString(),
    // A permanent failure is parked at the attempt ceiling so no automatic
    // pass ever picks it up again — only an explicit "Retry failed changes".
    attemptCount: failure.retryable ? attempt : MAX_AUTO_ATTEMPTS,
    lastError: encodeError(failure.kind, failure.message),
    nextRetryAt: retryAt,
  }).then(() => ({ kind: failure.kind, retryable: failure.retryable && !exhausted }));
}

/**
 * Conflict: BOTH sides are preserved. The local payload stays in `payload`,
 * the cloud row is stored in `conflict_details`, and nothing is uploaded or
 * overwritten. A future resolution UI has everything it needs.
 */
export function markConflict(
  record: OutboxRow,
  details: unknown,
  message: string,
  at = new Date(),
): Promise<void> {
  return transition({
    kind: "outboxStatus",
    id: record.id,
    status: "conflict",
    updatedAt: at.toISOString(),
    attemptCount: Number(record.attempt_count ?? 0) + 1,
    lastError: message.slice(0, 2000),
    nextRetryAt: null,
    conflictDetails: JSON.stringify(details ?? null),
  });
}

/** Manual "Retry Failed": puts failed records back in the queue, due now. */
export async function requeueFailed(at = new Date()): Promise<number> {
  const failed = await listOutbox({ statuses: ["failed"] });
  for (const record of failed) {
    await transition({
      kind: "outboxStatus",
      id: record.id,
      status: "pending",
      updatedAt: at.toISOString(),
      nextRetryAt: null,
    });
  }
  return failed.length;
}

/**
 * Recovers records left in `syncing` by a browser that was closed mid-upload.
 * They go back to `pending` — never to `synced`, and never deleted.
 */
export async function recoverStuckSyncing(at = new Date()): Promise<number> {
  const stuck = await listOutbox({ statuses: ["syncing"] });
  for (const record of stuck) {
    await transition({
      kind: "outboxStatus",
      id: record.id,
      status: "pending",
      updatedAt: at.toISOString(),
    });
  }
  return stuck.length;
}

/* ------------------------------------------------------------------ *
 * PHASE 9 — human conflict resolution                                 *
 * ------------------------------------------------------------------ */

/**
 * "Keep my version": re-baseline the record against the cloud row that was
 * captured with the conflict, then put it back in the queue. The next pass
 * re-applies the local payload on top of the current cloud state — nothing was
 * destroyed, and the decision was explicit.
 */
export async function resolveConflictKeepLocal(
  record: OutboxRow,
  at = new Date(),
): Promise<void> {
  let cloud: unknown = null;
  try {
    const details = record.conflict_details ? JSON.parse(record.conflict_details) : null;
    cloud = details?.cloudRow ?? null;
  } catch {
    cloud = null;
  }
  await transition({
    kind: "outboxStatus",
    id: record.id,
    status: "pending",
    updatedAt: at.toISOString(),
    attemptCount: 0,
    lastError: null,
    nextRetryAt: null,
    baseSnapshot: cloud ? JSON.stringify(cloud) : record.base_snapshot,
  });
}

/**
 * "Keep the cloud version": the local change is withdrawn from the queue. The
 * record is NOT deleted — it keeps both versions and its conflict details as
 * an audit trail of the decision.
 */
export function resolveConflictKeepCloud(record: OutboxRow, at = new Date()): Promise<void> {
  return transition({
    kind: "outboxStatus",
    id: record.id,
    status: "synced",
    updatedAt: at.toISOString(),
    syncedAt: at.toISOString(),
    lastError: encodeError("conflict", "Resolved by keeping the cloud version."),
    nextRetryAt: null,
  });
}

export async function listConflicts(): Promise<OutboxRow[]> {
  return listOutbox({ statuses: ["conflict"] });
}
