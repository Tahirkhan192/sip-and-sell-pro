/**
 * PHASE 9 — post-synchronization integrity verification.
 *
 * Answers one question with evidence: "after syncing, is the local database
 * still internally consistent, and does it agree with the cloud?"
 *
 * It is read-only. It never repairs, deletes or rewrites anything — a problem
 * is reported so a human decides, exactly like a conflict.
 */

import { requestLocalDb } from "@/data/local/db";
import { MASTER_TABLES, tableSpec, type MasterTable } from "@/data/local/mutations/master-tables";
import type { OutboxRow } from "@/data/local/mutations/outbox-schema";
import { listOutbox } from "./outbox";
import { supabaseGateway, type CloudGateway } from "./sync-protocol";
import { sameValue } from "./conflicts";

export type IntegrityIssue = {
  check:
    | "pk-uniqueness"
    | "fk-integrity"
    | "orphan-outbox"
    | "stuck-syncing"
    | "duplicate-rows"
    | "parity";
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

async function select(sql: string, bind: unknown[] = []): Promise<Record<string, unknown>[]> {
  const res = await requestLocalDb({ op: "query", sql, bind } as never);
  return ((res as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}

/** Duplicate primary keys inside the local mirror of a synchronized table. */
async function checkPrimaryKeys(table: MasterTable): Promise<IntegrityIssue[]> {
  const pk = tableSpec(table).pk;
  try {
    const rows = await select(
      `SELECT ${pk} AS id, COUNT(*) AS n FROM ${table} GROUP BY ${pk} HAVING n > 1 LIMIT 20`,
    );
    if (rows.length === 0) return [];
    return [
      {
        check: "pk-uniqueness",
        entity: table,
        detail: `${rows.length} duplicate id(s) found locally.`,
        ids: rows.map((r) => String(r.id)),
      },
    ];
  } catch {
    // The table may not exist on this device yet (nothing seeded) — not an issue.
    return [];
  }
}

/** SQLite's own foreign-key audit across the whole local database. */
async function checkForeignKeys(): Promise<IntegrityIssue[]> {
  try {
    const rows = await select("PRAGMA foreign_key_check");
    if (rows.length === 0) return [];
    return [
      {
        check: "fk-integrity",
        entity: String(rows[0]["table"] ?? "local database"),
        detail: `${rows.length} foreign-key violation(s) in the local database.`,
      },
    ];
  } catch {
    return [];
  }
}

/** Outbox records that point at an entity the local database no longer has. */
async function checkOrphanOutbox(records: OutboxRow[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const live = records.filter((r) => r.status !== "synced");
  for (const record of live) {
    if (record.operation_type === "delete") continue;
    const spec = (() => {
      try {
        return tableSpec(record.entity as MasterTable);
      } catch {
        return null;
      }
    })();
    if (!spec) {
      issues.push({
        check: "orphan-outbox",
        entity: record.entity,
        detail: "Queued change refers to a table this device cannot synchronize.",
        ids: [record.id],
      });
      continue;
    }
    try {
      const rows = await select(
        `SELECT ${spec.pk} AS id FROM ${record.entity} WHERE ${spec.pk} = ? LIMIT 1`,
        [record.entity_id],
      );
      if (rows.length === 0) {
        issues.push({
          check: "orphan-outbox",
          entity: record.entity,
          detail: "Queued change has no matching local row.",
          ids: [record.id],
        });
      }
    } catch {
      /* table missing locally — covered by the seed health check */
    }
  }
  return issues;
}

/** Records left mid-flight: they must have been recovered, never left hanging. */
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

/**
 * Parity: for every entity that this device successfully synchronized, the
 * cloud row must now carry the values that were uploaded.
 */
async function checkParity(
  records: OutboxRow[],
  gateway: CloudGateway,
  limit: number,
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
      continue; // transport problem is not a parity problem
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
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(record.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const drifted = Object.keys(payload).filter(
      (column) => column in cloud! && !sameValue(payload[column], cloud![column]),
    );
    // Drift here is normal when a LATER change (local or remote) touched the
    // row; only flag it when this is the newest known change for that entity.
    const newer = records.some(
      (r) =>
        r.entity === record.entity &&
        r.entity_id === record.entity_id &&
        Number(r.seq ?? 0) > Number(record.seq ?? 0),
    );
    if (drifted.length > 0 && !newer) {
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
  issues.push(...(await checkOrphanOutbox(records)));
  issues.push(...(await checkForeignKeys()));

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
