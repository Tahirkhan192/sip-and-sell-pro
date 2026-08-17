/**
 * PHASE 5A — internal tables used by the local mutation foundation.
 *
 * These are LOCAL-ONLY, INTERNAL tables. They are not business tables, they
 * are never seeded from the cloud, never uploaded anywhere, and no production
 * screen reads them. Their names are underscore-prefixed so `describeEngine()`
 * keeps excluding them from the operational row count.
 *
 * The DDL is applied lazily and additively (`CREATE TABLE IF NOT EXISTS`), the
 * same way the diagnostic probe table is. Nothing is dropped, no existing row
 * is rewritten, and `LOCAL_SCHEMA_VERSION` is deliberately NOT bumped so an
 * existing verified Phase 3 seed stays valid.
 */

/** Isolated table for transaction/rollback proofs. Never business data. */
export const TEST_TABLE = "_local_test_transactions";

/** Local mutation event log. Foundation only — there is no sync consumer. */
export const EVENT_TABLE = "_local_mutation_events";

export const MUTATION_STATUSES = ["local_test", "pending", "committed", "failed"] as const;
export type MutationStatus = (typeof MUTATION_STATUSES)[number];

export const MUTATION_OPERATIONS = ["insert", "update", "delete"] as const;
export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];

export const MUTATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  payload       TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
  mutation_id    TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  operation      TEXT NOT NULL,
  business_date  TEXT NOT NULL,
  business_time  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_hash   TEXT NOT NULL,
  status         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_mutation_events_status
  ON ${EVENT_TABLE}(status, created_at);
CREATE INDEX IF NOT EXISTS idx_local_mutation_events_entity
  ON ${EVENT_TABLE}(entity_type, entity_id);
`;
