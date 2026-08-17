/**
 * Local SQLite database — main-thread client (Phase 2B).
 *
 * The main thread NEVER opens SQLite directly. This module spawns the
 * dedicated SQLite worker (`sqlite.worker.ts`) and talks to it through the
 * typed request/response protocol in `protocol.ts`, which is what makes the
 * OPFS SAH Pool VFS (and therefore real persistence) available.
 *
 * Still inert for the application: no route, hook, or repository reads or
 * writes business data through this module. Supabase remains authoritative.
 */

import type {
  EngineFacts,
  EngineStatus,
  LocalDb,
  LocalStorageMode,
} from "./engine";
import type {
  LocalDbRequest,
  LocalDbResponse,
  MirrorStatus,
  VerifyTableResult,
} from "./protocol";
import type { MirrorColumn, SeedMetaRecord } from "./mirror";
import type { LocalFilter, LocalOrder, SelectSpec } from "./query";
import type { SqliteValue } from "./seed-format";

export type { EngineFacts, EngineStatus, LocalDb, LocalStorageMode };
export { LOCAL_SCHEMA_VERSION, LOCAL_DB_NAME, LOCAL_DB_POOL, PROBE_TABLE } from "./engine";

export type WorkerState = "idle" | "starting" | "running" | "error";

type Transport = {
  post: (req: LocalDbRequest) => void;
  terminate: () => void;
  onMessage: (cb: (res: LocalDbResponse) => void) => void;
};

let transport: Transport | null = null;
let transportKind: "worker" | "inline" | null = null;
let workerState: WorkerState = "idle";
let workerError: string | null = null;
let seq = 0;
const pending = new Map<number, (res: LocalDbResponse) => void>();

/** True in a real browser main thread, where a dedicated Worker is possible. */
function canUseWorker(): boolean {
  return typeof Worker !== "undefined" && typeof window !== "undefined";
}

/** Worker lifecycle facts for diagnostics. */
export function workerStatus(): { state: WorkerState; kind: typeof transportKind; error: string | null } {
  return { state: workerState, kind: transportKind, error: workerError };
}

