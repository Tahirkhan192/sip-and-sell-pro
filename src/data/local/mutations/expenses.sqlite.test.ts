/**
 * PHASE 5E — real SQLite proof for offline expenses.
 *
 * Proves the three things the phase promises:
 *   1. a plain expense can be created, edited and soft-deleted locally,
 *   2. a stock-transfer expense can NOT be touched locally, whatever the
 *      payload says (the row guard runs inside the worker engine), and
 *   3. a rejected expense leaves nothing behind — the transaction rolls back.
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

function rows(where = ""): any[] {
  return db.selectObjects(`SELECT * FROM "${mirrorTable("expenses")}" ${where}`) as any[];
}

beforeAll(async () => {
  db = await openEngine();
  applyMirrorSchema(db);
});

afterAll(async () => {
  await closeEngine();
});

describe("Phase 5E — expenses against real SQLite", () => {
  it("classifies expenses as locally writable with the stock-transfer guard", () => {
    expect(classifyTable("expenses")).toBe("SAFE_LOCAL");
    expect(tableSpec("expenses").rowGuard).toMatchObject({
      column: "is_stock_transfer",
      equals: 0,
    });
    // Everything transactional stays cloud-only.
    for (const t of ["sales", "purchases", "cash_movements", "delivery_expenses"]) {
      expect(classifyTable(t)).toBe("CLOUD_ONLY");
    }
  });

  it("creates, edits and soft-deletes a plain expense", () => {
    const row = buildInsertRow(
      "expenses",
      {
        date: "2026-03-04",
        category: "Utilities",
        amount: 1500,
        description: "Electricity",
        payment_method: "cash",
        payment_status: "paid",
        paid_amount: 1500,
        paid_at: at.toISOString(),
      },
      at,
    );
    const id = String(row.id);
    expect(runMutationTx(db, [{ kind: "masterInsert", table: "expenses", row }])).toMatchObject({
      committed: true,
    });

    const [created] = rows(`WHERE id = '${id}'`);
    expect(created.amount).toBe(1500);
    expect(created.paid_amount).toBe(1500);
    expect(created.is_stock_transfer).toBe(0);
    expect(created.source_product_id).toBeNull();

    runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "expenses",
        id,
        values: buildUpdateValues(
          "expenses",
          { amount: 1800, payment_status: "unpaid", paid_amount: 0, paid_at: null },
          at,
        ),
      },
    ]);
    const [edited] = rows(`WHERE id = '${id}'`);
    expect(edited.amount).toBe(1800);
    expect(edited.payment_status).toBe("unpaid");
    expect(edited.paid_amount).toBe(0);

    runMutationTx(db, [
      { kind: "masterUpdate", table: "expenses", id, values: { deleted_at: at.toISOString() } },
    ]);
    expect(rows(`WHERE id = '${id}'`)[0].deleted_at).toBe(at.toISOString());
  });

  it("refuses to create a stock-transfer expense locally", () => {
    expect(() =>
      buildInsertRow(
        "expenses",
        { date: "2026-03-04", category: "Wastage", amount: 100, is_stock_transfer: true },
        at,
      ),
    ).toThrow(/derived|stock-transfer/i);

    expect(() =>
      buildInsertRow(
        "expenses",
        {
          date: "2026-03-04",
          category: "Wastage",
          amount: 100,
          source_product_id: newUuid(),
        },
        at,
      ),
    ).toThrow(/derived|stock-transfer/i);

    expect(() =>
      buildInsertRow(
        "expenses",
        {
          date: "2026-03-04",
          category: "Wastage",
          amount: 100,
          payment_method: "stock_transfer",
        },
        at,
      ),
    ).toThrow(/must be one of/i);
  });

  it("refuses to edit or delete an existing stock-transfer expense", () => {
    // Seed one the way the cloud procedure would (mirror row, not a mutation).
    const id = newUuid();
    db.exec({
      sql: `INSERT INTO "${mirrorTable("expenses")}"
              (id, date, category, amount, created_at, payment_method, payment_status,
               paid_amount, payment_source, is_stock_transfer, source_quantity, source_unit_cost)
            VALUES (?, '2026-03-04', 'Wastage', 250, ?, 'stock_transfer', 'paid', 250, 'cash', 1, 5, 50)`,
      bind: [id, at.toISOString()] as any[],
    });

    const blocked = runMutationTx(db, [
      {
        kind: "masterUpdate",
        table: "expenses",
        id,
        values: buildUpdateValues("expenses", { category: "Staff Food" }, at),
      },
    ]);
    expect(blocked.committed).toBe(false);
    expect(String((blocked as any).message)).toMatch(/stock-transfer/i);
    expect(rows(`WHERE id = '${id}'`)[0].category).toBe("Wastage");

    const blockedDelete = runMutationTx(db, [
      { kind: "masterUpdate", table: "expenses", id, values: { deleted_at: at.toISOString() } },
    ]);
    expect(blockedDelete.committed).toBe(false);
    expect(rows(`WHERE id = '${id}'`)[0].deleted_at).toBeNull();
  });

  it("rolls the whole transaction back when a later step fails", () => {
    const row = buildInsertRow(
      "expenses",
      { date: "2026-03-04", category: "Repairs", amount: 999, payment_status: "paid", paid_amount: 999 },
      at,
    );
    const id = String(row.id);
    const outcome = runMutationTx(db, [
      { kind: "masterInsert", table: "expenses", row },
      { kind: "failDeliberately", message: "boom" },
    ]);
    expect(outcome.committed).toBe(false);
    expect(rows(`WHERE id = '${id}'`)).toHaveLength(0);
  });
});
