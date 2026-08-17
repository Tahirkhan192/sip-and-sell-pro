/**
 * PHASE 3 — Supabase Cloud → Local SQLite seed.
 *
 * Direction is one-way only:  Supabase  →  local SQLite (OPFS mirror).
 * There is no local → cloud write, no synchronisation and no conflict
 * resolution here. The application keeps reading and writing Supabase; the
 * `cloud_*` tables are nothing but a verified local copy.
 *
 * Safety rules enforced by this module
 *   * a valid authenticated session is required before AND after the seed —
 *     the seed never uses a service-role key or any server secret, so RLS
 *     applies exactly as it does for the signed-in user;
 *   * persistent OPFS storage is required — it never seeds into memory;
 *   * it refuses to run when local operational data already exists;
 *   * everything happens inside ONE SQLite transaction: either the whole
 *     verified dataset is committed, or the database is left untouched;
 *   * every value is copied verbatim (ids, timestamps, nulls, JSON, arrays,
 *     soft deletes) — no rounding, no recalculation, no id regeneration;
 *   * verification is by count, by primary key and by SHA-256 table digest,
 *     never by `>=`.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  BACKUP_TABLES,
  RLS_LIMITED_TABLES,
  primaryKeyOf,
  redactRow,
} from "@/data/backup/format";
import type { TableName } from "@/data/repo";
import {
  LOCAL_DB_NAME,
  LOCAL_SCHEMA_VERSION,
  engineStatus,
  initEngine,
  mirrorColumns,
  mirrorStatus,
  seedBegin,
  seedCommit,
  seedInsert,
  seedRollback,
  verifyTable,
  writeSeedMeta,
} from "./db";
import type { SeedMetaRecord } from "./mirror";
import {
  canonicalRow,
  comparePk,
  digestRows,
  toSqliteValue,
  type SqliteValue,
} from "./seed-format";
import { isLocalSqliteEnabled } from "./status";

const PAGE = 1000;
const INSERT_BATCH = 500;

export class SeedError extends Error {}

export type SeedPhase =
  | "checking"
  | "seeding"
  | "verifying"
  | "committing"
  | "done"
  | "blocked"
  | "failed";

export type SeedProgress = {
  phase: SeedPhase;
  table: TableName | null;
  tableIndex: number;
  totalTables: number;
  fetched: number;
  inserted: number;
  rowsTotal: number;
  message: string;
};

export type SeedTableResult = {
  table: TableName;
  primaryKey: string;
  cloudCount: number;
  seededCount: number;
  localCount: number;
  cloudDigest: string;
  localDigest: string;
  missingLocal: string[];
  unexpectedLocal: string[];
  duplicateLocal: string[];
  rlsLimited: boolean;
  status: "PASS" | "FAIL";
};

export type SeedReport = {
  status: "verified" | "failed" | "blocked";
  reason: string | null;
  startedAt: string;
  finishedAt: string;
  tables: SeedTableResult[];
  totals: { tables: number; cloudRows: number; seededRows: number; localRows: number };
  rlsLimitedTables: string[];
  overallDigest: string | null;
  meta: SeedMetaRecord | null;
  notes: string[];
};

export type SeedOptions = {
  onProgress?: (p: SeedProgress) => void;
  /** Unit tests only: allows the memory fallback engine. Never used by the UI. */
  allowNonPersistent?: boolean;
};

/* ------------------------------------------------------------------ *
 * Guards                                                              *
 * ------------------------------------------------------------------ */

async function requireSession(phase: "before" | "after") {
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session;
  if (error || !session?.access_token || !session.user?.id) {
    throw new SeedError(
      phase === "before"
        ? "Seed aborted: you are not signed in. Please log in and try again."
        : "Seed aborted: your session ended during the copy. Nothing was written locally.",
    );
  }
  const expiresAt = session.expires_at ? session.expires_at * 1000 : null;
  if (expiresAt && expiresAt <= Date.now()) {
    throw new SeedError("Seed aborted: your session has expired. Please log in again.");
  }
  return session;
}

