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

import { supabase } from "@/integrations/supabase/client";
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

export function notifyOutboxChanged() { emit(); }

export async function pendingCount(): Promise<number> {
  try {
    return await localDb().outbox.count();
  } catch {
    return 0;
  }
}

function opFromMethod(m: string): "insert" | "update" | "delete" {
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
  // Duplicate protection: for INSERTs, tell PostgREST to upsert on conflict
  // so replaying a write whose row already synced from another device
  // updates the existing row instead of creating a second copy.
  const headers = { ...req.headers };
  if (op === "insert") {
    const existing = headers["Prefer"] ?? headers["prefer"] ?? "";
    const parts = new Set(existing.split(",").map((s) => s.trim()).filter(Boolean));
    parts.add("resolution=merge-duplicates");
    parts.add("return=representation");
    headers["Prefer"] = Array.from(parts).join(",");
    delete headers["prefer"];
  }
  // Best-effort row id extraction from body so status listeners can dedupe.
  let rowId = "";
  try {
    if (req.body) {
      const parsed = JSON.parse(req.body);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      if (first && typeof first === "object" && (first as { id?: string }).id) {
        rowId = String((first as { id: string }).id);
      }
    }
  } catch { /* body may not be JSON */ }
  const id = await localDb().outbox.add({
    table,
    row_id: rowId,
    op,
    payload: { ...req, headers },
    attempts: 0,
    created_at: new Date().toISOString(),
    next_retry_at: new Date().toISOString(),
  });
  emit();
  return id as number;
}

async function withFreshAuthHeaders(headers: Record<string, string>): Promise<Record<string, string>> {
  const next = { ...headers };
  const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  if (publishable && !next.apikey) next.apikey = publishable;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) next.Authorization = `Bearer ${token}`;
  } catch { /* keep queued headers */ }
  return next;
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
          headers: await withFreshAuthHeaders(req.headers),
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
        // Clear the local _dirty flag now that the cloud confirmed the write.
        try {
          if (row.row_id && localDb().tables.some((t) => t.name === row.table)) {
            const tbl = localDb().table(row.table);
            const existing = (await tbl.get(row.row_id)) as Record<string, unknown> | undefined;
            if (existing && existing._dirty === 1) {
              await tbl.put({ ...existing, _dirty: 0, _op: null } as never);
            }
          }
        } catch { /* noop */ }
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
