/**
 * PHASE 6 — the classification registry is the contract the read/write gates
 * are built from, so it is tested as one: complete, self-consistent, and
 * identical to the sets the previously shipped phases enabled.
 */

import { describe, expect, it } from "vitest";
import {
  CLOUD_WRITE_BLOCKERS,
  ENTITY_CLASSIFICATION,
  LOCAL_READ_TABLE_SET,
  LOCAL_WRITE_TABLE_SET,
  REPORT_ONLY_TABLE_SET,
} from "./entity-classification";
import { LOCAL_READ_TABLES, LOCAL_WRITE_TABLES } from "./health";
import { MASTER_TABLES } from "@/data/local/mutations/master-tables";

const ALL_TABLES = [
  "audit_log", "branches", "cash_movements", "categories", "customers", "daily_closings",
  "delivery_expenses", "employees", "expense_categories", "expenses", "katha_opening",
  "money_movement_subcategories", "monthly_stock_overrides", "production_batch_items",
  "production_batches", "products", "purchase_items", "purchases", "recipes", "sale_items",
  "sales", "settings", "staff", "staff_attendance", "staff_month_carry", "staff_payments",
  "stock_adjustments", "stock_items", "stock_opening_snapshots", "stock_purchases",
  "stock_transfers", "suppliers", "user_roles",
];

describe("entity classification", () => {
  it("classifies every table exactly once", () => {
    expect(Object.keys(ENTITY_CLASSIFICATION).sort()).toEqual([...ALL_TABLES].sort());
  });

  it("documents a blocker for every cloud write", () => {
    for (const { table, reason } of CLOUD_WRITE_BLOCKERS) {
      expect(reason.length, table).toBeGreaterThan(20);
    }
    // Nothing may be written locally without also being readable locally.
    for (const table of LOCAL_WRITE_TABLE_SET) {
      expect(ENTITY_CLASSIFICATION[table].read, table).toBe("local");
    }
  });

  it("keeps the money-critical entities cloud-write", () => {
    for (const table of [
      "sales", "sale_items", "purchases", "purchase_items", "stock_purchases",
      "cash_movements", "staff_payments", "daily_closings", "katha_opening",
      "production_batches", "stock_transfers", "user_roles",
    ] as const) {
      expect(ENTITY_CLASSIFICATION[table].write, table).toBe("cloud");
    }
  });

  it("drives the health gates", () => {
    expect(LOCAL_READ_TABLES).toBe(LOCAL_READ_TABLE_SET);
    expect(LOCAL_WRITE_TABLES).toBe(LOCAL_WRITE_TABLE_SET);
  });

  it("matches the sets the earlier phases shipped", () => {
    expect(LOCAL_READ_TABLE_SET).toEqual([
      "branches", "categories", "customers", "employees", "expense_categories", "expenses",
      "money_movement_subcategories", "products", "purchase_items", "purchases", "recipes",
      "settings", "staff", "stock_adjustments", "stock_items", "stock_purchases", "suppliers",
    ]);
    expect(LOCAL_WRITE_TABLE_SET).toEqual([
      "branches", "categories", "customers", "employees", "expense_categories", "expenses",
      "money_movement_subcategories", "products", "recipes", "settings", "staff",
      "stock_adjustments", "stock_items", "suppliers",
    ]);
    // Every locally writable table is a table the mutation layer knows about.
    for (const t of LOCAL_WRITE_TABLE_SET) expect(MASTER_TABLES).toContain(t as any);
  });

  it("keeps report-mirrored tables out of the ordinary local read path", () => {
    for (const table of REPORT_ONLY_TABLE_SET) {
      expect(LOCAL_READ_TABLE_SET).not.toContain(table);
    }
    expect(REPORT_ONLY_TABLE_SET).toContain("sales");
    expect(REPORT_ONLY_TABLE_SET).toContain("sale_items");
  });
});
