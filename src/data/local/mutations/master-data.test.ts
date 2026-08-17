/**
 * PHASE 5B — master-data mutation tests.
 *
 * These run in Node (vitest), where there is no Worker and no OPFS, so they
 * cover everything that must be provably correct BEFORE SQLite is touched:
 * table classification, column contracts, value encoding, insert/update row
 * building, cross-column invariants, and the guarantee that with the default
 * flags no local write path can execute at all.
 */

import { describe, expect, it } from "vitest";

import {
  CLOUD_ONLY_TABLES,
  MASTER_TABLES,
  MASTER_TABLE_SPECS,
  MasterDataError,
  assertRowInvariants,
  assertWritable,
  classifyTable,
  encodeColumnValue,
  isMasterTable,
  tableSpec,
} from "./master-tables";
import {
  BUSINESS_WRITES_ENABLED,
  MASTER_DATA_WRITES_ENABLED,
  assertMasterDataWritesEnabled,
} from "./flags";
import { LocalMutationError } from "./errors";
import {
  buildInsertRow,
  buildUpdateValues,
  createCategory,
  createMasterRow,
  createProduct,
  createRecipe,
  createStaff,
  updateBusinessSettings,
  updateMasterRow,
} from "./procedures";

/* ------------------------------------------------------------------ */

