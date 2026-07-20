/**
 * Local-first fetch interceptor for Supabase REST writes.
 *
 * Behaviour (applies to POST / PATCH / DELETE / PUT against `/rest/v1/<table>`):
 *   1. The request NEVER awaits the network.
 *   2. The write is applied to IndexedDB immediately so Dashboard, Reports,
 *      Stock, COGS, customer balances, pending payments all see it.
 *   3. The request is queued in the outbox and flushed to Lovable Cloud in
 *      the background. Same UUID is preserved on both sides.
 *   4. A synthetic 200/201 response is returned to the caller, populated
 *      with the mirrored row(s) so `.select().single()` still resolves.
 *
 * RPC calls (/rest/v1/rpc/*), auth, storage, and reads pass through
 * unchanged. Reads always come from IndexedDB via the repo layer.
 *
 * Installed once at boot from `PwaBootstrap`.
 */

import { localDb } from "./db";
import { enqueueRequest, scheduleOutboxFlush } from "./outbox";
import { runLocalTriggers } from "./local-triggers";
import { serveLocalRead } from "./local-read";
import { isKnownLocalRpc, serveLocalRpc } from "./local-rpcs";

function rpcNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://x");
    const m = u.pathname.match(/\/rest\/v1\/rpc\/([^/?]+)$/);
    return m ? m[1] : null;
  } catch { return null; }
}

let installed = false;

type WriteTarget = { table: string; op: "insert" | "update" | "delete" | "upsert" };

function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRestWrite(url: string, method: string): WriteTarget | null {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://x");
    const m = u.pathname.match(/\/rest\/v1\/([^/?]+)$/);
    if (!m) return null;
    const table = m[1];
    if (table === "rpc") return null;
    const M = method.toUpperCase();
    if (M === "POST") {
      // POST with on_conflict acts as UPSERT in PostgREST.
      return { table, op: u.searchParams.get("on_conflict") ? "upsert" : "insert" };
    }
    if (M === "PATCH" || M === "PUT") return { table, op: "update" };
    if (M === "DELETE") return { table, op: "delete" };
    return null;
  } catch {
    return null;
  }
}

async function headersToObject(input: HeadersInit | undefined, base?: Headers): Promise<Record<string, string>> {
  const h = new Headers(base);
  if (input) new Headers(input).forEach((v, k) => h.set(k, v));
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k] = v; });
  return out;
}

/** Parse ?col=eq.value&other=eq.foo into a plain filter object. Only eq filters supported. */
function parseEqFilters(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const u = new URL(url);
    u.searchParams.forEach((v, k) => {
      if (k === "select" || k === "on_conflict" || k === "order" || k === "limit" || k === "offset") return;
      if (v.startsWith("eq.")) out[k] = v.slice(3);
    });
  } catch { /* noop */ }
  return out;
}

function matchesFilters(row: Record<string, unknown>, filters: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(filters)) {
    if (String(row?.[k] ?? "") !== v) return false;
  }
  return true;
}

type ApplyResult = {
  /** Rows AFTER the mutation, used for the synthetic response. */
  after: Array<Record<string, unknown>>;
  /** Rows BEFORE the mutation, used by local triggers to compute deltas. */
  before: Array<Record<string, unknown> | null>;
};

/**
 * Apply the write to IndexedDB. Returns the resulting rows (for synthetic
 * response) and the previous state (for triggers). If the table isn't
 * mirrored locally, returns null so callers fall back to the network.
 */
