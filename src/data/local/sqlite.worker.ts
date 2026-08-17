/// <reference lib="webworker" />
/**
 * Dedicated SQLite Web Worker.
 *
 * SQLite WASM and the OPFS SAH Pool VFS are initialized here, never on the
 * main thread — `createSyncAccessHandle` (which the SAH Pool needs) is only
 * available in worker contexts, which is why the main thread previously fell
 * back to a non-persistent in-memory database.
 *
 * The worker only answers the narrow protocol in `protocol.ts`.
 */

import { handleLocalDbRequest, type LocalDbRequest } from "./protocol";

self.addEventListener("message", (event: MessageEvent<LocalDbRequest>) => {
  const req = event.data;
  if (!req || typeof req.id !== "number" || typeof req.op !== "string") return;
  void handleLocalDbRequest(req).then((res) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
  });
});

// Announce readiness so the client can distinguish "worker booted" from
// "SQLite initialized".
(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id: -1, op: "ready", ok: true });
