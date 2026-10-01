/**
 * Month-end stock lock.
 *
 * "Set As Opening Stock" takes the stock exactly as the app currently shows it
 * (inventory engine when Auto Calculation is ON, stored Current Stock when it
 * is OFF) and writes it as:
 *   • the opening quantity of the selected month (replaces, never adds), and
 *   • the closing quantity of the previous month.
 *
 * The record is permanent and can be viewed for any month afterwards.
 * Unit price is carried automatically from purchases (weighted average) or the
 * manual average-price override where one is set.
 */
import { supabase } from "@/integrations/supabase/client";
import { buildRange, businessToday, businessDateOf } from "@/lib/business-date";
import { fetchInventoryEngine, type Period } from "@/lib/inventory-engine";
import { num } from "@/lib/format";

export type LockRow = { scope: "product" | "stock_item"; item_id: string; quantity: number; unit_value: number };

/**
 * The figures locked at month end are exactly the ones shown on Current Stock:
 * every movement from the very beginning up to today.
 */
export function currentBusinessMonthPeriod(): Period {
  const r = buildRange("custom", "2000-01-01", businessToday());
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
}


export function previousMonthOf(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function dayBefore(d: string) {
  const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/** First business date of the target month. */
function monthStart(year: number, month: number) {
  const cur = buildRange("month");
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return cur.from.slice(0, 7) === key ? cur.from : `${key}-01`;
}

/**
 * An earlier version of "Save as Opening" overwrote each item's base opening
 * stock with the saved figure, so history was counted twice (negatives, wrong
 * last-month profit). Put the base back: base = saved figure − movements that
 * were already inside it on the day it was saved.
 */
async function repairOverwrittenBase(year: number, month: number) {
  const sb = supabase as any;
  const { data: snaps } = await sb.from("stock_opening_snapshots")
    .select("scope,item_id,quantity,updated_at").eq("year", year).eq("month", month).eq("kind", "opening");
  if (!snaps?.length) return;
  const [{ data: prods }, { data: items }] = await Promise.all([
    sb.from("products").select("id,opening_stock,auto_calc"),
    sb.from("stock_items").select("id,opening_stock,auto_calc"),
  ]);
  const base: Record<string, any> = {};
  for (const p of prods ?? []) base[`product:${p.id}`] = p;
  for (const s of items ?? []) base[`stock_item:${s.id}`] = s;
  const byDate: Record<string, any[]> = {};
  for (const r of snaps) {
    const b = base[`${r.scope}:${r.item_id}`];
    if (!b || b.auto_calc !== true) continue;
    if (Math.abs(num(b.opening_stock) - num(r.quantity)) > 1e-6) continue; // not overwritten
    (byDate[businessDateOf(r.updated_at)] ??= []).push(r);
  }
  for (const [d, rows] of Object.entries(byDate)) {
    const rg = buildRange("custom", "2000-01-01", d);
    const snap = await fetchInventoryEngine({ from: rg.from, to: rg.to, startUTC: rg.startUTC, endExclusiveUTC: rg.endExclusiveUTC });
    const net: Record<string, number> = {};
    for (const x of snap.products) net[`product:${x.id}`] = x.remaining - x.opening;
    for (const x of snap.stockItems) net[`stock_item:${x.id}`] = x.remaining - x.opening;
    for (const r of rows) {
      const fixed = Math.round((num(r.quantity) - (net[`${r.scope}:${r.item_id}`] ?? 0)) * 1e6) / 1e6;
      await sb.from(r.scope === "product" ? "products" : "stock_items").update({ opening_stock: fixed }).eq("id", r.item_id);
    }
  }
}

/**
 * Rows to lock for `year`/`month`: the stock at the END of the previous month
 * (so this month's own sales are never deducted twice).
 */
export async function buildLockRows(year: number, month: number): Promise<LockRow[]> {
  await repairOverwrittenBase(year, month);
  const r = buildRange("custom", "2000-01-01", dayBefore(monthStart(year, month)));
  const period: Period = { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
  const [snapshot, prodPrices, itemPrices] = await Promise.all([
    fetchInventoryEngine(period),
    (supabase as any).from("products").select("id,cost_price,avg_price_override").is("deleted_at", null),
    (supabase as any).from("stock_items").select("id,purchase_price,avg_price_override").is("deleted_at", null),
  ]);

  const prodPrice: Record<string, number> = {};
  for (const p of (prodPrices.data ?? []) as any[]) {
    prodPrice[p.id] = p.avg_price_override != null ? num(p.avg_price_override) : num(p.cost_price);
  }
  const itemPrice: Record<string, number> = {};
  for (const s of (itemPrices.data ?? []) as any[]) {
    itemPrice[s.id] = s.avg_price_override != null ? num(s.avg_price_override) : num(s.purchase_price);
  }

  const rows: LockRow[] = [];
  for (const p of snapshot.products) {
    rows.push({ scope: "product", item_id: p.id, quantity: p.remaining, unit_value: prodPrice[p.id] ?? 0 });
  }
  for (const s of snapshot.stockItems) {
    rows.push({ scope: "stock_item", item_id: s.id, quantity: s.remaining, unit_value: itemPrice[s.id] ?? s.avgPrice });
  }
  return rows;
}

/** Saves the opening record for `year`/`month` and the closing record for the month before. */
export async function lockMonthOpening(year: number, month: number, rows: LockRow[]) {
  const { error } = await (supabase as any).rpc("lock_month_opening", {
    _year: year,
    _month: month,
    _rows: rows,
  });
  if (error) throw error;
  return rows.length;
}