async function applyLocal(
  target: WriteTarget,
  bodyText: string | null,
  url: string,
): Promise<ApplyResult | null> {
  const dexie = localDb();
  if (!dexie.tables.some((t) => t.name === target.table)) return null;
  const tbl = dexie.table(target.table);
  const nowIso = new Date().toISOString();

  if (target.op === "delete") {
    const filters = parseEqFilters(url);
    if (!Object.keys(filters).length) return { after: [], before: [] };
    if (filters.id && Object.keys(filters).length === 1) {
      const existing = (await tbl.get(filters.id)) as Record<string, unknown> | undefined;
      await tbl.delete(filters.id).catch(() => {});
      return { after: [{ id: filters.id }], before: [existing ?? null] };
    }
    const all = (await tbl.toArray()) as Array<Record<string, unknown>>;
    const toDelete = all.filter((r) => matchesFilters(r, filters));
    if (toDelete.length) {
      await tbl.bulkDelete(toDelete.map((r) => String(r.id))).catch(() => {});
    }
    return {
      after: toDelete.map((r) => ({ id: r.id })),
      before: toDelete.map((r) => r),
    };
  }

  if (!bodyText) return { after: [], before: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(bodyText); } catch { return { after: [], before: [] }; }
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );

  if (target.op === "insert" || target.op === "upsert") {
    const after: Array<Record<string, unknown>> = [];
    const before: Array<Record<string, unknown> | null> = [];
    for (const r of rows) {
      const id = String((r.id as string | undefined) ?? "") || newUuid();
      const prior = (await tbl.get(id)) as Record<string, unknown> | undefined;
      const merged: Record<string, unknown> = {
        created_at: nowIso,
        updated_at: nowIso,
        ...r,
        id,
        _dirty: 1,
        _op: target.op === "upsert" ? "update" : "insert",
      };
      await tbl.put(merged as never).catch(() => {});
      after.push(merged);
      before.push(prior ?? null);
    }
    return { after, before };
  }

  // update: PATCH with URL filters carrying id(s).
  const filters = parseEqFilters(url);
  const patch = rows[0] ?? {};
  const patchWithMeta = { ...patch, updated_at: nowIso, _dirty: 1, _op: "update" as const };

  if (filters.id && Object.keys(filters).length === 1) {
    const existing = (await tbl.get(filters.id)) as Record<string, unknown> | undefined;
    const merged = { ...(existing ?? { id: filters.id }), ...patchWithMeta, id: filters.id };
    await tbl.put(merged as never).catch(() => {});
    return { after: [merged], before: [existing ?? null] };
  }
  const all = (await tbl.toArray()) as Array<Record<string, unknown>>;
  const matched = all.filter((r) => matchesFilters(r, filters));
  const merged: Array<Record<string, unknown>> = [];
  const priors: Array<Record<string, unknown> | null> = [];
  for (const row of matched) {
    priors.push({ ...row });
    merged.push({ ...row, ...patchWithMeta, id: row.id });
  }
  if (merged.length) await tbl.bulkPut(merged as never).catch(() => {});
  return { after: merged, before: priors };
}

/** Rewrite the outgoing body so any client-generated ids are also sent to the cloud. */
function bodyWithMirroredIds(
  originalBody: string | null,
  mirrored: Array<Record<string, unknown>> | null,
  op: WriteTarget["op"],
): string | null {
  if (!originalBody || !mirrored || mirrored.length === 0) return originalBody;
  if (op !== "insert" && op !== "upsert") return originalBody;
  try {
    const parsed = JSON.parse(originalBody);
    const wasArray = Array.isArray(parsed);
    const rows = wasArray ? parsed : [parsed];
    const withIds = rows.map((r: Record<string, unknown>, idx: number) => ({
      ...r,
      id: r?.id ?? mirrored[idx]?.id,
    }));
    return JSON.stringify(wasArray ? withIds : withIds[0]);
  } catch {
    return originalBody;
  }
}

