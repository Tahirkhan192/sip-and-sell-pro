/**
 * Typed request/response protocol between the main thread and the dedicated
 * SQLite worker.
 *
 * Deliberately narrow: there is NO generic `execute(sql)` operation. Only the
 * controlled initialization/diagnostic operations below are reachable from the
 * main thread, so application code cannot run arbitrary SQL against the local
 * database in this phase.
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
  | { id: number; op: "resetForTests" };

export type LocalDbOp = LocalDbRequest["op"];

export type LocalDbErrorPayload = { message: string; name: string; stack?: string };

export type LocalDbResponse =
  | { id: number; op: LocalDbOp; ok: true; result: LocalDbResult }
  | { id: number; op: LocalDbOp; ok: false; error: LocalDbErrorPayload };

export type LocalDbResult =
  | EngineStatus
  | EngineFacts
  | { probe: string | null }
  | { closed: true };

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