async function ensureTransport(): Promise<Transport> {
  if (transport) return transport;
  workerState = "starting";
  workerError = null;
  const listeners: ((res: LocalDbResponse) => void)[] = [];

  if (canUseWorker()) {
    const { default: SqliteWorker } = await import("./sqlite.worker?worker");
    const worker = new SqliteWorker();
    worker.onmessage = (event: MessageEvent<LocalDbResponse>) => {
      for (const cb of listeners) cb(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      workerState = "error";
      workerError = event.message || "Worker error";
    };
    transport = {
      post: (req) => worker.postMessage(req),
      terminate: () => worker.terminate(),
      onMessage: (cb) => listeners.push(cb),
    };
    transportKind = "worker";
  } else {
    // Node / SSR test environment: no Worker and no OPFS. Handle requests
    // in-process so unit tests can exercise the same protocol. The engine
    // reports `storage: "memory", persistent: false` there.
    const { handleLocalDbRequest } = await import("./protocol");
    transport = {
      post: (req) => {
        void handleLocalDbRequest(req).then((res) => {
          for (const cb of listeners) cb(res);
        });
      },
      terminate: () => {},
      onMessage: (cb) => listeners.push(cb),
    };
    transportKind = "inline";
  }

  transport.onMessage((res) => {
    if (!res || typeof res.id !== "number") return;
    const resolve = pending.get(res.id);
    if (resolve) {
      pending.delete(res.id);
      resolve(res);
    }
  });
  workerState = "running";
  return transport;
}

type RequestBody = DistributiveOmit<LocalDbRequest, "id">;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

function request(req: RequestBody): Promise<LocalDbResponse> {
  const id = ++seq;
  const full = { ...req, id } as LocalDbRequest;
  return ensureTransport().then(
    (t) =>
      new Promise<LocalDbResponse>((resolve, reject) => {
        pending.set(id, resolve);
        try {
          t.post(full);
        } catch (e) {
          pending.delete(id);
          reject(e);
        }
      }),
  );
}

function unwrap<T>(res: LocalDbResponse): T {
  if (res.ok) return res.result as T;
  const err = new Error(res.error.message);
  err.name = res.error.name;
  throw err;
}

/** Initialize (or reuse) the worker-backed local database. Idempotent. */
export async function initEngine(): Promise<EngineStatus> {
  return unwrap<EngineStatus>(await request({ op: "init" }));
}

/** Diagnostic snapshot from the worker. */
export async function engineStatus(): Promise<EngineStatus> {
  return unwrap<EngineStatus>(await request({ op: "status" }));
}

/** Low-level facts (storage mode, VFS, version) from the worker. */
export async function engineFacts(): Promise<EngineFacts> {
  return unwrap<EngineFacts>(await request({ op: "getFacts" }));
}

/** Diagnostic probe helpers — isolated table, never business data. */
export async function probePersistence(
  mode: "write" | "read" | "clear",
  key: string,
  value?: string,
): Promise<string | null> {
  const res = await request({ op: "probePersistence", mode, key, value });
  return unwrap<{ probe: string | null }>(res).probe;
}

/** Close the SQLite connection and stop the worker. Never deletes OPFS data. */
export async function closeLocalDb(): Promise<void> {
  if (!transport) return;
  try {
    await request({ op: "close" });
  } catch {
    // ignore — we terminate regardless
  }
  transport.terminate();
  transport = null;
  transportKind = null;
  workerState = "idle";
  pending.clear();
}

/* ------------------------------------------------------------------ *
 * Phase 3 — cloud → local seed (typed operations only, no raw SQL).   *
 * ------------------------------------------------------------------ */

/** Mirror table row counts, seed metadata and transaction state. */
export async function mirrorStatus(): Promise<MirrorStatus> {
  return unwrap<MirrorStatus>(await request({ op: "mirrorStatus" }));
}

/** Column list (name / declared type / nullability) of one mirror table. */
export async function mirrorColumns(table: string): Promise<MirrorColumn[]> {
  return unwrap<{ columns: MirrorColumn[] }>(await request({ op: "mirrorColumns", table })).columns;
}

export async function seedBegin(): Promise<void> {
  unwrap(await request({ op: "seedBegin" }));
}

export async function seedInsert(
  table: string,
  columns: string[],
  rows: SqliteValue[][],
): Promise<number> {
  return unwrap<{ inserted: number }>(await request({ op: "seedInsert", table, columns, rows }))
    .inserted;
}

export async function seedCommit(): Promise<void> {
  unwrap(await request({ op: "seedCommit" }));
}

export async function seedRollback(): Promise<void> {
  unwrap(await request({ op: "seedRollback" }));
}

/** Local count + primary keys + deterministic digest for one mirror table. */
export async function verifyTable(table: string, pk: string): Promise<VerifyTableResult> {
  return unwrap<VerifyTableResult>(await request({ op: "verifyTable", table, pk }));
}

export async function writeSeedMeta(meta: SeedMetaRecord): Promise<void> {
  unwrap(await request({ op: "writeSeedMeta", meta }));
}

export type { LocalFilter, LocalOrder, SelectSpec };

/* ------------------------------------------------------------------ *
 * Phase 4 — read-only queries against the seeded mirror.              *
 * ------------------------------------------------------------------ */

/** Runs a declarative SELECT inside the worker. Read-only, parameterized. */
export async function localSelect(spec: SelectSpec): Promise<Record<string, SqliteValue>[]> {
  return unwrap<{ rows: Record<string, SqliteValue>[] }>(await request({ op: "select", spec })).rows;
}

/** Counts matching rows inside the worker. */
export async function localCount(table: string, filter?: LocalFilter): Promise<number> {
  return unwrap<{ count: number }>(await request({ op: "countRows", table, filter })).count;
}

/* ------------------------------------------------------------------ *
 * Phase 5A — escape hatch for the typed mutation ops.                 *
 * Still no raw SQL: the request union itself is the whole vocabulary.  *
 * ------------------------------------------------------------------ */

/** Distributive omit so each member of the request union keeps its own shape. */
export type LocalDbRequestInput = LocalDbRequest extends infer R
  ? R extends { id: number }
    ? Omit<R, "id">
    : never
  : never;

/** Sends one typed protocol request to the worker and unwraps the result. */
export async function requestLocalDb(
  req: LocalDbRequestInput,
): Promise<import("./protocol").LocalDbResult> {
  return unwrap(await request(req as any));
}

/** Test-only alias kept for Phase 2 callers. */
export async function _resetForTests(): Promise<void> {
  if (!transport) return;
  try {
    await request({ op: "resetForTests" });
  } catch {
    // ignore
  }
  transport.terminate();
  transport = null;
  transportKind = null;
  workerState = "idle";
  pending.clear();
}
