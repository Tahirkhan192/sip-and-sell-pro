/**
 * Typed request/response protocol between the main thread and the dedicated
 * SQLite worker.
 *
 * Deliberately narrow: there is NO generic `execute(sql)` operation. Only the
 * controlled initialization / diagnostic / seed operations below are reachable
 * from the main thread, so application code cannot run arbitrary SQL against
 * the local database.
 *
 * Phase 3 adds the minimum needed for a transactional cloud → local seed:
 * begin, insert-batch (into a named mirror table only), commit, rollback,
 * verification reads and the seed metadata record.
 */

import {
  closeEngine,
  describeEngine,
  engineFacts,
  openEngine,
  probeClear,
  probeRead,
  probeWrite,
  type EngineFacts,
  type EngineStatus,
} from "./engine";
import {
  mirrorColumns,
  mirrorCounts,
  mirrorDigest,
  mirrorPrimaryKeys,
  mirrorTotalRows,
  readSeedMeta,
  seedBegin,
  seedCommit,
  seedInsert,
  seedRollback,
  seedTxOpen,
  writeSeedMeta,
  type MirrorColumn,
  type SeedMetaRecord,
} from "./mirror";
import { runCount, runSelect, type LocalFilter, type SelectSpec } from "./query";
import type { SqliteValue } from "./seed-format";

export type LocalDbRequest =
  | { id: number; op: "init" }
  | { id: number; op: "status" }
  | { id: number; op: "getFacts" }
  | {
      id: number;
      op: "probePersistence";
      mode: "write" | "read" | "clear";
      key: string;
      value?: string;
    }
  | { id: number; op: "close" }
  /** Test-only: closes the connection. Never deletes the OPFS database file. */
  | { id: number; op: "resetForTests" }
  /* ---- Phase 3: cloud → local seed ---- */
  | { id: number; op: "mirrorStatus" }
  | { id: number; op: "mirrorColumns"; table: string }
  | { id: number; op: "seedBegin" }
  | { id: number; op: "seedInsert"; table: string; columns: string[]; rows: SqliteValue[][] }
  | { id: number; op: "seedCommit" }
  | { id: number; op: "seedRollback" }
  | { id: number; op: "verifyTable"; table: string; pk: string }
  | { id: number; op: "writeSeedMeta"; meta: SeedMetaRecord }
  /* ---- Phase 4: read-only mirror queries (no raw SQL is ever accepted) ---- */
  | { id: number; op: "select"; spec: SelectSpec }
  | { id: number; op: "countRows"; table: string; filter?: LocalFilter };

export type LocalDbOp = LocalDbRequest["op"];

export type LocalDbErrorPayload = { message: string; name: string; stack?: string };

export type MirrorStatus = {
  counts: Record<string, number>;
  totalRows: number;
  seedMeta: SeedMetaRecord | null;
  transactionOpen: boolean;
};

export type VerifyTableResult = {
  table: string;
  count: number;
  digest: string;
  primaryKeys: SqliteValue[];
};

export type LocalDbResponse =
  | { id: number; op: LocalDbOp; ok: true; result: LocalDbResult }
  | { id: number; op: LocalDbOp; ok: false; error: LocalDbErrorPayload };

export type LocalDbResult =
  | EngineStatus
  | EngineFacts
  | { probe: string | null }
  | { closed: true }
  | MirrorStatus
  | { columns: MirrorColumn[] }
  | { inserted: number }
  | { transactionOpen: boolean }
  | VerifyTableResult
  | { written: true }
  | { rows: Record<string, SqliteValue>[] }
  | { count: number };

/**
 * Executes one protocol request. Lives outside the worker file so it can be
 * unit-tested directly (Node has no OPFS, so it exercises the memory
 * fallback path).
 */
export async function handleLocalDbRequest(req: LocalDbRequest): Promise<LocalDbResponse> {
  try {
    switch (req.op) {
      case "init": {
        const db = await openEngine();
        return { id: req.id, op: req.op, ok: true, result: describeEngine(db) };
      }
      case "status": {
        const db = await openEngine();
        return { id: req.id, op: req.op, ok: true, result: describeEngine(db) };
      }
      case "getFacts": {
        return { id: req.id, op: req.op, ok: true, result: engineFacts() };
      }
      case "probePersistence": {
        const db = await openEngine();
        if (req.mode === "write") {
          probeWrite(db, req.key, req.value ?? "");
          return { id: req.id, op: req.op, ok: true, result: { probe: req.value ?? "" } };
        }
        if (req.mode === "clear") {
          probeClear(db, req.key);
          return { id: req.id, op: req.op, ok: true, result: { probe: null } };
        }
        return { id: req.id, op: req.op, ok: true, result: { probe: probeRead(db, req.key) } };
      }
      case "mirrorStatus": {
        const db = await openEngine();
        const result: MirrorStatus = {
          counts: mirrorCounts(db),
          totalRows: mirrorTotalRows(db),
          seedMeta: readSeedMeta(db),
          transactionOpen: seedTxOpen(),
        };
        return { id: req.id, op: req.op, ok: true, result };
      }
      case "mirrorColumns": {
        const db = await openEngine();
        return {
          id: req.id,
          op: req.op,
          ok: true,
          result: { columns: mirrorColumns(db, req.table) },
        };
      }
      case "seedBegin": {
        const db = await openEngine();
        seedBegin(db);
        return { id: req.id, op: req.op, ok: true, result: { transactionOpen: true } };
      }
      case "seedInsert": {
        const db = await openEngine();
        const inserted = seedInsert(db, req.table, req.columns, req.rows);
        return { id: req.id, op: req.op, ok: true, result: { inserted } };
      }
      case "seedCommit": {
        const db = await openEngine();
        seedCommit(db);
        return { id: req.id, op: req.op, ok: true, result: { transactionOpen: false } };
      }
      case "seedRollback": {
        const db = await openEngine();
        seedRollback(db);
        return { id: req.id, op: req.op, ok: true, result: { transactionOpen: false } };
      }
      case "verifyTable": {
        const db = await openEngine();
        const { digest, rows } = await mirrorDigest(db, req.table, req.pk);
        const result: VerifyTableResult = {
          table: req.table,
          count: rows,
          digest,
          primaryKeys: mirrorPrimaryKeys(db, req.table, req.pk),
        };
        return { id: req.id, op: req.op, ok: true, result };
      }
      case "writeSeedMeta": {
        const db = await openEngine();
        writeSeedMeta(db, req.meta);
        return { id: req.id, op: req.op, ok: true, result: { written: true } };
      }
      case "select": {
        const db = await openEngine();
        return {
          id: req.id,
          op: req.op,
          ok: true,
          result: { rows: runSelect(db, req.spec) },
        };
      }
      case "countRows": {
        const db = await openEngine();
        return {
          id: req.id,
          op: req.op,
          ok: true,
          result: { count: runCount(db, req.table, req.filter) },
        };
      }
      case "close":
      case "resetForTests": {
        await closeEngine();
        return { id: req.id, op: req.op, ok: true, result: { closed: true } };
      }
      default: {
        const bad = req as { id: number; op: string };
        return {
          id: bad.id,
          op: bad.op as LocalDbOp,
          ok: false,
          error: { name: "UnknownOperation", message: `Unsupported operation: ${bad.op}` },
        };
      }
    }
  } catch (e: any) {
    return {
      id: req.id,
      op: req.op,
      ok: false,
      error: {
        name: e?.name ?? "Error",
        message: e?.message ?? String(e),
        stack: typeof e?.stack === "string" ? e.stack : undefined,
      },
    };
  }
}
