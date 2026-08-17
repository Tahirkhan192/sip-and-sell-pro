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
  LocalStorageMode,
} from "./engine";
import type { LocalDbRequest, LocalDbResponse } from "./protocol";

export type { EngineFacts, EngineStatus, LocalStorageMode };
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

function request(req: Omit<LocalDbRequest, "id"> & { id?: number }): Promise<LocalDbResponse> {
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
