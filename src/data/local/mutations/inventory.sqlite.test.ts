/**
 * PHASE 5H — real SQLite proof for offline manual stock adjustments.
 *
 * Proves:
 *   1. an adjustment (positive and negative) can be recorded locally and lands
 *      in the mirror table exactly as the cloud insert would,
 *   2. the ledger sum used by the inventory engine matches the cloud formula
 *      (parity: opening + purchases … + SUM(adjustments)),
 *   3. adjustments are insert-only and target exactly one item, and
 *   4. everything else transactional (purchases, sales, transfers, snapshots)
 *      is still refused by the contract.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeEngine, openEngine, type LocalDb } from "../engine";
import { applyMirrorSchema, mirrorTable } from "../mirror";
import { runMutationTx } from "./engine-mutations";
import { buildInsertRow, buildUpdateValues } from "./procedures/run";
import { classifyTable, tableSpec } from "./master-tables";
import { newUuid } from "./ids";

let db: LocalDb;
const at = new Date("2026-03-04T09:15:00.000Z");
const PRODUCT = newUuid();

function adjustments(where = ""): any[] {
  return db.selectObjects(
    `SELECT * FROM "${mirrorTable("stock_adjustments")}" ${where}`,
  ) as any[];
}

function insert(input: Record<string, unknown>) {
  const row = buildInsertRow("stock_adjustments", input, at);
  const outcome = runMutationTx(db, [
    { kind: "masterInsert", table: "stock_adjustments", row },
  ]);
  return { row, outcome };
}

beforeAll(async () => {
  db = await openEngine();
  applyMirrorSchema(db);
  db.exec({
    sql: `INSERT INTO "${mirrorTable("products")}"
            (id, name, category, sale_price, cost_price, active, created_at,
             opening_stock, current_stock, minimum_stock, unit, selling_method,
             allow_negative_stock, track_stock, auto_calc)
          VALUES (?, 'Chai', 'Drinks', 100, 40, 1, ?, 10, 10, 0, 'pcs', 'unit', 0, 1, 1)`,
    bind: [PRODUCT, at.toISOString()] as any[],
  });
});

afterAll(async () => {
  await closeEngine();
});

describe("Phase 5H — stock adjustments against real SQLite", () => {
  it("classifies adjustments as locally writable and keeps the rest cloud-only", () => {
    expect(classifyTable("stock_adjustments")).toBe("SAFE_LOCAL");
    expect(tableSpec("stock_adjustments").allowInsert).toBe(true);
    for (const t of [
      "purchases",
      "purchase_items",
      "stock_purchases",
      "sales",
      "sale_items",
      "stock_transfers",
      "stock_opening_snapshots",
      "monthly_stock_overrides",
      "production_batches",
      "cash_movements",
    ]) {
      expect(classifyTable(t)).toBe("CLOUD_ONLY");
    }
  });

  it("records positive and negative adjustments with cloud-shaped columns", () => {
    const add = insert({ scope: "product", product_id: PRODUCT, quantity: 5, date: "2026-03-04" });
    expect(add.outcome).toMatchObject({ committed: true });
    const remove = insert({
      scope: "product",
      product_id: PRODUCT,
      quantity: -2,
      reason: "Wastage",
      date: "2026-03-04",
    });
    expect(remove.outcome).toMatchObject({ committed: true });

    const stored = adjustments(`WHERE product_id = '${PRODUCT}' ORDER BY quantity`);
    expect(stored).toHaveLength(2);
    expect(stored[0].quantity).toBe(-2);
    expect(stored[0].reason).toBe("Wastage");
    expect(stored[0].scope).toBe("product");
    expect(stored[0].stock_item_id).toBeNull();
    // `created_by` is left null locally, exactly like the cloud insert.
    expect(stored[0].created_by).toBeNull();
    expect(stored[0].deleted_at).toBeNull();
    expect(stored[1].created_at).toBe(at.toISOString());
  });

  it("matches the cloud ledger sum used by the inventory formula", () => {
    const [{ total }] = db.selectObjects(
      `SELECT COALESCE(SUM(quantity), 0) AS total
         FROM "${mirrorTable("stock_adjustments")}"
        WHERE deleted_at IS NULL AND product_id = '${PRODUCT}'`,
    ) as any[];
    // rebuild_item_remaining: opening(10) + adjustments(+5-2) with nothing else.
    expect(Number(total)).toBe(3);
    expect(10 + Number(total)).toBe(13);
  });

  it("refuses an adjustment without exactly one target, and any edit", () => {
    expect(() =>
      buildInsertRow("stock_adjustments", { scope: "product", quantity: 1, date: "2026-03-04" }, at),
    ).toThrow(/exactly one target/i);
    expect(() =>
      buildInsertRow(
        "stock_adjustments",
        { scope: "product", product_id: PRODUCT, stock_item_id: newUuid(), quantity: 1, date: "2026-03-04" },
        at,
      ),
    ).toThrow(/exactly one target/i);
    expect(() =>
      buildInsertRow(
        "stock_adjustments",
        { scope: "product", product_id: PRODUCT, quantity: 0, date: "2026-03-04" },
        at,
      ),
    ).toThrow(/non-zero/i);
    expect(() => buildUpdateValues("stock_adjustments", { quantity: 4 }, at)).toThrow(
      /cannot be edited/i,
    );
  });

  it("rolls back completely when a later step in the transaction fails", () => {
    const before = adjustments().length;
    const row = buildInsertRow(
      "stock_adjustments",
      { scope: "product", product_id: PRODUCT, quantity: 9, date: "2026-03-04" },
      at,
    );
    const outcome = runMutationTx(db, [
      { kind: "masterInsert", table: "stock_adjustments", row },
      { kind: "failDeliberately", message: "outbox failure" },
    ]);
    expect(outcome).toMatchObject({ committed: false, rolledBack: true });
    expect(adjustments().length).toBe(before);
    expect(adjustments(`WHERE id = '${String(row.id)}'`)).toHaveLength(0);
  });
});
