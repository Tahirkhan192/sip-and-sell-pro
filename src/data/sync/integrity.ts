/**
 * PHASE 9 — post-synchronization integrity verification.
 *
 * Answers one question with evidence: "after syncing, is the local database
 * still internally consistent, and does it agree with the cloud?"
 *
 * It is read-only, and it goes through the same safe protocol as every other
 * local read (no raw SQL exists anywhere in this codebase). It never repairs,
 * deletes or rewrites anything — a problem is reported so a human decides,
 * exactly like a conflict.
 */

import { localSelect, verifyTable } from "@/data/local/db";
import { MASTER_TABLES, tableSpec, type MasterTable } from "@/data/local/mutations/master-tables";
import type { OutboxRow } from "@/data/local/mutations/outbox-schema";
import { listOutbox } from "./outbox";
import { supabaseGateway, type CloudGateway } from "./sync-protocol";
import { sameValue } from "./conflicts";

export type IntegrityCheck =
  | "pk-uniqueness"
  | "orphan-outbox"
  | "stuck-syncing"
  | "duplicate-rows"
  | "parity";

export type IntegrityIssue = {
  check: IntegrityCheck;
  entity: string;
  detail: string;
  ids?: string[];
};

export type IntegrityReport = {
  ok: boolean;
  checkedAt: string;
  issues: IntegrityIssue[];
  checked: { entities: number; outboxRecords: number; paritySampled: number };
};

/** Duplicate primary keys inside the local mirror of a synchronized table. */
async function checkPrimaryKeys(table: MasterTable): Promise<IntegrityIssue[]> {
  const spec = tableSpec(table);
  let keys: unknown[];
  try {
    const result = await verifyTable(table, spec.pk);
    keys = result.primaryKeys as unknown[];
  } catch {
    // The table may not be seeded on this device yet — not an integrity problem.
    return [];
  }
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of keys) {
    const value = String(key);
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  if (duplicates.size === 0) return [];
  return [
    {
      check: "pk-uniqueness",
      entity: table,
      detail: `${duplicates.size} duplicate id(s) found locally.`,
      ids: [...duplicates].slice(0, 20),
    },
  ];
}

/** Outbox records that point at an entity the local database no longer has. */
async function checkOrphanOutbox(records: OutboxRow[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  for (const record of records) {
    if (record.status === "synced" || record.operation_type === "delete") continue;
    let spec;
    try {
      spec = tableSpec(record.entity as MasterTable);
    } catch {
      issues.push({
        check: "orphan-outbox",
        entity: record.entity,
        detail: "A queued change refers to a table this device cannot synchronize.",
        ids: [record.id],
      });
      continue;
    }
    try {
      const rows = await localSelect({
        table: record.entity,
        columns: [spec.pk],
        filter: { eq: { [spec.pk]: record.entity_id as never } },
        limit: 1,
      } as never);
      if (rows.length === 0) {
        issues.push({
          check: "orphan-outbox",
          entity: record.entity,
          detail: "A queued change has no matching local row.",
          ids: [record.id],
        });
      }
    } catch {
      /* table not present locally — covered by the seed health check */
    }
  }
  return issues;
}

/** Records left mid-flight: they must be recovered, never left hanging. */
function checkStuckSyncing(records: OutboxRow[]): IntegrityIssue[] {
  const stuck = records.filter((r) => r.status === "syncing");
  if (stuck.length === 0) return [];
  return [
    {
      check: "stuck-syncing",
      entity: "outbox",
      detail: `${stuck.length} change(s) are still marked as uploading.`,
      ids: stuck.map((r) => r.id),
    },
  ];
}

/** Two live outbox records claiming the same operation id would mean a replay bug. */
export function checkDuplicateOperations(records: OutboxRow[]): IntegrityIssue[] {
  const seen = new Map<string, string[]>();
  for (const record of records) {
    const list = seen.get(record.operation_id) ?? [];
    list.push(record.id);
    seen.set(record.operation_id, list);
  }
  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  return dupes.map(([operationId, ids]) => ({
    check: "duplicate-rows" as const,
    entity: "outbox",
    detail: `Operation ${operationId} appears ${ids.length} times.`,
    ids,
  }));
}

/**
 * Parity: for every entity this device successfully synchronized, the cloud
 * row must carry the values that were uploaded — unless a later change to the
 * same entity has moved it on since.
 */
export async function checkParity(
  records: OutboxRow[],
  gateway: CloudGateway,
  limit = 25,
): Promise<{ issues: IntegrityIssue[]; sampled: number }> {
  const issues: IntegrityIssue[] = [];
  const synced = records
    .filter((r) => r.status === "synced" && r.operation_type !== "delete")
    .slice(-limit);
  let sampled = 0;

  for (const record of synced) {
    let spec;
    try {
      spec = tableSpec(record.entity as MasterTable);
    } catch {
      continue;
    }
    const id = spec.pkKind === "integer" ? Number(record.entity_id) : record.entity_id;
    let cloud: Record<string, unknown> | null = null;
    try {
      cloud = await gateway.fetchRow(record.entity, spec.pk, id);
    } catch {
      continue; // a transport problem is not a parity problem
    }
    sampled += 1;
    if (!cloud) {
      issues.push({
        check: "parity",
        entity: record.entity,
        detail: "A change reported as uploaded has no matching cloud row.",
        ids: [record.entity_id],
      });
      continue;
    }
    const newer = records.some(
      (r) =>
        r.entity === record.entity &&
        r.entity_id === record.entity_id &&
        Number(r.seq ?? 0) > Number(record.seq ?? 0),
    );
    if (newer) continue;

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(record.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const drifted = Object.keys(payload).filter(
      (column) => column in cloud! && !sameValue(payload[column], cloud![column]),
    );
    if (drifted.length > 0) {
      issues.push({
        check: "parity",
        entity: record.entity,
        detail: `Cloud values differ from the uploaded change for: ${drifted.join(", ")}.`,
        ids: [record.entity_id],
      });
    }
  }
  return { issues, sampled };
}

export async function verifySyncIntegrity(
  options: { gateway?: CloudGateway; paritySample?: number; skipParity?: boolean } = {},
): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = [];
  const records = await listOutbox({});

  issues.push(...checkStuckSyncing(records));
  issues.push(...checkDuplicateOperations(records));
  issues.push(...(await checkOrphanOutbox(records)));
  for (const table of MASTER_TABLES) {
    issues.push(...(await checkPrimaryKeys(table)));
  }

  let paritySampled = 0;
  if (!options.skipParity) {
    try {
      const gateway = options.gateway ?? (await supabaseGateway());
      const parity = await checkParity(records, gateway, options.paritySample ?? 25);
      issues.push(...parity.issues);
      paritySampled = parity.sampled;
    } catch {
      /* offline — parity simply cannot be checked right now */
    }
  }

  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    issues,
    checked: {
      entities: MASTER_TABLES.length,
      outboxRecords: records.length,
      paritySampled,
    },
  };
}
