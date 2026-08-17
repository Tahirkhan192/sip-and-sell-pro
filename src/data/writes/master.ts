/**
 * PHASE 5C — the application's master-data mutations, routed.
 *
 * Every function here is a drop-in replacement for a mutation a screen used
 * to perform inline against Lovable Cloud. The cloud branch is that exact
 * mutation, unchanged; the local branch is the Phase 5B SQLite procedure.
 * `routeMasterWrite` decides which one runs — never both.
 *
 * DELIBERATELY NOT ROUTED (still cloud-only, see README):
 *   * stock item create/update — the screen also calls the
 *     `rebuild_item_remaining` RPC and writes `current_stock`, which are
 *     stock side effects. Only its soft delete is routed.
 *   * menu visibility — it writes a `settings.menu_visibility` column that
 *     the local mirror does not have.
 *   * WhatsApp credentials — never written locally (Phase 5B protection).
 *   * every transactional table.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  createCategory,
  createCustomer,
  createExpenseCategory,
  createProduct,
  createRecipe,
  createStaff,
  createSupplier,
  deleteCategory as localDeleteCategory,
  deleteCustomer as localDeleteCustomer,
  deleteExpenseCategory as localDeleteExpenseCategory,
  deleteProduct as localDeleteProduct,
  deleteRecipe as localDeleteRecipe,
  deleteStaff as localDeleteStaff,
  deleteStockItem as localDeleteStockItem,
  deleteSupplier as localDeleteSupplier,
  renameExpenseCategory,
  setCategoryActive as localSetCategoryActive,
  setExpenseCategoryActive,
  updateBusinessSettings,
  updateCategory,
  updateCustomer,
  updateProduct,
  updateRecipe,
  updateStaff,
  updateSupplier,
  type CategoryInput,
  type CustomerInput,
  type ProductInput,
  type RecipeInput,
  type StaffInput,
  type SupplierInput,
} from "@/data/local/mutations/procedures";
import { routeMasterWrite, type WriteOutcome } from "./route";

const nowIso = () => new Date().toISOString();

function check(res: { error: any }): void {
  if (res.error) throw res.error;
}

/* ---------------- product categories ---------------- */

export type CategoryForm = CategoryInput & { id?: string };

export function saveCategory(p: CategoryForm): Promise<WriteOutcome> {
  const payload: any = {
    name: p.name.trim(),
    description: p.description || null,
    color: p.color || null,
    icon: p.icon || null,
    sort_order: p.sort_order ?? 0,
    active: p.active,
  };
  return routeMasterWrite(
    "categories",
    () => (p.id ? updateCategory(p.id, payload) : createCategory(payload)),
    async () =>
      check(
        p.id
          ? await supabase.from("categories" as any).update(payload).eq("id", p.id)
          : await supabase.from("categories" as any).insert(payload),
      ),
  );
}

export function setCategoryActive(id: string, active: boolean): Promise<WriteOutcome> {
  return routeMasterWrite(
    "categories",
    () => localSetCategoryActive(id, active),
    async () => check(await supabase.from("categories" as any).update({ active }).eq("id", id)),
  );
}

/** Soft delete — same semantics as the screen (deleted_at = now). */
export function deleteCategory(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "categories",
    () => localDeleteCategory(id),
    async () =>
      check(
        await supabase.from("categories" as any).update({ deleted_at: nowIso() }).eq("id", id),
      ),
  );
}

/* ---------------- expense categories ---------------- */

export function createExpenseCategoryWrite(name: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "expense_categories",
    () => createExpenseCategory({ name }),
    async () =>
      check(await (supabase as any).from("expense_categories").insert({ name: name.trim() })),
  );
}

export function renameExpenseCategoryWrite(id: string, name: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "expense_categories",
    () => renameExpenseCategory(id, name),
    async () =>
      check(
        await (supabase as any)
          .from("expense_categories")
          .update({ name: name.trim() })
          .eq("id", id),
      ),
  );
}

