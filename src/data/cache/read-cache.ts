/**
 * Offline read-cache (Step 2 of the offline foundation).
 *
 * Behaviour:
 *  - Online:  cloud → UI  AND  cloud → IndexedDB (silent background write).
 *  - Offline: IndexedDB → UI (seeded via queryClient.setQueryData BEFORE
 *             the query fires, so the Supabase call resolves quickly with
 *             cached data instead of hanging on a broken network).
 *
 * This module is READ-ONLY. It does NOT change any save/update/delete API,
 * business calculation, invoice numbering, or query shape. It observes the
 * React-Query cache and mirrors successful reads of a small whitelist of
 * reference tables. Reports, sales history, and dashboards are deliberately
 * excluded.
 */

import type { QueryClient, Query } from "@tanstack/react-query";
import { idbGet, idbSet } from "./idb";

/**
 * First element of a queryKey that is safe to cache offline. These are
 * reference lists and settings — never full invoice history or reports.
 */
const CACHEABLE_ROOTS = new Set<string>([
  "products",
  "categories",
  "customers",
  "suppliers",
  "stock_items",
  "stock",             // current stock views only (product / item lists)
  "recipes",
  "settings",
  "branches",
  "expense_categories",
  "money_movement_subcategories",
  "employees",
]);

/**
 * Query keys that also need caching but do not fit the root-only rule.
 * We match on a JSON prefix so `["sales","pending-search", ...]` variants
 * are all cached under the same offline bucket while completed-sale history
 * queries like `["sales", <from>, <to>]` are skipped.
 */
function isPendingBillsKey(key: readonly unknown[]): boolean {
  return (
    key.length >= 2 &&
    key[0] === "sales" &&
    typeof key[1] === "string" &&
    (key[1] === "pending" || key[1] === "pending-search" || key[1] === "edit")
  );
}

function shouldCache(key: readonly unknown[]): boolean {
  if (!key.length) return false;
  const root = key[0];
  if (typeof root !== "string") return false;
  if (CACHEABLE_ROOTS.has(root)) return true;
  if (isPendingBillsKey(key)) return true;
  return false;
}

function serializeKey(key: readonly unknown[]): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

/**
 * Install the read-cache mirror. Safe to call multiple times — subsequent
 * calls are ignored. Must be invoked in the browser only.
 */
let installed = false;
export function installReadCache(queryClient: QueryClient): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  const cache = queryClient.getQueryCache();

  // --- Mirror successful cloud reads → IndexedDB (silent) --------------
  cache.subscribe((event) => {
    const query = (event as { query?: Query }).query;
    if (!query) return;
    const key = query.queryKey as readonly unknown[];
    if (!shouldCache(key)) return;

    const state = query.state;
    if (state.status !== "success") return;
    if (state.data === undefined || state.data === null) return;
    // Only mirror fresh data — not the seeded-from-cache result itself.
    if (state.fetchStatus === "idle" && state.dataUpdateCount === 0) return;

    void idbSet(serializeKey(key), state.data);
  });

  // --- Seed queries from IndexedDB when they first appear ---------------
  // We seed regardless of online/offline so a slow network still gets an
  // instant paint; React-Query will replace the cache once the cloud
  // response lands. This never blocks or delays the real request.
  cache.subscribe((event) => {
    if ((event as { type?: string }).type !== "added") return;
    const query = (event as { query?: Query }).query;
    if (!query) return;
    const key = query.queryKey as readonly unknown[];
    if (!shouldCache(key)) return;
    if (query.state.data !== undefined) return;

    void idbGet(serializeKey(key)).then((cached) => {
      if (cached === undefined) return;
      // Re-check — the real fetch may have completed in the meantime.
      if (query.state.data !== undefined) return;
      queryClient.setQueryData(key, cached);
    });
  });
}
