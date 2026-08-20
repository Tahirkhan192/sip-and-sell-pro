/**
 * PHASE 5J / 5K — proves the offline reporting path computes THE SAME numbers
 * as the cloud path. The formulas are never duplicated: both sides call
 * `computeReport`, and only the row source differs.
 */

import { describe, expect, it } from "vitest";
import { computeReport, type ReportInputs } from "@/lib/report-engine";
import {
  assembleProduction,
  assembleSales,
  filterReportInputs,
} from "@/data/reads/report-inputs";
import { compareValues } from "@/data/repo/calc-parity";

const RANGE = {
  from: "2026-03-01",
  to: "2026-03-31",
  startUTC: "2026-03-01T03:00:00.000Z",
  endExclusiveUTC: "2026-04-01T03:00:00.000Z",
};

const products = [
  { id: "p1", name: "Chai", category: "Drinks", cost_price: 20, avg_price_override: null, opening_stock: 10, current_stock: 4 },
  { id: "p2", name: "Roll", category: "Food", cost_price: 60, avg_price_override: null, opening_stock: 5, current_stock: 2 },
];

const stockItems = [
  { id: "s1", name: "Milk", category: "Raw", purchase_price: 100, avg_price_override: null, opening_stock: 8, current_stock: 3 },
];

/** Flat mirror rows (what SQLite stores). */
const flatSales = [
  { id: "sa1", invoice_no: "INV-1", sale_date: "2026-03-05T09:00:00.000Z", grand_total: 300, delivery_charges: 50, cash_paid: 300, online_paid: 0, payment_method: "cash", customer_name: null, customer_phone: null, status: "completed", order_type: "walk_in", katha: false, staff_id: null, deleted_at: null },
  { id: "sa2", invoice_no: "INV-2", sale_date: "2026-03-09T11:00:00.000Z", grand_total: 120, delivery_charges: 0, cash_paid: 200, online_paid: 0, payment_method: "cash", customer_name: null, customer_phone: null, status: "completed", order_type: "delivery", katha: false, staff_id: null, deleted_at: null },
  // Outside the range — must be filtered out exactly like the cloud query does.
  { id: "sa3", invoice_no: "INV-3", sale_date: "2026-02-20T11:00:00.000Z", grand_total: 999, delivery_charges: 0, cash_paid: 999, online_paid: 0, payment_method: "cash", customer_name: null, customer_phone: null, status: "completed", order_type: "walk_in", katha: false, staff_id: null, deleted_at: null },
];

const flatSaleItems = [
  { id: "i1", sale_id: "sa1", product_id: "p1", quantity: 3, price: 60, total: 180, unit: "pcs" },
  { id: "i2", sale_id: "sa1", product_id: "p2", quantity: 1, price: 120, total: 120, unit: "pcs" },
  { id: "i3", sale_id: "sa2", product_id: "p1", quantity: 2, price: 60, total: 120, unit: "pcs" },
  { id: "i4", sale_id: "sa3", product_id: "p2", quantity: 5, price: 200, total: 999, unit: "pcs" },
];

const flatBatches = [
  { id: "b1", target_category: "Food", total_cost: 400, batch_date: "2026-03-07" },
  { id: "b2", target_category: "Food", total_cost: 700, batch_date: "2026-01-07" },
];
const flatBatchItems = [
  { id: "bi1", batch_id: "b1", source_category: "Raw", total_cost: 400 },
  { id: "bi2", batch_id: "b2", source_category: "Raw", total_cost: 700 },
];

const allExpenses = [
  { id: "e1", date: "2026-03-04", amount: 500, payment_status: "paid", payment_method: "cash", is_stock_transfer: false, source_product_id: null, source_stock_item_id: null },
  { id: "e2", date: "2026-03-06", amount: 90, payment_status: "unpaid", payment_method: "cash", is_stock_transfer: true, source_product_id: "p1", source_stock_item_id: null },
  { id: "e3", date: "2026-02-06", amount: 4000, payment_status: "paid", payment_method: "cash", is_stock_transfer: false, source_product_id: null, source_stock_item_id: null },
];

