/**
 * PHASE 5E — local procedures for general business expenses.
 *
 * These mirror exactly what the Expenses screen does against the cloud today:
 * add an expense, edit it, soft delete it. Nothing else.
 *
 * NOT handled here, deliberately:
 *   * stock-transfer expenses (`is_stock_transfer = 1`). Creating, editing or
 *     deleting one moves product / stock-item quantities through the cloud
 *     procedures `stock_to_expense_transfer`, `update_stock_transfer_expense`
 *     and `delete_stock_transfer_expense`. Reproducing only the money half
 *     locally would leave stock wrong, so those operations stay cloud-only and
 *     are rejected by both the contract and the worker row guard.
 *   * delivery expenses — a different table, out of scope for Phase 5E.
 */

import {
  createMasterRow,
  softDeleteMasterRow,
  updateMasterRow,
  type MasterMutationResult,
} from "./run";
import { MasterDataError } from "../master-tables";

export type ExpenseInput = {
  /** Business date, `YYYY-MM-DD` — exactly what the screen sends today. */
  date: string;
  category: string;
  amount: number;
  description?: string | null;
  payment_method?: "cash" | "online";
  payment_status?: "paid" | "unpaid" | "katha";
  payment_source?: "cash" | "online";
  supplier?: string | null;
  notes?: string | null;
};

/**
 * Derives the payment columns exactly the way the Expenses screen does:
 * `paid_amount` is the full amount when paid, otherwise 0, and `paid_at` is
 * only stamped for a paid expense.
 */
function normalize(
  input: Partial<ExpenseInput>,
  mode: "insert" | "update",
  at: Date,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.date !== undefined) out.date = input.date;
  if (input.category !== undefined) out.category = input.category.trim();
  if (input.description !== undefined) out.description = input.description || null;
  if (input.supplier !== undefined) out.supplier = input.supplier || null;
  if (input.notes !== undefined) out.notes = input.notes || null;
  if (input.payment_method !== undefined) out.payment_method = input.payment_method;
  if (input.payment_source !== undefined) out.payment_source = input.payment_source;

  const amount = input.amount === undefined ? undefined : Number(input.amount);
  if (amount !== undefined) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new MasterDataError("Invalid local mutation: expenses.amount must be greater than 0.");
    }
    out.amount = amount;
  }

  const status = input.payment_status;
  if (status !== undefined) {
    out.payment_status = status;
    if (amount === undefined && mode === "update") {
      // Status changed without a new amount: paid_amount can only be derived
      // when we also know the amount, so let the caller send both.
      throw new MasterDataError(
        "Invalid local mutation: changing the payment status also requires the amount.",
      );
    }
    out.paid_amount = status === "paid" ? (amount ?? 0) : 0;
    out.paid_at = status === "paid" ? at.toISOString() : null;
  } else if (mode === "insert") {
    out.payment_status = "paid";
    out.paid_amount = amount ?? 0;
    out.paid_at = at.toISOString();
  }
  return out;
}

export function createExpense(
  input: ExpenseInput,
  at: Date = new Date(),
): Promise<MasterMutationResult> {
  if (!input.date) {
    throw new MasterDataError("Invalid local mutation: expenses.date is required.");
  }
  if (!input.category || !input.category.trim()) {
    throw new MasterDataError("Invalid local mutation: expenses.category is required.");
  }
  return createMasterRow("expenses", normalize(input, "insert", at));
}

export function updateExpense(
  id: string,
  input: Partial<ExpenseInput>,
  at: Date = new Date(),
): Promise<MasterMutationResult> {
  return updateMasterRow("expenses", id, normalize(input, "update", at));
}

/** Soft delete — the same `deleted_at` stamp the screen writes today. */
export function deleteExpense(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("expenses", id);
}