async function requirePersistentLocalDb(allowNonPersistent: boolean) {
  await initEngine();
  const status = await engineStatus();
  if (status.databaseName !== LOCAL_DB_NAME) {
    throw new SeedError(
      `Seed aborted: unexpected local database identity (${status.databaseName}).`,
    );
  }
  if (status.schemaVersion !== LOCAL_SCHEMA_VERSION) {
    throw new SeedError(
      `Seed aborted: local schema version ${status.schemaVersion} does not match the expected ${LOCAL_SCHEMA_VERSION}.`,
    );
  }
  if (!allowNonPersistent && (!status.persistent || status.storage !== "opfs")) {
    throw new SeedError(
      "Seed aborted: persistent OPFS storage is unavailable in this browser context. Refusing to seed into memory.",
    );
  }
  return status;
}

/* ------------------------------------------------------------------ *
 * Cloud reads (keyset pagination, RLS respected)                      *
 * ------------------------------------------------------------------ */

async function cloudCount(table: TableName): Promise<number> {
  const { count, error } = await (supabase as any)
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new SeedError(`${table}: ${error.message}`);
  if (count === null || count === undefined) {
    throw new SeedError(`${table}: the database did not return a row count.`);
  }
  return count;
}

/** One keyset page: `order(pk) limit(PAGE) [gt(pk, cursor)]`. Never offset. */
async function cloudPage(table: TableName, pk: string, cursor: SqliteValue | null) {
  let q = (supabase as any).from(table).select("*").order(pk, { ascending: true }).limit(PAGE);
  if (cursor !== null) q = q.gt(pk, cursor);
  const { data, error } = await q;
  if (error) throw new SeedError(`${table}: ${error.message}`);
  return (data ?? []) as Record<string, any>[];
}

/* ------------------------------------------------------------------ *
 * Seed                                                                *
 * ------------------------------------------------------------------ */

function blocked(reason: string, notes: string[] = []): SeedReport {
  const now = new Date().toISOString();
  return {
    status: "blocked",
    reason,
    startedAt: now,
    finishedAt: now,
    tables: [],
    totals: { tables: 0, cloudRows: 0, seededRows: 0, localRows: 0 },
    rlsLimitedTables: [...RLS_LIMITED_TABLES],
    overallDigest: null,
    meta: null,
    notes,
  };
}

/**
 * Copies every backup table from Supabase into the local `cloud_*` mirror and
 * verifies the result. Resolves with a report; only `status === "verified"`
 * means the local database was actually written.
 */
