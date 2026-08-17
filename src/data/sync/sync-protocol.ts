/**
 * PHASE 5D — turning one outbox record into one cloud mutation.
 *
 * This is the ONLY place that uploads master data. It:
 *   * decodes the SQLite-shaped payload back into cloud column values using
 *     the SAME Phase 5B column contract that validated the local write, so no
 *     validation or business rule is bypassed,
 *   * preserves the entity UUID, `created_at`, `updated_at`, `deleted_at` and
 *     every business field exactly as they were written locally,
 *   * is idempotent: it reads the cloud row first, so replaying the same
 *     `operation_id` can never create a second row, and
 *   * refuses to overwrite a cloud row that moved on (see `conflicts.ts`).
 *
 * Transactional tables have no path through here at all: `entity` is checked
 * against the master-table contract, which only knows master/reference data.
 */

import {
  isMasterTable,
  tableSpec,
  type MasterTable,
} from "@/data/local/mutations/master-tables";
import type { OutboxRow } from "@/data/local/mutations/outbox-schema";
import { conflictDetails, detectConflict, parseSnapshot, sameValue } from "./conflicts";

export type CloudRow = Record<string, unknown>;

/**
 * PHASE 9 — the smallest safe server-side mechanism for a conditional update.
 *
 * The cloud schema has no row-version column, and adding one to 30+ live
 * tables would be a large, risky migration. Instead the UPDATE itself carries
 * the baseline: `UPDATE ... WHERE id = $1 AND updated_at = <baseline>`,
 * returning the affected rows. If zero rows come back, another device wrote
 * first and we have a conflict — decided by the DATABASE, not by a read that
 * could be stale. No migration, no RLS change, no data change.
 */
export type UpdateGuard = { column: string; value: unknown } | null;

/** The narrow cloud surface the sync engine needs — injectable for tests. */
export type CloudGateway = {
  fetchRow: (table: string, pk: string, id: unknown) => Promise<CloudRow | null>;
  insertRow: (table: string, row: CloudRow) => Promise<void>;
  /** Returns the number of rows actually updated (0 = the guard did not match). */
  updateRow: (
    table: string,
    pk: string,
    id: unknown,
    values: CloudRow,
    guard?: UpdateGuard,
  ) => Promise<number>;
};

export type ApplyResult =
  | { outcome: "synced" }
  | { outcome: "conflict"; reason: string; details: ReturnType<typeof conflictDetails> };

/** Default gateway — the app's Lovable Cloud client, loaded lazily. */
export async function supabaseGateway(): Promise<CloudGateway> {
  const { supabase } = await import("@/integrations/supabase/client");
  const client = supabase as any;
  return {
    async fetchRow(table, pk, id) {
      const { data, error } = await client.from(table).select("*").eq(pk, id).maybeSingle();
      if (error) throw error;
      return (data as CloudRow) ?? null;
    },
    async insertRow(table, row) {
      const { error } = await client.from(table).insert(row);
      if (error) throw error;
    },
    async updateRow(table, pk, id, values, guard) {
      let query = client.from(table).update(values).eq(pk, id);
      if (guard) {
        query =
          guard.value === null || guard.value === undefined
            ? query.is(guard.column, null)
            : query.eq(guard.column, guard.value);
      }
      const { data, error } = await query.select(pk);
      if (error) throw error;
      return Array.isArray(data) ? data.length : 0;
    },
  };
}


/**
 * Decodes one stored payload value back to its cloud representation.
 * SQLite has no booleans and no JSON type, so the contract's column kind is
 * what tells us which is which.
 */
export function decodeValue(table: MasterTable, column: string, value: unknown): unknown {
  const spec = tableSpec(table).columns[column];
  if (value === null || value === undefined) return null;
  if (!spec) return value;
  switch (spec.kind) {
    case "boolean":
      return value === 1 || value === "1" || value === true;
    case "json":
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    case "number":
    case "integer":
      return typeof value === "string" ? Number(value) : value;
    default:
      return value;
  }
}

export function decodePayload(table: MasterTable, payload: string): CloudRow {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new Error("The stored payload for this change is not readable.");
  }
  const out: CloudRow = {};
  for (const [column, value] of Object.entries(raw ?? {})) {
    out[column] = decodeValue(table, column, value);
  }
  return out;
}

/** True when the cloud row already carries everything this payload would set. */
export function alreadyApplied(cloud: CloudRow, payload: CloudRow): boolean {
  return Object.entries(payload).every(([column, value]) => sameValue(value, cloud[column]));
}

/**
 * Applies ONE outbox record to Lovable Cloud.
 *
 * Never throws for a conflict — conflicts are returned so the caller can store
 * both versions. Genuine transport/permission failures do throw, and the
 * caller retries them with backoff.
 */
export async function applyOutboxRecord(
  record: OutboxRow,
  gateway: CloudGateway,
  at: Date = new Date(),
): Promise<ApplyResult> {
  if (!isMasterTable(record.entity)) {
    throw new Error(
      `"${record.entity}" is not master data and must never be synchronized by this engine.`,
    );
  }
  const table = record.entity as MasterTable;
  const spec = tableSpec(table);
  const id = spec.pkKind === "integer" ? Number(record.entity_id) : record.entity_id;
  const payload = decodePayload(table, record.payload);
  const base = parseSnapshot(record.base_snapshot);
  const cloud = await gateway.fetchRow(table, spec.pk, id);

  if (record.operation_type === "insert") {
    if (cloud) {
      // Idempotency: the row is already there. Identical → this operation
      // simply happened already (a retry after a lost response). Different →
      // someone else owns that id; never overwrite it.
      if (alreadyApplied(cloud, payload)) return { outcome: "synced" };
      const reason = "A different record already exists in the cloud with this id.";
      return {
        outcome: "conflict",
        reason,
        details: conflictDetails({
          reason,
          columns: Object.keys(payload).filter((c) => !sameValue(payload[c], cloud[c])),
          local: payload,
          base,
          cloud,
          detectedAt: at.toISOString(),
        }),
      };
    }
    // The UUID minted locally is the UUID stored in the cloud — never a new one.
    await gateway.insertRow(table, { ...payload, [spec.pk]: id });
    return { outcome: "synced" };
  }

  // update / delete (soft delete is an update of deleted_at)
  const changed = Object.keys(payload);
  if (cloud && alreadyApplied(cloud, payload)) {
    // Already identical in the cloud — a replay, not a change. Idempotent.
    return { outcome: "synced" };
  }
  const decision = detectConflict(cloud, base, changed);
  if (decision.conflict) {
    return {
      outcome: "conflict",
      reason: decision.reason,
      details: conflictDetails({
        reason: decision.reason,
        columns: decision.columns,
        local: payload,
        base,
        cloud,
        detectedAt: at.toISOString(),
      }),
    };
  }

  await gateway.updateRow(table, spec.pk, id, payload);
  return { outcome: "synced" };
}
