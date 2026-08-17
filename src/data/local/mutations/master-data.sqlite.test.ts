/**
 * PHASE 5B — real SQLite proof for master-data mutations.
 *
 * Uses the real engine (in Node it opens the in-memory fallback, which is the
 * same SQLite build the worker runs) and the real mirror schema, so the tests
 * exercise actual statements, actual foreign keys and actual rollback.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeEngine, openEngine, type LocalDb } from "../engine";
import { applyMirrorSchema, mirrorTable } from "../mirror";
import { runMutationTx } from "./engine-mutations";
import { buildInsertRow, buildUpdateValues } from "./procedures/run";
import { newUuid } from "./ids";

let db: LocalDb;

const at = new Date("2026-03-04T09:15:00.000Z");

function rows(table: string, where = ""): any[] {
  return db.selectObjects(`SELECT * FROM "${mirrorTable(table)}" ${where}`) as any[];
}

function insertStep(table: any, input: Record<string, unknown>) {
  return { kind: "masterInsert" as const, table, row: buildInsertRow(table, input, at) };
}

beforeAll(async () => {
  db = await openEngine();
  applyMirrorSchema(db);
});

afterAll(async () => {
  await closeEngine();
});

describe("Phase 5B — master data against real SQLite", () => {
  it("inserts, updates and soft-deletes a category in the mirror table", () => {
    const step = insertStep("categories", { name: "Bakery", sort_order: 3 });
    const id = String((step.row as any).id);

    expect(runMutationTx(db, [step])).toMatchObject({ committed: true, applied: 1 });
    const [row] = rows("categories", `WHERE id = '${id}'`);
    expect(row.name).toBe("Bakery");
    expect(row.active).toBe(1);
    expect(row.deleted_at).toBeNull();

    const upd = runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "categories",
        id,
        values: buildUpdateValues("categories", { name: "Bakery & Sweets", active: false }, at),
      },
    ]);
    expect(upd).toMatchObject({ committed: true });
    const [after] = rows("categories", `WHERE id = '${id}'`);
    expect(after.name).toBe("Bakery & Sweets");
    expect(after.active).toBe(0);
    expect(after.updated_at).toBe(at.toISOString());

    runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "categories",
        id,
        values: { deleted_at: at.toISOString(), updated_at: at.toISOString() },
      },
    ]);
    expect(rows("categories", `WHERE id = '${id}'`)[0].deleted_at).toBe(at.toISOString());
  });

  it("enforces the UNIQUE(name) constraint and rolls back", () => {
    const a = insertStep("categories", { name: "Grill" });
    expect(runMutationTx(db, [a])).toMatchObject({ committed: true });

    const b = insertStep("categories", { name: "grill" });
    const outcome = runMutationTx(db, [b]);
    expect(outcome.committed).toBe(false);
    expect(rows("categories", `WHERE lower(name) = 'grill'`)).toHaveLength(1);
  });

  it("refuses a transactional table and a derived column", () => {
    const bad = runMutationTx(db, [
      { kind: "masterInsert", table: "sales" as any, row: { id: newUuid() } },
    ]);
    expect(bad.committed).toBe(false);
    expect(bad).toMatchObject({ rolledBack: true });

    const derived = runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "products",
        id: newUuid(),
        values: { current_stock: 42 },
      },
    ]);
    expect(derived.committed).toBe(false);
  });

  it("keeps foreign keys on: a recipe cannot point at a missing product", () => {
    const orphan = insertStep("recipes", {
      parent_product_id: newUuid(),
      component_stock_item_id: newUuid(),
      quantity: 2,
    });
    const outcome = runMutationTx(db, [orphan]);
    expect(outcome.committed).toBe(false);
  });

  it("writes a product + recipe atomically and rolls both back on failure", () => {
    const product = insertStep("products", { name: "Chai", category: "Drinks" });
    const productId = String((product.row as any).id);
    const component = insertStep("products", { name: "Milk", category: "Drinks" });
    const componentId = String((component.row as any).id);
    expect(runMutationTx(db, [product, component])).toMatchObject({ committed: true });

    const recipe = insertStep("recipes", {
      parent_product_id: productId,
      component_product_id: componentId,
      quantity: 0.25,
      applies_to: ["walk_in", "delivery"],
    });
    const failed = runMutationTx(db, [
      recipe,
      { kind: "failDeliberately", message: "boom" },
    ]);
    expect(failed.committed).toBe(false);
    expect(rows("recipes", `WHERE parent_product_id = '${productId}'`)).toHaveLength(0);

    expect(runMutationTx(db, [recipe])).toMatchObject({ committed: true });
    const [line] = rows("recipes", `WHERE parent_product_id = '${productId}'`);
    expect(line.quantity).toBe(0.25);
    expect(line.applies_to).toBe('["walk_in","delivery"]');
    expect(line.component_stock_item_id).toBeNull();
  });

  it("never creates or deletes the settings row locally", () => {
    const insert = runMutationTx(db, [
      { kind: "masterInsert", table: "settings", row: { id: 1 } as any },
    ]);
    expect(insert.committed).toBe(false);

    const hardDelete = runMutationTx(db, [
      { kind: "masterDelete", table: "categories", id: newUuid() },
    ]);
    expect(hardDelete.committed).toBe(false);
  });

  it("updates the settings row without touching credentials", () => {
    db.exec({
      sql: `INSERT OR REPLACE INTO "${mirrorTable("settings")}"
            (id, allow_negative_stock, updated_at, whatsapp_token, whatsapp_phone_id,
             whatsapp_business_id, whatsapp_country_code, whatsapp_auto_send, timezone,
             business_day_start_time, business_month_start_day, pin_locks, staff_invoice_color)
            VALUES (1, 0, ?, 'secret-token', 'phone', 'biz', '92', 1, 'Asia/Karachi', '08:00:00', 6, '{}', '#DBEAFE')`,
      bind: [at.toISOString()],
    });

    const outcome = runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "settings",
        id: 1,
        values: buildUpdateValues(
          "settings",
          { business_month_start_day: 5, pin_locks: { stock: true } },
          at,
        ),
      },
    ]);
    expect(outcome).toMatchObject({ committed: true });
    const [row] = rows("settings", "WHERE id = 1");
    expect(row.business_month_start_day).toBe(5);
    expect(row.pin_locks).toBe('{"stock":true}');
    expect(row.whatsapp_token).toBe("secret-token");
  });
});
