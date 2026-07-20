/**
 * Cloud → Local hydration.
 *
 * On login (and when the browser comes back online) pull every synced table
 * from Supabase into IndexedDB. Uses `updated_at` cursors stored in the
 * `meta` store so subsequent runs only fetch what changed.
 *
 * This is intentionally read-only for now: routes still write through
 * Supabase directly, and the service worker's runtime cache handles the
 * network-first HTTP layer. Dexie is the persistent structured mirror that
 * future feature-by-feature offline write support will build on.
 */

import { supabase } from "@/integrations/supabase/client";
import { localDb, SYNCED_TABLES, type SyncedTable } from "./db";

const PAGE_SIZE = 1000;

async function getCursor(table: string): Promise<string | null> {
  const row = await localDb().meta.get(`cursor:${table}`);
  return row?.value ?? null;
}

async function setCursor(table: string, value: string) {
  await localDb().meta.put({ key: `cursor:${table}`, value });
}

async function pullTable(table: SyncedTable) {
  const cursor = await getCursor(table);
  let from = 0;
  let latest = cursor;
  while (true) {
    const client = supabase as unknown as {
      from: (name: string) => any;
    };
    let q = client.from(table as string).select("*").order("updated_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (cursor) q = q.gt("updated_at", cursor);
    const { data, error } = await q;
    if (error) {
      // Table may not expose updated_at (e.g. user_roles). Fall back to a full pull once.
      if (!cursor && /updated_at/i.test(error.message)) {
        const { data: full, error: err2 } = await client.from(table as string).select("*");
        if (err2) throw err2;
        if (full && full.length) {
          await localDb().table(table).bulkPut(full as any);
        }
        await setCursor(table, new Date().toISOString());
        return;
      }
      throw error;
    }
    if (!data || data.length === 0) break;
    await localDb().table(table).bulkPut(data as any);
    const last = (data[data.length - 1] as any)?.updated_at as string | undefined;
    if (last) latest = last;
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  if (latest) await setCursor(table, latest);
}

let running = false;
export async function syncFromCloud(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: false, error: "no window" };
  if (running) return { ok: true };
  if (!navigator.onLine) return { ok: false, error: "offline" };
  running = true;
  try {
    for (const t of SYNCED_TABLES) {
      try {
        await pullTable(t);
      } catch (err) {
        // One failing table shouldn't stop the rest — surface to console.
        console.warn(`[sync] pull ${t} failed`, err);
      }
    }
    await localDb().meta.put({ key: "last_sync_at", value: new Date().toISOString() });
    return { ok: true };
  } finally {
    running = false;
  }
}

/** Trigger hydration in the background — safe to call from React effects. */
export function scheduleBackgroundSync() {
  if (typeof window === "undefined") return;
  const run = () => void syncFromCloud();
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 500);
  }
}
