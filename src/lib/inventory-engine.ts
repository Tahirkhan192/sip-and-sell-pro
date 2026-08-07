/**
 * Inventory Engine — single source of truth for Remaining quantity.
 *
 * Remaining = Opening
 *           + Purchases + Transfer Received + Production
 *           − Recipe Usage − Direct Sales − Transfer Out − Manual Consumption
 *
 * Every movement is rebuilt from transaction history; stored `current_stock`
 * is only used when Auto Calculation is OFF for that item.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";

export type Period = { from: string; to: string; startUTC: string; endExclusiveUTC: string };

export type InventoryRow = {
  id: string;
  name: string;
  opening: number;
  purchases: number;
  transferIn: number;
  production: number;
  recipeUsage: number;
  directSales: number;
  transferOut: number;
  manualConsumption: number;
  manualAdjustment: number;
  remaining: number;
  auto: boolean;
};


export type ProductInventoryRow = InventoryRow & { category: string; salePrice: number; value: number };
export type StockItemInventoryRow = InventoryRow & {
  unit: string;
  avgPrice: number;
  manual: boolean;
  value: number;
};

export type InventorySnapshot = {
  products: ProductInventoryRow[];
  stockItems: StockItemInventoryRow[];
};

const add = (m: Record<string, number>, k: string | null | undefined, v: number) => {
  if (!k) return;
  m[k] = (m[k] ?? 0) + v;
};

/** PostgREST caps a request at 1000 rows — page through everything. */
async function fetchAllPaged<T = any>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function fetchInventoryEngine(period: Period): Promise<InventorySnapshot> {
  const year = Number(period.from.slice(0, 4));
  const month = Number(period.from.slice(5, 7));
  const sb = supabase as any;

  const [
    prods,
    items,
    openRows,
    purRows,
    batchRows,
    batchItemRows,
    transferRows,
    consumptionRows,
    saleItemRows,
    recipeRows,
    expCatRows,
    adjustRows,
  ] = await Promise.all([
    fetchAllPaged(() => sb.from("products").select("id,name,category,opening_stock,current_stock,sale_price,auto_calc").is("deleted_at", null).order("name")),
    fetchAllPaged(() => sb.from("stock_items").select("id,name,unit,opening_stock,current_stock,purchase_price,avg_price_override,auto_calc").is("deleted_at", null).order("name")),
    fetchAllPaged(() => sb.from("stock_opening_snapshots").select("scope,item_id,quantity").eq("year", year).eq("month", month).order("item_id")),
    fetchAllPaged(() => sb.from("stock_purchases").select("product_id,stock_item_id,quantity").is("deleted_at", null).gte("date", period.from).lte("date", period.to).order("id")),
    fetchAllPaged(() => sb.from("production_batches").select("product_id,quantity").is("deleted_at", null).gte("batch_date", period.from).lte("batch_date", period.to).order("id")),
    fetchAllPaged(() => sb.from("production_batch_items").select("component_product_id,component_stock_item_id,quantity,production_batches!inner(batch_date,deleted_at)")
      .gte("production_batches.batch_date", period.from).lte("production_batches.batch_date", period.to).order("id")),
    fetchAllPaged(() => sb.from("stock_transfers").select("product_id,stock_item_id,quantity,from_category,to_category").is("deleted_at", null)
      .gte("created_at", period.startUTC).lt("created_at", period.endExclusiveUTC).order("id")),
    fetchAllPaged(() => sb.from("expenses").select("source_product_id,source_stock_item_id,source_quantity").is("deleted_at", null).eq("is_stock_transfer", true)
      .gte("date", period.from).lte("date", period.to).order("id")),
    fetchAllPaged(() => sb.from("sale_items").select("product_id,quantity,sales!inner(sale_date,status,deleted_at,hidden,order_type)")
      .gte("sales.sale_date", period.startUTC).lt("sales.sale_date", period.endExclusiveUTC).order("id")),
    fetchAllPaged(() => sb.from("recipes").select("parent_product_id,component_product_id,component_stock_item_id,quantity,applies_to").is("deleted_at", null).order("id")),
    fetchAllPaged(() => sb.from("expense_categories").select("name").is("deleted_at", null).order("id")),
    fetchAllPaged(() => sb.from("stock_adjustments").select("product_id,stock_item_id,quantity").is("deleted_at", null).gte("date", period.from).lte("date", period.to).order("id")),
  ]);
  const prodsRes = { data: prods };

  const itemsRes = { data: items };
  const openRes = { data: openRows };
  const purRes = { data: purRows };
  const batchRes = { data: batchRows };
  const batchItemRes = { data: batchItemRows };
  const transferRes = { data: transferRows };
  const consumptionRes = { data: consumptionRows };
  const saleItemRes = { data: saleItemRows };
  const recipeRes = { data: recipeRows };
  const expCatRes = { data: expCatRows };


  // ---- Opening (locked monthly snapshot wins over live opening_stock)
  const openings: Record<string, number> = {};
  for (const r of (openRes.data ?? []) as any[]) openings[`${r.scope}:${r.item_id}`] = num(r.quantity);

  // ---- Purchases
  const purchaseProd: Record<string, number> = {};
  const purchaseItem: Record<string, number> = {};
  for (const r of (purRes.data ?? []) as any[]) {
    add(purchaseProd, r.product_id, num(r.quantity));
    add(purchaseItem, r.stock_item_id, num(r.quantity));
  }

  // ---- Production (finished products produced by recipe batches)
  const productionProd: Record<string, number> = {};
  for (const b of (batchRes.data ?? []) as any[]) add(productionProd, b.product_id, num(b.quantity));

  // ---- Recipe usage via production batches (components consumed)
  const recipeProd: Record<string, number> = {};
  const recipeItem: Record<string, number> = {};
  for (const r of (batchItemRes.data ?? []) as any[]) {
    if (r.production_batches?.deleted_at) continue;
    add(recipeProd, r.component_product_id, num(r.quantity));
    add(recipeItem, r.component_stock_item_id, num(r.quantity));
  }

  // ---- Sales (completed, non-deleted, non-hidden only)
  const soldByProduct: Record<string, number> = {};
  const soldByProductAndType: Record<string, Record<string, number>> = {};
  for (const it of (saleItemRes.data ?? []) as any[]) {
    const s = it.sales;
    if (!s || s.deleted_at || s.hidden || s.status !== "completed") continue;
    const q = num(it.quantity);
    add(soldByProduct, it.product_id, q);
    const t = (s.order_type ?? "walk_in") as string;
    const bucket = (soldByProductAndType[it.product_id] ??= {});
    bucket[t] = (bucket[t] ?? 0) + q;
  }

  // ---- Recipe usage via POS sales: recipe qty × sold qty of the parent product
  const parentsWithRecipe = new Set<string>();
  for (const r of (recipeRes.data ?? []) as any[]) {
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

  // ---- Transfers: category → category moves of the same item.
  // Moving into an expense-style category leaves inventory (out only).
  const expenseCats = new Set(
    ((expCatRes.data ?? []) as any[]).map((c) => String(c.name).trim().toLowerCase()),
  );
  const transferInProd: Record<string, number> = {};
  const transferOutProd: Record<string, number> = {};
  const transferInItem: Record<string, number> = {};
  const transferOutItem: Record<string, number> = {};
  for (const r of (transferRes.data ?? []) as any[]) {
    const q = num(r.quantity);
    const leavesInventory = expenseCats.has(String(r.to_category ?? "").trim().toLowerCase());
    add(transferOutProd, r.product_id, q);
    add(transferOutItem, r.stock_item_id, q);
    if (!leavesInventory) {
      add(transferInProd, r.product_id, q);
      add(transferInItem, r.stock_item_id, q);
    }
  }

  // ---- Manual consumption (waste, staff meal, testing, owner use…)
  const consProd: Record<string, number> = {};
  const consItem: Record<string, number> = {};
  for (const e of (consumptionRes.data ?? []) as any[]) {
    const q = num(e.source_quantity);
    add(consProd, e.source_product_id, q);
    add(consItem, e.source_stock_item_id, q);
  }

  const products: ProductInventoryRow[] = ((prodsRes.data ?? []) as any[]).map((r) => {
    const opening = openings[`product:${r.id}`] ?? num(r.opening_stock);
    const purchases = purchaseProd[r.id] ?? 0;
    const transferIn = transferInProd[r.id] ?? 0;
    const production = productionProd[r.id] ?? 0;
    const recipeUsage = recipeProd[r.id] ?? 0;
    // A product built from a recipe is consumed through its ingredients;
    // only products without a recipe are deducted directly on sale.
    const sold = soldByProduct[r.id] ?? 0;
    const directSales = parentsWithRecipe.has(r.id) ? 0 : sold;
    const transferOut = transferOutProd[r.id] ?? 0;
    const manualConsumption = consProd[r.id] ?? 0;
    const auto = r.auto_calc === true;
    const remaining = auto
      ? opening + purchases + transferIn + production - recipeUsage - directSales - transferOut - manualConsumption
      : num(r.current_stock);
    const salePrice = num(r.sale_price);
    return {
      id: r.id,
      name: r.name,
      category: r.category ?? "—",
      opening, purchases, transferIn, production,
      recipeUsage, directSales, transferOut, manualConsumption,
      remaining, auto, salePrice, value: remaining * salePrice,
    };
  });

  const stockItems: StockItemInventoryRow[] = ((itemsRes.data ?? []) as any[]).map((r) => {
    const opening = openings[`stock_item:${r.id}`] ?? num(r.opening_stock);
    const purchases = purchaseItem[r.id] ?? 0;
    const transferIn = transferInItem[r.id] ?? 0;
    const production = 0; // stock items are not produced by batches
    const recipeUsage = recipeItem[r.id] ?? 0;
    const directSales = 0; // stock items are never sold directly on an invoice
    const transferOut = transferOutItem[r.id] ?? 0;
    const manualConsumption = consItem[r.id] ?? 0;
    const auto = r.auto_calc === true;
    const remaining = auto
      ? opening + purchases + transferIn + production - recipeUsage - directSales - transferOut - manualConsumption
      : num(r.current_stock);
    const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
    const avgPrice = manual ? num(r.avg_price_override) : num(r.purchase_price);
    return {
      id: r.id,
      name: r.name,
      unit: r.unit ?? "pcs",
      opening, purchases, transferIn, production,
      recipeUsage, directSales, transferOut, manualConsumption,
      remaining, auto, avgPrice, manual, value: remaining * avgPrice,
    };
  });

  return { products, stockItems };
}

export function useInventoryEngine(period: Period) {
  return useQuery({
    queryKey: ["inventory-engine", period.from, period.to],
    queryFn: () => fetchInventoryEngine(period),
    staleTime: 0,
  });
}
