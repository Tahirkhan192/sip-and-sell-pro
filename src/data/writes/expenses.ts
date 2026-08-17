/**
 * PHASE 5E — the Expenses screen's mutations, routed.
 *
 * Drop-in replacements for what the screen used to do inline. The cloud branch
 * is that exact Supabase mutation, unchanged; the local branch is the Phase 5E
 * SQLite procedure. `routeMasterWrite` runs exactly one of them.
 *
 * ALWAYS CLOUD, never local:
 *   * stock-transfer expenses. Saving or deleting one calls
 *     `update_stock_transfer_expense` / `delete_stock_transfer_expense`, which
 *     also restore product and stock-item quantities. An offline copy would
 *     record the money and lose the stock, so the whole operation stays on the
 *     cloud path even when the local database is healthy.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  createExpense,
  deleteExpense as localDeleteExpense,
  updateExpense,
} from "@/data/local/mutations/procedures";
import { routeMasterWrite, type WriteOutcome } from "./route";

export type ExpenseForm = {
  id?: string;
  date: string;
  category: string;
  amount: number;
  description?: string | null;
  payment_method: "cash" | "online" | "stock_transfer";
  payment_status: "paid" | "unpaid" | "katha";
  is_stock_transfer?: boolean;
  /** Stock-transfer edit only — passed straight to the cloud procedure. */
  source_quantity?: number | null;
  source_unit_cost?: number | null;
};

function check(res: { error: any }): void {
  if (res.error) throw res.error;
}

/** True when this row belongs to the cloud-only stock-transfer flow. */
export function isCloudOnlyExpense(p: {
  is_stock_transfer?: boolean | null;
  payment_method?: string | null;
}): boolean {
  return !!p.is_stock_transfer || p.payment_method === "stock_transfer";
}

export function saveExpense(p: ExpenseForm): Promise<WriteOutcome> {
  const amount = Number(p.amount || 0);

  // Stock-transfer expense: cloud procedure only, it also moves stock.
  if (isCloudOnlyExpense(p)) {
    return cloudOnly(async () => {
      if (!p.id) throw new Error("A stock transfer expense is created from the Stock screen.");
      const quantity =
        amount > 0 && p.source_unit_cost ? amount / Number(p.source_unit_cost) : p.source_quantity;
      check(
        await supabase.rpc("update_stock_transfer_expense" as any, {
          _expense_id: p.id,
          _quantity: quantity,
          _date: p.date,
          _category: p.category,
          _description: p.description || null,
          _notes: null,
        } as any),
      );
    });
  }

  const method = (p.payment_method === "online" ? "online" : "cash") as "cash" | "online";
  const payload = {
    date: p.date,
    category: p.category,
    amount,
    description: p.description || null,
    payment_method: method,
    payment_status: p.payment_status,
    paid_amount: p.payment_status === "paid" ? amount : 0,
    paid_at: p.payment_status === "paid" ? new Date().toISOString() : null,
  };

  return routeMasterWrite(
    "expenses",
    () =>
      p.id
        ? updateExpense(p.id, {
            date: p.date,
            category: p.category,
            amount,
            description: p.description ?? null,
            payment_method: method,
            payment_status: p.payment_status,
          })
        : createExpense({
            date: p.date,
            category: p.category,
            amount,
            description: p.description ?? null,
            payment_method: method,
            payment_status: p.payment_status,
          }),
    async () =>
      check(
        p.id
          ? await supabase.from("expenses" as any).update(payload).eq("id", p.id)
          : await supabase.from("expenses" as any).insert(payload),
      ),
  );
}

export function deleteExpense(id: string, isStockTransfer: boolean): Promise<WriteOutcome> {
  if (isStockTransfer) {
    return cloudOnly(async () =>
      check(await supabase.rpc("delete_stock_transfer_expense" as any, { _expense_id: id } as any)),
    );
  }
  return routeMasterWrite(
    "expenses",
    () => localDeleteExpense(id),
    async () =>
      check(
        await supabase
          .from("expenses" as any)
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", id),
      ),
  );
}

async function cloudOnly(run: () => Promise<void>): Promise<WriteOutcome> {
  await run();
  return { path: "cloud", fallbackReason: "STOCK_TRANSFER_EXPENSE" };
}
