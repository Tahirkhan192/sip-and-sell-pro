/**
 * PHASE 5D — real-SQLite proof for the outbox.
 *
 * What must hold, and is proven here:
 *   * the outbox record and the data change commit together, or not at all,
 *   * the pre-mutation row is captured as the baseline for conflict detection,
 *   * a rejected mutation leaves NO orphan outbox record,
 *   * records survive as history: statuses change, rows are never removed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeEngine, openEngine, type LocalDb } from "../local/engine";
import { applyMirrorSchema, mirrorTable } from "../local/mirror";
import { runMutationTx, readOutbox, outboxCounts } from "../local/mutations/engine-mutations";
import { buildInsertRow, buildUpdateValues } from "../local/mutations/procedures/run";
import { buildOutboxStep } from "./outbox";
import type { OutboxRow } from "../local/mutations/outbox-schema";

let db: LocalDb;

const at = new Date("2026-03-04T09:15:00.000Z");
const stamp = { utc: at.toISOString(), businessDate: "2026-03-04", localTime: "14:15" } as any;

function outboxStep(table: any, operation: any, entityId: string, payload: Record<string, any>) {
  return buildOutboxStep({
    deviceId: "device-test",
    schemaVersion: 1,
    table,
    operation,
    entityId,
    payload,
    stamp,
  });
}

beforeAll(async () => {
  db = await openEngine();
  applyMirrorSchema(db);
});

afterAll(async () => {
  await closeEngine();
});

describe("Phase 5D — outbox against real SQLite", () => {
  it("commits the outbox record in the same transaction as the data change", () => {
    const row = buildInsertRow("categories", { name: "Outbox Cat", sort_order: 1 }, at);
    const id = String((row as any).id);
    const { row: obRow, step } = outboxStep("categories", "insert", id, row as any);

    const res = runMutationTx(db, [step, { kind: "masterInsert", table: "categories", row }]);
    expect(res.committed).toBe(true);

    const stored = readOutbox(db, { ids: [obRow.id] });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      entity: "categories",
      entity_id: id,
      operation_type: "insert",
      status: "pending",
      attempt_count: 0,
      base_snapshot: null,
    });
    expect(JSON.parse(stored[0].payload).name).toBe("Outbox Cat");
  });

  it("captures the pre-mutation row as the conflict baseline on update", () => {
    const row = buildInsertRow("categories", { name: "Before", sort_order: 4 }, at);
    const id = String((row as any).id);
    runMutationTx(db, [{ kind: "masterInsert", table: "categories", row }]);

    const values = buildUpdateValues("categories", { name: "After" }, at);
    const { row: obRow, step } = outboxStep("categories", "update", id, values as any);
    const res = runMutationTx(db, [
      step,
      { kind: "masterUpdate", table: "categories", id, values },
    ]);
    expect(res.committed).toBe(true);

    const stored = readOutbox(db, { ids: [obRow.id] })[0] as OutboxRow;
    const base = JSON.parse(String(stored.base_snapshot));
    // The baseline is the row as it was BEFORE this change.
    expect(base.name).toBe("Before");
    expect(base.id).toBe(id);
    const [after] = db.selectObjects(
      `SELECT * FROM "${mirrorTable("categories")}" WHERE id = '${id}'`,
    ) as any[];
    expect(after.name).toBe("After");
  });

  it("leaves no outbox record when the mutation is rejected", () => {
    const before = readOutbox(db, {}).length;
    const row = buildInsertRow("categories", { name: "Outbox Cat" }, at); // duplicate name
    const id = String((row as any).id);
    const { step } = outboxStep("categories", "insert", id, row as any);

    const res = runMutationTx(db, [step, { kind: "masterInsert", table: "categories", row }]);
    expect(res.committed).toBe(false);
    expect(readOutbox(db, {}).length).toBe(before);
  });

  it("keeps records as history when their status changes", () => {
    const row = buildInsertRow("categories", { name: "History Cat" }, at);
    const id = String((row as any).id);
    const { row: obRow, step } = outboxStep("categories", "insert", id, row as any);
    runMutationTx(db, [step, { kind: "masterInsert", table: "categories", row }]);

    runMutationTx(db, [
      {
        kind: "outboxStatus",
        id: obRow.id,
        status: "failed",
        updatedAt: at.toISOString(),
        attemptCount: 1,
        lastError: "Network unavailable",
        nextRetryAt: "2026-03-04T09:15:05.000Z",
      },
    ]);
    let stored = readOutbox(db, { ids: [obRow.id] })[0];
    expect(stored).toMatchObject({ status: "failed", attempt_count: 1 });
    expect(stored.last_error).toBe("Network unavailable");

    runMutationTx(db, [
      {
        kind: "outboxStatus",
        id: obRow.id,
        status: "synced",
        updatedAt: at.toISOString(),
        syncedAt: at.toISOString(),
        lastError: null,
        nextRetryAt: null,
      },
    ]);
    stored = readOutbox(db, { ids: [obRow.id] })[0];
    expect(stored.status).toBe("synced");
    expect(stored.synced_at).toBe(at.toISOString());
    // Still present — synchronization never deletes local history.
    expect(readOutbox(db, { ids: [obRow.id] })).toHaveLength(1);

    const counts = outboxCounts(db);
    expect(counts.synced).toBeGreaterThanOrEqual(1);
  });
});
