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
import { buildRange } from "@/lib/business-date";
import { fetchInventoryEngine, type Period } from "@/lib/inventory-engine";
import { num } from "@/lib/format";

export type LockRow = { scope: "product" | "stock_item"; item_id: string; quantity: number; unit_value: number };

export function currentBusinessMonthPeriod(): Period {
  const r = buildRange("month");
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

/** Builds the rows that will be locked, using live displayed stock + purchase prices. */
export async function buildLockRows(): Promise<LockRow[]> {
  const period = currentBusinessMonthPeriod();
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
