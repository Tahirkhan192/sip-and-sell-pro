/**
 * PHASE 5G — purchase read parity (pure).
 *
 * Proves the local assembler rebuilds EXACTLY the shape PostgREST returns for
 * `*, purchase_items(*, products(name,unit), stock_items(name,unit))`, using
 * the same rows on both sides. Any field difference fails the test — there is
 * no tolerance and no normalization.
 */

import { describe, expect, it } from "vitest";

import { compareValues } from "@/data/repo/calc-parity";
import { assemblePurchases } from "./purchases";

const products = [
  { id: "p1", name: "Chicken", unit: "kg" },
  { id: "p2", name: "Bun", unit: "pcs" },
];
const stockItems = [{ id: "s1", name: "Cooking Oil", unit: "ltr" }];

const purchases = [
  {
    id: "pu1",
    date: "2026-03-02",
    supplier: "Metro",
    category: "Kitchen",
    payment_status: "paid",
    payment_method: "cash",
    grand_total: 1500,
    notes: null,
    deleted_at: null,
  },
  {
    id: "pu2",
    date: "2026-03-01",
    supplier: null,
    category: "Kitchen",
    payment_status: "unpaid",
    payment_method: null,
    grand_total: 400,
    notes: "credit",
    deleted_at: null,
  },
];

const items = [
  {
    id: "i1",
    purchase_id: "pu1",
    product_id: "p1",
    stock_item_id: null,
    category: "Kitchen",
    quantity: 3,
    unit: "kg",
    unit_cost: 400,
    total_cost: 1200,
  },
  {
    id: "i2",
    purchase_id: "pu1",
    product_id: null,
    stock_item_id: "s1",
    category: "Kitchen",
    quantity: 2,
    unit: "ltr",
    unit_cost: 150,
    total_cost: 300,
  },
  {
    id: "i3",
    purchase_id: "pu2",
    product_id: "p2",
    stock_item_id: null,
    category: "Kitchen",
    quantity: 40,
    unit: "pcs",
    unit_cost: 10,
    total_cost: 400,
  },
];

/** What the cloud embedded select returns for exactly these rows. */
const cloudShape = [
  {
    ...purchases[0],
    purchase_items: [
      { ...items[0], products: { name: "Chicken", unit: "kg" }, stock_items: null },
      { ...items[1], products: null, stock_items: { name: "Cooking Oil", unit: "ltr" } },
    ],
  },
  {
    ...purchases[1],
    purchase_items: [{ ...items[2], products: { name: "Bun", unit: "pcs" }, stock_items: null }],
  },
];

describe("Phase 5G — purchase read parity", () => {
  it("rebuilds the embedded cloud shape field for field", () => {
    const local = assemblePurchases(purchases, items, products, stockItems);
    const parity = compareValues(cloudShape, local);
    expect(parity.differingFields).toEqual([]);
    expect(parity.missingFields).toEqual([]);
    expect(parity.unexpectedFields).toEqual([]);
    expect(parity.equal).toBe(true);
  });

  it("keeps parent order and never invents or drops rows", () => {
    const local = assemblePurchases(purchases, items, products, stockItems);
    expect(local.map((p) => p.id)).toEqual(["pu1", "pu2"]);
    expect(local.flatMap((p) => p.purchase_items).map((i: any) => i.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("returns an empty item list — never a missing key — for a purchase with no items", () => {
    const local = assemblePurchases([{ id: "pu9" }], [], products, stockItems);
    expect(local[0].purchase_items).toEqual([]);
  });

  it("does not resolve a name for an item whose product is not in the catalogue", () => {
    const local = assemblePurchases(
      [purchases[0]],
      [{ id: "x", purchase_id: "pu1", product_id: "missing", stock_item_id: null }],
      products,
      stockItems,
    );
    expect(local[0].purchase_items[0].products).toBeNull();
    expect(local[0].purchase_items[0].stock_items).toBeNull();
  });

  it("does not sum, round or repair any stored number", () => {
    const local = assemblePurchases(purchases, items, products, stockItems);
    expect(local[0].grand_total).toBe(1500);
    expect(local[0].purchase_items.map((i: any) => i.total_cost)).toEqual([1200, 300]);
  });
});