const allDelivery = [
  { id: "d1", date: "2026-03-08", fuel_cost: 30, maintenance_cost: 10 },
  { id: "d2", date: "2026-04-08", fuel_cost: 999, maintenance_cost: 0 },
];

const allPurchases = [
  { id: "sp1", date: "2026-03-02", product_id: "p1", stock_item_id: null, total_cost: 200, quantity: 10, unit_cost: 20, category: "Drinks" },
  { id: "sp2", date: "2026-03-03", product_id: null, stock_item_id: "s1", total_cost: 300, quantity: 3, unit_cost: 100, category: "Raw" },
  { id: "sp3", date: "2026-01-03", product_id: null, stock_item_id: "s1", total_cost: 9000, quantity: 90, unit_cost: 100, category: "Raw" },
];

const allTransfers = [
  { id: "t1", from_category: "Raw", to_category: "Food", total_cost: 150, created_at: "2026-03-10T06:00:00.000Z" },
  { id: "t2", from_category: "Raw", to_category: "Food", total_cost: 5000, created_at: "2026-04-10T06:00:00.000Z" },
];

const allOverrides = [
  { id: "o1", scope: "category", category: "Drinks", product_id: null, stock_item_id: null, year: 2026, month: 3, opening_value: 250, closing_value: null },
  { id: "o2", scope: "category", category: "Drinks", product_id: null, stock_item_id: null, year: 2026, month: 2, opening_value: 9999, closing_value: null },
];

const allSnapshots = [
  { scope: "product", item_id: "p1", year: 2026, month: 3, quantity: 12, unit_value: 20 },
  { scope: "product", item_id: "p1", year: 2026, month: 2, quantity: 900, unit_value: 20 },
];

const staff = [{ id: "st1", monthly_salary: 30000 }];
const allAttendance = [
  { staff_id: "st1", status: "present", date: "2026-03-01" },
  { staff_id: "st1", status: "present", date: "2026-03-02" },
  { staff_id: "st1", status: "present", date: "2026-02-02" },
];

const recipes = [
  { parent_product_id: "p2", component_product_id: null, component_stock_item_id: "s1", quantity: 0.5, applies_to: ["walk_in", "take_away", "delivery"] },
];

/** Exactly what PostgREST returns for the report queries, hand-written. */
function cloudInputs(): ReportInputs {
  return {
    sales: [
      {
        ...flatSales[1],
        sale_items: [
          { id: "i3", product_id: "p1", quantity: 2, price: 60, total: 120, unit: "pcs", products: { id: "p1", name: "Chai", category: "Drinks", cost_price: 20 } },
        ],
      },
      {
        ...flatSales[0],
        sale_items: [
          { id: "i1", product_id: "p1", quantity: 3, price: 60, total: 180, unit: "pcs", products: { id: "p1", name: "Chai", category: "Drinks", cost_price: 20 } },
          { id: "i2", product_id: "p2", quantity: 1, price: 120, total: 120, unit: "pcs", products: { id: "p2", name: "Roll", category: "Food", cost_price: 60 } },
        ],
      },
    ],
    expenses: [allExpenses[0], allExpenses[1]],
    deliveryExpenses: [allDelivery[0]],
    purchases: [allPurchases[0], allPurchases[1]],
    products,
    stockItems,
    recipes,
    transfers: [allTransfers[0]],
    production: [{ ...flatBatches[0], production_batch_items: [{ source_category: "Raw", total_cost: 400, component_product_id: null, component_stock_item_id: "s1", quantity: 2 }] }],
    transferExpenses: [allExpenses[1]],
    adjustments: [],
    overrides: [allOverrides[0]],
    snapshot: [allSnapshots[0]],
    staff,
    attendance: [allAttendance[0], allAttendance[1]],
  };
}

