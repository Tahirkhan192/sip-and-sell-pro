/**
 * PHASE 5D — the master-data synchronization engine.
 *
 * Guarantees, in plain terms:
 *   * ONE sync runs at a time. A second trigger while a run is in flight is
 *     coalesced, never run in parallel — so a record can never be uploaded twice.
 *   * Records are processed OLDEST FIRST, and strictly in order per entity, so
 *     "create then rename then delete" reaches the cloud in that order.
 *   * A failed record blocks only its own entity. Other entities keep syncing.
 *   * Nothing is ever deleted from the outbox. Success marks `synced`,
 *     failure keeps the record with its error and a backoff schedule, and a
 *     conflict keeps BOTH the local payload and the cloud row.
 *   * Sync is triggered on: app start, coming back online, a successful local
 *     master-data write, and a manual "Sync Now".
 */

import {
  listOutbox,
  markConflict,
  markFailed,
  markSynced,
  markSyncing,
  recoverStuckSyncing,
  requeueFailed,
  outboxCounts,
  isDue,
  MAX_AUTO_ATTEMPTS,
  type OutboxCounts,
  type OutboxRow,
} from "./outbox";
import { applyOutboxRecord, supabaseGateway, type CloudGateway } from "./sync-protocol";
import { decodeError, type FailureKind } from "./failure";

export type SyncPhase = "idle" | "syncing" | "offline" | "disabled";

export type SyncState = {
  phase: SyncPhase;
  online: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  counts: OutboxCounts;
};

export type SyncRunSummary = {
  attempted: number;
  synced: number;
  failed: number;
  conflicts: number;
  skipped: number;
  /** Records that will not be retried automatically until a human acts. */
  needsAttention: number;
  failureKinds: Partial<Record<FailureKind, number>>;
  error?: string;
};

function emptySummary(): SyncRunSummary {
  return {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicts: 0,
    skipped: 0,
    needsAttention: 0,
    failureKinds: {},
  };
}

const EMPTY_COUNTS: OutboxCounts = {
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
  total: 0,
};

let state: SyncState = {
  phase: "idle",
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  counts: EMPTY_COUNTS,
};

const listeners = new Set<(s: SyncState) => void>();
let inFlight: Promise<SyncRunSummary> | null = null;
let rerunRequested = false;
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