export function setExpenseCategoryActiveWrite(id: string, active: boolean): Promise<WriteOutcome> {
  return routeMasterWrite(
    "expense_categories",
    () => setExpenseCategoryActive(id, active),
    async () =>
      check(await (supabase as any).from("expense_categories").update({ active }).eq("id", id)),
  );
}

export function deleteExpenseCategoryWrite(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "expense_categories",
    () => localDeleteExpenseCategory(id),
    async () =>
      check(
        await (supabase as any)
          .from("expense_categories")
          .update({ deleted_at: nowIso() })
          .eq("id", id),
      ),
  );
}

/* ---------------- customers ---------------- */

export type CustomerForm = CustomerInput & { id?: string };

export function saveCustomer(p: CustomerForm): Promise<WriteOutcome> {
  const payload = {
    name: p.name.trim(),
    phone: p.phone?.trim() || null,
    address: p.address || null,
    notes: p.notes || null,
  };
  return routeMasterWrite(
    "customers",
    () => (p.id ? updateCustomer(p.id, payload) : createCustomer(payload)),
    async () =>
      check(
        p.id
          ? await supabase.from("customers").update(payload).eq("id", p.id)
          : await supabase.from("customers").insert(payload),
      ),
  );
}

export function deleteCustomer(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "customers",
    () => localDeleteCustomer(id),
    async () =>
      check(await supabase.from("customers").update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/* ---------------- suppliers ---------------- */

export type SupplierForm = SupplierInput & { id?: string };

export function saveSupplier(p: SupplierForm): Promise<WriteOutcome> {
  const payload = {
    name: p.name.trim(),
    phone: p.phone?.trim() || null,
    address: p.address || null,
    notes: p.notes || null,
  };
  return routeMasterWrite(
    "suppliers",
    () => (p.id ? updateSupplier(p.id, payload) : createSupplier(payload)),
    async () =>
      check(
        p.id
          ? await supabase.from("suppliers").update(payload).eq("id", p.id)
          : await supabase.from("suppliers").insert(payload),
      ),
  );
}

export function deleteSupplier(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "suppliers",
    () => localDeleteSupplier(id),
    async () =>
      check(await supabase.from("suppliers").update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/* ---------------- products ---------------- */

export type ProductForm = ProductInput & { id?: string };

/**
 * Product master attributes only. `current_stock` is never written here — it
 * is calculated by the inventory engine, exactly as before.
 */
export function saveProduct(p: ProductForm): Promise<WriteOutcome> {
  const payload: any = {
    name: p.name,
    category: p.category,
    sale_price: p.sale_price ?? 0,
    cost_price: p.cost_price ?? 0,
    opening_stock: p.opening_stock ?? 0,
    minimum_stock: p.minimum_stock ?? 0,
    active: p.active,
    unit: p.unit,
    selling_method: p.selling_method,
    track_stock: p.track_stock,
    auto_calc: p.auto_calc,
  };
  return routeMasterWrite(
    "products",
    () => (p.id ? updateProduct(p.id, payload) : createProduct(payload)),
    async () => {
      const res = p.id
        ? await supabase.from("products").update(payload).eq("id", p.id).select("id").maybeSingle()
        : await supabase.from("products").insert(payload).select("id").maybeSingle();
      check(res);
    },
  );
}

export function deleteProduct(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "products",
    () => localDeleteProduct(id),
    async () =>
      check(await supabase.from("products").update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/** Opening-stock only edit from the bulk Opening Stock screen. */
export function setProductOpeningStock(id: string, openingStock: number): Promise<WriteOutcome> {
  return routeMasterWrite(
    "products",
    () => updateProduct(id, { opening_stock: openingStock }),
    async () =>
      check(await supabase.from("products").update({ opening_stock: openingStock }).eq("id", id)),
  );
}

/* ---------------- stock items (soft delete only) ---------------- */

/**
 * Create/update stay cloud-only: that path also writes `current_stock` and
 * calls the `rebuild_item_remaining` RPC. The soft delete has no side effect,
 * so it is routed.
 */
export function deleteStockItem(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "stock_items",
    () => localDeleteStockItem(id),
    async () =>
      check(await supabase.from("stock_items").update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/* ---------------- recipes (product connections) ---------------- */

export type RecipeForm = RecipeInput & { id?: string };

export function saveRecipe(p: RecipeForm): Promise<WriteOutcome> {
  const payload = {
    parent_product_id: p.parent_product_id,
    component_product_id: p.component_product_id ?? null,
    component_stock_item_id: p.component_stock_item_id ?? null,
    quantity: p.quantity,
    unit: p.unit,
    applies_to: p.applies_to,
  };
  return routeMasterWrite(
    "recipes",
    () => (p.id ? updateRecipe(p.id, payload) : createRecipe(payload as RecipeInput)),
    async () =>
      check(
        p.id
          ? await supabase.from("recipes" as any).update(payload).eq("id", p.id)
          : await supabase.from("recipes" as any).insert(payload),
      ),
  );
}

export function deleteRecipe(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "recipes",
    () => localDeleteRecipe(id),
    async () =>
      check(await supabase.from("recipes" as any).update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/* ---------------- staff (profile only) ---------------- */

export type StaffForm = StaffInput & { id?: string };

/**
 * Profile fields only. Katha movements and salary payments remain cloud-only
 * RPCs; on create the katha balance is seeded from the opening katha, which is
 * what the Staff screen already does.
 */
export function saveStaff(p: StaffForm): Promise<WriteOutcome> {
  const payload = {
    name: p.name.trim(),
    father_name: p.father_name?.trim() || null,
    phone: p.phone?.trim() || null,
    cnic: p.cnic?.trim() || null,
    joining_date: p.joining_date,
    monthly_salary: p.monthly_salary ?? 0,
    status: p.status ?? "active",
    notes: p.notes?.trim() || null,
    opening_katha: p.opening_katha ?? 0,
  };
  return routeMasterWrite(
    "staff",
    () => (p.id ? updateStaff(p.id, payload) : createStaff(payload as StaffInput)),
    async () =>
      check(
        p.id
          ? await supabase.from("staff" as any).update(payload).eq("id", p.id)
          : await supabase
              .from("staff" as any)
              .insert({ ...payload, katha_balance: payload.opening_katha }),
      ),
  );
}

export function deleteStaff(id: string): Promise<WriteOutcome> {
  return routeMasterWrite(
    "staff",
    () => localDeleteStaff(id),
    async () =>
      check(await supabase.from("staff" as any).update({ deleted_at: nowIso() }).eq("id", id)),
  );
}

/* ---------------- settings (credential-free fields only) ---------------- */

export function saveBusinessSettings(input: {
  timezone: string;
  business_day_start_time: string;
  business_month_start_day: number;
}): Promise<WriteOutcome> {
  return routeMasterWrite(
    "settings",
    () => updateBusinessSettings(input),
    async () =>
      check(
        await supabase
          .from("settings" as any)
          .upsert({ id: 1, ...input, updated_at: nowIso() }),
      ),
  );
}

export function saveAllowNegativeStock(value: boolean): Promise<WriteOutcome> {
  return routeMasterWrite(
    "settings",
    () => updateBusinessSettings({ allow_negative_stock: value }),
    async () =>
      check(
        await supabase
          .from("settings" as any)
          .upsert({ id: 1, allow_negative_stock: value, updated_at: nowIso() }),
      ),
  );
}

export function savePinSettings(input: {
  pin_locks: Record<string, unknown>;
  staff_invoice_color: string;
}): Promise<WriteOutcome> {
  return routeMasterWrite(
    "settings",
    () =>
      updateBusinessSettings({
        pin_locks: input.pin_locks,
        staff_invoice_color: input.staff_invoice_color,
      }),
    async () =>
      check(
        await supabase
          .from("settings" as any)
          .upsert({ id: 1, ...input, updated_at: nowIso() }),
      ),
  );
}

export type { WriteOutcome } from "./route";
