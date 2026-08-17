/**
 * PHASE 5A — worker-side local mutation engine.
 *
 * Runs INSIDE the SQLite worker (and directly inside Node for unit tests).
 * The main thread can never reach it except through the narrow, typed
 * protocol operations in `../protocol.ts`.
 *
 * Hard guarantees implemented here:
 *   * There is no `execute(sql)`. A transaction is a list of typed steps and
 *     each step maps to one hand-written, parameterised statement.
 *   * The only tables reachable are the two internal Phase 5A tables. A step
 *     can not name a table, so no business table — cloud mirror or otherwise —
 *     can be written, updated or deleted through this path.
 *   * BEGIN → steps → COMMIT. Any failure (including a deliberate test
 *     failure) triggers ROLLBACK, so a partial transaction cannot survive.
 */

import type { LocalDb } from "../engine";
import { LOCAL_SCHEMA_VERSION } from "../engine";
import {
  EVENT_TABLE,
  MUTATION_OPERATIONS,
  MUTATION_SCHEMA_SQL,
  MUTATION_STATUSES,
  TEST_TABLE,
  type MutationOperation,
  type MutationStatus,
} from "./schema";

export type LocalTestRow = {
  id: string;
  label: string;
  payload: string;
  device_id: string;
  business_date: string;
  created_at: string;
};

export type LocalMutationEventRow = {
  mutation_id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation: MutationOperation;
  business_date: string;
  business_time: string;
  created_at: string;
  schema_version: number;
  payload_hash: string;
  status: MutationStatus;
};

/**
 * The complete vocabulary of a local transaction in Phase 5A. Note that no
 * step carries a table name or SQL text.
 */
export type MutationStep =
  | { kind: "testInsert"; row: LocalTestRow }
  | { kind: "testDelete"; id: string }
  | { kind: "event"; event: LocalMutationEventRow }
  | { kind: "eventStatus"; mutationId: string; status: MutationStatus }
  /** Test-only: forces the transaction to fail so rollback can be proven. */
  | { kind: "failDeliberately"; message: string };

export type MutationTxOutcome =
  | { committed: true; applied: number }
  | { committed: false; rolledBack: true; errorName: string; message: string };

/** Applies the internal Phase 5A DDL. Idempotent and purely additive. */
export function ensureMutationSchema(db: LocalDb): void {
  db.exec(MUTATION_SCHEMA_SQL);
}

let txOpen = false;