export async function seedCloudToLocal(options: SeedOptions = {}): Promise<SeedReport> {
  const { onProgress, allowNonPersistent = false } = options;
  const startedAt = new Date().toISOString();
  const notes: string[] = [];
  const emit = (p: Partial<SeedProgress> & { phase: SeedPhase; message: string }) =>
    onProgress?.({
      table: null,
      tableIndex: 0,
      totalTables: BACKUP_TABLES.length,
      fetched: 0,
      inserted: 0,
      rowsTotal: 0,
      ...p,
    });

  if (!isLocalSqliteEnabled()) {
    return blocked("Local SQLite is disabled (VITE_ENABLE_LOCAL_SQLITE is not \"true\").");
  }

  emit({ phase: "checking", message: "Checking session and local database…" });

  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession("before");
    await requirePersistentLocalDb(allowNonPersistent);
  } catch (e: any) {
    return blocked(e?.message ?? String(e));
  }

  // Idempotency guard: never silently overwrite existing local data.
  const before = await mirrorStatus();
  if (before.totalRows > 0) {
    const populated = Object.entries(before.counts)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}: ${n}`);
    return blocked("Local database already contains operational data. No seed performed.", [
      `Local rows: ${before.totalRows.toLocaleString()}`,
      ...populated,
    ]);
  }
  if (before.transactionOpen) {
    return blocked("Local database has an unfinished seed transaction open. No seed performed.");
  }

  const results: SeedTableResult[] = [];
  const cloudDigests = new Map<TableName, { digest: string; pks: SqliteValue[] }>();
  let rowsTotal = 0;

  await seedBegin();
  try {
    for (let i = 0; i < BACKUP_TABLES.length; i++) {
      const table = BACKUP_TABLES[i];
      const pk = primaryKeyOf(table);
      const columns = await mirrorColumns(table);
      if (columns.length === 0) {
        throw new SeedError(`${table}: no local mirror table (cloud_${table}) exists.`);
      }
      const colNames = columns.map((c) => c.name);
      const typeByName = new Map(columns.map((c) => [c.name, c.declType] as const));

      emit({
        phase: "seeding",
        table,
        tableIndex: i + 1,
        rowsTotal,
        message: `Table: ${table} (${i + 1} of ${BACKUP_TABLES.length})`,
      });

      const expected = await cloudCount(table);
      let fetched = 0;
      let inserted = 0;
      let cursor: SqliteValue | null = null;
      const seenPks = new Set<string>();
      const rowLines: { pk: SqliteValue; line: string }[] = [];
      let batch: SqliteValue[][] = [];

      for (;;) {
        const page = await cloudPage(table, pk, cursor);
        for (const raw of page) {
          const keyValue = raw[pk];
          if (keyValue === undefined || keyValue === null) {
            throw new SeedError(`${table}: a row has no ${pk} — cannot page safely.`);
          }
          if (seenPks.has(String(keyValue))) continue; // defensive, never duplicate
          seenPks.add(String(keyValue));

          const row = redactRow(table, raw);
          const values: SqliteValue[] = colNames.map((c) =>
            toSqliteValue(row[c], typeByName.get(c)),
          );
          const asObject: Record<string, unknown> = {};
          colNames.forEach((c, idx) => (asObject[c] = values[idx]));
          const pkValue = asObject[pk] as SqliteValue;
          rowLines.push({ pk: pkValue, line: `${String(pkValue)}\t${canonicalRow(colNames, asObject)}` });

          batch.push(values);
          fetched++;
          if (batch.length >= INSERT_BATCH) {
            inserted += await seedInsert(table, colNames, batch);
            batch = [];
          }
        }
        emit({
          phase: "seeding",
          table,
          tableIndex: i + 1,
          fetched,
          inserted,
          rowsTotal: rowsTotal + fetched,
          message: `Table: ${table} — fetched ${fetched.toLocaleString()}`,
        });
        if (page.length < PAGE) break;
        cursor = page[page.length - 1][pk] as SqliteValue;
      }
      if (batch.length) {
        inserted += await seedInsert(table, colNames, batch);
        batch = [];
      }

      const after = await cloudCount(table);
      if (expected !== fetched || fetched !== after || fetched !== inserted) {
        throw new SeedError(
          `${table}: count verification failed (cloud before: ${expected}, fetched: ${fetched}, inserted: ${inserted}, cloud after: ${after}).`,
        );
      }

      rowLines.sort((a, b) => comparePk(a.pk, b.pk));
      cloudDigests.set(table, {
        digest: await digestRows(rowLines.map((r) => r.line)),
        pks: rowLines.map((r) => r.pk),
      });
      rowsTotal += fetched;

      results.push({
        table,
        primaryKey: pk,
        cloudCount: expected,
        seededCount: inserted,
        localCount: 0,
        cloudDigest: cloudDigests.get(table)!.digest,
        localDigest: "",
        missingLocal: [],
        unexpectedLocal: [],
        duplicateLocal: [],
        rlsLimited: RLS_LIMITED_TABLES.includes(table),
        status: "FAIL",
      });
    }

    // The session must still be valid: an expired one would have produced
    // RLS-filtered (possibly empty) pages without ever raising an error.
    await requireSession("after");

    if (rowsTotal === 0) {
      throw new SeedError(
        "Seed aborted: every cloud table came back empty. This usually means the session is not authorised.",
      );
    }

    /* ---- row-level verification, still inside the transaction ---- */
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      emit({
        phase: "verifying",
        table: r.table,
        tableIndex: i + 1,
        rowsTotal,
        message: `Verifying ${r.table} (${i + 1} of ${results.length})`,
      });
      const local = await verifyTable(r.table, r.primaryKey);
      const cloud = cloudDigests.get(r.table)!;

      const cloudSet = new Set(cloud.pks.map(String));
      const localList = local.primaryKeys.map(String);
      const localSet = new Set(localList);
      const duplicates = localList.filter((v, idx) => localList.indexOf(v) !== idx);
      const missing = cloud.pks.map(String).filter((k) => !localSet.has(k));
      const unexpected = localList.filter((k) => !cloudSet.has(k));

      r.localCount = local.count;
      r.localDigest = local.digest;
      r.missingLocal = missing.slice(0, 5);
      r.unexpectedLocal = unexpected.slice(0, 5);
      r.duplicateLocal = duplicates.slice(0, 5);
      r.status =
        r.cloudCount === r.seededCount &&
        r.cloudCount === r.localCount &&
        missing.length === 0 &&
        unexpected.length === 0 &&
        duplicates.length === 0 &&
        r.cloudDigest === r.localDigest
          ? "PASS"
          : "FAIL";

      if (r.status === "FAIL") {
        throw new SeedError(
          `${r.table}: verification failed — cloud rows ${r.cloudCount}, local rows ${r.localCount}, ` +
            `cloud digest ${r.cloudDigest.slice(0, 12)}…, local digest ${r.localDigest.slice(0, 12)}…` +
            (missing.length ? `, missing ids: ${missing.slice(0, 3).join(", ")}` : "") +
            (unexpected.length ? `, unexpected ids: ${unexpected.slice(0, 3).join(", ")}` : "") +
            (duplicates.length ? `, duplicate ids: ${duplicates.slice(0, 3).join(", ")}` : ""),
        );
      }
    }

    const overallDigest = await digestRows(
      results.map((r) => `${r.table}\t${r.cloudCount}\t${r.cloudDigest}`),
    );

    emit({ phase: "committing", rowsTotal, message: "Committing verified local database…" });
    await seedCommit();

    const meta: SeedMetaRecord = {
      status: "verified",
      seededAt: new Date().toISOString(),
      authUserId: session.user.id,
      source: "supabase",
      tables: results.length,
      rows: rowsTotal,
      schemaVersion: LOCAL_SCHEMA_VERSION,
      verification: "passed",
      overallDigest,
      rlsLimitedTables: [...RLS_LIMITED_TABLES],
    };
    await writeSeedMeta(meta);

    const post = await mirrorStatus();
    if (post.totalRows !== rowsTotal) {
      throw new SeedError(
        `Post-commit verification failed: local rows ${post.totalRows} ≠ seeded rows ${rowsTotal}.`,
      );
    }
    if (!post.seedMeta || post.seedMeta.status !== "verified") {
      throw new SeedError("Seed metadata could not be written — not reporting success.");
    }

    for (const t of RLS_LIMITED_TABLES) {
      notes.push(
        `${t}: row-level security limits this table to rows visible to the signed-in user — the local copy is NOT a complete copy of ${t}.`,
      );
    }
    notes.push(
      "Cloud counts were read with the same authenticated (RLS-scoped) client that read the rows, so counts compare visible rows to visible rows.",
    );

    return {
      status: "verified",
      reason: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      tables: results,
      totals: {
        tables: results.length,
        cloudRows: results.reduce((a, r) => a + r.cloudCount, 0),
        seededRows: results.reduce((a, r) => a + r.seededCount, 0),
        localRows: results.reduce((a, r) => a + r.localCount, 0),
      },
      rlsLimitedTables: [...RLS_LIMITED_TABLES],
      overallDigest,
      meta,
      notes,
    };
  } catch (e: any) {
    try {
      await seedRollback();
    } catch (rollbackError: any) {
      notes.push(`Rollback failed: ${rollbackError?.message ?? String(rollbackError)}`);
    }
    emit({ phase: "failed", message: e?.message ?? String(e) });
    return {
      status: "failed",
      reason: e?.message ?? String(e),
      startedAt,
      finishedAt: new Date().toISOString(),
      tables: results,
      totals: {
        tables: results.length,
        cloudRows: results.reduce((a, r) => a + r.cloudCount, 0),
        seededRows: results.reduce((a, r) => a + r.seededCount, 0),
        localRows: 0,
      },
      rlsLimitedTables: [...RLS_LIMITED_TABLES],
      overallDigest: null,
      meta: null,
      notes,
    };
  }
}

/** Current seed state for the diagnostics UI (no cloud calls). */
export async function getSeedStatus(): Promise<{
  enabled: boolean;
  localRows: number;
  counts: Record<string, number>;
  meta: SeedMetaRecord | null;
  transactionOpen: boolean;
}> {
  if (!isLocalSqliteEnabled()) {
    return { enabled: false, localRows: 0, counts: {}, meta: null, transactionOpen: false };
  }
  const s = await mirrorStatus();
  return {
    enabled: true,
    localRows: s.totalRows,
    counts: s.counts,
    meta: s.seedMeta,
    transactionOpen: s.transactionOpen,
  };
}
