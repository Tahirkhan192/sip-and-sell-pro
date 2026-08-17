/**
 * PHASE 5A — thin main-thread wrappers over the mutation protocol ops.
 *
 * Separated from `transaction.ts` so the transaction layer stays free of
 * transport details, and so tests can exercise the protocol directly.
 */

import { requestLocalDb } from "../db";
import type {
  LocalMutationEventRow,
  LocalTestRow,
  MutationCounts,
  MutationStep,
  MutationTxOutcome,
} from "./engine-mutations";

/** Runs a typed step list inside one worker-side transaction. */
export async function runLocalMutationTx(steps: MutationStep[]): Promise<MutationTxOutcome> {
  const res = await requestLocalDb({ op: "mutationTx", steps });
  return (res as { outcome: MutationTxOutcome }).outcome;
}

/** Reads back rows from the isolated test table. */
export async function readLocalTestRows(ids?: string[]): Promise<LocalTestRow[]> {
  const res = await requestLocalDb({ op: "mutationTestRows", ids });
  return (res as { rows: LocalTestRow[] }).rows;
}

/** Reads back local mutation events. */
export async function readLocalMutationEvents(
  ids?: string[],
): Promise<LocalMutationEventRow[]> {
  const res = await requestLocalDb({ op: "mutationEvents", ids });
  return (res as { events: LocalMutationEventRow[] }).events;
}

/** Row counts for the two internal Phase 5A tables. */
export async function localMutationCounts(): Promise<MutationCounts> {
  const res = await requestLocalDb({ op: "mutationCounts" });
  return (res as { counts: MutationCounts }).counts;
}

/** Removes rows written by the isolated harness (test artefacts only). */
export async function clearLocalTestArtifacts(
  ids: string[],
  mutationIds: string[],
): Promise<number> {
  const res = await requestLocalDb({ op: "mutationClearTest", ids, mutationIds });
  return (res as { removed: number }).removed;
}
