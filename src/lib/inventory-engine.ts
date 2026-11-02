/**
 * Inventory Engine — single source of truth for Remaining quantity.
 *
 * Remaining = Opening + Purchases + Production
 *           − Recipe Usage − Direct Sales − Transfer Out + Manual Adjustment
 *
 * Transfers to another category AND transfers to Expenses (wastage, staff
 * food, testing…) are both reported as Transfer Out.
 *
 * Every movement is rebuilt from transaction history; stored `current_stock`
 * is only used when Auto Calculation is OFF for that item.
 *
 * The whole history the requested period can need (its own movements plus the
 * carry-forward / anchor sub-ranges) is fetched ONCE and every sub-total is
 * computed from that single read in memory — no network recursion.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { buildRange, getBusinessConfig } from "@/lib/business-date";

const BASE_DATE = "2000-01-01";
function dayBefore(d: string) {
  const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** Business-month start date of a saved snapshot's year/month. */
export function snapshotStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(getBusinessConfig().monthStartDay).padStart(2, "0")}`;
}

export type Period = { from: string; to: string; startUTC: string; endExclusiveUTC: string };

export type InventoryRow = {
  id: string;
  name: string;
  opening: number;
  purchases: number;
  transferIn: number;
  production: number;
  recipeUsage: number;
  directSales: number;
  transferOut: number;
  manualAdjustment: number;
  remaining: number;
  auto: boolean;
  /** Stock Tracking switch — false means unlimited stock, never validated. */
  tracked: boolean;
};

export type ProductInventoryRow = InventoryRow & { category: string; salePrice: number; value: number };
export type StockItemInventoryRow = InventoryRow & {
  unit: string;
  avgPrice: number;
  manual: boolean;
  value: number;
};

export type InventorySnapshot = {
  products: ProductInventoryRow[];
  stockItems: StockItemInventoryRow[];
  /** Master rows (deleted filtered out) so screens don't re-read the catalogues. */
  rawProducts: any[];
  rawStockItems: any[];
};

const add = (m: Record<string, number>, k: string | null | undefined, v: number) => {
  if (!k) return;
  m[k] = (m[k] ?? 0) + v;
};

/** PostgREST caps a request at 1000 rows — page through everything. */
async function fetchAllPaged<T = any>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** A missing optional history source must not hide the product catalogue. */
async function fetchHistory<T = any>(build: () => any): Promise<T[]> {
  try {
    return await fetchAllPaged<T>(build);
  } catch {
    return [];
  }
}

/** Postgres timestamps without an offset are UTC wall time. */
function ts(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? "");
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)$/.exec(s);
  return Date.parse(m ? `${m[1]}T${m[2]}Z` : s);
}

type PurchaseRow = { productId: string | null; itemId: string | null; q: number; date: string };
type BatchRow = { productId: string | null; q: number; date: string };
type BatchItemRow = { productId: string | null; itemId: string | null; q: number; date: string; deleted: boolean };
type TransferRow = { productId: string | null; itemId: string | null; q: number; at: number };
type ConsumptionRow = { productId: string | null; itemId: string | null; q: number; date: string };
type SaleItemRow = { productId: string; q: number; at: number; orderType: string; skip: boolean };
type RecipeRow = { parentId: string; productId: string | null; itemId: string | null; q: number; applies: string[] };
type AdjustRow = { productId: string | null; itemId: string | null; q: number; date: string };

type History = {
  purchases: PurchaseRow[];
  batches: BatchRow[];
  batchItems: BatchItemRow[];
  transfers: TransferRow[];
  consumptions: ConsumptionRow[];
  saleItems: SaleItemRow[];
  recipes: RecipeRow[];
  adjustments: AdjustRow[];
};

type Snap = { key: string; qty: number; start: string; year: number; month: number };

type Ctx = {
  prods: any[];
  items: any[];
  snaps: Snap[];
  snapsByKey: Record<string, { start: string; qty: number }[]>;
  autoKeys: Set<string>;
  history: History;
};

type Scope = { products?: Set<string>; items?: Set<string> };

const rangeOf = (from: string, to: string): Period => {
  const r = buildRange("custom", from, to);
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
};

/**
 * Computes every movement row for one date range from the prefetched history.
 * `scope` narrows which catalogue keys are materialised (carry-forward and
 * anchor sub-computations need a single item); undefined means everything.
 */
function computeRange(ctx: Ctx, range: Period, scope?: Scope, depth = 0): {
  products: Map<string, ProductInventoryRow>;
  items: Map<string, StockItemInventoryRow>;
} {
  const year = Number(range.from.slice(0, 4));
  const month = Number(range.from.slice(5, 7));

  // ---- Opening (locked monthly snapshot wins over live opening_stock)
  const openings: Record<string, number> = {};
  for (const s of ctx.snaps) if (s.year === year && s.month === month) openings[s.key] = s.qty;

  // Latest saved opening at or before a date, per item.
  const anchorFor = (key: string, onOrBefore: string, strictlyBefore: boolean) => {
    let best: string | null = null;
    for (const x of ctx.snapsByKey[key] ?? []) {
      const ok = strictlyBefore ? x.start < onOrBefore : x.start <= onOrBefore;
      if (ok && (best === null || x.start > best)) best = x.start;
    }
    return best;
  };

  const scopeOf = (keys: Set<string>): Scope => {
    const products = new Set<string>();
    const items = new Set<string>();
    for (const k of keys) (k.startsWith("product:") ? products : items).add(k.slice(k.indexOf(":") + 1));
    return { products: products.size ? products : undefined, items: items.size ? items : undefined };
  };
  const inScope = (sc: Scope, key: string) =>
    key.startsWith("product:") ? !sc.products || sc.products.has(key.slice(8)) : !sc.items || sc.items.has(key.slice(10));

  // ---- Sales (non-deleted, non-hidden; completed AND pending both reduce stock).
  // Built for every product — recipe parents outside a narrowed scope still
  // feed their components' usage.
  const startMs = ts(range.startUTC);
  const endMs = ts(range.endExclusiveUTC);
  const soldByProduct: Record<string, number> = {};
  const soldByProductAndType: Record<string, Record<string, number>> = {};
  for (const it of ctx.history.saleItems) {
    if (it.skip) continue;
    if (it.at < startMs || it.at >= endMs) continue;
    add(soldByProduct, it.productId, it.q);
    const bucket = (soldByProductAndType[it.productId] ??= {});
    bucket[it.orderType] = (bucket[it.orderType] ?? 0) + it.q;
  }

  // ---- Movements inside this range
  const inDate = (d: string) => d >= range.from && d <= range.to;
  const purchaseProd: Record<string, number> = {};
  const purchaseItem: Record<string, number> = {};
  for (const r of ctx.history.purchases) if (inDate(r.date)) { add(purchaseProd, r.productId, r.q); add(purchaseItem, r.itemId, r.q); }

  // ---- Production (finished products produced by recipe batches)
  const productionProd: Record<string, number> = {};
  for (const r of ctx.history.batches) if (inDate(r.date)) add(productionProd, r.productId, r.q);

  // ---- Recipe usage via production batches (components consumed)
  const recipeProd: Record<string, number> = {};
  const recipeItem: Record<string, number> = {};
  for (const r of ctx.history.batchItems) {
    if (r.deleted || !inDate(r.date)) continue;
    add(recipeProd, r.productId, r.q);
    add(recipeItem, r.itemId, r.q);
  }

  // ---- Recipe usage via POS sales: recipe qty × sold qty of the parent product
  const parentsWithRecipe = new Set<string>();
  for (const r of ctx.history.recipes) {
    parentsWithRecipe.add(r.parentId);
    const byType = soldByProductAndType[r.parentId];
    if (!byType) continue;
    let soldQty = 0;
    for (const [type, qty] of Object.entries(byType)) {
      if (r.applies.length === 0 || r.applies.includes(type)) soldQty += qty;
    }
    if (soldQty === 0) continue;
    const used = soldQty * r.q;
    add(recipeProd, r.productId, used);
    add(recipeItem, r.itemId, used);
  }

  // ---- Transfers OUT: category → category moves AND stock moved to Expenses
  // (wastage, staff food, testing…). Both are reported as Transfer Out.
  const transferOutProd: Record<string, number> = {};
  const transferOutItem: Record<string, number> = {};
  for (const r of ctx.history.transfers) if (r.at >= startMs && r.at < endMs) { add(transferOutProd, r.productId, r.q); add(transferOutItem, r.itemId, r.q); }
  for (const r of ctx.history.consumptions) if (inDate(r.date)) { add(transferOutProd, r.productId, r.q); add(transferOutItem, r.itemId, r.q); }

  // ---- Manual stock adjustments (signed: +increase / −decrease)
  const adjProd: Record<string, number> = {};
  const adjItem: Record<string, number> = {};
  for (const r of ctx.history.adjustments) if (inDate(r.date)) { add(adjProd, r.productId, r.q); add(adjItem, r.itemId, r.q); }

  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  // ---- "From the beginning" view: start every item from its latest saved
  // opening (on or before the end date) plus only the entries since then.
  const anchoredP: Record<string, ProductInventoryRow> = {};
  const anchoredI: Record<string, StockItemInventoryRow> = {};
  if (range.from <= BASE_DATE && depth < 6) {
    const groups: Record<string, Set<string>> = {};
    for (const key of ctx.autoKeys) {
      if (scope && !inScope(scope, key)) continue;
      const a = anchorFor(key, range.to, false);
      if (a && a > BASE_DATE) (groups[a] ??= new Set()).add(key);
    }
    for (const [start, keys] of Object.entries(groups)) {
      const sub = computeRange(ctx, rangeOf(start, range.to), scopeOf(keys), depth + 1);
      for (const [k, row] of sub.products) if (keys.has(`product:${k}`)) anchoredP[k] = row;
      for (const [k, row] of sub.items) if (keys.has(`stock_item:${k}`)) anchoredI[k] = row;
    }
  }

  // ---- No saved opening for this month → carry forward from the most recent
  // saved opening before it (plus entries since), else from the very start.
  const carriedFor = (key: string, atDepth: number): number | undefined => {
    if (range.from <= BASE_DATE) return undefined;
    if (openings[key] !== undefined) return undefined;
    if (!ctx.autoKeys.has(key)) return undefined;
    if (atDepth >= 6) return undefined;
    const a = anchorFor(key, range.from, true) ?? BASE_DATE;
    const sub = computeRange(ctx, rangeOf(a, dayBefore(range.from)), scopeOf(new Set([key])), atDepth + 1);
    const row = key.startsWith("product:") ? sub.products.get(key.slice(8)) : sub.items.get(key.slice(10));
    return row ? row.remaining : undefined;
  };

  const products = new Map<string, ProductInventoryRow>();
  for (const r of ctx.prods) {
    if (scope?.products && !scope.products.has(r.id as string)) continue;
    const tracked = r.track_stock !== false;
    const auto = r.auto_calc === true;
    const salePrice = num(r.sale_price ?? r.price);
    const base = {
      id: r.id as string,
      name: r.name as string,
      category: (r.category ?? "—") as string,
      tracked,
      auto,
      salePrice,
    };
    const key = `product:${r.id}`;
    const opening = num(openings[key] ?? carriedFor(key, depth) ?? r.opening_stock);
    const purchases = purchaseProd[r.id] ?? 0;
    const production = productionProd[r.id] ?? 0;
    const recipeUsage = round(recipeProd[r.id] ?? 0);
    // A product built from a recipe is consumed through its ingredients;
    // only products without a recipe are deducted directly on sale.
    const sold = soldByProduct[r.id] ?? 0;
    const directSales = parentsWithRecipe.has(r.id) ? 0 : sold;
    const transferOut = transferOutProd[r.id] ?? 0;
    const manualAdjustment = adjProd[r.id] ?? 0;
    // Auto Calculation OFF → keep the manually maintained Current Stock.
    const remaining = auto
      ? round(opening + purchases + production - recipeUsage - directSales - transferOut + manualAdjustment)
      : num(r.current_stock);
    const anchored = anchoredP[r.id];
    if (anchored) {
      products.set(r.id as string, { ...base, ...anchored, ...base, value: anchored.remaining * salePrice });
      continue;
    }
    products.set(r.id as string, {
      ...base,
      opening, purchases, transferIn: 0, production,
      recipeUsage, directSales, transferOut, manualAdjustment,
      remaining, value: remaining * salePrice,
    });
  }

  const items = new Map<string, StockItemInventoryRow>();
  for (const r of ctx.items) {
    if (scope?.items && !scope.items.has(r.id as string)) continue;
    const auto = r.auto_calc === true;
    const key = `stock_item:${r.id}`;
    const opening = num(openings[key] ?? carriedFor(key, depth) ?? r.opening_stock);
    const purchases = purchaseItem[r.id] ?? 0;
    const recipeUsage = round(recipeItem[r.id] ?? 0);
    const transferOut = transferOutItem[r.id] ?? 0;
    const manualAdjustment = adjItem[r.id] ?? 0;
    // Auto Calculation OFF → keep the manually maintained Current Stock.
    const remaining = auto
      ? round(opening + purchases - recipeUsage - transferOut + manualAdjustment)
      : num(r.current_stock);
    const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
    const avgPrice = manual ? num(r.avg_price_override) : num(r.purchase_price);
    const anchored = anchoredI[r.id];
    if (anchored) {
      items.set(r.id as string, { ...anchored, id: r.id, name: r.name, unit: r.unit ?? "pcs", tracked: true, auto, avgPrice, manual, value: anchored.remaining * avgPrice });
      continue;
    }
    items.set(r.id as string, {
      id: r.id,
      name: r.name,
      unit: r.unit ?? "pcs",
      tracked: true,
      opening, purchases, transferIn: 0, production: 0,
      recipeUsage, directSales: 0, transferOut, manualAdjustment,
      remaining, auto, avgPrice, manual, value: remaining * avgPrice,
    });
  }

  return { products, items };
}

export async function fetchInventoryEngine(period: Period): Promise<InventorySnapshot> {
  const sb = supabase as any;

  // Load the two master lists independently from movement history. This keeps
  // every catalogue item visible even when an older/offline database does not
  // yet contain one of the newer history fields.
  const [prodsAll, itemsAll, snapRows] = await Promise.all([
    fetchAllPaged(() => sb.from("products").select("*").order("name")),
    fetchAllPaged(() => sb.from("stock_items").select("*").order("name")),
    fetchHistory(() => sb.from("stock_opening_snapshots").select("scope,item_id,quantity,year,month").eq("kind", "opening").order("item_id")),
  ]);
  const prods = ((prodsAll ?? []) as any[]).filter((r) => !r.deleted_at);
  const items = ((itemsAll ?? []) as any[]).filter((r) => !r.deleted_at);

  const snaps: Snap[] = ((snapRows ?? []) as any[]).map((r) => ({
    key: `${r.scope}:${r.item_id}`,
    qty: num(r.quantity),
    start: snapshotStart(Number(r.year), Number(r.month)),
    year: Number(r.year),
    month: Number(r.month),
  }));
  const snapsByKey: Record<string, { start: string; qty: number }[]> = {};
  for (const s of snaps) (snapsByKey[s.key] ??= []).push({ start: s.start, qty: s.qty });

  const autoKeys = new Set<string>();
  for (const r of prods) if (r.auto_calc === true) autoKeys.add(`product:${r.id}`);
  for (const r of items) if (r.auto_calc === true) autoKeys.add(`stock_item:${r.id}`);

  // Everything the period needs: its own movements plus every carry-forward /
  // anchor sub-range, i.e. from the earliest needed saved opening (or the
  // beginning of time) up to the period end. One read, no recursion.
  let historyFrom = period.from;
  if (period.from > BASE_DATE) {
    const py = Number(period.from.slice(0, 4));
    const pm = Number(period.from.slice(5, 7));
    const openingsMain: Record<string, number> = {};
    for (const s of snaps) if (s.year === py && s.month === pm) openingsMain[s.key] = s.qty;
    let earliest: string | null = null;
    for (const key of autoKeys) {
      if (openingsMain[key] !== undefined) continue;
      const keySnaps = snapsByKey[key] ?? [];
      let best: string | null = null;
      for (const x of keySnaps) if (x.start < period.from && (best === null || x.start > best)) best = x.start;
      const a = best ?? BASE_DATE;
      if (earliest === null || a < earliest) earliest = a;
    }
    if (earliest && earliest < historyFrom) historyFrom = earliest;
  }
  const hist = rangeOf(historyFrom, period.to);

  const [
    purRows,
    batchRows,
    batchItemRows,
    transferRows,
    consumptionRows,
    saleItemRows,
    recipeRows,
    adjustRows,
  ] = await Promise.all([
    fetchHistory(() => sb.from("stock_purchases").select("product_id,stock_item_id,quantity,date").is("deleted_at", null).gte("date", hist.from).lte("date", hist.to).order("id")),
    fetchHistory(() => sb.from("production_batches").select("product_id,quantity,batch_date").is("deleted_at", null).gte("batch_date", hist.from).lte("batch_date", hist.to).order("id")),
    fetchHistory(() => sb.from("production_batch_items").select("component_product_id,component_stock_item_id,quantity,production_batches!inner(batch_date,deleted_at)")
      .gte("production_batches.batch_date", hist.from).lte("production_batches.batch_date", hist.to).order("id")),
    fetchHistory(() => sb.from("stock_transfers").select("product_id,stock_item_id,quantity,created_at").is("deleted_at", null)
      .gte("created_at", hist.startUTC).lt("created_at", hist.endExclusiveUTC).order("id")),
    fetchHistory(() => sb.from("expenses").select("source_product_id,source_stock_item_id,source_quantity,date").is("deleted_at", null).eq("is_stock_transfer", true)
      .gte("date", hist.from).lte("date", hist.to).order("id")),
    fetchHistory(() => sb.from("sale_items").select("product_id,quantity,sales!inner(sale_date,status,deleted_at,hidden,order_type)")
      .gte("sales.sale_date", hist.startUTC).lt("sales.sale_date", hist.endExclusiveUTC).order("id")),
    fetchHistory(() => sb.from("recipes").select("parent_product_id,component_product_id,component_stock_item_id,quantity,applies_to").is("deleted_at", null).order("id")),
    fetchHistory(() => sb.from("stock_adjustments").select("product_id,stock_item_id,quantity,date").is("deleted_at", null).gte("date", hist.from).lte("date", hist.to).order("id")),
  ]);

  const history: History = {
    purchases: ((purRows ?? []) as any[]).map((r) => ({ productId: r.product_id ?? null, itemId: r.stock_item_id ?? null, q: num(r.quantity), date: r.date })),
    batches: ((batchRows ?? []) as any[]).map((r) => ({ productId: r.product_id ?? null, q: num(r.quantity), date: r.batch_date })),
    batchItems: ((batchItemRows ?? []) as any[]).map((r) => ({
      productId: r.component_product_id ?? null,
      itemId: r.component_stock_item_id ?? null,
      q: num(r.quantity),
      date: r.production_batches?.batch_date,
      deleted: !!r.production_batches?.deleted_at,
    })),
    transfers: ((transferRows ?? []) as any[]).map((r) => ({ productId: r.product_id ?? null, itemId: r.stock_item_id ?? null, q: num(r.quantity), at: ts(r.created_at) })),
    consumptions: ((consumptionRows ?? []) as any[]).map((r) => ({ productId: r.source_product_id ?? null, itemId: r.source_stock_item_id ?? null, q: num(r.source_quantity), date: r.date })),
    saleItems: ((saleItemRows ?? []) as any[]).map((r) => {
      const s = r.sales;
      return {
        productId: r.product_id,
        q: num(r.quantity),
        at: ts(s?.sale_date),
        orderType: (s?.order_type ?? "walk_in") as string,
        skip: !s || s.deleted_at || s.hidden || (s.status !== "completed" && s.status !== "pending"),
      };
    }),
    recipes: ((recipeRows ?? []) as any[]).map((r) => ({
      parentId: r.parent_product_id,
      productId: r.component_product_id ?? null,
      itemId: r.component_stock_item_id ?? null,
      q: num(r.quantity),
      applies: Array.isArray(r.applies_to) ? r.applies_to : [],
    })),
    adjustments: ((adjustRows ?? []) as any[]).map((r) => ({ productId: r.product_id ?? null, itemId: r.stock_item_id ?? null, q: num(r.quantity), date: r.date })),
  };

  const ctx: Ctx = { prods, items, snaps, snapsByKey, autoKeys, history };
  const res = computeRange(ctx, period);
  return {
    products: [...res.products.values()],
    stockItems: [...res.items.values()],
    rawProducts: prods,
    rawStockItems: items,
  };
}

export function useInventoryEngine(period: Period) {
  return useQuery({
    queryKey: ["inventory-engine", period.from, period.to],
    queryFn: () => fetchInventoryEngine(period),
    // Short-lived so switching Stock tabs / months reuses the snapshot that was
    // just calculated; every write path invalidates this key explicitly.
    staleTime: 60_000,
  });
}
