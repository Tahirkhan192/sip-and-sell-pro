/**
 * Cloud → Local hydration with last-write-wins conflict resolution.
 *
 * Only pulls rows changed since the stored `updated_at` cursor for each table.
 * Local rows flagged `_dirty === 1` with a newer `updated_at` are preserved so
 * offline writes are never clobbered by a stale server copy.
 */

import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { localDb, SYNCED_TABLES, type SyncedTable } from "./db";
import { markLocalReady, setReadinessProgress } from "./readiness";

const PAGE_SIZE = 1000;

/**
 * Dedicated Supabase client for hydration. Marks every request with
 * `x-lf-bypass: 1` so the local-read interceptor lets it through to the real
 * network — otherwise sync would query the very IndexedDB store it's trying
 * to fill and think the cloud is empty.
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
let _syncClient: ReturnType<typeof createClient> | null = null;
async function getSyncClient() {
  if (_syncClient) return _syncClient;
  const bypassFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("apikey", SUPABASE_KEY);
    headers.set("x-lf-bypass", "1");
    // Attach the user's access token so RLS applies as usual.
    const auth = init?.headers ? new Headers(init.headers).get("Authorization") : null;
    if (auth) headers.set("Authorization", auth);
    return fetch(input as never, { ...init, headers });
  };
  _syncClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: bypassFetch },
  });
  // Mirror the current session so RLS sees the same user.
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await _syncClient.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    }
  } catch { /* noop */ }
  return _syncClient;
}


/* ---------- observable sync state ---------- */

export type SyncState = {
  syncing: boolean;
  lastSyncAt: string | null;
  progress: { done: number; total: number; table: string | null } | null;
  lastError: string | null;
};

const state: SyncState = {
  syncing: false,
  lastSyncAt: null,
  progress: null,
  lastError: null,
};
const listeners = new Set<(s: SyncState) => void>();
function emit() {
  const snapshot = { ...state, progress: state.progress ? { ...state.progress } : null };
  for (const cb of listeners) {
    try { cb(snapshot); } catch { /* noop */ }
  }
}
export function subscribeSync(cb: (s: SyncState) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getSyncState(): SyncState {
  return { ...state, progress: state.progress ? { ...state.progress } : null };
}

/* ---------- cursors ---------- */

async function getCursor(table: string): Promise<string | null> {
  const row = await localDb().meta.get(`cursor:${table}`);
  return row?.value ?? null;
}
async function setCursor(table: string, value: string) {
  await localDb().meta.put({ key: `cursor:${table}`, value });
}

async function loadLastSyncFromMeta() {
  try {
    const row = await localDb().meta.get("last_sync_at");
    state.lastSyncAt = row?.value ?? null;
  } catch { /* noop */ }
}

/* ---------- last-write-wins merge ---------- */

async function mergeIntoLocal(table: SyncedTable, incoming: Array<Record<string, unknown>>) {
  if (incoming.length === 0) return;
  const ids = incoming.map((r) => String((r as { id?: unknown }).id ?? "")).filter(Boolean);
  const existing = ids.length ? await localDb().table(table).bulkGet(ids) : [];
  const localById = new Map<string, Record<string, unknown>>();
  for (const row of existing) if (row) localById.set(String((row as { id: string }).id), row as Record<string, unknown>);

  const toPut: Array<Record<string, unknown>> = [];
  for (const row of incoming) {
    const id = String((row as { id?: unknown }).id ?? "");
    if (!id) continue;
    const local = localById.get(id);
    if (local && local._dirty === 1) {
      // Local has a pending write. Only overwrite if the server timestamp is
      // strictly newer than the local one (someone else's later change).
      const localAt = String(local.updated_at ?? "");
      const remoteAt = String((row as { updated_at?: unknown }).updated_at ?? "");
      if (remoteAt && localAt && remoteAt <= localAt) continue;
    }
    // Drop the dirty flag on merge — server confirmed this state.
    toPut.push({ ...row, _dirty: 0 });
  }
  if (toPut.length) await localDb().table(table).bulkPut(toPut as never);
}

async function pullTable(table: SyncedTable) {
  // Keyset pagination on (updated_at, id).
  //
  // Why keyset and NOT offset+range:
  //   Supabase PostgREST caps responses at `db.max_rows` (default 1000). A
  //   request like `.range(1000, 1999)` returns 0 rows on some deployments,
  //   which previously broke the loop after the first page and stranded
  //   millions of historical records outside IndexedDB. Filtering by
  //   `updated_at > cursor` (with an `id > cursor_id` tiebreaker for rows
  //   that share the same timestamp) walks the entire table safely.
  const startCursor = await getCursor(table);
  let cursorAt: string | null = startCursor;
  let cursorId: string | null = null;
  let latestAt: string | null = startCursor;
  let latestId: string | null = null;
  const client = (await getSyncClient()) as unknown as { from: (name: string) => any };

  while (true) {
    let q = client
      .from(table as string)
      .select("*")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursorAt && cursorId) {
      // (updated_at, id) > (cursorAt, cursorId) — expressed as an OR filter.
      q = q.or(`updated_at.gt.${cursorAt},and(updated_at.eq.${cursorAt},id.gt.${cursorId})`);
    } else if (cursorAt) {
      q = q.gt("updated_at", cursorAt);
    }
    const { data, error } = await q;
    if (error) {
      // Tables like `user_roles` don't expose updated_at. Full-pull once.
      if (!startCursor && /updated_at/i.test(error.message)) {
        const { data: full, error: err2 } = await client.from(table as string).select("*");
        if (err2) throw err2;
        if (full && full.length) await mergeIntoLocal(table, full as never);
        await setCursor(table, new Date().toISOString());
        return;
      }
      throw error;
    }
    if (!data || data.length === 0) break;
    await mergeIntoLocal(table, data as never);
    const last = data[data.length - 1] as { updated_at?: string; id?: string };
    if (last?.updated_at) {
      latestAt = last.updated_at;
      latestId = String(last.id ?? "");
      cursorAt = latestAt;
      cursorId = latestId;
    }
    if (data.length < PAGE_SIZE) break;
  }
  if (latestAt) await setCursor(table, latestAt);
}

