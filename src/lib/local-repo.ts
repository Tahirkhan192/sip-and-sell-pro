/**
 * Hybrid report repository.
 *
 * When the browser is online, reads go straight to Lovable Cloud through the
 * Supabase client — the fetch interceptor bypasses IndexedDB in online mode,
 * so nothing here caps at the local cache. Historical invoices, purchases and
 * expenses are always complete.
 *
 * When offline, the same Supabase calls transparently fall back to
 * IndexedDB via `serveLocalRead`, so pages keep working.
 *
 * IMPORTANT — keyset pagination:
 *   PostgREST responses are capped (default 1000) and several tables here
 *   don't have `updated_at`, so we cannot rely on `.range()` past the first
 *   page. We page with `.gte(field, cursor).order(field).limit(N)` and
 *   advance the cursor to the last row's field value, dropping duplicates
 *   we've already seen. This walks the entire table safely.
 */

import { supabase } from "@/integrations/supabase/client";
import { localDb } from "@/pwa/db";

type Row = Record<string, any>;

const PAGE = 1000;
const alive = (r: Row) => !r?.deleted_at;
const isOnline = () => typeof navigator === "undefined" || navigator.onLine;

/** Fetch all rows matching a range on `field`, paging with keyset on that field. */
async function fetchRangeKeyset(
  table: string,
  field: string,
  select: string,
  fromInclusive: string,
  toExclusive: string,
): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  let cursor = fromInclusive;
  // Safety cap: stop after 1000 pages (1M rows) to prevent runaway loops.
  for (let page = 0; page < 1000; page++) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .is("deleted_at", null)
      .gte(field, cursor)
      .lt(field, toExclusive)
      .order(field, { ascending: true })
      .limit(PAGE);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    let added = 0;
    let lastField: string | null = null;
    for (const r of rows) {
      const id = String(r.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(r);
      lastField = String(r[field] ?? "");
      added++;
    }
    if (rows.length < PAGE) break;
    if (!lastField) break;
    if (added === 0) break; // all-duplicates page — cursor stuck
    cursor = lastField;
  }
  return out;
}

/** Fetch all rows on a table, paging by `id` (used when no time filter). */
async function fetchAllKeyset(table: string, select: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor = "";
  for (let page = 0; page < 1000; page++) {
    let q = supabase
      .from(table)
      .select(select)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
    cursor = String(rows[rows.length - 1].id ?? "");
    if (!cursor) break;
  }
  return out;
}

/* --------------------------- reference lists --------------------------- */

