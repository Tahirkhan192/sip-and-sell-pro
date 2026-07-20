import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { businessDateOf, type RangeResult } from "@/lib/business-date";
import { num } from "@/lib/format";
import {
  listSalesInRangeLocal,
  listAllSalesLocal,
  listExpensesInRangeLocal,
  listDeliveryExpensesInRangeLocal,
  listStockPurchasesInRangeLocal,
  listProductsLocal,
  listStockItemsLocal,
  listRecipesLocal,
  listMonthlyOverridesLocal,
} from "@/lib/local-repo";

export type ReportRangeInput = Partial<RangeResult> & { label?: string };

export type ReportCategoryRow = {
  category: string;
  sales: number;
  revenueQty: number;
  opening: number;
  productPurchases: number;
  stockPurchases: number;
  purchases: number;
  closing: number;
  cogs: number;
  grossProfit: number;
  allocatedExp: number;
  deliveryProfit: number;
  netProfit: number;
};

export type ReportProductRow = {
  id: string;
  name: string;
  category: string;
  qty: number;
  rev: number;
  cogs: number;
  grossProfit: number;
};

export type ReportResult = {
  from?: string;
  to?: string;
  invoices: any[];
  totalInvoices: number;
  totalSales: number;
  totalQtySold: number;
  deliveryCharges: number;
  totalCashPaid: number;
  totalOnlinePaid: number;
  kathaAmount: number;
  generalExpenses: number;
  paidExpenses: number;
  unpaidExpenses: number;
  deliveryExpenses: number;
  deliveryProfit: number;
  totalOpening: number;
  totalPurch: number;
  totalClosing: number;
  totalCogs: number;
  grossProfit: number;
  businessProfit: number;
  netProfit: number;
  catRows: ReportCategoryRow[];
  productRows: ReportProductRow[];
  salesByBusinessDate: Record<string, { date: string; count: number; totalSales: number; totalQtySold: number; delivery: number; cash: number; online: number; katha: number }>;
  audit: {
    totalInvoices: number;
    firstBusinessDate: string | null;
    lastBusinessDate: string | null;
    totalSales: number;
    totalCogs: number;
    totalExpenses: number;
    totalDeliveryProfit: number;
    netProfit: number;
    categorySalesTotal: number;
    productSalesTotal: number;
    valid: boolean;
  };
  // Compatibility aliases for existing report UI.
  monthRev: number;
  monthSalesExDel: number;
  monthDelCharges: number;
  monthExp: number;
  monthDelExp: number;
  overall: number;
};

function reportKey(range: ReportRangeInput, categories: string[] = []) {
  return ["report", "engine", range.from ?? "overall", range.to ?? "overall", range.startUTC ?? "", range.endExclusiveUTC ?? "", categories.join("|")];
}

function inBusinessRange(row: any, range: ReportRangeInput) {
  if (!range.from || !range.to) return true;
  const d = businessDateOf(row.sale_date);
  return d >= range.from && d <= range.to;
}

function adjustToTotal<T extends Record<string, any>>(rows: T[], key: keyof T, target: number) {
  const sum = rows.reduce((s, r) => s + num(r[key]), 0);
  const diff = target - sum;
  if (Math.abs(diff) < 0.005 || rows.length === 0) return;
  const row = rows.reduce((best, r) => (Math.abs(num(r[key])) > Math.abs(num(best[key])) ? r : best), rows[0]);
  (row as any)[key] = num(row[key]) + diff;
}

