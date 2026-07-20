/**
 * Offline write queue.
 *
 * Persists Supabase REST write requests (POST / PATCH / DELETE against
 * /rest/v1/<table>) when the network is unavailable or the fetch fails, and
 * replays them once connectivity returns.
 *
 * The Dexie `outbox` table is reused; we store the raw request as the
 * payload so we can replay it faithfully (URL, headers, body).
 */

import { localDb } from "./db";

export type QueuedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

const listeners = new Set<() => void>();
export function subscribeOutbox(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
}

export async function pendingCount(): Promise<number> {
  try {
    return await localDb().outbox.count();
  } catch {
    return 0;
  }
}

function opFromMethod(m: string): "insert" | "update" | "delete" | "upsert" {
  const method = m.toUpperCase();
  if (method === "PATCH") return "update";
  if (method === "DELETE") return "delete";
  if (method === "POST") return "insert";
  return "update";
}

function tableFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/rest\/v1\/([^/?]+)/);
    return m?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function enqueueRequest(req: QueuedRequest): Promise<number> {
  const table = tableFromUrl(req.url);
  const op = opFromMethod(req.method);
  const id = await localDb().outbox.add({
    table,
    row_id: "", // filled by replayer if response returns id
    op,
    payload: req,
    attempts: 0,
    created_at: new Date().toISOString(),
    next_retry_at: new Date().toISOString(),
  });
  emit();
  return id as number;
}

function backoffMs(attempts: number): number {
  const base = 2000; // 2s
  const cap = 5 * 60 * 1000; // 5m
  return Math.min(cap, base * Math.pow(2, Math.min(attempts, 8)));
}

let flushing = false;
let flushRequested = false;

/**
 * Replay every queued write in insertion order. Stops on the first request
 * that fails with a network error; row-level errors (RLS, validation) are
 * logged and the row is dropped from the queue so it doesn't block others.
 */
export async function flushOutbox(): Promise<{ processed: number; failed: number }> {
  if (typeof window === "undefined") return { processed: 0, failed: 0 };
  if (!navigator.onLine) return { processed: 0, failed: 0 };
  if (flushing) { flushRequested = true; return { processed: 0, failed: 0 }; }
  flushing = true;
  let processed = 0;
  let failed = 0;
  try {
    const now = Date.now();
    const rows = await localDb().outbox.orderBy("id").toArray();
    for (const row of rows) {
      const nextAt = row.next_retry_at ? Date.parse(row.next_retry_at) : 0;
      if (nextAt > now) continue;
      const req = row.payload as QueuedRequest;
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        });
        if (!res.ok) {
          // Distinguish network-ish (5xx) from client-side (4xx).
          if (res.status >= 500) {
            const attempts = (row.attempts ?? 0) + 1;
            await localDb().outbox.update(row.id!, {
              attempts,
              last_error: `HTTP ${res.status}`,
              next_retry_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
            });
            failed++;
            break; // stop; server unhealthy
          }
          // 4xx — request is malformed / rejected. Drop it so it doesn't block.
          const text = await res.text().catch(() => "");
          console.warn(`[outbox] dropping request (HTTP ${res.status}) ${req.method} ${req.url}: ${text.slice(0, 300)}`);
          await localDb().outbox.delete(row.id!);
          failed++;
          continue;
        }
        await localDb().outbox.delete(row.id!);
        processed++;
      } catch (err) {
        // Network error — retry with backoff and stop the loop.
        const attempts = (row.attempts ?? 0) + 1;
        await localDb().outbox.update(row.id!, {
          attempts,
          last_error: (err as Error)?.message ?? String(err),
          next_retry_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
        });
        failed++;
        break;
      }
    }
  } finally {
    flushing = false;
    emit();
    if (flushRequested) {
      flushRequested = false;
      void flushOutbox();
    }
  }
  return { processed, failed };
}

let retryTimer: number | null = null;
export function scheduleOutboxFlush(delayMs = 0) {
  if (typeof window === "undefined") return;
  if (retryTimer) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => { void flushOutbox(); }, delayMs) as unknown as number;
}
