/**
 * Global fetch interceptor that makes Supabase REST writes offline-safe.
 *
 * Behaviour:
 *   - Only touches requests targeting the current project's `/rest/v1/<table>`
 *     endpoints with a write method (POST / PATCH / DELETE / PUT).
 *   - RPC calls (/rest/v1/rpc/*), auth, storage, and reads pass through
 *     untouched — they still require connectivity.
 *   - When `navigator.onLine === false`, the request is enqueued in the local
 *     outbox and a synthetic 202 response is returned so the caller does not
 *     see an error.
 *   - When online and the fetch fails with a network error (TypeError),
 *     the request is enqueued and the caller sees success. HTTP errors
 *     (4xx / 5xx) pass through so RLS / validation still surface to the UI.
 *   - Successful writes and enqueued writes both mirror into IndexedDB so the
 *     local database stays consistent for offline reads.
 *
 * Installed once at boot from `PwaBootstrap`.
 */

import { localDb } from "./db";
import { enqueueRequest, scheduleOutboxFlush } from "./outbox";

let installed = false;

function isRestWrite(url: string, method: string): { table: string } | null {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://x");
    // Must be a Supabase REST endpoint.
    const m = u.pathname.match(/\/rest\/v1\/([^/?]+)$/);
    if (!m) return null;
    const table = m[1];
    if (table === "rpc") return null;
    const write = ["POST", "PATCH", "DELETE", "PUT"].includes(method.toUpperCase());
    if (!write) return null;
    return { table };
  } catch {
    return null;
  }
}

async function headersToObject(input: HeadersInit | undefined, base?: Headers): Promise<Record<string, string>> {
  const h = new Headers(base);
  if (input) {
    new Headers(input).forEach((v, k) => h.set(k, v));
  }
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

async function mirrorToLocal(table: string, method: string, body: string | null, url: string) {
  if (!body) return;
  try {
    const parsed = JSON.parse(body);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const dexie = localDb();
    if (!dexie.tables.some((t) => t.name === table)) return;
    if (method.toUpperCase() === "DELETE") {
      // Body may be empty on delete; URL carries the filter — skip local mirror.
      return;
    }
    // PATCH filters live in the URL; without ids in body we can't safely mirror.
    // Try to grab id from url query (eq.id=...).
    if (method.toUpperCase() === "PATCH") {
      const idMatch = new URL(url).searchParams.get("id");
      if (idMatch && idMatch.startsWith("eq.")) {
        const id = idMatch.slice(3);
        await dexie.table(table).update(id, { ...parsed, _dirty: 1 }).catch(() => {});
      }
      return;
    }
    // INSERT — bulk put, tag dirty.
    const now = new Date().toISOString();
    const withMeta = rows
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ updated_at: now, ...r, _dirty: 1 }));
    if (withMeta.length && withMeta.every((r) => r.id)) {
      await dexie.table(table).bulkPut(withMeta as never).catch(() => {});
    }
  } catch {
    // Body wasn't JSON or table not present — skip mirror.
  }
}

function syntheticAccepted(): Response {
  return new Response(JSON.stringify([]), {
    status: 202,
    statusText: "Accepted (queued offline)",
    headers: { "Content-Type": "application/json", "x-offline-queued": "1" },
  });
}

export function installOfflineFetchInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: string;
    let method: string;
    let headers: Record<string, string>;
    let body: string | null;
    let baseHeaders: Headers | undefined;

    if (input instanceof Request) {
      url = input.url;
      method = init?.method ?? input.method;
      baseHeaders = new Headers(input.headers);
      body = init?.body != null ? String(init.body) : await input.clone().text().catch(() => null);
    } else {
      url = typeof input === "string" ? input : input.toString();
      method = init?.method ?? "GET";
      body = init?.body != null ? String(init.body) : null;
    }
    headers = await headersToObject(init?.headers, baseHeaders);

    const target = isRestWrite(url, method);
    if (!target) return original(input as never, init);

    const runOriginal = () => original(input as never, init);

    // Fully offline — enqueue immediately.
    if (!navigator.onLine) {
      try {
        await enqueueRequest({ url, method, headers, body });
        await mirrorToLocal(target.table, method, body, url);
      } catch (err) {
        console.warn("[offline] failed to enqueue write", err);
      }
      return syntheticAccepted();
    }

    // Online — try the network first.
    try {
      const res = await runOriginal();
      // Success — mirror the write locally so reads stay fresh.
      if (res.ok) {
        try {
          const cloned = res.clone();
          // If server returned representation, prefer that; otherwise mirror request body.
          const returned = await cloned.text();
          if (returned && returned.length > 2) {
            try {
              const parsed = JSON.parse(returned);
              const rows = Array.isArray(parsed) ? parsed : [parsed];
              if (rows.length && rows.every((r: unknown) => r && typeof r === "object" && (r as { id?: string }).id)) {
                await localDb().table(target.table).bulkPut(rows as never).catch(() => {});
              } else {
                await mirrorToLocal(target.table, method, body, url);
              }
            } catch {
              await mirrorToLocal(target.table, method, body, url);
            }
          } else {
            await mirrorToLocal(target.table, method, body, url);
          }
        } catch {
          /* ignore mirror failure */
        }
      }
      return res;
    } catch (err) {
      // Network-level failure — queue it.
      try {
        await enqueueRequest({ url, method, headers, body });
        await mirrorToLocal(target.table, method, body, url);
        scheduleOutboxFlush(2000);
      } catch (qErr) {
        console.warn("[offline] failed to enqueue write after fetch error", qErr);
        throw err;
      }
      return syntheticAccepted();
    }
  };
}
