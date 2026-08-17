/**
 * PHASE 5A — local audit / mutation event recording.
 *
 * Records "a mutation happened" rows in the local-only `_local_mutation_events`
 * table so a future sync engine can answer who / which device / when / which
 * business date / what operation / which entity.
 *
 * Explicitly NOT a sync engine: nothing here uploads, retries, drains or
 * consumes these rows, and no cloud call is made. Payload bodies are never
 * stored — only their redacted canonical hash — so no credential can leak
 * into the log.
 */

import { runLocalMutationTx } from "./client";
import type { MutationStep } from "./engine-mutations";
import { LocalMutationError } from "./errors";
import {
  buildMutationMetadata,
  metadataToEventRow,
  type BuildMetadataInput,
  type MutationMetadata,
} from "./metadata";
import { requireWritableEngine } from "./transaction";

export { readLocalMutationEvents, localMutationCounts } from "./client";
export type { MutationMetadata };

/**
 * Builds metadata for a mutation and returns the step that records it.
 * Callers put this step in the SAME transaction as the data change, so the
 * event can never survive a rolled-back mutation.
 */
export async function mutationEventStep(
  input: BuildMetadataInput,
): Promise<{ metadata: MutationMetadata; step: MutationStep }> {
  const metadata = await buildMutationMetadata(input);
  return { metadata, step: { kind: "event", event: metadataToEventRow(metadata) } };
}

/**
 * Records a standalone event (its own transaction). Used by diagnostics; real
 * mutations must bundle `mutationEventStep()` with their data steps instead.
 */
export async function recordMutationEvent(
  input: Omit<BuildMetadataInput, "deviceId"> & { deviceId?: string },
): Promise<MutationMetadata> {
  const engine = await requireWritableEngine();
  const { metadata, step } = await mutationEventStep({
    ...input,
    deviceId: input.deviceId ?? engine.deviceId,
  });
  const outcome = await runLocalMutationTx([step]);
  if (!outcome.committed) {
    throw new LocalMutationError("TRANSACTION_FAILED", outcome.message);
  }
  return metadata;
}