/** True while a local mutation transaction is in flight (worker-local). */
export function mutationTxOpen(): boolean {
  return txOpen;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Invalid local mutation: "${field}" must be a non-empty string.`);
  }
  return v;
}

function validateTestRow(row: LocalTestRow): LocalTestRow {
  return {
    id: requireString(row?.id, "id"),
    label: requireString(row?.label, "label"),
    payload: requireString(row?.payload, "payload"),
    device_id: requireString(row?.device_id, "device_id"),
    business_date: requireString(row?.business_date, "business_date"),
    created_at: requireString(row?.created_at, "created_at"),
  };
}

function validateEvent(e: LocalMutationEventRow): LocalMutationEventRow {
  if (!MUTATION_OPERATIONS.includes(e?.operation)) {
    throw new Error(`Invalid local mutation operation: ${String(e?.operation)}`);
  }
  if (!MUTATION_STATUSES.includes(e?.status)) {
    throw new Error(`Invalid local mutation status: ${String(e?.status)}`);
  }
  return {
    mutation_id: requireString(e.mutation_id, "mutation_id"),
    device_id: requireString(e.device_id, "device_id"),
    entity_type: requireString(e.entity_type, "entity_type"),
    entity_id: requireString(e.entity_id, "entity_id"),
    operation: e.operation,
    business_date: requireString(e.business_date, "business_date"),
    business_time: requireString(e.business_time, "business_time"),
    created_at: requireString(e.created_at, "created_at"),
    schema_version: Number.isFinite(e.schema_version) ? e.schema_version : LOCAL_SCHEMA_VERSION,
    payload_hash: requireString(e.payload_hash, "payload_hash"),
    status: e.status,
  };
}

function applyStep(db: LocalDb, step: MutationStep): void {
  switch (step.kind) {
    case "testInsert": {
      const r = validateTestRow(step.row);
      db.exec({
        sql: `INSERT INTO ${TEST_TABLE}(id, label, payload, device_id, business_date, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        bind: [r.id, r.label, r.payload, r.device_id, r.business_date, r.created_at],
      });
      return;
    }
    case "testDelete": {
      db.exec({
        sql: `DELETE FROM ${TEST_TABLE} WHERE id = ?`,
        bind: [requireString(step.id, "id")],
      });
      return;
    }
    case "event": {
      const e = validateEvent(step.event);
      db.exec({
        sql: `INSERT INTO ${EVENT_TABLE}(
                mutation_id, device_id, entity_type, entity_id, operation,
                business_date, business_time, created_at, schema_version,
                payload_hash, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind: [
          e.mutation_id,
          e.device_id,
          e.entity_type,
          e.entity_id,
          e.operation,
          e.business_date,
          e.business_time,
          e.created_at,
          e.schema_version,
          e.payload_hash,
          e.status,
        ],
      });
      return;
    }
    case "eventStatus": {
      if (!MUTATION_STATUSES.includes(step.status)) {
        throw new Error(`Invalid local mutation status: ${String(step.status)}`);
      }
      db.exec({
        sql: `UPDATE ${EVENT_TABLE} SET status = ? WHERE mutation_id = ?`,
        bind: [step.status, requireString(step.mutationId, "mutationId")],
      });
      return;
    }
    case "failDeliberately": {
      const err = new Error(step.message || "Deliberate local transaction failure");
      err.name = "DeliberateTransactionFailure";
      throw err;
    }
    default: {
      throw new Error(`Unsupported local mutation step: ${String((step as any)?.kind)}`);
    }
  }
}

/**
 * Executes every step inside one SQLite transaction.
 * Commits only if all steps succeed; otherwise rolls the whole thing back.
 */
export function runMutationTx(db: LocalDb, steps: MutationStep[]): MutationTxOutcome {
  if (txOpen) throw new Error("A local mutation transaction is already open.");
  ensureMutationSchema(db);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN");
  txOpen = true;
  try {
    let applied = 0;
    for (const step of steps) {
      applyStep(db, step);
      applied += 1;
    }
    db.exec("COMMIT");
    txOpen = false;
    return { committed: true, applied };
  } catch (err: any) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // A rollback failure must never mask the original error.
    }
    txOpen = false;
    return {
      committed: false,
      rolledBack: true,
      errorName: err?.name ?? "Error",
      message: err?.message ?? String(err),
    };
  }
}

/* ------------------------------------------------------------------ *
 * Read-back (used by the tests / diagnostics only)                     *
 * ------------------------------------------------------------------ */

export function readTestRows(db: LocalDb, ids?: string[]): LocalTestRow[] {
  ensureMutationSchema(db);
  if (ids && ids.length > 0) {
    const marks = ids.map(() => "?").join(", ");
    return db.selectObjects(
      `SELECT * FROM ${TEST_TABLE} WHERE id IN (${marks}) ORDER BY id`,
      ids as any[],
    ) as unknown as LocalTestRow[];
  }
  return db.selectObjects(
    `SELECT * FROM ${TEST_TABLE} ORDER BY created_at, id`,
  ) as unknown as LocalTestRow[];
}

export function readMutationEvents(db: LocalDb, ids?: string[]): LocalMutationEventRow[] {
  ensureMutationSchema(db);
  if (ids && ids.length > 0) {
    const marks = ids.map(() => "?").join(", ");
    return db.selectObjects(
      `SELECT * FROM ${EVENT_TABLE} WHERE mutation_id IN (${marks}) ORDER BY mutation_id`,
      ids as any[],
    ) as unknown as LocalMutationEventRow[];
  }
  return db.selectObjects(
    `SELECT * FROM ${EVENT_TABLE} ORDER BY created_at, mutation_id`,
  ) as unknown as LocalMutationEventRow[];
}

export type MutationCounts = { testRows: number; events: number; byStatus: Record<string, number> };

export function mutationCounts(db: LocalDb): MutationCounts {
  ensureMutationSchema(db);
  const testRows = Number(
    (db.selectValues(`SELECT COUNT(*) FROM ${TEST_TABLE}`) as number[])[0] ?? 0,
  );
  const events = Number(
    (db.selectValues(`SELECT COUNT(*) FROM ${EVENT_TABLE}`) as number[])[0] ?? 0,
  );
  const byStatus: Record<string, number> = {};
  for (const row of db.selectObjects(
    `SELECT status, COUNT(*) AS n FROM ${EVENT_TABLE} GROUP BY status`,
  ) as any[]) {
    byStatus[String(row.status)] = Number(row.n);
  }
  return { testRows, events, byStatus };
}

/** Removes ONLY rows written by the isolated test harness. */
export function clearTestArtifacts(db: LocalDb, ids: string[], mutationIds: string[]): number {
  ensureMutationSchema(db);
  let removed = 0;
  for (const id of ids) {
    db.exec({ sql: `DELETE FROM ${TEST_TABLE} WHERE id = ?`, bind: [id] });
    removed += 1;
  }
  for (const id of mutationIds) {
    db.exec({
      sql: `DELETE FROM ${EVENT_TABLE} WHERE mutation_id = ? AND status = 'local_test'`,
      bind: [id],
    });
  }
  return removed;
}
