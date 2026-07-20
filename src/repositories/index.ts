/**
 * Repository facade.
 *
 * All pages must talk to their repository — never to the Supabase client
 * directly. Each repository exposes `.query()` which returns the underlying
 * PostgREST builder. Reads and writes are transparently intercepted by
 * `src/pwa/fetch-interceptor.ts` and served from IndexedDB (local-first).
 * The cloud is contacted only in the background by the sync outbox.
 *
 * Data flow:
 *   Repository → Fetch Interceptor → IndexedDB → Outbox → Loveable Cloud
 */
import { supabase } from "@/integrations/supabase/client";

export type Repository = {
  readonly table: string;
  /** Returns the PostgREST builder for this table. Fully compatible with the
   *  Supabase JS client fluent API (select/insert/update/delete/etc.). */
  query: () => ReturnType<typeof supabase.from>;
};

const repository = (table: string): Repository => ({
  table,
  query: () => (supabase as any).from(table),
});

// Core business entities
export const productsRepository = repository("products");
export const categoriesRepository = repository("categories");
export const customersRepository = repository("customers");
export const suppliersRepository = repository("suppliers");
export const recipesRepository = repository("recipes");

// Sales
export const salesRepository = repository("sales");
export const saleItemsRepository = repository("sale_items");
/** Alias — invoices are sales in the domain model. */
export const invoicesRepository = salesRepository;

// Purchases
export const purchasesRepository = repository("purchases");
export const purchaseItemsRepository = repository("purchase_items");

// Expenses
export const expensesRepository = repository("expenses");
export const expenseCategoriesRepository = repository("expense_categories");
export const deliveryExpensesRepository = repository("delivery_expenses");

// Stock
export const stockItemsRepository = repository("stock_items");
export const stockPurchasesRepository = repository("stock_purchases");
export const stockTransfersRepository = repository("stock_transfers");
/** Alias — generic stock repository. */
export const stockRepository = stockItemsRepository;

// Cash & production
export const cashMovementsRepository = repository("cash_movements");
export const cashMovementRepository = cashMovementsRepository;
export const productionBatchesRepository = repository("production_batches");

// Settings / closings
export const settingsRepository = repository("settings");
export const dailyClosingsRepository = repository("daily_closings");

// Singular convenience aliases requested by the domain
export const customerRepository = customersRepository;
export const supplierRepository = suppliersRepository;
export const recipeRepository = recipesRepository;

/** Escape hatch for tables not yet in the map. Prefer named repositories. */
export const anyRepository = repository;