function publish(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(listener: (s: SyncState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function refreshSyncCounts(): Promise<OutboxCounts> {
  try {
    const counts = await outboxCounts();
    publish({ counts });
    return counts;
  } catch {
    return state.counts;
  }
}

/**
 * Oldest first; ties broken by SQLite `rowid` — real insertion order — so
 * "create → rename → delete" can never be reordered, even when two mutations
 * share a millisecond.
 */
function orderRecords(records: OutboxRow[]): OutboxRow[] {
  return [...records].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    const sa = Number(a.seq ?? Number.MAX_SAFE_INTEGER);
    const sb = Number(b.seq ?? Number.MAX_SAFE_INTEGER);
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : 1;
  });
}

function entityKey(record: OutboxRow): string {
  return `${record.entity}:${record.entity_id}`;
}

async function runOnce(gateway: CloudGateway, at: Date): Promise<SyncRunSummary> {
  const summary = emptySummary();

  // A run that died mid-upload (tab closed, crash) leaves records in
  // `syncing`. They go back to `pending`, never to `synced`.
  await recoverStuckSyncing(at);

  const queue = orderRecords(await listOutbox({ statuses: ["pending", "failed"] }));
  // Once an entity fails or conflicts, later changes to that SAME entity must
  // wait — applying them out of order would corrupt it.
  const blocked = new Set<string>();

  for (const record of queue) {
    const key = entityKey(record);
    if (blocked.has(key)) {
      summary.skipped += 1;
      continue;
    }
    if (record.status === "failed") {
      const previous = decodeError(record.last_error).kind;
      const permanent = previous === "auth" || previous === "validation" || previous === "permanent";
      if (permanent || record.attempt_count >= MAX_AUTO_ATTEMPTS || !isDue(record, at)) {
        // Permanent failures are never retried automatically: they wait for a
        // human. Not retrying is what keeps this loop bounded.
        summary.skipped += 1;
        if (permanent) summary.needsAttention += 1;
        blocked.add(key);
        continue;
      }
    }

    summary.attempted += 1;
    try {
      await markSyncing(record, at);
      const result = await applyOutboxRecord(record, gateway, at);
      if (result.outcome === "synced") {
        await markSynced(record, new Date());
        summary.synced += 1;
      } else {
        await markConflict(record, result.details, result.reason, new Date());
        summary.conflicts += 1;
        blocked.add(key);
      }
    } catch (error) {
      const outcome = await markFailed(record, error, new Date());
      summary.failed += 1;
      summary.failureKinds[outcome.kind] = (summary.failureKinds[outcome.kind] ?? 0) + 1;
      if (!outcome.retryable) summary.needsAttention += 1;
      blocked.add(key);
      // A sign-in problem will fail identically for every remaining record —
      // stop the pass instead of burning the whole queue's retry budget.
      if (outcome.kind === "auth") {
        summary.error = "Sign-in required before changes can be uploaded.";
        break;
      }
    }
  }

  return summary;
}

/**
 * Runs a sync pass. Concurrent callers share the in-flight run; if a trigger
 * arrives while one is running, exactly one extra pass follows it.
 */
export async function syncNow(options: { gateway?: CloudGateway } = {}): Promise<SyncRunSummary> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    publish({ phase: "offline", online: false });
    await refreshSyncCounts();
    return emptySummary();
  }

  const run = (async (): Promise<SyncRunSummary> => {
    publish({ phase: "syncing", online: true, lastRunAt: new Date().toISOString() });
    try {
      const gateway = options.gateway ?? (await supabaseGateway());
      const summary = await runOnce(gateway, new Date());
      publish({
        phase: "idle",
        lastError: summary.failed > 0 ? "Some changes could not be uploaded yet." : null,
        lastSuccessAt: summary.failed === 0 ? new Date().toISOString() : state.lastSuccessAt,
      });
      await refreshSyncCounts();
      return summary;
    } catch (error) {
      // The local database may simply not be seeded/healthy on this device —
      // that is not an app error, sync just has nothing to do.
      const message = error instanceof Error ? error.message : String(error);
      publish({ phase: "idle", lastError: message });
      return { ...emptySummary(), error: message };
    } finally {
      inFlight = null;
    }
  })();

  inFlight = run;
  const summary = await run;
  if (rerunRequested) {
    rerunRequested = false;
    return syncNow(options);
  }
  return summary;
}

/** Manual recovery: put failed records back in the queue and sync. */
export async function retryFailedNow(): Promise<SyncRunSummary> {
  await requeueFailed();
  return syncNow();
}

/** Called after every successful local master-data write. */
export function requestSync(): void {
  void syncNow().catch(() => undefined);
}

/** Wires app start, online/offline, and a slow safety-net interval. Idempotent. */
export function startSyncEngine(): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;

  const goOnline = () => {
    publish({ online: true, phase: "idle" });
    void syncNow().catch(() => undefined);
  };
  const goOffline = () => publish({ online: false, phase: "offline" });

  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);
  timer = setInterval(() => void syncNow().catch(() => undefined), 60_000);

  void syncNow().catch(() => undefined);

  return () => {
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
    if (timer) clearInterval(timer);
    timer = null;
    started = false;
  };
}

/** Test-only reset of the module singleton. */
export function __resetSyncEngineForTests(): void {
  inFlight = null;
  rerunRequested = false;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  state = { ...state, phase: "idle", lastError: null, counts: EMPTY_COUNTS };
}
