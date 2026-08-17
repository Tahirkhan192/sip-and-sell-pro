/**
 * PHASE 5A — isolated, test/development-only mutation harness.
 *
 * Demonstrates the full local mutation pipeline end to end WITHOUT touching a
 * single business table. Only `_local_test_transactions` and
 * `_local_mutation_events` are written; sales, sale_items, purchases,
 * purchase_items, expenses, cash_movements, products, stock_items,
 * staff_payments, production_batches, stock_transfers and daily_closings are
 * never referenced by this path.
 *
 * Guarded by `assertLocalWritesEnabled()`, so with the default flags it cannot
 * run at all.
 */

import {
  clearLocalTestArtifacts,
  readLocalMutationEvents,
  readLocalTestRows,
  runLocalMutationTx,
} from "./client";
import type { LocalMutationEventRow, LocalTestRow, MutationStep } from "./engine-mutations";
import {
  LocalMutationError,
  classifyLocalError,
  failure,
  type LocalMutationResult,
} from "./errors";
import { newMutationId, newUuid } from "./ids";
import { buildMutationMetadata, metadataToEventRow, payloadHash } from "./metadata";
import { businessStamp } from "./timestamps";
import { requireWritableEngine } from "./transaction";

export const TEST_ENTITY_TYPE = "local_test";

export type TestMutationOptions = {
  label?: string;
  payload?: Record<string, unknown>;
  /** When true the transaction deliberately fails so rollback can be proven. */
  failDeliberately?: boolean;
};

export type TestMutationOutcome = {
  result: LocalMutationResult;
  entityId: string;
  mutationId: string;
  row: LocalTestRow | null;
  event: LocalMutationEventRow | null;
};

/**
 * 1 uuid → 2 device id → 3 business date → 4 BEGIN → 5 test row →
 * 6 mutation metadata → 7 payload hash → 8 COMMIT (or rollback).
 */
export async function runLocalTestMutation(
  options: TestMutationOptions = {},
): Promise<TestMutationOutcome> {
  const entityId = newUuid();
  const mutationId = newMutationId();
  try {
    const engine = await requireWritableEngine(); // flags + persistence + device id
    const stamp = businessStamp();
    const payload = options.payload ?? { label: options.label ?? "phase-5a", n: 1 };
    const hash = await payloadHash(payload);

    const metadata = await buildMutationMetadata({
      mutationId,
      deviceId: engine.deviceId,
      entityType: TEST_ENTITY_TYPE,
      entityId,
      operation: "insert",
      payload,
      status: "local_test",
      stamp,
    });

    const steps: MutationStep[] = [
      {
        kind: "testInsert",
        row: {
          id: entityId,
          label: options.label ?? "phase-5a",
          payload: JSON.stringify(payload),
          device_id: engine.deviceId,
          business_date: stamp.businessDate,
          created_at: stamp.utc,
        },
      },
      { kind: "event", event: metadataToEventRow(metadata) },
    ];
    if (options.failDeliberately) {
      steps.push({
        kind: "failDeliberately",
        message: "Phase 5A rollback proof — intentional failure",
      });
    }

    const outcome = await runLocalMutationTx(steps);
    const [row] = await readLocalTestRows([entityId]);
    const [event] = await readLocalMutationEvents([mutationId]);

    if (!outcome.committed) {
      return {
        result: failure(mutationId, "TRANSACTION_FAILED", outcome.message, outcome.rolledBack),
        entityId,
        mutationId,
        row: row ?? null,
        event: event ?? null,
      };
    }

    return {
      result: {
        ok: true,
        mutationId,
        entityId,
        entityType: TEST_ENTITY_TYPE,
        operation: "insert",
        businessDate: stamp.businessDate,
        businessTime: stamp.businessTime,
        payloadHash: hash,
        committedAt: stamp.utc,
        deviceId: engine.deviceId,
      },
      entityId,
      mutationId,
      row: row ?? null,
      event: event ?? null,
    };
  } catch (err: any) {
    const code = err instanceof LocalMutationError ? err.code : classifyLocalError(err);
    return {
      result: failure(mutationId, code, err?.message, true),
      entityId,
      mutationId,
      row: null,
      event: null,
    };
  }
}

/** Convenience wrapper: the rollback demonstration. */
export function runLocalRollbackDemo(label = "phase-5a-rollback") {
  return runLocalTestMutation({ label, failDeliberately: true });
}

/** Removes rows created by this harness. Never touches business data. */
export async function cleanupLocalTestMutation(outcome: TestMutationOutcome): Promise<void> {
  await clearLocalTestArtifacts([outcome.entityId], [outcome.mutationId]);
}

export { readLocalMutationEvents, readLocalTestRows };
