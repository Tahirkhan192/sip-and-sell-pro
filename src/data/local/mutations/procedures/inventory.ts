/**
 * PHASE 5H — local procedures for transactional inventory.
 *
 * ONLY manual stock adjustments live here, and only creation.
 *
 * Audit result that limits this file (see `master-tables.ts` for the contract
 * comment): the cloud `stock_adjustments` table has no triggers and no stored
 * procedure. Adding an adjustment is one plain insert; the Remaining quantity
 * the app shows is recomputed by the client inventory engine from this ledger.
 * A local insert therefore reproduces the cloud result exactly.
 *
 * Everything else in the inventory area stays cloud-only:
 *   * `rebuild_item_remaining` (writes the derived `current_stock` column and
 *     reads sales, production, transfers and stock-transfer expenses),
 *   * opening-stock snapshots and monthly overrides,
 *   * `stock_transfers` and stock-to-expense transfers,
 *   * WAC recomputation (`recompute_product_wac` / `recompute_stock_item_wac`).
 */

import { createMasterRow, type MasterMutationResult } from "./run";
import { MasterDataError } from "../master-tables";

export type StockAdjustmentInput = {
  scope: "product" | "stock_item";
  productId?: string | null;
  stockItemId?: string | null;
  /** Signed quantity: positive adds, negative removes. Never zero. */
  quantity: number;
  reason?: string | null;
  notes?: string | null;
  /** Business date, `YYYY-MM-DD` — exactly what the screen sends today. */
  date: string;
};

export function createStockAdjustment(
  input: StockAdjustmentInput,
): Promise<MasterMutationResult> {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new MasterDataError(
      "Invalid local mutation: stock_adjustments.quantity must be a non-zero number.",
    );
  }
  if (!input.date) {
    throw new MasterDataError("Invalid local mutation: stock_adjustments.date is required.");
  }
  return createMasterRow("stock_adjustments", {
    scope: input.scope,
    product_id: input.scope === "product" ? (input.productId ?? null) : null,
    stock_item_id: input.scope === "stock_item" ? (input.stockItemId ?? null) : null,
    quantity,
    reason: input.reason || null,
    notes: input.notes || null,
    date: input.date,
  });
}