function syntheticResponse(rows: Array<Record<string, unknown>>, status = 200): Response {
  return new Response(JSON.stringify(rows), {
    status,
    statusText: "OK (local-first)",
    headers: {
      "Content-Type": "application/json",
      "x-local-first": "1",
    },
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

    // Local-first READS: serve GET/HEAD against /rest/v1/<table> from IndexedDB.
    // Exception: sync/hydration marks its own requests with `x-lf-bypass: 1`
    // so cloud → IndexedDB back-fill never gets served empty results from the
    // very store it's trying to populate.
    const M = method.toUpperCase();
    if (M === "GET" || M === "HEAD") {
      const bypass = headers["x-lf-bypass"] === "1";
      if (!bypass) {
        try {
          const hdrs = new Headers(headers);
          const local = await serveLocalRead(url, M, hdrs);
          if (local) return local;
        } catch (err) {
          console.warn("[local-first] read interceptor failed", err);
        }
      }
      return original(input as never, init);
    }


    const target = isRestWrite(url, method);
    if (!target) return original(input as never, init);

    // HYBRID OFFLINE ARCHITECTURE:
    // When online, forward every write straight to Lovable Cloud (master
    // database). Cloud triggers and constraints run there as usual; on
    // success we mirror the returned rows into IndexedDB so the offline
    // cache stays fresh. We only fall back to the local-first path if
    // the network attempt fails.
    if (typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const res = await original(input as never, init);
        // Best-effort cache mirror: only for successful writes with a JSON body.
        if (res.ok && res.status !== 204) {
          try {
            const cloned = res.clone();
            const ct = cloned.headers.get("content-type") ?? "";
            if (ct.includes("application/json")) {
              const parsed = await cloned.json().catch(() => null);
              const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
              const dexie = localDb();
              if (rows.length && dexie.tables.some((t) => t.name === target.table)) {
                const tbl = dexie.table(target.table);
                if (target.op === "delete") {
                  await tbl.bulkDelete(rows.map((r: any) => String(r.id))).catch(() => {});
                } else {
                  await tbl.bulkPut(
                    rows.map((r: Record<string, unknown>) => ({ ...r, _dirty: 0, _op: null })) as never,
                  ).catch(() => {});
                }
              }
            }
          } catch { /* mirroring is best-effort */ }
        }
        return res;
      } catch (err) {
        // Network failed even though navigator claims online — fall through
        // to the offline path so the user never loses a write.
        console.warn("[hybrid] online write failed, falling back to offline queue", err);
      }
    }

    // ---------- OFFLINE PATH (or online-network-failure fallback) ----------

    // 1) Apply to IndexedDB first.
    let mirrored: ApplyResult | null = null;
    try {
      mirrored = await applyLocal(target, body, url);
    } catch (err) {
      console.warn("[local-first] mirror failed", err);
    }

    // If table isn't mirrored locally, fall through to the network so the
    // caller doesn't silently lose data (rare — most CUD tables are mirrored).
    if (mirrored === null) {
      return original(input as never, init);
    }

    // 2) Run local business triggers (mirrors cloud triggers while offline
    //    so stock, WAC, cash movements and reports stay accurate until sync).
    const primaryPatches: Array<Record<string, unknown> | undefined> = [];
    for (let i = 0; i < mirrored.after.length; i++) {
      try {
        const { mutatePrimary } = await runLocalTriggers({
          table: target.table,
          op: target.op,
          before: mirrored.before[i] ?? null,
          after: target.op === "delete" ? null : mirrored.after[i] ?? null,
          refUrl: url,
          refHeaders: headers,
        });
        primaryPatches.push(mutatePrimary);
      } catch (err) {
        console.warn("[local-first] trigger failed", err);
        primaryPatches.push(undefined);
      }
    }

    // Apply any trigger-requested patches back to the primary row in Dexie
    // and to the outgoing cloud body so the same UUID linkage lands remotely.
    let effectiveAfter = mirrored.after;
    if (primaryPatches.some((p) => p && Object.keys(p).length > 0)) {
      const dexie = localDb();
      const tbl = dexie.tables.some((t) => t.name === target.table) ? dexie.table(target.table) : null;
      effectiveAfter = await Promise.all(mirrored.after.map(async (row, i) => {
        const patch = primaryPatches[i];
        if (!patch || !row?.id) return row;
        const next = { ...row, ...patch, _dirty: 1 } as Record<string, unknown>;
        if (tbl) await tbl.put(next as never).catch(() => {});
        return next;
      }));
    }

    // 3) Rewrite body so client-generated UUIDs and trigger patches reach cloud.
    const cloudBody = bodyWithMirroredIds(body, effectiveAfter, target.op);

    // 4) Queue for background cloud sync — do NOT await the network.
    try {
      await enqueueRequest({ url, method, headers, body: cloudBody });
      scheduleOutboxFlush(navigator.onLine ? 50 : 0);
    } catch (err) {
      console.warn("[local-first] failed to enqueue", err);
    }

    // 5) Return a synthetic response now so the UI never blocks.
    const status = target.op === "insert" ? 201 : 200;
    return syntheticResponse(effectiveAfter, status);
  };
}

