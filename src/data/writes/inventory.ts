/**
 * PHASE 5H — the inventory screens' mutations, routed.
 *
 * Supported offline: recording a manual stock adjustment. The cloud branch is
 * the exact Supabase insert the Products screen performed inline before.
 *
 * NOT routed (still cloud-only, unchanged):
 *   * `rebuild_item_remaining` — writes the derived `current_stock` column
 *     from sales, production, transfers and stock-transfer expenses,
 *   * opening-stock snapshots / monthly overrides,
 *   * stock transfers and stock-to-expense transfers,
 *   * purchases and POS sales (see the phase report).
 */

import { supabase } from "@/integrations/supabase/client";
import {
  createStockAdjustment,
  type StockAdjustmentInput,
} from "@/data/local/mutations/procedures";
import { routeMasterWrite, type WriteOutcome } from "./route";

export function saveStockAdjustment(input: StockAdjustmentInput): Promise<WriteOutcome> {
  const payload = {
    scope: input.scope,
    product_id: input.scope === "product" ? (input.productId ?? null) : null,
    stock_item_id: input.scope === "stock_item" ? (input.stockItemId ?? null) : null,
    quantity: Number(input.quantity),
    reason: input.reason || null,
    notes: input.notes || null,
    date: input.date,
  };
  return routeMasterWrite(
    "stock_adjustments",
    () => createStockAdjustment(input),
    async () => {
      const res = await (supabase as any).from("stock_adjustments").insert(payload);
      if (res.error) throw res.error;
    },
  );
}
