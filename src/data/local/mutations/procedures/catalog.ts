/**
 * PHASE 5B — catalog master data: products, stock items and recipes
 * (product connections).
 *
 * IMPORTANT — what a catalog procedure deliberately does NOT do:
 *   * it never writes `current_stock`. Current Stock is produced by the
 *     inventory engine from history (opening + purchases + production −
 *     recipe usage − direct sales − transfers out + manual adjustment) and the
 *     Products screen already shows it read-only.
 *   * it never records a purchase, a transfer, a production batch or a manual
 *     stock adjustment. Those are transactional and stay cloud-only.
 *   * it never recomputes a weighted-average cost.
 *
 * `opening_stock`, `minimum_stock`, prices, units, `track_stock` and
 * `auto_calc` ARE master attributes and are writable, exactly as on the
 * existing screens.
 */

import {
  createMasterRow,
  restoreMasterRow,
  softDeleteMasterRow,
  updateMasterRow,
  type MasterMutationResult,
} from "./run";

/* ---------------- products ---------------- */

export type ProductInput = {
  name: string;
  category: string;
  sale_price?: number;
  cost_price?: number;
  opening_stock?: number;
  minimum_stock?: number;
  active?: boolean;
  unit?: "pcs" | "kg" | "ltr";
  selling_method?: "fixed" | "weight";
  allow_negative_stock?: boolean;
  track_stock?: boolean;
  auto_calc?: boolean;
  avg_price_override?: number | null;
};

export function createProduct(input: ProductInput): Promise<MasterMutationResult> {
  return createMasterRow("products", normalizeProduct(input));
}

export function updateProduct(
  id: string,
  input: Partial<ProductInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("products", id, normalizeProduct(input));
}

export function deleteProduct(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("products", id);
}

export function restoreProduct(id: string): Promise<MasterMutationResult> {
  return restoreMasterRow("products", id);
}

function normalizeProduct(input: Partial<ProductInput>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.category !== undefined) out.category = input.category.trim();
  return out;
}

/* ---------------- stock items ---------------- */

export type StockItemInput = {
  name: string;
  category: string;
  unit?: string;
  opening_stock?: number;
  minimum_stock?: number;
  purchase_price?: number;
  supplier_id?: string | null;
  purchase_date?: string | null;
  notes?: string | null;
  auto_calc?: boolean;
  avg_price_override?: number | null;
};

export function createStockItem(input: StockItemInput): Promise<MasterMutationResult> {
  return createMasterRow("stock_items", normalizeStockItem(input));
}

export function updateStockItem(
  id: string,
  input: Partial<StockItemInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("stock_items", id, normalizeStockItem(input));
}

export function deleteStockItem(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("stock_items", id);
}

function normalizeStockItem(input: Partial<StockItemInput>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (input.name !== undefined) out.name = input.name.trim();
  if (input.category !== undefined) out.category = input.category.trim();
  if (input.supplier_id !== undefined) out.supplier_id = input.supplier_id || null;
  if (input.purchase_date !== undefined) out.purchase_date = input.purchase_date || null;
  if (input.notes !== undefined) out.notes = input.notes || null;
  return out;
}

/* ---------------- recipes (product connections) ---------------- */

export type OrderTypeScope = "walk_in" | "take_away" | "delivery";

export type RecipeInput = {
  parent_product_id: string;
  /** Exactly one component must be supplied. */
  component_product_id?: string | null;
  component_stock_item_id?: string | null;
  quantity: number;
  unit?: string;
  applies_to?: OrderTypeScope[];
};

/**
 * Creates one recipe line. The "exactly one component", "quantity > 0",
 * "parent is not its own component" and "applies_to is a non-empty subset"
 * rules are enforced by the shared contract, so they behave identically to the
 * cloud CHECK constraints. The foreign keys are enforced by SQLite itself
 * (`PRAGMA foreign_keys = ON`).
 */
export function createRecipe(input: RecipeInput): Promise<MasterMutationResult> {
  return createMasterRow("recipes", normalizeRecipe(input));
}

export function updateRecipe(
  id: string,
  input: Partial<RecipeInput>,
): Promise<MasterMutationResult> {
  return updateMasterRow("recipes", id, normalizeRecipe(input));
}

export function deleteRecipe(id: string): Promise<MasterMutationResult> {
  return softDeleteMasterRow("recipes", id);
}

function normalizeRecipe(input: Partial<RecipeInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.parent_product_id !== undefined) out.parent_product_id = input.parent_product_id;
  if (input.component_product_id !== undefined) {
    out.component_product_id = input.component_product_id || null;
  }
  if (input.component_stock_item_id !== undefined) {
    out.component_stock_item_id = input.component_stock_item_id || null;
  }
  if (input.quantity !== undefined) out.quantity = input.quantity;
  if (input.unit !== undefined) out.unit = input.unit;
  if (input.applies_to !== undefined) out.applies_to = input.applies_to;
  return out;
}
