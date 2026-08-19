/**
 * Inventory Engine — single source of truth for Remaining quantity.
 *
 * Remaining = Opening + Purchases + Production
 *           − Recipe Usage − Direct Sales − Transfer Out + Manual Adjustment
 *
 * Transfers to another category AND transfers to Expenses (wastage, staff
 * food, testing…) are both reported as Transfer Out.
 *
 * Every movement is rebuilt from transaction history; stored `current_stock`
 * is only used when Auto Calculation is OFF for that item.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import { computeStockPosition, type ProductStockRow, type StockItemStockRow, type StockSale } from "@/lib/stock-position";

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
  manualAdjustment: number;
  remaining: number;
  auto: boolean;
  /** Stock Tracking switch — false means unlimited stock, never validated. */
  tracked: boolean;
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
    adjustRows,
  ] = await Promise.all([
    fetchAllPaged(() => sb.from("products").select("id,name,category,opening_stock,current_stock,sale_price,auto_calc,track_stock").is("deleted_at", null).order("name")),
    fetchAllPaged(() => sb.from("stock_items").select("id,name,unit,category,opening_stock,current_stock,purchase_price,avg_price_override,auto_calc").is("deleted_at", null).order("name")),
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
    fetchAllPaged(() => sb.from("stock_adjustments").select("product_id,stock_item_id,quantity").is("deleted_at", null).gte("date", period.from).lte("date", period.to).order("id")),
  ]);

  const openingSnapshot: Record<string, number> = {};
  for (const r of openRows as any[]) openingSnapshot[`${r.scope}:${r.item_id}`] = num(r.quantity);

  // One sale-item row per invoice line; normalise to the shared sale shape.
  const sales: StockSale[] = (saleItemRows as any[])
    .filter((it) => it.sales && !it.sales.deleted_at)
    .map((it) => ({
      status: it.sales.status,
      deleted_at: it.sales.deleted_at,
      hidden: it.sales.hidden,
      order_type: it.sales.order_type,
      items: [{ product_id: it.product_id, quantity: it.quantity }],
    }));

  return computeStockPosition({
    products: prods as any[],
    stockItems: items as any[],
    openingSnapshot,
    purchases: purRows as any[],
    production: batchRows as any[],
    batchItems: (batchItemRows as any[]).filter((r) => !r.production_batches?.deleted_at),
    transfers: transferRows as any[],
    transferExpenses: consumptionRows as any[],
    adjustments: adjustRows as any[],
    recipes: recipeRows as any[],
    sales,
  });
}

export function useInventoryEngine(period: Period) {
  return useQuery({
    queryKey: ["inventory-engine", period.from, period.to],
    queryFn: () => fetchInventoryEngine(period),
    staleTime: 0,
  });
}
