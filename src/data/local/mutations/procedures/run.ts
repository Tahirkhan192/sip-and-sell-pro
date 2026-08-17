/**
 * PHASE 5B — the shared execution path for every local master-data procedure.
 *
 * A procedure never writes SQL and never talks to SQLite. It describes ONE
 * logical change (create / update / soft-delete / restore of one master row),
 * and this module:
 *
 *   1. checks the write gate (flags, worker, persistent OPFS, safe table),
 *   2. builds the row in cloud storage shape (ids, defaults, timestamps),
 *   3. bundles the data step with its audit event, and
 *   4. runs both inside ONE local transaction, so an event can never outlive
 *      a change that rolled back.
 *
 * There is no dual-write and no sync: nothing here contacts Lovable Cloud.
 * Existing screens keep using the cloud repository until a later phase flips
 * the routing.
 */

import type { SqliteValue } from "../../seed-format";
import { mutationEventStep } from "../audit";
import { LocalMutationError } from "../errors";
import { assertMasterDataWritesEnabled } from "../flags";
import { newUuid } from "../ids";
import {
  MasterDataError,
  assertRowInvariants,
  assertWritable,
  encodeColumnValue,
  tableSpec,
  type MasterTable,
} from "../master-tables";
import type { MutationOperation } from "../schema";
import { businessStamp } from "../timestamps";
import { runLocalTransaction, requireWritableEngine } from "../transaction";
import type { MutationStep } from "../engine-mutations";
import { buildOutboxStep } from "@/data/sync/outbox";

export type MasterMutationResult = {
  table: MasterTable;
  operation: MutationOperation;
  /** Primary key of the affected row (generated locally for a create). */
  id: string;
  mutationId: string;
  businessDate: string;
  createdAt: string;
  /** Phase 5D — the outbox record committed alongside this mutation. */
  operationId: string;
  outboxId: string;
};

export type MasterInput = Record<string, unknown>;

function wrap(err: unknown): never {
  if (err instanceof LocalMutationError) throw err;
  if (err instanceof MasterDataError) {
    throw new LocalMutationError("INVALID_MUTATION", err.message);
  }
  throw new LocalMutationError("UNKNOWN", (err as any)?.message ?? String(err));
}

/** Builds a complete insert row: caller values + contract defaults + stamps. */
export function buildInsertRow(
  table: MasterTable,
  input: MasterInput,
  at = new Date(),
): Record<string, SqliteValue> {
  const spec = tableSpec(table);
  const nowIso = at.toISOString();
  const row: Record<string, SqliteValue> = {};

  for (const [column, col] of Object.entries(spec.columns)) {
    if (column === spec.pk) {
      const provided = input[column];
      row[column] = typeof provided === "string" && provided ? provided : newUuid();
      continue;
    }
    if (column === "created_at" || column === "updated_at") {
      row[column] = nowIso;
      continue;
    }
    if (column === "deleted_at") {
      row[column] = null;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(input, column) && input[column] !== undefined) {
      if (!col.writable) {
        throw new MasterDataError(
          `Invalid local mutation: ${table}.${column} is derived and cannot be written locally.`,
        );
      }
      row[column] = encodeColumnValue(table, column, input[column]);
      continue;
    }
    if (col.required) {
      throw new MasterDataError(
        `Invalid local mutation: ${table}.${column} is required and was not provided.`,
      );
    }
    if (col.insertDefault !== undefined) {
      row[column] = col.insertDefault;
      continue;
    }
    if (col.nullable) {
      row[column] = null;
      continue;
    }
    throw new MasterDataError(
      `Invalid local mutation: ${table}.${column} has no value and no default.`,
    );
  }
  return row;
}

