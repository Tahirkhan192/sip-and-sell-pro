/**
 * PHASE 5G — purchase reads against REAL SQLite.
 *
 * Rows are written into the `cloud_*` mirror exactly as the Phase 3 seed would
 * write them, then read back through the same query path the screen uses, and
 * compared to the rows that went in. Soft-deleted purchases must disappear,
 * ordering must match, and money/quantity values must come back unchanged
 * (SQLite REAL round-trip included).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeEngine, openEngine, type LocalDb } from "../local/engine";
import { applyMirrorSchema, mirrorTable } from "../local/mirror";
import { assemblePurchases } from "./purchases";

let db: LocalDb;

const PRODUCT_DEFAULTS = {
  sale_price: 0,
  cost_price: 0,
  active: 1,
  created_at: "2026-03-01T00:00:00.000Z",
  opening_stock: 0,
  current_stock: 0,
  minimum_stock: 0,
  selling_method: "unit",
  allow_negative_stock: 0,
  track_stock: 1,
  auto_calc: 0,
};

const STOCK_ITEM_DEFAULTS = {
  opening_stock: 0,
  current_stock: 0,
  minimum_stock: 0,
  purchase_price: 0,
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
  auto_calc: 0,
};

const TIMESTAMPS = {
  created_at: "2026-03-01T00:00:00.000Z",
  updated_at: "2026-03-01T00:00:00.000Z",
};

function insert(table: string, values: Record<string, unknown>) {
  const defaults =
    table === "products"
      ? PRODUCT_DEFAULTS
      : table === "stock_items"
        ? STOCK_ITEM_DEFAULTS
        : table === "purchase_items"
          ? { created_at: TIMESTAMPS.created_at }
          : TIMESTAMPS;
  const row: Record<string, unknown> = { ...defaults, ...values };
  const cols = Object.keys(row);
  db.exec({
    sql: `INSERT OR REPLACE INTO "${mirrorTable(table)}" (${cols.map((c) => `"${c}"`).join(",")})
          VALUES (${cols.map(() => "?").join(",")})`,
    bind: cols.map((c) => row[c] as any),
  } as any);
}

function selectObjects(sql: string, bind: any[] = []) {
  return db.selectObjects(sql, bind as any) as any[];
}

beforeAll(async () => {
  db = await openEngine();
  applyMirrorSchema(db);

  insert("products", { id: "pp1", name: "Chicken", category: "Kitchen", unit: "kg" });
  insert("stock_items", { id: "ss1", name: "Cooking Oil", unit: "ltr", category: "Kitchen" });

  insert("purchases", {
    id: "pq1",
    date: "2026-03-02",
    supplier: "Metro",
    category: "Kitchen",
    payment_status: "paid",
    payment_method: "cash",
    grand_total: 1234.56,
    deleted_at: null,
  });
  insert("purchases", {
    id: "pq2",
    date: "2026-03-05",
    supplier: "Local",
    category: "Kitchen",
    payment_status: "unpaid",
    grand_total: 90.25,
    deleted_at: null,
  });
  insert("purchases", {
    id: "pq3",
    date: "2026-03-06",
    supplier: "Deleted",
    category: "Kitchen",
    payment_status: "paid",
    grand_total: 10,
    deleted_at: "2026-03-06T10:00:00.000Z",
  });

  insert("purchase_items", {
    id: "pi1",
    purchase_id: "pq1",
    product_id: "pp1",
    stock_item_id: null,
    category: "Kitchen",
    quantity: 3,
    unit: "kg",
    unit_cost: 411.52,
    total_cost: 1234.56,
  });
  insert("purchase_items", {
    id: "pi2",
    purchase_id: "pq2",
    product_id: null,
    stock_item_id: "ss1",
    category: "Kitchen",
    quantity: 0.5,
    unit: "ltr",
    unit_cost: 180.5,
    total_cost: 90.25,
  });
});

afterAll(async () => {
  await closeEngine();
});

function readPurchases() {
  const purchases = selectObjects(
    `SELECT * FROM "${mirrorTable("purchases")}" WHERE deleted_at IS NULL ORDER BY date DESC`,
  );
  const items = selectObjects(`SELECT * FROM "${mirrorTable("purchase_items")}"`);
  const products = selectObjects(`SELECT id, name, unit FROM "${mirrorTable("products")}"`);
  const stockItems = selectObjects(`SELECT id, name, unit FROM "${mirrorTable("stock_items")}"`);
  return assemblePurchases(purchases, items, products, stockItems);
}

describe("Phase 5G — purchase reads from real SQLite", () => {
  it("returns live purchases newest first and hides soft-deleted ones", () => {
    const rows = readPurchases();
    expect(rows.map((r) => r.id)).toEqual(["pq2", "pq1"]);
  });

  it("attaches each item to its own purchase with the right name embed", () => {
    const rows = readPurchases();
    const pq1 = rows.find((r) => r.id === "pq1")!;
    const pq2 = rows.find((r) => r.id === "pq2")!;
    expect(pq1.purchase_items).toHaveLength(1);
    expect(pq1.purchase_items[0].products).toEqual({ name: "Chicken", unit: "kg" });
    expect(pq1.purchase_items[0].stock_items).toBeNull();
    expect(pq2.purchase_items[0].stock_items).toEqual({ name: "Cooking Oil", unit: "ltr" });
    expect(pq2.purchase_items[0].products).toBeNull();
  });

  it("round-trips money and fractional quantities without drift", () => {
    const rows = readPurchases();
    const pq1 = rows.find((r) => r.id === "pq1")!;
    const pq2 = rows.find((r) => r.id === "pq2")!;
    expect(pq1.grand_total).toBe(1234.56);
    expect(pq1.purchase_items[0].unit_cost).toBe(411.52);
    expect(pq2.purchase_items[0].quantity).toBe(0.5);
    expect(pq2.grand_total).toBe(90.25);
  });

  it("supplier and payment-status filtering match the stored values exactly", () => {
    const rows = readPurchases();
    expect(rows.filter((r) => r.supplier === "Metro").map((r) => r.id)).toEqual(["pq1"]);
    expect(rows.filter((r) => r.payment_status === "unpaid").map((r) => r.id)).toEqual(["pq2"]);
  });

  it("date-range filtering over the mirror matches the stored business dates", () => {
    const rows = selectObjects(
      `SELECT id FROM "${mirrorTable("purchases")}"
       WHERE deleted_at IS NULL AND date >= ? AND date <= ? ORDER BY date`,
      ["2026-03-01", "2026-03-03"],
    );
    expect(rows.map((r) => r.id)).toEqual(["pq1"]);
  });
});
