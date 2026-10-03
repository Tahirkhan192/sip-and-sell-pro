import { describe, it, expect, vi, beforeAll } from "vitest";

const DATA: Record<string, any[]> = {
  products: [{ id: "p1", name: "Tea", category: "Drinks", sale_price: 10, auto_calc: true, track_stock: true, opening_stock: 10, current_stock: 0 }],
  stock_items: [],
  stock_opening_snapshots: [{ scope: "product", item_id: "p1", year: 2026, month: 9, kind: "opening", quantity: 50 }],
  stock_purchases: [
    { product_id: "p1", stock_item_id: null, quantity: 5, date: "2026-09-10", deleted_at: null },
    { product_id: "p1", stock_item_id: null, quantity: 3, date: "2026-10-10", deleted_at: null },
  ],
};

function builder(table: string) {
  let rows = [...(DATA[table] ?? [])];
  const flat = (k: string) => !k.includes(".");
  const b: any = {
    select: () => b, order: () => b,
    eq: (k: string, v: any) => { if (flat(k)) rows = rows.filter((r) => r[k] === v); return b; },
    is: (k: string, v: any) => { if (flat(k)) rows = rows.filter((r) => (r[k] ?? null) === v); return b; },
    gte: (k: string, v: any) => { if (flat(k)) rows = rows.filter((r) => r[k] >= v); return b; },
    lte: (k: string, v: any) => { if (flat(k)) rows = rows.filter((r) => r[k] <= v); return b; },
    lt: (k: string, v: any) => { if (flat(k)) rows = rows.filter((r) => r[k] < v); return b; },
    range: async (a: number, z: number) => ({ data: rows.slice(a, z + 1), error: null }),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

import { fetchInventoryEngine } from "./inventory-engine";
import { buildRange, setBusinessConfig } from "./business-date";

beforeAll(() => setBusinessConfig({ monthStartDay: 1 }));
const period = (from: string, to: string) => buildRange("custom", from, to);

describe("saved openings carry forward", () => {
  it("October opening = saved September opening + September entries", async () => {
    const r = await fetchInventoryEngine(period("2026-10-01", "2026-10-31"));
    expect(r.products[0].opening).toBe(55);
    expect(r.products[0].remaining).toBe(58);
  });

  it("Current Stock starts from the latest saved opening", async () => {
    const r = await fetchInventoryEngine(period("2000-01-01", "2026-10-31"));
    expect(r.products[0].remaining).toBe(58);
  });
});
