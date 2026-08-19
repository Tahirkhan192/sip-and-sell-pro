/**
 * Stock Position — the ONE pure calculation of "what is actually available
 * right now" for products and stock items.
 *
 * Remaining = Opening + Purchases + Production
 *           − Recipe Usage − Direct Sales − Transfer Out + Manual Adjustment
 *
 * This math used to live only inside `src/lib/inventory-engine.ts` (Stock
 * Availability screen), while the report engine valued Closing Stock from the
 * stored `current_stock` columns. Those columns drift (and can even go
 * negative), which is why Closing Stock disagreed with the Stock Availability
 * totals. Both paths now call this module, so there is exactly ONE authority.
 *
 * Nothing here is new business logic: the formula, the `track_stock` /
 * `auto_calc` rules and the valuation basis are copied verbatim from the
 * inventory engine.
 */
import { num } from "@/lib/format";

export type StockPositionRow = {
  id: string;
  name: string;
  opening: number;
  purchases: number;
  transferIn: number;
  production: number;
  recipeUsage: number;
  directSales: number;
  transferOut: number;
  manualAdjustment: number;
  remaining: number;
  auto: boolean;
  tracked: boolean;
};

export type ProductStockRow = StockPositionRow & { category: string; salePrice: number; value: number };
export type StockItemStockRow = StockPositionRow & {
  category: string;
  unit: string;
  avgPrice: number;
  manual: boolean;
  value: number;
};

export type StockPosition = { products: ProductStockRow[]; stockItems: StockItemStockRow[] };

/** One sale, normalised: only the fields the stock position depends on. */
export type StockSale = {
  status?: string | null;
  deleted_at?: string | null;
  hidden?: boolean | null;
  order_type?: string | null;
  items: { product_id?: string | null; quantity?: unknown }[];
};

export type StockPositionInputs = {
  products: any[];
  stockItems: any[];
  /** Locked monthly opening snapshot keyed "<scope>:<id>". */
  openingSnapshot: Record<string, number>;
  /** stock_purchases rows in the period. */
  purchases: any[];
  /** production_batches rows in the period (product_id, quantity). */
  production: any[];
  /** production_batch_items rows of those batches. */
  batchItems: any[];
  /** stock_transfers rows in the period. */
  transfers: any[];
  /** expenses rows with is_stock_transfer = true in the period. */
  transferExpenses: any[];
  /** stock_adjustments rows in the period. */
  adjustments: any[];
  recipes: any[];
  sales: StockSale[];
};

