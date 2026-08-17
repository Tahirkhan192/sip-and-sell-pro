/**
 * PHASE 5A/5B — local mutation foundation + master-data procedures.
 *
 * Nothing exported here is used by a production write path yet. POS, sales,
 * purchases, expenses, stock, staff, production, transfers and closing all
 * continue to write to Lovable Cloud exactly as before; Phase 5B adds local
 * procedures for master/reference data only.
 */

export * from "./errors";
export * from "./flags";
export * from "./ids";
export * from "./timestamps";
export * from "./business-date";
export {
  buildMutationMetadata,
  canonicalPayload,
  isForbiddenKey,
  metadataToEventRow,
  payloadHash,
  redactPayload,
  REDACTED,
  type BuildMetadataInput,
  type MutationMetadata,
} from "./metadata";
export {
  getLocalDeviceId,
  localWriteReadiness,
  requireWritableEngine,
  runLocalTransaction,
  type MutationStep,
  type MutationTxOutcome,
  type WritableEngine,
} from "./transaction";
export { mutationEventStep, recordMutationEvent } from "./audit";
export {
  localMutationCounts,
  readLocalMutationEvents,
  readLocalTestRows,
} from "./client";
export {
  EVENT_TABLE,
  TEST_TABLE,
  MUTATION_OPERATIONS,
  MUTATION_STATUSES,
  type MutationOperation,
  type MutationStatus,
} from "./schema";
export {
  TEST_ENTITY_TYPE,
  cleanupLocalTestMutation,
  runLocalRollbackDemo,
  runLocalTestMutation,
  type TestMutationOutcome,
} from "./test-api";
export * from "./procedures";
