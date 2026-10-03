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
import { buildRange, businessToday, businessDateOf, getBusinessConfig } from "@/lib/business-date";
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
  // Always the configured business-month start day, for any month — so the
  // previous month's closing is measured at its real business month end.
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return `${key}-${String(getBusinessConfig().monthStartDay).padStart(2, "0")}`;
}

/**
 * Rows to lock for `year`/`month`: the stock at the END of the previous month,
 * copied exactly as shown (no repair, no clamping, signs preserved).
 */
export async function buildLockRows(year: number, month: number): Promise<LockRow[]> {
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

/**
 * Auto month-start lock: once per business month, if the current month has no
 * saved opening yet, save it (and the previous month's closing) automatically.
 * Never overwrites a month that already has a saved opening.
 */
export async function autoLockCurrentMonth() {
  const from = buildRange("month").from;
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const flag = `auto-month-lock:${year}-${month}`;
  try { if (localStorage.getItem(flag)) return; } catch { /* ignore */ }
  const { data } = await (supabase as any).from("stock_opening_snapshots")
    .select("id").eq("year", year).eq("month", month).eq("kind", "opening").limit(1);
  if (!data?.length) {
    const rows = await buildLockRows(year, month);
    if (rows.length) await lockMonthOpening(year, month, rows);
  }
  try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
}