const add = (m: Record<string, number>, k: string | null | undefined, v: number) => {
  if (!k) return;
  m[k] = (m[k] ?? 0) + v;
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function computeStockPosition(input: StockPositionInputs): StockPosition {
  const openings = input.openingSnapshot;

  // ---- Purchases
  const purchaseProd: Record<string, number> = {};
  const purchaseItem: Record<string, number> = {};
  for (const r of input.purchases) {
    add(purchaseProd, r.product_id, num(r.quantity));
    add(purchaseItem, r.stock_item_id, num(r.quantity));
  }

  // ---- Production (finished products produced by recipe batches)
  const productionProd: Record<string, number> = {};
  for (const b of input.production) add(productionProd, b.product_id, num(b.quantity));

  // ---- Recipe usage via production batches (components consumed)
  const recipeProd: Record<string, number> = {};
  const recipeItem: Record<string, number> = {};
  for (const r of input.batchItems) {
    add(recipeProd, r.component_product_id, num(r.quantity));
    add(recipeItem, r.component_stock_item_id, num(r.quantity));
  }

  // ---- Sales (non-deleted, non-hidden; completed AND pending both reduce stock)
  const soldByProduct: Record<string, number> = {};
  const soldByProductAndType: Record<string, Record<string, number>> = {};
  for (const s of input.sales) {
    if (!s || s.deleted_at || s.hidden) continue;
    if (s.status !== "completed" && s.status !== "pending") continue;
    const t = (s.order_type ?? "walk_in") as string;
    for (const it of s.items ?? []) {
      if (!it?.product_id) continue;
      const q = num(it.quantity);
      add(soldByProduct, it.product_id, q);
      const bucket = (soldByProductAndType[it.product_id] ??= {});
      bucket[t] = (bucket[t] ?? 0) + q;
    }
  }

  // ---- Recipe usage via POS sales: recipe qty × sold qty of the parent product
  const parentsWithRecipe = new Set<string>();
  for (const r of input.recipes) {
    parentsWithRecipe.add(r.parent_product_id);
    const byType = soldByProductAndType[r.parent_product_id];
    if (!byType) continue;
    const applies: string[] = Array.isArray(r.applies_to) ? r.applies_to : [];
    let soldQty = 0;
    for (const [type, qty] of Object.entries(byType)) {
      if (applies.length === 0 || applies.includes(type)) soldQty += qty;
    }
    if (soldQty === 0) continue;
    const used = soldQty * num(r.quantity);
    add(recipeProd, r.component_product_id, used);
    add(recipeItem, r.component_stock_item_id, used);
  }

  // ---- Transfers OUT: category → category moves AND stock moved to Expenses
  const transferOutProd: Record<string, number> = {};
  const transferOutItem: Record<string, number> = {};
  for (const r of input.transfers) {
    const q = num(r.quantity);
    add(transferOutProd, r.product_id, q);
    add(transferOutItem, r.stock_item_id, q);
  }
  for (const e of input.transferExpenses) {
    const q = num(e.source_quantity);
    add(transferOutProd, e.source_product_id, q);
    add(transferOutItem, e.source_stock_item_id, q);
  }

  // ---- Manual stock adjustments (signed: +increase / −decrease)
  const adjProd: Record<string, number> = {};
  const adjItem: Record<string, number> = {};
  for (const a of input.adjustments) {
    const q = num(a.quantity);
    add(adjProd, a.product_id, q);
    add(adjItem, a.stock_item_id, q);
  }

  const products: ProductStockRow[] = input.products.map((r: any) => {
    const tracked = r.track_stock !== false;
    const auto = r.auto_calc === true;
    const salePrice = num(r.sale_price);
    const base = {
      id: r.id as string,
      name: r.name as string,
      category: (r.category ?? "—") as string,
      tracked,
      auto,
      salePrice,
    };
    // Stock Tracking OFF → unlimited stock, excluded from every calculation.
    if (!tracked) {
      return {
        ...base,
        opening: 0, purchases: 0, transferIn: 0, production: 0,
        recipeUsage: 0, directSales: 0, transferOut: 0, manualAdjustment: 0,
        remaining: 0, value: 0,
      };
    }
    const opening = num(openings[`product:${r.id}`] ?? r.opening_stock);
    const purchases = purchaseProd[r.id] ?? 0;
    const production = productionProd[r.id] ?? 0;
    const recipeUsage = round(recipeProd[r.id] ?? 0);
    // A product built from a recipe is consumed through its ingredients;
    // only products without a recipe are deducted directly on sale.
    const sold = soldByProduct[r.id] ?? 0;
    const directSales = parentsWithRecipe.has(r.id) ? 0 : sold;
    const transferOut = transferOutProd[r.id] ?? 0;
    const manualAdjustment = adjProd[r.id] ?? 0;
    // Auto Calculation OFF → keep the manually maintained Current Stock.
    const remaining = auto
      ? round(opening + purchases + production - recipeUsage - directSales - transferOut + manualAdjustment)
      : num(r.current_stock);
    return {
      ...base,
      opening, purchases, transferIn: 0, production,
      recipeUsage, directSales, transferOut, manualAdjustment,
      remaining, value: remaining * salePrice,
    };
  });

  const stockItems: StockItemStockRow[] = input.stockItems.map((r: any) => {
    const auto = r.auto_calc === true;
    const opening = num(openings[`stock_item:${r.id}`] ?? r.opening_stock);
    const purchases = purchaseItem[r.id] ?? 0;
    const production = 0; // stock items are not produced by batches
    const recipeUsage = round(recipeItem[r.id] ?? 0);
    const directSales = 0; // stock items are never sold directly on an invoice
    const transferOut = transferOutItem[r.id] ?? 0;
    const manualAdjustment = adjItem[r.id] ?? 0;
    // Auto Calculation OFF → keep the manually maintained Current Stock.
    const remaining = auto
      ? round(opening + purchases + production - recipeUsage - directSales - transferOut + manualAdjustment)
      : num(r.current_stock);
    const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
    const avgPrice = manual ? num(r.avg_price_override) : num(r.purchase_price);
    return {
      id: r.id,
      name: r.name,
      category: (r.category ?? "—") as string,
      unit: r.unit ?? "pcs",
      tracked: true,
      opening, purchases, transferIn: 0, production,
      recipeUsage, directSales, transferOut, manualAdjustment,
      remaining, auto, avgPrice, manual, value: remaining * avgPrice,
    };
  });

  return { products, stockItems };
}

/** Closing Stock = available product value + available stock-item value. */
export function closingStockTotals(position: StockPosition) {
  const productValue = position.products.reduce((s, p) => s + p.value, 0);
  const stockItemValue = position.stockItems.reduce((s, p) => s + p.value, 0);
  return { productValue, stockItemValue, total: productValue + stockItemValue };
}
