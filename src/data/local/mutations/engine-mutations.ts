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
import { mirrorTable } from "../mirror";
import type { SqliteValue } from "../seed-format";
import {
  MasterDataError,
  assertRowInvariants,
  assertWritable,
  encodeColumnValue,
  tableSpec,
  type MasterTable,
} from "./master-tables";
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
 * The complete vocabulary of a local transaction.
 *
 * Phase 5A steps carry no table name at all. The Phase 5B master-data steps
 * carry a table name, but it is validated against `MASTER_TABLE_SPECS` here,
 * inside the worker, before a single statement is prepared — a transactional
 * table (sales, purchases, cash movements…) is rejected, and so is any column
 * that is derived or unknown. There is still no SQL text in a step.
 */
export type MutationStep =
  | { kind: "testInsert"; row: LocalTestRow }
  | { kind: "testDelete"; id: string }
  | { kind: "event"; event: LocalMutationEventRow }
  | { kind: "eventStatus"; mutationId: string; status: MutationStatus }
  /* ---- Phase 5B: master/reference data only ---- */
  | { kind: "masterInsert"; table: MasterTable; row: Record<string, SqliteValue> }
  | {
      kind: "masterUpdate";
      table: MasterTable;
      id: SqliteValue;
      values: Record<string, SqliteValue>;
    }
  | { kind: "masterDelete"; table: MasterTable; id: SqliteValue }
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

/* ------------------------------------------------------------------ *
 * PHASE 5B — master/reference data steps                              *
 * ------------------------------------------------------------------ */

/**
 * Re-validates a master-data row inside the worker: allowed table, allowed
 * columns, allowed values, cross-column invariants. The main thread already
 * did this; doing it again here means a hand-crafted message can never write
 * something the contract forbids.
 */
function validateMasterRow(
  table: MasterTable,
  values: Record<string, SqliteValue>,
  mode: "insert" | "update",
): Record<string, SqliteValue> {
  const spec = tableSpec(table);
  const out: Record<string, SqliteValue> = {};

  for (const [column, value] of Object.entries(values)) {
    if (column === spec.pk) {
      if (mode === "update") {
        throw new MasterDataError(`Invalid local mutation: ${table}.${spec.pk} cannot be changed.`);
      }
      out[column] = value;
      continue;
    }
    // created_at / updated_at / deleted_at are stamped by the procedure layer.
    if (column === "created_at" || column === "updated_at") {
      out[column] = value;
      continue;
    }
    if (column !== "deleted_at") {
      const col = spec.columns[column];
      const baseline = col?.insertDefault ?? null;
      // A derived column (stock, balances, credentials) may appear in an insert
      // ONLY at its baseline value — it can never carry a caller-chosen number.
      const derivedAtBaseline = mode === "insert" && col && !col.writable && value === baseline;
      if (!derivedAtBaseline) assertWritable(table, column, mode);
    }
    out[column] = encodeColumnValue(table, column, value);

  }

  if (mode === "insert") {
    for (const [column, col] of Object.entries(spec.columns)) {
      if (column in out) continue;
      if (col.nullable) {
        out[column] = null;
        continue;
      }
      throw new MasterDataError(
        `Invalid local mutation: ${table}.${column} is required and was not provided.`,
      );
    }
  }

  assertRowInvariants(table, out, mode);
  return out;
}