function addDaysISO(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export async function fetchReportEngine(range: ReportRangeInput, seedCategories: string[] = []): Promise<ReportResult> {
  const hasRange = Boolean(range.from && range.to && range.startUTC && range.endExclusiveUTC);

  const [salesRows, expensesRows, deliveryExpensesRows, purchasesRows, productsRows, stockItemsRows, recipesRows, overridesRows] = await Promise.all([
    hasRange ? listSalesInRangeLocal(range.startUTC!, range.endExclusiveUTC!) : listAllSalesLocal(),
    listExpensesInRangeLocal(range.from, range.to),
    listDeliveryExpensesInRangeLocal(range.from, range.to),
    listStockPurchasesInRangeLocal(range.from, range.to),
    listProductsLocal(),
    listStockItemsLocal(),
    listRecipesLocal(),
    range.from
      ? listMonthlyOverridesLocal(Number(range.from.slice(0, 4)), Number(range.from.slice(5, 7)))
      : Promise.resolve([] as any[]),
  ]);

  const invoices = (salesRows as any[]).filter((s) => inBusinessRange(s, range));
  const expenses = expensesRows as any[];
  const deliveryExpenses = deliveryExpensesRows as any[];
  const purchases = purchasesRows as any[];
  const products = productsRows as any[];
  const stockItems = (stockItemsRows ?? []) as any[];
  const recipes = (recipesRows ?? []) as any[];
  const overrides = (overridesRows ?? []) as any[];


  const catMap: Record<string, ReportCategoryRow> = {};
  const productMap: Record<string, ReportProductRow> = {};
  const salesByBusinessDate: ReportResult["salesByBusinessDate"] = {};
  const ensureCat = (category: string) => (catMap[category] ??= {
    category,
    sales: 0,
    revenueQty: 0,
    opening: 0,
    productPurchases: 0,
    stockPurchases: 0,
    purchases: 0,
    closing: 0,
    cogs: 0,
    grossProfit: 0,
    allocatedExp: 0,
    deliveryProfit: 0,
    netProfit: 0,
  });
  for (const c of seedCategories) ensureCat(c);

  const prodById: Record<string, any> = {};
  for (const p of products) {
    prodById[p.id] = p;
    ensureCat(p.category ?? "—");
  }
  const stockById: Record<string, any> = {};
  for (const s of stockItems) {
    stockById[s.id] = s;
    ensureCat(s.category ?? "—");
  }

  // Recipe components indexed by parent product, using current weighted-average cost.
  type RecipeComp = { kind: "product" | "stock_item"; category: string; unitCost: number; qtyPerParent: number };
  const recipesByParent: Record<string, RecipeComp[]> = {};
  for (const r of recipes) {
    const parent = r.parent_product_id;
    if (!parent) continue;
    let comp: RecipeComp | null = null;
    if (r.component_product_id) {
      const cp = prodById[r.component_product_id];
      if (cp) comp = { kind: "product", category: cp.category ?? "—", unitCost: num(cp.cost_price), qtyPerParent: num(r.quantity) };
    } else if (r.component_stock_item_id) {
      const cs = stockById[r.component_stock_item_id];
      if (cs) comp = { kind: "stock_item", category: cs.category ?? "—", unitCost: num(cs.purchase_price), qtyPerParent: num(r.quantity) };
    }
    if (comp) (recipesByParent[parent] ??= []).push(comp);
  }


  let totalSales = 0;
  let totalQtySold = 0;
  let deliveryCharges = 0;
  let totalCashPaid = 0;
  let totalOnlinePaid = 0;
  let kathaAmount = 0;

  for (const sale of invoices) {
    // Pending invoices reduce inventory only; they never contribute to
    // financial totals, category rollups, product sales, or daily closing.
    if (sale.status === "pending") continue;
    const businessDate = businessDateOf(sale.sale_date);
    const grand = num(sale.grand_total);
    const delivery = num(sale.delivery_charges);
    const items = ((sale.sale_items ?? []) as any[]).filter(Boolean);
    const itemSubtotal = items.reduce((s, it) => s + num(it.total), 0);
    let cash = num(sale.cash_paid);
    let online = num(sale.online_paid);
    if (cash + online <= 0 && !sale.katha) {
      if (sale.payment_method === "cash") cash = grand;
      if (sale.payment_method === "card") online = grand;
    }
    const remaining = Math.max(0, grand - cash - online);

    totalSales += grand;
    deliveryCharges += delivery;
    totalCashPaid += cash;
    totalOnlinePaid += online;
    if (sale.katha) kathaAmount += remaining;

    const day = (salesByBusinessDate[businessDate] ??= { date: businessDate, count: 0, totalSales: 0, totalQtySold: 0, delivery: 0, cash: 0, online: 0, katha: 0 });
    day.count += 1;
    day.totalSales += grand;
    day.delivery += delivery;
    day.cash += cash;
    day.online += online;
    if (sale.katha) day.katha += remaining;

    if (items.length === 0) {
      const cat = ensureCat("Uncategorized");
      cat.sales += grand;
      const key = "unallocated";
      productMap[key] ??= { id: key, name: "Unallocated invoice", category: "Uncategorized", qty: 0, rev: 0, cogs: 0, grossProfit: 0 };
      productMap[key].rev += grand;
      continue;
    }

    for (const it of items) {
      const product = it.products ?? prodById[it.product_id] ?? {};
      const category = product.category ?? "—";
      const qty = num(it.quantity);
      const itemTotal = num(it.total);
      const allocatedSales = itemSubtotal > 0 ? (grand * itemTotal) / itemSubtotal : grand / items.length;
      const cat = ensureCat(category);
      cat.sales += allocatedSales;
      cat.revenueQty += qty;
      totalQtySold += qty;
      day.totalQtySold += qty;

      // If parent product has a recipe, cost = sum of consumed ingredient WACs and cost
      // is transferred from each ingredient category to the finished-product category.
      const recipe = recipesByParent[it.product_id];
      let cost: number;
      if (recipe && recipe.length > 0) {
        cost = 0;
        for (const comp of recipe) {
          const ingredientCost = qty * comp.qtyPerParent * comp.unitCost;
          if (ingredientCost === 0) continue;
          cost += ingredientCost;
          const src = ensureCat(comp.category);
          // Source category loses purchase value (bucketed by component kind so it
          // offsets the same bucket the original purchase landed in).
          if (comp.kind === "product") src.productPurchases -= ingredientCost;
          else src.stockPurchases -= ingredientCost;
          // Destination (finished product's category) gains purchase value.
          cat.productPurchases += ingredientCost;
        }
      } else {
        cost = qty * num(product.cost_price);
      }

      const pid = it.product_id ?? `unknown-${category}`;
      productMap[pid] ??= { id: pid, name: product.name ?? "Unknown product", category, qty: 0, rev: 0, cogs: 0, grossProfit: 0 };
      productMap[pid].qty += qty;
      productMap[pid].rev += allocatedSales;
      productMap[pid].cogs += cost;
    }
  }

  adjustToTotal(Object.values(catMap), "sales", totalSales);
  adjustToTotal(Object.values(productMap), "rev", totalSales);

  const purchaseByProduct: Record<string, number> = {};
  for (const p of purchases) {
    if (p.product_id) {
      purchaseByProduct[p.product_id] = (purchaseByProduct[p.product_id] ?? 0) + num(p.total_cost);
    } else {
      ensureCat(p.category ?? "—").stockPurchases += num(p.total_cost);
    }
  }

  const catOverride: Record<string, { opening?: number; closing?: number }> = {};
  const prodOverride: Record<string, { opening?: number; closing?: number }> = {};
  for (const o of overrides) {
    if (o.scope === "category" && o.category) catOverride[o.category] = { opening: o.opening_value ?? undefined, closing: o.closing_value ?? undefined };
    if (o.scope === "product" && o.product_id) prodOverride[o.product_id] = { opening: o.opening_value ?? undefined, closing: o.closing_value ?? undefined };
  }

  for (const p of products) {
    const cat = ensureCat(p.category ?? "—");
    const costPrice = num(p.cost_price);
    cat.opening += prodOverride[p.id]?.opening ?? num(p.opening_stock) * costPrice;
    cat.closing += prodOverride[p.id]?.closing ?? num(p.current_stock) * costPrice;
    cat.productPurchases += purchaseByProduct[p.id] ?? 0;
  }
  // Include stock items in opening/closing valuation so Monthly Report reflects them.
  for (const si of stockItems) {
    const cat = ensureCat(si.category ?? "—");
    const price = num(si.purchase_price);
    cat.opening += num(si.opening_stock) * price;
    cat.closing += num(si.current_stock) * price;
  }
  for (const [category, override] of Object.entries(catOverride)) {
    const cat = ensureCat(category);
    if (override.opening !== undefined) cat.opening = override.opening;
    if (override.closing !== undefined) cat.closing = override.closing;
  }

  const generalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const paidExpenses = expenses.reduce((s, e) => s + (((e.payment_status ?? "paid") === "paid") ? num(e.amount) : 0), 0);
  const unpaidExpenses = expenses.reduce((s, e) => s + (((e.payment_status ?? "paid") === "unpaid") ? num(e.amount) : 0), 0);
  const deliveryExpenseTotal = deliveryExpenses.reduce((s, e) => s + num(e.fuel_cost) + num(e.maintenance_cost), 0);
  const deliveryProfit = deliveryCharges - deliveryExpenseTotal;

  const catRows = Object.values(catMap).map((c) => {
    c.purchases = c.productPurchases + c.stockPurchases;
    c.cogs = c.opening + c.purchases - c.closing;
    c.grossProfit = c.sales - c.cogs;
    c.allocatedExp = 0;
    c.deliveryProfit = 0;
    c.netProfit = c.grossProfit;
    return c;
  }).sort((a, b) => b.sales - a.sales || a.category.localeCompare(b.category));

  const productRows = Object.values(productMap).map((p) => ({ ...p, grossProfit: p.rev - p.cogs })).sort((a, b) => b.rev - a.rev || a.name.localeCompare(b.name));
  const totalOpening = catRows.reduce((s, c) => s + c.opening, 0);
  const totalPurch = catRows.reduce((s, c) => s + c.purchases, 0);
  const totalClosing = catRows.reduce((s, c) => s + c.closing, 0);
  const totalCogs = totalOpening + totalPurch - totalClosing;
  const grossProfit = totalSales - totalCogs;
  const businessProfit = totalSales - totalCogs - generalExpenses;
  const netProfit = totalSales - totalCogs + deliveryProfit - generalExpenses;
  const categorySalesTotal = catRows.reduce((s, c) => s + c.sales, 0);
  const productSalesTotal = productRows.reduce((s, p) => s + p.rev, 0);
  const businessDates = invoices.map((s) => businessDateOf(s.sale_date)).sort();
  const valid = Math.abs(totalSales - categorySalesTotal) < 0.01 && Math.abs(totalSales - productSalesTotal) < 0.01;

  return {
    from: range.from,
    to: range.to,
    invoices,
    totalInvoices: invoices.length,
    totalSales,
    totalQtySold,
    deliveryCharges,
    totalCashPaid,
    totalOnlinePaid,
    kathaAmount,
    generalExpenses,
    paidExpenses,
    unpaidExpenses,
    deliveryExpenses: deliveryExpenseTotal,
    deliveryProfit,
    totalOpening,
    totalPurch,
    totalClosing,
    totalCogs,
    grossProfit,
    businessProfit,
    netProfit,
    catRows,
    productRows,
    salesByBusinessDate,
    audit: {
      totalInvoices: invoices.length,
      firstBusinessDate: businessDates[0] ?? null,
      lastBusinessDate: businessDates[businessDates.length - 1] ?? null,
      totalSales,
      totalCogs,
      totalExpenses: generalExpenses,
      totalDeliveryProfit: deliveryProfit,
      netProfit,
      categorySalesTotal,
      productSalesTotal,
      valid,
    },
    monthRev: totalSales,
    monthSalesExDel: totalSales - deliveryCharges,
    monthDelCharges: deliveryCharges,
    monthExp: generalExpenses,
    monthDelExp: deliveryExpenseTotal,
    overall: netProfit,
  };
}

export function useReportEngine(range: ReportRangeInput, categories: string[] = []) {
  return useQuery({
    queryKey: reportKey(range, categories),
    queryFn: () => fetchReportEngine(range, categories),
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useIsAdmin() {
  return useQuery({
    queryKey: ["auth", "is-admin"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return false;
      const { data, error } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (error) return false;
      return Boolean(data);
    },
    staleTime: 300000,
  });
}

export { addDaysISO };