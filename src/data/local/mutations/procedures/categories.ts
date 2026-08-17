/**
 * PHASE 5B — category master data (product categories, expense categories and
 * money-movement subcategories).
 *
 * These mirror exactly what the Categories, Expense Categories and Money
 * Movement settings screens do against the cloud today: create, rename/edit,
 * toggle Active, and soft delete. Nothing here touches a product, a stock
 * item, an expense or a money movement.
 */

import {
  createMasterRow,
  restoreMasterRow,
  softDeleteMasterRow,
  updateMasterRow,
  type MasterMutationResult,
} from "./run";

/* ---------------- product categories ---------------- */

export type CategoryInput = {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  sort_order?: number;
  active?: boolean;
};

export function createCategory(input: CategoryInput): Promise<MasterMutationResult> {
  return createMasterRow("categories", normalizeCategory(input));
}

export function updateCategory(
  id: string,
  input: Partial<CategoryInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("categories", id, normalizeCategory(input));
}

export function setCategoryActive(id: string, active: boolean): Promise<MasterMutationResult> {
  return updateMasterRow("categories", id, { active });
}

/** Soft delete. Callers that must keep a category with products should call
 *  `setCategoryActive(id, false)` instead — the same rule the screen uses. */
export function deleteCategory(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("categories", id);
}

export function restoreCategory(id: string): Promise<MasterMutationResult> {
  return restoreMasterRow("categories", id);
}

function normalizeCategory(input: Partial<CategoryInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.description !== undefined) out.description = input.description || null;
  if (input.color !== undefined) out.color = input.color || null;
  if (input.icon !== undefined) out.icon = input.icon || null;
  if (input.sort_order !== undefined) out.sort_order = input.sort_order ?? 0;
  if (input.active !== undefined) out.active = input.active;
  return out;
}

/* ---------------- expense categories ---------------- */

export type ExpenseCategoryInput = { name: string; active?: boolean; sort_order?: number };

export function createExpenseCategory(
  input: ExpenseCategoryInput,
): Promise<MasterMutationResult> {
  return createMasterRow("expense_categories", { ...input, name: input.name.trim() });
}

export function renameExpenseCategory(id: string, name: string): Promise<MasterMutationResult> {
  return updateMasterRow("expense_categories", id, { name: name.trim() });
}

export function setExpenseCategoryActive(
  id: string,
  active: boolean,
): Promise<MasterMutationResult> {
  return updateMasterRow("expense_categories", id, { active });
}

export function deleteExpenseCategory(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("expense_categories", id);
}

/* ---------------- money movement subcategories ---------------- */

export type MoneyMovementCategory = "Expense" | "Owner" | "Customer" | "Other";

export type MoneySubcategoryInput = {
  category: MoneyMovementCategory;
  name: string;
  active?: boolean;
  sort_order?: number;
};

export function createMoneySubcategory(
  input: MoneySubcategoryInput,
): Promise<MasterMutationResult> {
  return createMasterRow("money_movement_subcategories", {
    ...input,
    name: input.name.trim(),
  });
}

export function updateMoneySubcategory(
  id: string,
  input: Partial<MoneySubcategoryInput>,
): Promise<MasterMutationResult> {
  const patch: Record<string, unknown> = {};
  if (input.category !== undefined) patch.category = input.category;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.active !== undefined) patch.active = input.active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  return updateMasterRow("money_movement_subcategories", id, patch);
}

export function deleteMoneySubcategory(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("money_movement_subcategories", id);
}