describe("Phase 5B — table classification", () => {
  it("classifies every master table as SAFE_LOCAL", () => {
    for (const t of MASTER_TABLES) {
      expect(classifyTable(t)).toBe("SAFE_LOCAL");
      expect(isMasterTable(t)).toBe(true);
    }
  });

  it("classifies every transactional table as CLOUD_ONLY", () => {
    for (const t of CLOUD_ONLY_TABLES) {
      expect(classifyTable(t)).toBe("CLOUD_ONLY");
      expect(isMasterTable(t)).toBe(false);
    }
  });

  it("never classifies a money/stock table as writable", () => {
    for (const t of ["sales", "purchases", "expenses", "cash_movements", "stock_transfers"]) {
      expect(classifyTable(t)).toBe("CLOUD_ONLY");
      expect(() => tableSpec(t)).toThrow(MasterDataError);
    }
  });

  it("keeps transactional writes disabled", () => {
    expect(BUSINESS_WRITES_ENABLED).toBe(false);
    expect(MASTER_DATA_WRITES_ENABLED).toBe(true);
  });

  it("every master table declares a primary key and columns", () => {
    for (const t of MASTER_TABLES) {
      const spec = MASTER_TABLE_SPECS[t];
      expect(spec.columns[spec.pk]).toBeTruthy();
      expect(Object.keys(spec.columns).length).toBeGreaterThan(2);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("Phase 5B — derived columns are never writable", () => {
  const derived: [string, string][] = [
    ["products", "current_stock"],
    ["products", "last_sold_at"],
    ["stock_items", "current_stock"],
    ["customers", "balance"],
    ["customers", "total_purchases"],
    ["customers", "outstanding_balance"],
    ["suppliers", "balance"],
    ["settings", "whatsapp_token"],
    ["settings", "whatsapp_phone_id"],
  ];

  it.each(derived)("%s.%s cannot be written locally", (table, column) => {
    expect(() => assertWritable(table as any, column, "update")).toThrow(MasterDataError);
  });

  it("staff.katha_balance may only be seeded at insert", () => {
    expect(() => assertWritable("staff", "katha_balance", "insert")).not.toThrow();
    expect(() => assertWritable("staff", "katha_balance", "update")).toThrow(MasterDataError);
  });

  it("rejects unknown columns", () => {
    expect(() => assertWritable("categories", "not_a_column" as any, "update")).toThrow(
      MasterDataError,
    );
  });
});

/* ------------------------------------------------------------------ */

describe("Phase 5B — value encoding matches the seeded storage shape", () => {
  it("stores booleans as 0/1", () => {
    expect(encodeColumnValue("categories", "active", true)).toBe(1);
    expect(encodeColumnValue("categories", "active", false)).toBe(0);
    expect(encodeColumnValue("products", "track_stock", true)).toBe(1);
  });

  it("stores json/array columns as JSON text", () => {
    expect(encodeColumnValue("recipes", "applies_to", ["walk_in", "delivery"])).toBe(
      '["walk_in","delivery"]',
    );
    expect(encodeColumnValue("settings", "pin_locks", { stock: true })).toBe('{"stock":true}');
  });

  it("keeps text, numbers, uuids and nulls verbatim", () => {
    expect(encodeColumnValue("categories", "name", "Chai")).toBe("Chai");
    expect(encodeColumnValue("products", "sale_price", 250.5)).toBe(250.5);
    expect(encodeColumnValue("categories", "description", null)).toBeNull();
    const id = "11111111-2222-4333-8444-555555555555";
    expect(encodeColumnValue("recipes", "parent_product_id", id)).toBe(id);
  });

  it("rejects a null in a NOT NULL column", () => {
    expect(() => encodeColumnValue("categories", "name", null)).toThrow(MasterDataError);
    expect(() => encodeColumnValue("products", "category", null)).toThrow(MasterDataError);
  });

  it("enforces the cloud CHECK value sets", () => {
    expect(() => encodeColumnValue("products", "unit", "box")).toThrow(MasterDataError);
    expect(() => encodeColumnValue("products", "selling_method", "auto")).toThrow(MasterDataError);
    expect(() => encodeColumnValue("staff", "status", "retired")).toThrow(MasterDataError);
    expect(() => encodeColumnValue("money_movement_subcategories", "category", "Misc")).toThrow(
      MasterDataError,
    );
    expect(() => encodeColumnValue("recipes", "applies_to", ["dine_in"])).toThrow(MasterDataError);
    expect(() => encodeColumnValue("recipes", "applies_to", [])).toThrow(MasterDataError);
  });

  it("enforces numeric bounds", () => {
    expect(() => encodeColumnValue("settings", "business_month_start_day", 0)).toThrow(
      MasterDataError,
    );
    expect(() => encodeColumnValue("settings", "business_month_start_day", 29)).toThrow(
      MasterDataError,
    );
    expect(encodeColumnValue("settings", "business_month_start_day", 6)).toBe(6);
    expect(() => encodeColumnValue("products", "sale_price", Number.NaN)).toThrow(MasterDataError);
  });

  it("rejects a malformed uuid", () => {
    expect(() => encodeColumnValue("stock_items", "supplier_id", "not-a-uuid")).toThrow(
      MasterDataError,
    );
  });
});

/* ------------------------------------------------------------------ */

describe("Phase 5B — insert row building", () => {
  const at = new Date("2026-03-04T09:15:00.000Z");

  it("fills id, timestamps, soft-delete marker and contract defaults", () => {
    const row = buildInsertRow("categories", { name: "Bakery" }, at);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.name).toBe("Bakery");
    expect(row.sort_order).toBe(0);
    expect(row.active).toBe(1);
    expect(row.created_at).toBe(at.toISOString());
    expect(row.updated_at).toBe(at.toISOString());
    expect(row.deleted_at).toBeNull();
    expect(row.description).toBeNull();
  });

  it("produces every column the mirror table declares", () => {
    const row = buildInsertRow("products", { name: "Chai", category: "Drinks" }, at);
    expect(Object.keys(row).sort()).toEqual(Object.keys(MASTER_TABLE_SPECS.products.columns).sort());
    expect(row.current_stock).toBe(0);
    expect(row.unit).toBe("pcs");
    expect(row.track_stock).toBe(1);
    expect(row.auto_calc).toBe(0);
  });

  it("refuses to write a derived column", () => {
    expect(() => buildInsertRow("products", { name: "X", category: "Y", current_stock: 99 }, at)).toThrow(
      MasterDataError,
    );
  });

  it("requires the required columns", () => {
    expect(() => buildInsertRow("categories", {}, at)).toThrow(MasterDataError);
    expect(() => buildInsertRow("products", { name: "X" }, at)).toThrow(MasterDataError);
    expect(() => buildInsertRow("staff", { name: "Ali" }, at)).toThrow(MasterDataError);
  });

  it("seeds staff katha balance from the opening katha", () => {
    const row = buildInsertRow(
      "staff",
      { name: "Ali", joining_date: "2026-03-01", opening_katha: 1200, katha_balance: 1200 },
      at,
    );
    expect(row.opening_katha).toBe(1200);
    expect(row.katha_balance).toBe(1200);
    expect(row.status).toBe("active");
  });
});

describe("Phase 5B — update value building", () => {
  const at = new Date("2026-03-04T09:15:00.000Z");

  it("only sets the supplied columns and refreshes updated_at", () => {
    const values = buildUpdateValues("categories", { name: "Snacks", active: false }, at);
    expect(values).toEqual({ name: "Snacks", active: 0, updated_at: at.toISOString() });
  });

  it("does not add updated_at to a table that has no such column", () => {
    const values = buildUpdateValues("customers", { phone: "0300" }, at);
    expect(values).toEqual({ phone: "0300" });
  });

  it("ignores undefined and rejects an empty patch", () => {
    expect(() => buildUpdateValues("categories", { name: undefined }, at)).toThrow(MasterDataError);
  });

  it("rejects derived and unknown columns", () => {
    expect(() => buildUpdateValues("staff", { katha_balance: 5 }, at)).toThrow(MasterDataError);
    expect(() => buildUpdateValues("categories", { nope: 1 }, at)).toThrow(MasterDataError);
  });
});

/* ------------------------------------------------------------------ */

describe("Phase 5B — recipe invariants mirror the cloud CHECK constraints", () => {
  const parent = "11111111-2222-4333-8444-555555555555";
  const comp = "99999999-2222-4333-8444-555555555555";

  it("needs exactly one component", () => {
    expect(() =>
      assertRowInvariants(
        "recipes",
        { parent_product_id: parent, component_product_id: null, component_stock_item_id: null },
        "insert",
      ),
    ).toThrow(MasterDataError);
    expect(() =>
      assertRowInvariants(
        "recipes",
        { parent_product_id: parent, component_product_id: comp, component_stock_item_id: comp },
        "insert",
      ),
    ).toThrow(MasterDataError);
    expect(() =>
      assertRowInvariants(
        "recipes",
        {
          parent_product_id: parent,
          component_product_id: comp,
          component_stock_item_id: null,
          quantity: 2,
        },
        "insert",
      ),
    ).not.toThrow();
  });

  it("rejects a non-positive quantity and self-reference", () => {
    expect(() =>
      assertRowInvariants(
        "recipes",
        { parent_product_id: parent, component_product_id: comp, quantity: 0 },
        "insert",
      ),
    ).toThrow(MasterDataError);
    expect(() =>
      assertRowInvariants(
        "recipes",
        { parent_product_id: parent, component_product_id: parent, quantity: 1 },
        "insert",
      ),
    ).toThrow(MasterDataError);
  });
});

/* ------------------------------------------------------------------ */

describe("Phase 5B — write gating (default flags are OFF)", () => {
  it("refuses a transactional table outright", () => {
    for (const t of ["sales", "purchases", "cash_movements"]) {
      try {
        assertMasterDataWritesEnabled(t);
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(LocalMutationError);
        expect(["BUSINESS_WRITES_DISABLED", "LOCAL_SQLITE_DISABLED", "LOCAL_WRITES_DISABLED"]).toContain(
          e.code,
        );
      }
    }
  });

  it("blocks every master procedure while the flags are off", async () => {
    const calls: Promise<unknown>[] = [
      createCategory({ name: "Nope" }),
      createProduct({ name: "Nope", category: "Drinks" }),
      createStaff({ name: "Nope", joining_date: "2026-03-01" }),
      createRecipe({
        parent_product_id: "11111111-2222-4333-8444-555555555555",
        component_stock_item_id: "99999999-2222-4333-8444-555555555555",
        quantity: 1,
      }),
      updateBusinessSettings({ allow_negative_stock: true }),
      createMasterRow("categories", { name: "Nope" }),
      updateMasterRow("categories", "11111111-2222-4333-8444-555555555555", { name: "Nope" }),
    ];
    for (const call of calls) {
      await expect(call).rejects.toBeInstanceOf(LocalMutationError);
    }
  });

  it("never routes a transactional table through a master procedure", async () => {
    await expect(createMasterRow("sales" as any, { id: "x" })).rejects.toMatchObject({
      name: "LocalMutationError",
    });
  });
});
