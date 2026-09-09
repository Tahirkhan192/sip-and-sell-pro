/**
 * Stock traceability.
 *
 * For one product or stock item, lists the actual transactions behind every
 * number shown on the Current Stock screen. Nothing here is typed by hand —
 * every line is read back from the module that created it (purchases, sales,
 * recipes/production, transfers, adjustments).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { num } from "@/lib/format";
import type { Period } from "@/lib/inventory-engine";

export type TraceLine = { date: string; ref: string; quantity: number; note?: string };
export type TraceGroup = { key: string; title: string; total: number; lines: TraceLine[] };

const sb = () => supabase as any;
const d = (v: any) => String(v ?? "").slice(0, 10);

async function safe<T = any>(p: any): Promise<T[]> {
  try {
    const { data } = await p;
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export async function fetchStockTrace(
  scope: "product" | "stock_item",
  id: string,
  period: Period,
): Promise<TraceGroup[]> {
  const isProduct = scope === "product";
  const col = isProduct ? "product_id" : "stock_item_id";

  const [purchases, sales, batchItems, batches, transfers, expenseTransfers, adjustments, recipes] = await Promise.all([
    safe(sb().from("stock_purchases").select("date,quantity,unit_cost,supplier").is("deleted_at", null).eq(col, id).gte("date", period.from).lte("date", period.to).order("date")),
    isProduct
      ? safe(sb().from("sale_items").select("quantity,sales!inner(invoice_no,sale_date,status,deleted_at,hidden)").eq("product_id", id)
          .gte("sales.sale_date", period.startUTC).lt("sales.sale_date", period.endExclusiveUTC))
      : Promise.resolve([]),
    safe(sb().from("production_batch_items").select("quantity,production_batches!inner(batch_date,deleted_at,product_id)")
      .eq(isProduct ? "component_product_id" : "component_stock_item_id", id)
      .gte("production_batches.batch_date", period.from).lte("production_batches.batch_date", period.to)),
    isProduct
      ? safe(sb().from("production_batches").select("batch_date,quantity,notes").is("deleted_at", null).eq("product_id", id).gte("batch_date", period.from).lte("batch_date", period.to))
      : Promise.resolve([]),
    safe(sb().from("stock_transfers").select("created_at,quantity,from_category,to_category,reason").is("deleted_at", null).eq(col, id)
      .gte("created_at", period.startUTC).lt("created_at", period.endExclusiveUTC)),
    safe(sb().from("expenses").select("date,source_quantity,category,description").is("deleted_at", null).eq("is_stock_transfer", true)
      .eq(isProduct ? "source_product_id" : "source_stock_item_id", id).gte("date", period.from).lte("date", period.to)),
    safe(sb().from("stock_adjustments").select("date,quantity,reason,notes").is("deleted_at", null).eq(col, id).gte("date", period.from).lte("date", period.to)),
    safe(sb().from("recipes").select("parent_product_id,quantity,applies_to,products!recipes_parent_product_id_fkey(name)").is("deleted_at", null)
      .eq(isProduct ? "component_product_id" : "component_stock_item_id", id)),
  ]);

  // Recipe usage through POS sales: recipe quantity × quantity of the parent sold.
  const recipeSaleLines: TraceLine[] = [];
  for (const r of recipes as any[]) {
    const parentSales = await safe(sb().from("sale_items").select("quantity,sales!inner(sale_date,status,deleted_at,hidden,order_type)")
      .eq("product_id", r.parent_product_id).gte("sales.sale_date", period.startUTC).lt("sales.sale_date", period.endExclusiveUTC));
    const applies: string[] = Array.isArray(r.applies_to) ? r.applies_to : [];
    let sold = 0;
    for (const s of parentSales as any[]) {
      const sale = s.sales;
      if (!sale || sale.deleted_at || sale.hidden) continue;
      if (sale.status !== "completed" && sale.status !== "pending") continue;
      const type = sale.order_type ?? "walk_in";
      if (applies.length > 0 && !applies.includes(type)) continue;
      sold += num(s.quantity);
    }
    if (sold <= 0) continue;
    recipeSaleLines.push({
      date: period.to,
      ref: r.products?.name ?? "Recipe",
      quantity: sold * num(r.quantity),
      note: `${num(r.quantity)} per unit × ${sold} sold`,
    });
  }

  const purchaseLines: TraceLine[] = (purchases as any[]).map((p) => ({
    date: d(p.date), ref: p.supplier || "Purchase", quantity: num(p.quantity), note: `unit ${num(p.unit_cost)}`,
  }));

  const saleLines: TraceLine[] = (sales as any[])
    .filter((s) => s.sales && !s.sales.deleted_at && !s.sales.hidden && (s.sales.status === "completed" || s.sales.status === "pending"))
    .map((s) => ({ date: d(s.sales.sale_date), ref: s.sales.invoice_no ?? "Invoice", quantity: num(s.quantity) }));

  const productionLines: TraceLine[] = (batches as any[]).map((b) => ({
    date: d(b.batch_date), ref: "Production batch", quantity: num(b.quantity), note: b.notes ?? undefined,
  }));

  const recipeLines: TraceLine[] = [
    ...(batchItems as any[])
      .filter((b) => b.production_batches && !b.production_batches.deleted_at)
      .map((b) => ({ date: d(b.production_batches.batch_date), ref: "Production batch", quantity: num(b.quantity) })),
    ...recipeSaleLines,
  ];

  const transferLines: TraceLine[] = [
    ...(transfers as any[]).map((t) => ({
      date: d(t.created_at), ref: `${t.from_category ?? "—"} → ${t.to_category ?? "—"}`, quantity: num(t.quantity), note: t.reason ?? undefined,
    })),
    ...(expenseTransfers as any[]).map((e) => ({
      date: d(e.date), ref: `Expense: ${e.category ?? "—"}`, quantity: num(e.source_quantity), note: e.description ?? undefined,
    })),
  ];

  const adjustmentLines: TraceLine[] = (adjustments as any[]).map((a) => ({
    date: d(a.date), ref: a.reason || "Adjustment", quantity: num(a.quantity), note: a.notes ?? undefined,
  }));

  const groups: TraceGroup[] = [
    { key: "purchase", title: "Purchase", lines: purchaseLines, total: 0 },
    ...(isProduct ? [{ key: "production", title: "Production", lines: productionLines, total: 0 }] : []),
    { key: "sale", title: "Direct Sale", lines: saleLines, total: 0 },
    { key: "recipe", title: "Recipe Usage", lines: recipeLines, total: 0 },
    { key: "transfer", title: "Transfer Out", lines: transferLines, total: 0 },
    { key: "adjustment", title: "Adjustment", lines: adjustmentLines, total: 0 },
  ];
  for (const g of groups) {
    g.total = g.lines.reduce((s, l) => s + l.quantity, 0);
    g.lines.sort((a, b) => a.date.localeCompare(b.date));
  }
  return groups;
}

export function useStockTrace(scope: "product" | "stock_item", id: string | null, period: Period) {
  return useQuery({
    queryKey: ["stock-trace", scope, id, period.from, period.to],
    queryFn: () => fetchStockTrace(scope, id as string, period),
    enabled: !!id,
  });
}
