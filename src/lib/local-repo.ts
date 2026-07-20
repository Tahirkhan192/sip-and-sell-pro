/**
 * Local-first repository over IndexedDB (Dexie).
 *
 * All read paths in Dashboard / POS / Reports go through this module so
 * pages render instantly from the on-device mirror. Supabase remains the
 * cloud backup — writes still flow through the Supabase client, but reads
 * never wait on the network.
 *
 * Business logic (COGS, recipe cost transfer, category rollups, etc.) is
 * unchanged; only the data source moves.
 */

import { localDb } from "@/pwa/db";

type Row = Record<string, any>;

const alive = (r: Row) => !r?.deleted_at;

/** Products list — active-only when `active=true`, ordered by name. */
export async function listProductsLocal(opts: { active?: boolean } = {}): Promise<Row[]> {
  const rows = await localDb().products.toArray();
  let out = rows.filter(alive);
  if (opts.active) out = out.filter((p) => p.active !== false);
  out.sort((a, b) => {
    // Recently-sold first when timestamps are present.
    const la = (a.last_sold_at ?? "") as string;
    const lb = (b.last_sold_at ?? "") as string;
    if (la || lb) return lb.localeCompare(la);
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
  return out;
}

export async function listStockItemsLocal(): Promise<Row[]> {
  const rows = await localDb().stock_items.toArray();
  return rows.filter(alive).sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}

export async function listRecipesLocal(): Promise<Row[]> {
  const rows = await localDb().recipes.toArray();
  return rows.filter(alive);
}

export async function listCustomersLocal(): Promise<Row[]> {
  const rows = await localDb().customers.toArray();
  return rows.filter(alive);
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
  const rows = await localDb().sales.where("status").equals("pending").toArray();
  return rows
    .filter(alive)
    .filter((s) => String(s.customer_name ?? "").toLowerCase().includes(q))
    .sort((a, b) => String(b.sale_date ?? "").localeCompare(String(a.sale_date ?? "")))
    .slice(0, limit);
}

async function joinSaleItems(sales: Row[]): Promise<Row[]> {
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

/** Full sale with items + product info, for editing in POS. */
export async function getSaleWithItemsLocal(id: string): Promise<Row | null> {
  const sale = await localDb().sales.get(id);
  if (!sale) return null;
  const [joined] = await joinSaleItems([sale]);
  return joined;
}

/** Sales in a business-date range (uses sale_date UTC bounds). */
export async function listSalesInRangeLocal(startUTC: string, endExclusiveUTC: string): Promise<Row[]> {
  const rows = await localDb().sales
    .where("sale_date")
    .between(startUTC, endExclusiveUTC, true, false)
    .toArray();
  return joinSaleItems(rows.filter(alive));
}

/** All sales (used for "overall" reports with no range). */
export async function listAllSalesLocal(): Promise<Row[]> {
  const rows = await localDb().sales.toArray();
  return joinSaleItems(rows.filter(alive));
}

export async function listStockPurchasesInRangeLocal(from?: string, to?: string): Promise<Row[]> {
  const tbl = localDb().stock_purchases;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  const filtered = rows.filter(alive);
  // Join product/stock item names for display.
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
  const tbl = localDb().expenses;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  return rows.filter(alive).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
}

export async function listDeliveryExpensesInRangeLocal(from?: string, to?: string): Promise<Row[]> {
  const tbl = localDb().delivery_expenses;
  const rows = from && to
    ? await tbl.where("date").between(from, to, true, true).toArray()
    : await tbl.toArray();
  return rows.filter(alive);
}

export async function listMonthlyOverridesLocal(year: number, month: number): Promise<Row[]> {
  const rows = await localDb().monthly_stock_overrides.toArray();
  return rows.filter((r) => Number(r.year) === year && Number(r.month) === month);
}