/** What `loadLocalReportInputs` builds from the flat mirror tables. */
function localInputsUnfiltered(): ReportInputs {
  return {
    sales: assembleSales(
      [flatSales[1], flatSales[0], flatSales[2]],
      flatSaleItems,
      products,
    ),
    expenses: allExpenses,
    deliveryExpenses: allDelivery,
    purchases: allPurchases,
    products,
    stockItems,
    recipes,
    transfers: allTransfers,
    production: assembleProduction(flatBatches, flatBatchItems),
    transferExpenses: allExpenses.filter((e) => e.is_stock_transfer === true),
    adjustments: [],
    overrides: allOverrides,
    snapshot: allSnapshots,
    staff,
    attendance: allAttendance,
  };
}

/** Report without the raw invoice rows (local rows legitimately carry more columns). */
function totalsOnly(result: any) {
  const { invoices, ...rest } = result;
  return rest;
}

describe("offline report inputs", () => {
  it("filters local rows to exactly the cloud query's result set", () => {
    const local = filterReportInputs(localInputsUnfiltered(), RANGE);
    const cloud = cloudInputs();

    expect(local.sales.map((s) => s.id)).toEqual(cloud.sales.map((s) => s.id));
    expect(local.expenses.map((e) => e.id)).toEqual(cloud.expenses.map((e) => e.id));
    expect(local.deliveryExpenses.map((e) => e.id)).toEqual(["d1"]);
    expect(local.purchases.map((p) => p.id)).toEqual(["sp1", "sp2"]);
    expect(local.transfers.map((t) => t.id)).toEqual(["t1"]);
    expect(local.production.map((b) => b.id)).toEqual(["b1"]);
    expect(local.transferExpenses.map((e) => e.id)).toEqual(["e2"]);
    expect(local.overrides.map((o) => o.id)).toEqual(["o1"]);
    expect(local.snapshot).toHaveLength(1);
    expect(local.attendance).toHaveLength(2);
  });

  it("rebuilds the embedded sale_items → products shape", () => {
    const sales = assembleSales(flatSales, flatSaleItems, products);
    const sa1 = sales.find((s) => s.id === "sa1")!;
    expect(sa1.sale_items).toEqual(cloudInputs().sales[1].sale_items);
    // A sale with no items gets an empty array, never undefined.
    expect(assembleSales([{ id: "zz" }], [], products)[0].sale_items).toEqual([]);
  });

  it("rebuilds the embedded production_batch_items shape", () => {
    expect(assembleProduction(flatBatches, flatBatchItems)[0].production_batch_items).toEqual([
      { source_category: "Raw", total_cost: 400 },
    ]);
    expect(assembleProduction([{ id: "b9" }], [])[0].production_batch_items).toEqual([]);
  });

  it("produces byte-identical report totals from cloud and local inputs", () => {
    const cloud = computeReport(cloudInputs(), RANGE, ["Drinks", "Food", "Raw"]);
    const local = computeReport(filterReportInputs(localInputsUnfiltered(), RANGE), RANGE, ["Drinks", "Food", "Raw"]);

    const parity = compareValues(totalsOnly(cloud), totalsOnly(local));
    expect(parity.differingFields).toEqual([]);
    expect(parity.missingFields).toEqual([]);
    expect(parity.equal).toBe(true);

    // Sanity: the fixture actually exercises the money paths.
    expect(cloud.totalSales).toBe(420);
    expect(cloud.totalChangeReturned).toBe(80);
    expect(cloud.staffSalaryCost).toBe(2000);
    expect(local.netProfit).toBe(cloud.netProfit);
  });

  it("keeps every invoice field the report UI reads", () => {
    const local = computeReport(filterReportInputs(localInputsUnfiltered(), RANGE), RANGE);
    const cloud = computeReport(cloudInputs(), RANGE);
    for (const key of Object.keys(cloud.invoices[0])) {
      expect(local.invoices[0][key]).toEqual(cloud.invoices[0][key]);
    }
  });
});
