/**
 * PHASE 5D — the local master-data outbox (schema + pure rules).
 *
 * `_local_outbox` is a LOCAL-ONLY internal table, like the Phase 5A event log:
 * never seeded from the cloud, never part of the operational row count, and
 * never read by a business screen. It holds exactly one record per local
 * master-data mutation that still has to reach Lovable Cloud.
 *
 * This module is imported by BOTH the main thread and the SQLite worker, so it
 * must stay free of React, Supabase and browser-only APIs.
 *
 * Invariants encoded here:
 *   * `operation_id` is globally unique (UNIQUE index) — a retry can never
 *     produce a second cloud row.
 *   * `entity_id` is the REAL entity UUID, generated once locally and never
 *     regenerated during synchronization.
 *   * `payload` is the exact row/values that were applied locally.
 *   * `base_snapshot` is what the cloud row looked like (as far as this device
 *     knew) when the mutation was based on it — the raw material for conflict
 *     detection.
 *   * failed/conflict records are terminal-but-recoverable: nothing in the
 *     engine ever deletes them.
 */

export const OUTBOX_TABLE = "_local_outbox";

export const OUTBOX_STATUSES = ["pending", "syncing", "synced", "failed", "conflict"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_OPERATIONS = ["insert", "update", "delete"] as const;
export type OutboxOperation = (typeof OUTBOX_OPERATIONS)[number];

/** A record exactly as it is stored in SQLite (all values are primitives). */
export type OutboxRow = {
  id: string;
  device_id: string;
  operation_id: string;
  entity: string;
  entity_id: string;
  operation_type: OutboxOperation;
  /** JSON — the values applied locally. */
  payload: string;
  /** JSON or null — the pre-mutation view of the row, for conflict detection. */
  base_snapshot: string | null;
  created_at: string;
  updated_at: string;
  business_date: string;
  status: OutboxStatus;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  schema_version: number;
  /** ISO instant of the successful upload, null until then. */
  synced_at: string | null;
  /** JSON or null — cloud state + local payload captured when a conflict was seen. */
  conflict_details: string | null;
};

export const OUTBOX_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${OUTBOX_TABLE} (
  id             TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL,
  operation_id   TEXT NOT NULL,
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  payload        TEXT NOT NULL,
  base_snapshot  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT,
  next_retry_at  TEXT,
  schema_version INTEGER NOT NULL,
  synced_at      TEXT,
  conflict_details TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_local_outbox_operation
  ON ${OUTBOX_TABLE}(operation_id);
CREATE INDEX IF NOT EXISTS idx_local_outbox_status
  ON ${OUTBOX_TABLE}(status, created_at);
CREATE INDEX IF NOT EXISTS idx_local_outbox_entity
  ON ${OUTBOX_TABLE}(entity, entity_id);
`;

/* ------------------------------------------------------------------ *
 * Retry policy                                                        *
 * ------------------------------------------------------------------ */

/** Bounded exponential backoff, in seconds, by attempt number (1-based). */
export const BACKOFF_SECONDS = [5, 15, 30, 60] as const;

/** Everything past the table waits the cap — five minutes. */
export const BACKOFF_CAP_SECONDS = 300;

/**
 * Attempts after which automatic retrying stops. The record stays `failed`
 * (never deleted) and waits for an explicit "Retry Failed" from Settings, so
 * a permanently rejected mutation cannot busy-loop against the network.
 */
export const MAX_AUTO_ATTEMPTS = 10;

export function backoffSeconds(attempt: number): number {
  if (attempt <= 0) return BACKOFF_SECONDS[0];
  return BACKOFF_SECONDS[attempt - 1] ?? BACKOFF_CAP_SECONDS;
}

/** ISO instant at which attempt number `attempt` may be retried. */
export function nextRetryAt(attempt: number, from: Date = new Date()): string {
  return new Date(from.getTime() + backoffSeconds(attempt) * 1000).toISOString();
}

export function isDue(row: Pick<OutboxRow, "next_retry_at">, at: Date = new Date()): boolean {
  if (!row.next_retry_at) return true;
  return Date.parse(row.next_retry_at) <= at.getTime();
}

export type OutboxCounts = Record<OutboxStatus, number> & { total: number };

export function emptyCounts(): OutboxCounts {
  return { pending: 0, syncing: 0, synced: 0, failed: 0, conflict: 0, total: 0 };
}