export async function listProductsLocal(opts: { active?: boolean } = {}): Promise<Row[]> {
  let rows: Row[];
  if (isOnline()) {
    rows = await fetchAllKeyset("products", "*");
  } else {
    rows = (await localDb().products.toArray()).filter(alive);
  }
  let out = rows;
  if (opts.active) out = out.filter((p) => p.active !== false);
  out.sort((a, b) => {
    const la = (a.last_sold_at ?? "") as string;
    const lb = (b.last_sold_at ?? "") as string;
    if (la || lb) return lb.localeCompare(la);
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
  return out;
}

export async function listStockItemsLocal(): Promise<Row[]> {
  const rows = isOnline()
    ? await fetchAllKeyset("stock_items", "*")
    : (await localDb().stock_items.toArray()).filter(alive);
  return rows.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export async function listRecipesLocal(): Promise<Row[]> {
  return isOnline()
    ? await fetchAllKeyset("recipes", "*")
    : (await localDb().recipes.toArray()).filter(alive);
}

export async function listCustomersLocal(): Promise<Row[]> {
  return isOnline()
    ? await fetchAllKeyset("customers", "*")
    : (await localDb().customers.toArray()).filter(alive);
}

export async function searchCustomersLocal(term: string, limit = 6): Promise<Row[]> {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const all = await listCustomersLocal();
  return all
    .filter((c) => String(c.name ?? "").toLowerCase().includes(q) || String(c.phone ?? "").toLowerCase().includes(q))
    .slice(0, limit);
}

export async function searchPendingSalesLocal(term: string, limit = 8): Promise<Row[]> {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  if (isOnline()) {
    const { data } = await supabase
      .from("sales")
      .select("*")
      .is("deleted_at", null)
      .eq("status", "pending")
      .ilike("customer_name", `%${q}%`)
      .order("sale_date", { ascending: false })
      .limit(limit);
    return (data ?? []) as Row[];
  }
  const rows = await localDb().sales.where("status").equals("pending").toArray();
  return rows
    .filter(alive)
    .filter((s) => String(s.customer_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => String(b.sale_date ?? "").localeCompare(String(a.sale_date ?? "")))
    .slice(0, limit);
}

/* --------------------------- sales --------------------------- */

async function joinSaleItemsLocal(sales: Row[]): Promise<Row[]> {
  if (sales.length === 0) return sales;
  const ids = sales.map((s) => s.id).filter(Boolean) as string[];
  const items = (await localDb().sale_items.where("sale_id").anyOf(ids).toArray()) as Row[];
  const productIds = Array.from(new Set(items.map((i) => i.product_id).filter(Boolean))) as string[];
  const products = productIds.length ? await localDb().products.bulkGet(productIds) : [];
  const prodById: Record<string, Row> = {};
  for (const p of products) if (p) prodById[(p as Row).id] = p as Row;
  const bySale: Record<string, Row[]> = {};
  for (const it of items) {
    const sid = String(it.sale_id);
    (bySale[sid] ??= []).push({ ...it, products: it.product_id ? prodById[String(it.product_id)] : undefined });
  }
  return sales.map((s) => ({ ...s, sale_items: bySale[String(s.id)] ?? [] }));
}

export async function getSaleWithItemsLocal(id: string): Promise<Row | null> {
  if (isOnline()) {
    const { data } = await supabase
      .from("sales")
      .select("*, sale_items(*, products(*))")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    return (data as Row | null) ?? null;
  }
  const sale = await localDb().sales.get(id);
  if (!sale) return null;
  const [joined] = await joinSaleItemsLocal([sale]);
  return joined;
}

/**
 * Sales in a business-date range, joined with sale_items and products.
 * When online, pages through Lovable Cloud with keyset on sale_date so no
 * historical invoice is ever dropped by the 1000-row PostgREST cap.
 */
export async function listSalesInRangeLocal(startUTC: string, endExclusiveUTC: string): Promise<Row[]> {
  if (isOnline()) {
    return fetchRangeKeyset("sales", "sale_date", "*, sale_items(*, products(*))", startUTC, endExclusiveUTC);
  }
  const rows = await localDb().sales
    .where("sale_date")
    .between(startUTC, endExclusiveUTC, true, false)
    .toArray();
  return joinSaleItemsLocal(rows.filter(alive));
}

export async function listAllSalesLocal(): Promise<Row[]> {
  if (isOnline()) {
    // Paginate by sale_date across all history.
    return fetchRangeKeyset("sales", "sale_date", "*, sale_items(*, products(*))", "1900-01-01", "9999-12-31");
  }
  const rows = await localDb().sales.toArray();
  return joinSaleItemsLocal(rows.filter(alive));
}

/* --------------------------- purchases / expenses --------------------------- */

export async function listStockPurchasesInRangeLocal(from?: string, to?: string): Promise<Row[]> {
  if (isOnline() && from && to) {
    // `date` here is a DATE column (YYYY-MM-DD). Range is inclusive.
    const toExclusive = addDaysStr(to, 1);
    const rows = await fetchRangeKeyset("stock_purchases", "date", "*, products(*), stock_items(*)", from, toExclusive);
    return rows.sort((a: Row, b: Row) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }
  if (isOnline()) {
    return fetchAllKeyset("stock_purchases", "*, products(*), stock_items(*)");
  }
  const tbl = localDb().stock_purchases;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  const filtered = rows.filter(alive);
  const productIds = Array.from(new Set(filtered.map((r) => r.product_id).filter(Boolean))) as string[];
  const stockIds = Array.from(new Set(filtered.map((r) => r.stock_item_id).filter(Boolean))) as string[];
  const [products, items] = await Promise.all([
    productIds.length ? localDb().products.bulkGet(productIds) : Promise.resolve([]),
    stockIds.length ? localDb().stock_items.bulkGet(stockIds) : Promise.resolve([]),
  ]);
  const pById: Record<string, Row> = {};
  const sById: Record<string, Row> = {};
  for (const p of products) if (p) pById[(p as Row).id] = p as Row;
  for (const s of items) if (s) sById[(s as Row).id] = s as Row;
  return filtered.map((r: Row) => ({
    ...r,
    products: r.product_id ? pById[String(r.product_id)] : undefined,
    stock_items: r.stock_item_id ? sById[String(r.stock_item_id)] : undefined,
  })).sort((a: Row, b: Row) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

export async function listExpensesInRangeLocal(from?: string, to?: string): Promise<Row[]> {
  if (isOnline() && from && to) {
    const toExclusive = addDaysStr(to, 1);
    const rows = await fetchRangeKeyset("expenses", "date", "*", from, toExclusive);
    return rows.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }
  if (isOnline()) {
    return fetchAllKeyset("expenses", "*");
  }
  const tbl = localDb().expenses;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  return rows.filter(alive).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

export async function listDeliveryExpensesInRangeLocal(from?: string, to?: string): Promise<Row[]> {
  if (isOnline() && from && to) {
    const toExclusive = addDaysStr(to, 1);
    return fetchRangeKeyset("delivery_expenses", "date", "*", from, toExclusive);
  }
  if (isOnline()) {
    return fetchAllKeyset("delivery_expenses", "*");
  }
  const tbl = localDb().delivery_expenses;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  return rows.filter(alive);
}

export async function listMonthlyOverridesLocal(year: number, month: number): Promise<Row[]> {
  if (isOnline()) {
    const { data } = await supabase
      .from("monthly_stock_overrides")
      .select("*")
      .is("deleted_at", null)
      .eq("year", year)
      .eq("month", month)
      .limit(PAGE);
    return (data ?? []) as Row[];
  }
  const rows = await localDb().monthly_stock_overrides.toArray();
  return rows.filter((r) => Number(r.year) === year && Number(r.month) === month);
}

/* --------------------------- helpers --------------------------- */

function addDaysStr(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