/** Builds the SET map for an update: only supplied columns, plus updated_at. */
export function buildUpdateValues(
  table: MasterTable,
  input: MasterInput,
  at = new Date(),
): Record<string, SqliteValue> {
  const spec = tableSpec(table);
  const values: Record<string, SqliteValue> = {};

  for (const [column, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (column === spec.pk) continue;
    assertWritable(table, column, "update");
    values[column] = encodeColumnValue(table, column, value);
  }
  if (Object.keys(values).length === 0) {
    throw new MasterDataError(`Invalid local mutation: nothing to update on ${table}.`);
  }
  assertRowInvariants(table, values, "update");
  if (spec.touchUpdatedAt) values.updated_at = at.toISOString();
  return values;
}

async function execute(
  table: MasterTable,
  operation: MutationOperation,
  id: string,
  payload: unknown,
  dataStep: MutationStep,
  /** Exactly what SQLite will write — the row (insert) or the SET map (update). */
  applied: Record<string, SqliteValue>,
): Promise<MasterMutationResult> {
  const engine = await requireWritableEngine();
  const stamp = businessStamp();
  const { metadata, step: eventStep } = await mutationEventStep({
    deviceId: engine.deviceId,
    entityType: table,
    entityId: id,
    operation,
    payload,
    status: "pending",
    stamp,
  });

  // PHASE 5D — the outbox record rides in the SAME transaction as the data
  // change. Commit both or neither: a local master-data mutation can never
  // exist without its pending sync record, and a rolled-back mutation can
  // never leave one behind. The outbox step goes FIRST so the worker reads the
  // pre-mutation row for conflict detection.
  const { row: outboxRow, step: outboxStep } = buildOutboxStep({
    deviceId: engine.deviceId,
    schemaVersion: engine.schemaVersion,
    table,
    operation,
    entityId: id,
    payload: applied,
    stamp,
  });

  const outcome = await runLocalTransaction([outboxStep, dataStep, eventStep]);
  if (!outcome.committed) {
    throw new LocalMutationError("TRANSACTION_FAILED", outcome.message);
  }
  return {
    table,
    operation,
    id,
    mutationId: metadata.mutationId,
    businessDate: stamp.businessDate,
    createdAt: stamp.utc,
    operationId: outboxRow.operation_id,
    outboxId: outboxRow.id,
  };
}

/** Creates one master row locally. */
export async function createMasterRow(
  table: MasterTable,
  input: MasterInput,
): Promise<MasterMutationResult> {
  try {
    assertMasterDataWritesEnabled(table);
    const row = buildInsertRow(table, input);
    return await execute(
      table,
      "insert",
      String(row[tableSpec(table).pk]),
      input,
      { kind: "masterInsert", table, row },
      row,
    );
  } catch (err) {
    wrap(err);
  }
}

/** Updates one master row locally (primary key never changes). */
export async function updateMasterRow(
  table: MasterTable,
  id: string | number,
  input: MasterInput,
): Promise<MasterMutationResult> {
  try {
    assertMasterDataWritesEnabled(table);
    const values = buildUpdateValues(table, input);
    return await execute(
      table,
      "update",
      String(id),
      input,
      { kind: "masterUpdate", table, id: id as SqliteValue, values },
      values,
    );
  } catch (err) {
    wrap(err);
  }
}

/**
 * Soft-deletes one master row (`deleted_at = now`), exactly like the cloud
 * screens do. No master row is ever physically removed locally.
 */
export async function softDeleteMasterRow(
  table: MasterTable,
  id: string,
  at = new Date(),
): Promise<MasterMutationResult> {
  try {
    assertMasterDataWritesEnabled(table);
    const spec = tableSpec(table);
    if (!spec.softDelete) {
      throw new MasterDataError(`Invalid local mutation: ${table} rows cannot be deleted.`);
    }
    const values: Record<string, SqliteValue> = { deleted_at: at.toISOString() };
    if (spec.touchUpdatedAt) values.updated_at = at.toISOString();
    return await execute(
      table,
      "delete",
      id,
      { deleted_at: values.deleted_at },
      { kind: "masterUpdate", table, id, values },
      values,
    );
  } catch (err) {
    wrap(err);
  }
}

/** Restores a soft-deleted master row. */
export async function restoreMasterRow(
  table: MasterTable,
  id: string,
  at = new Date(),
): Promise<MasterMutationResult> {
  try {
    assertMasterDataWritesEnabled(table);
    const spec = tableSpec(table);
    if (!spec.softDelete) {
      throw new MasterDataError(`Invalid local mutation: ${table} rows cannot be restored.`);
    }
    const values: Record<string, SqliteValue> = { deleted_at: null };
    if (spec.touchUpdatedAt) values.updated_at = at.toISOString();
    return await execute(
      table,
      "update",
      id,
      { deleted_at: null },
      { kind: "masterUpdate", table, id, values },
      values,
    );
  } catch (err) {
    wrap(err);
  }
}