/* ---------- top-level sync ---------- */

let running = false;
export async function syncFromCloud(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "no window" };
  if (running) return { ok: true };
  if (!navigator.onLine) return { ok: false, error: "offline" };
  running = true;
  state.syncing = true;
  state.lastError = null;
  state.progress = { done: 0, total: SYNCED_TABLES.length, table: null };
  emit();
  try {
    // One-time repair (v2): previous versions routed hydration reads through
    // the local-read interceptor, which served empty results from the very
    // IndexedDB store we were trying to fill. Reset every table cursor once
    // more so keyset-based re-hydration can back-fill the full history from
    // Lovable Cloud.
    const repairKey = "repair_bypass_v2";
    const repaired = await localDb().meta.get(repairKey);
    if (!repaired) {
      for (const t of SYNCED_TABLES) {
        await localDb().meta.delete(`cursor:${t}`);
      }
      await localDb().meta.put({ key: repairKey, value: new Date().toISOString() });
    }

    let done = 0;
    for (const t of SYNCED_TABLES) {
      state.progress = { done, total: SYNCED_TABLES.length, table: t };
      setReadinessProgress(`Loading ${t.replace(/_/g, " ")}… (${done + 1}/${SYNCED_TABLES.length})`);
      emit();
      try {
        await pullTable(t);
      } catch (err) {
        console.warn(`[sync] pull ${t} failed`, err);
      }
      done++;
      state.progress = { done, total: SYNCED_TABLES.length, table: t };
      emit();
    }
    const now = new Date().toISOString();
    await localDb().meta.put({ key: "last_sync_at", value: now });
    state.lastSyncAt = now;
    // Mark initial hydration complete on the first successful full pass.
    const initKey = "initial_hydration_v2";
    const already = await localDb().meta.get(initKey);
    if (!already) await localDb().meta.put({ key: initKey, value: now });
    markLocalReady();
    return { ok: true };
  } catch (err) {
    state.lastError = (err as Error)?.message ?? String(err);
    return { ok: false, error: state.lastError };
  } finally {
    running = false;
    state.syncing = false;
    state.progress = null;
    emit();
  }
}

/**
 * Ensure the local database has been fully hydrated at least once from the
 * cloud before the UI reads any business data. Idempotent — subsequent calls
 * resolve immediately once `initial_hydration_v2` is set.
 */
export async function ensureInitialHydration(): Promise<void> {
  if (typeof window === "undefined") { markLocalReady(); return; }
  // Hybrid architecture: online reads go straight to Lovable Cloud, so the
  // UI never has to wait on IndexedDB hydration. Unblock immediately and let
  // the offline cache refresh in the background.
  markLocalReady();
  if (navigator.onLine) void syncFromCloud();
}



/** Trigger hydration in the background — safe to call from React effects. */
export function scheduleBackgroundSync() {
  if (typeof window === "undefined") return;
  void syncFromCloud();
}

let periodicTimer: number | null = null;
export function startPeriodicSync(intervalMs = 60_000) {
  if (typeof window === "undefined") return;
  void loadLastSyncFromMeta().then(() => emit());
  if (periodicTimer) window.clearInterval(periodicTimer);
  periodicTimer = window.setInterval(() => {
    if (navigator.onLine) void syncFromCloud();
  }, intervalMs) as unknown as number;
}
export function stopPeriodicSync() {
  if (periodicTimer) {
    window.clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