/** Enforces the cloud UNIQUE constraints against live (not soft-deleted) rows. */
function assertUnique(
  db: LocalDb,
  table: MasterTable,
  values: Record<string, SqliteValue>,
  excludeId: SqliteValue | null,
): void {
  const spec = tableSpec(table);
  for (const cols of spec.unique) {
    if (!cols.some((c) => c in values)) continue;
    const where: string[] = [];
    const bind: SqliteValue[] = [];
    for (const c of cols) {
      const v = values[c];
      if (v === undefined) return; // partial key on update: nothing to check
      where.push(`lower(CAST("${c}" AS TEXT)) = lower(CAST(? AS TEXT))`);
      bind.push(v);
    }
    if (spec.softDelete) where.push(`"deleted_at" IS NULL`);
    if (excludeId !== null) {
      where.push(`"${spec.pk}" <> ?`);
      bind.push(excludeId);
    }
    const rows = db.selectValues(
      `SELECT COUNT(*) FROM "${mirrorTable(table)}" WHERE ${where.join(" AND ")}`,
      bind as any[],
    ) as number[];
    if (Number(rows[0] ?? 0) > 0) {
      throw new MasterDataError(
        `Invalid local mutation: ${table} already has a row with the same ${cols.join(" + ")}.`,
      );
    }
  }
}

function rowExists(db: LocalDb, table: MasterTable, id: SqliteValue): boolean {
  const spec = tableSpec(table);
  const v = db.selectValues(
    `SELECT COUNT(*) FROM "${mirrorTable(table)}" WHERE "${spec.pk}" = ?`,
    [id] as any[],
  ) as number[];
  return Number(v[0] ?? 0) > 0;
}

function applyMasterInsert(db: LocalDb, table: MasterTable, raw: Record<string, SqliteValue>): void {
  const spec = tableSpec(table);
  if (!spec.allowInsert) {
    throw new MasterDataError(`Invalid local mutation: rows cannot be created in "${table}".`);
  }
  const row = validateMasterRow(table, raw, "insert");
  const id = row[spec.pk];
  if (id === undefined || id === null) {
    throw new MasterDataError(`Invalid local mutation: ${table}.${spec.pk} is missing.`);
  }
  if (rowExists(db, table, id)) {
    throw new MasterDataError(`Invalid local mutation: ${table} row "${String(id)}" already exists.`);
  }
  assertUnique(db, table, row, null);

  const columns = Object.keys(row);
  db.exec({
    sql: `INSERT INTO "${mirrorTable(table)}"(${columns.map((c) => `"${c}"`).join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})`,
    bind: columns.map((c) => row[c]) as any[],
  });
}

function applyMasterUpdate(
  db: LocalDb,
  table: MasterTable,
  id: SqliteValue,
  raw: Record<string, SqliteValue>,
): void {
  const spec = tableSpec(table);
  if (id === undefined || id === null) {
    throw new MasterDataError(`Invalid local mutation: ${table} update needs a primary key.`);
  }
  const values = validateMasterRow(table, raw, "update");
  const columns = Object.keys(values);
  if (columns.length === 0) {
    throw new MasterDataError(`Invalid local mutation: ${table} update has no columns.`);
  }
  if (!rowExists(db, table, id)) {
    throw new MasterDataError(`Invalid local mutation: ${table} row "${String(id)}" does not exist.`);
  }
  assertUnique(db, table, values, id);

  db.exec({
    sql: `UPDATE "${mirrorTable(table)}" SET ${columns.map((c) => `"${c}" = ?`).join(", ")}
          WHERE "${spec.pk}" = ?`,
    bind: [...columns.map((c) => values[c]), id] as any[],
  });
}

function applyMasterDelete(db: LocalDb, table: MasterTable, id: SqliteValue): void {
  const spec = tableSpec(table);
  if (!spec.allowHardDelete) {
    throw new MasterDataError(
      `Invalid local mutation: "${table}" rows are soft-deleted (deleted_at), never removed.`,
    );
  }
  db.exec({
    sql: `DELETE FROM "${mirrorTable(table)}" WHERE "${spec.pk}" = ?`,
    bind: [id] as any[],
  });
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
    case "masterInsert": {
      applyMasterInsert(db, step.table, step.row);
      return;
    }
    case "masterUpdate": {
      applyMasterUpdate(db, step.table, step.id, step.values);
      return;
    }
    case "masterDelete": {
      applyMasterDelete(db, step.table, step.id);
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
