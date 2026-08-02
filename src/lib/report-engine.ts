import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { businessDateOf, type RangeResult } from "@/lib/business-date";
import { num } from "@/lib/format";

export type ReportRangeInput = Partial<RangeResult> & { label?: string };

export type ReportCategoryRow = {
  category: string;
  sales: number;
  revenueQty: number;
  opening: number;
  productPurchases: number;
  stockPurchases: number;
  purchases: number;
  /** Net stock received from transfers / production (in − out), excluding purchases. */
  received: number;
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
  /** Daily staff salary (monthly ÷ 30) accrued for every present day in the range. */
  staffSalaryCost: number;

  totalOpening: number;
  totalPurch: number;
  totalReceived: number;

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

async function fetchAllPaged<T = any>(build: () => any, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await build().range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function fetchReportEngine(range: ReportRangeInput, seedCategories: string[] = []): Promise<ReportResult> {
  const hasRange = Boolean(range.from && range.to && range.startUTC && range.endExclusiveUTC);

  const buildSales = () => {
    let q = (supabase as any)
      .from("sales")
      .select("id, invoice_no, sale_date, grand_total, delivery_charges, cash_paid, online_paid, payment_method, customer_name, customer_phone, status, order_type, katha, deleted_at, sale_items(id, product_id, quantity, price, total, unit, products(id, name, category, cost_price))")
      .is("deleted_at", null)
      .eq("hidden", false)

      .order("sale_date", { ascending: false });
    if (hasRange) q = q.gte("sale_date", range.startUTC).lt("sale_date", range.endExclusiveUTC);
    return q;
  };
  const buildExpenses = () => {
    let q = supabase.from("expenses" as any).select("amount, payment_status, payment_method").is("deleted_at", null).order("date", { ascending: false });
    if (range.from && range.to) q = q.gte("date", range.from).lte("date", range.to);
    return q;
  };
  const buildDeliveryExpenses = () => {
    let q = supabase.from("delivery_expenses" as any).select("fuel_cost, maintenance_cost").is("deleted_at", null).order("date", { ascending: false });
    if (range.from && range.to) q = q.gte("date", range.from).lte("date", range.to);
    return q;
  };
  const buildPurchases = () => {
    let q = supabase.from("stock_purchases" as any).select("product_id, stock_item_id, total_cost, quantity, unit_cost, category").is("deleted_at", null).order("date", { ascending: false });
    if (range.from && range.to) q = q.gte("date", range.from).lte("date", range.to);
    return q;
  };
  const buildProducts = () => (supabase as any).from("products").select("id, name, category, cost_price, avg_price_override, opening_stock, current_stock").is("deleted_at", null).order("name");
  const buildStockItems = () => (supabase as any).from("stock_items").select("id, name, category, purchase_price, avg_price_override, opening_stock, current_stock").is("deleted_at", null).order("name");
  const buildRecipes = () => (supabase as any).from("recipes").select("parent_product_id, component_product_id, component_stock_item_id, quantity, applies_to").is("deleted_at", null);
  // Stock received into / sent out of a category by transfers, production and stock-to-expense moves.
  const buildTransfers = () => {
    let q = (supabase as any).from("stock_transfers").select("from_category, to_category, total_cost, created_at").is("deleted_at", null).order("created_at", { ascending: false });
    if (range.startUTC && range.endExclusiveUTC) q = q.gte("created_at", range.startUTC).lt("created_at", range.endExclusiveUTC);
    return q;
  };
  const buildProduction = () => {
    let q = (supabase as any).from("production_batches").select("target_category, total_cost, batch_date, production_batch_items(source_category, total_cost)").is("deleted_at", null).order("batch_date", { ascending: false });
    if (range.from && range.to) q = q.gte("batch_date", range.from).lte("batch_date", range.to);
    return q;
  };
  const buildTransferExpenses = () => {
    let q = (supabase as any)
      .from("expenses")
      .select("amount, source_product_id, source_stock_item_id")
      .is("deleted_at", null)
      .eq("is_stock_transfer", true)
      .order("date", { ascending: false });
    if (range.from && range.to) q = q.gte("date", range.from).lte("date", range.to);
    return q;
  };


  const overridesPromise = range.from
    ? (supabase as any).from("monthly_stock_overrides").select("*").eq("year", Number(range.from.slice(0, 4))).eq("month", Number(range.from.slice(5, 7)))
    : Promise.resolve({ data: [], error: null });

  // Locked opening-stock snapshot for the reported period (historical months never change).
  const snapshotPromise = range.from
    ? (supabase as any).from("stock_opening_snapshots").select("scope,item_id,quantity,unit_value")
        .eq("year", Number(range.from.slice(0, 4))).eq("month", Number(range.from.slice(5, 7)))
    : Promise.resolve({ data: [], error: null });

  const staffPromise = (supabase as any).from("staff").select("id, monthly_salary").is("deleted_at", null);
  const attendancePromise = range.from && range.to
    ? (supabase as any).from("staff_attendance").select("staff_id, status, date").eq("status", "present").gte("date", range.from).lte("date", range.to)
    : (supabase as any).from("staff_attendance").select("staff_id, status, date").eq("status", "present");

  const [salesRows, expensesRows, deliveryExpensesRows, purchasesRows, productsRows, stockItemsRows, recipesRows, transferRows, productionRows, transferExpenseRows, overridesQ, snapshotQ, staffQ, attendanceQ] = await Promise.all([
    fetchAllPaged<any>(buildSales),
    fetchAllPaged<any>(buildExpenses),
    fetchAllPaged<any>(buildDeliveryExpenses),
    fetchAllPaged<any>(buildPurchases),
    fetchAllPaged<any>(buildProducts),
    fetchAllPaged<any>(buildStockItems),
    fetchAllPaged<any>(buildRecipes),
    fetchAllPaged<any>(buildTransfers),
    fetchAllPaged<any>(buildProduction),
    fetchAllPaged<any>(buildTransferExpenses),
    overridesPromise,
    snapshotPromise,
    staffPromise,
    attendancePromise,
  ]);
  if ((overridesQ as any).error) throw (overridesQ as any).error;

  // Opening quantities locked to this period, keyed "<scope>:<id>".
  const openingSnapshot: Record<string, number> = {};
  for (const r of (((snapshotQ as any).data ?? []) as any[])) openingSnapshot[`${r.scope}:${r.item_id}`] = num(r.quantity);

  // Part 3 — present staff accrue one daily salary (monthly ÷ 30) per present day.
  const salaryById: Record<string, number> = {};
  for (const s of (((staffQ as any).data ?? []) as any[])) salaryById[s.id] = num(s.monthly_salary) / 30;
  let staffSalaryCost = 0;
  for (const a of (((attendanceQ as any).data ?? []) as any[])) staffSalaryCost += salaryById[a.staff_id] ?? 0;
  staffSalaryCost = Math.round(staffSalaryCost * 100) / 100;


  const invoices = (salesRows as any[]).filter((s) => inBusinessRange(s, range));
  const expenses = expensesRows as any[];
  const deliveryExpenses = deliveryExpensesRows as any[];
  const purchases = purchasesRows as any[];
  const products = productsRows as any[];
  const stockItems = (stockItemsRows ?? []) as any[];
  const recipes = (recipesRows ?? []) as any[];
  const transfers = (transferRows ?? []) as any[];
  const production = (productionRows ?? []) as any[];
  const transferExpenses = (transferExpenseRows ?? []) as any[];


  const overrides = (overridesQ.data ?? []) as any[];

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
    received: 0,
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

  // Recipe components indexed by parent product + order type, using current weighted-average cost.
  type RecipeComp = { kind: "product" | "stock_item"; category: string; unitCost: number; qtyPerParent: number; appliesTo: Set<string> };
  const recipesByParent: Record<string, RecipeComp[]> = {};
  const ALL_OT = ["walk_in", "take_away", "delivery"];
  for (const r of recipes) {
    const parent = r.parent_product_id;
    if (!parent) continue;
    const applies = new Set<string>((Array.isArray(r.applies_to) && r.applies_to.length > 0) ? r.applies_to : ALL_OT);
    let comp: RecipeComp | null = null;
    if (r.component_product_id) {
      const cp = prodById[r.component_product_id];
      if (cp) comp = { kind: "product", category: cp.category ?? "—", unitCost: num(cp.cost_price), qtyPerParent: num(r.quantity), appliesTo: applies };
    } else if (r.component_stock_item_id) {
      const cs = stockById[r.component_stock_item_id];
      if (cs) comp = { kind: "stock_item", category: cs.category ?? "—", unitCost: num(cs.purchase_price), qtyPerParent: num(r.quantity), appliesTo: applies };
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
    const isPending = sale.status === "pending";
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
    const orderType: string = sale.order_type ?? "walk_in";

    // Financial totals only for completed sales — pending is inventory-only.
    if (!isPending) {
      totalSales += grand;
      deliveryCharges += delivery;
      totalCashPaid += cash;
      totalOnlinePaid += online;
      if (sale.katha) kathaAmount += remaining;
    }

    const day = (salesByBusinessDate[businessDate] ??= { date: businessDate, count: 0, totalSales: 0, totalQtySold: 0, delivery: 0, cash: 0, online: 0, katha: 0 });
    day.count += 1;
    if (!isPending) {
      day.totalSales += grand;
      day.delivery += delivery;
      day.cash += cash;
      day.online += online;
      if (sale.katha) day.katha += remaining;
    }

    if (items.length === 0) {
      if (!isPending) {
        const cat = ensureCat("Uncategorized");
        cat.sales += grand;
        const key = "unallocated";
        productMap[key] ??= { id: key, name: "Unallocated invoice", category: "Uncategorized", qty: 0, rev: 0, cogs: 0, grossProfit: 0 };
        productMap[key].rev += grand;
      }
      continue;
    }

    for (const it of items) {
      const product = it.products ?? prodById[it.product_id] ?? {};
      const category = product.category ?? "—";
      const qty = num(it.quantity);
      const itemTotal = num(it.total);
      const allocatedSales = itemSubtotal > 0 ? (grand * itemTotal) / itemSubtotal : grand / items.length;
      const cat = ensureCat(category);
      // Quantities and product rows include pending so Reports match the Sales page.
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
          if (!comp.appliesTo.has(orderType)) continue;
          const ingredientCost = qty * comp.qtyPerParent * comp.unitCost;
          if (ingredientCost === 0) continue;
          cost += ingredientCost;
          if (!isPending) {
            const src = ensureCat(comp.category);
            if (comp.kind === "product") src.productPurchases -= ingredientCost;
            else src.stockPurchases -= ingredientCost;
            cat.productPurchases += ingredientCost;
          }
        }
      } else {
        cost = qty * num(product.cost_price);
      }

      const pid = it.product_id ?? `unknown-${category}`;
      productMap[pid] ??= { id: pid, name: product.name ?? "Unknown product", category, qty: 0, rev: 0, cogs: 0, grossProfit: 0 };
      productMap[pid].qty += qty;
      if (!isPending) {
        cat.sales += allocatedSales;
        productMap[pid].rev += allocatedSales;
        productMap[pid].cogs += cost;
      }
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
    // Owner override of the average purchase price is used for valuation only.
    const costPrice = p.avg_price_override !== null && p.avg_price_override !== undefined ? num(p.avg_price_override) : num(p.cost_price);
    const openQty = openingSnapshot[`product:${p.id}`] ?? num(p.opening_stock);
    cat.opening += prodOverride[p.id]?.opening ?? openQty * costPrice;
    cat.closing += prodOverride[p.id]?.closing ?? num(p.current_stock) * costPrice;
    cat.productPurchases += purchaseByProduct[p.id] ?? 0;
  }
  // Include stock items in opening/closing valuation so Monthly Report reflects them.
  for (const si of stockItems) {
    const cat = ensureCat(si.category ?? "—");
    const price = si.avg_price_override !== null && si.avg_price_override !== undefined ? num(si.avg_price_override) : num(si.purchase_price);
    const openQty = openingSnapshot[`stock_item:${si.id}`] ?? num(si.opening_stock);
    cat.opening += openQty * price;
    cat.closing += num(si.current_stock) * price;
  }

  for (const [category, override] of Object.entries(catOverride)) {
    const cat = ensureCat(category);
    if (override.opening !== undefined) cat.opening = override.opening;
    if (override.closing !== undefined) cat.closing = override.closing;
  }

  // Received Stock: value moved INTO a category (transfers in, production output) minus
  // value moved OUT of it (transfers out, production consumption, stock-to-expense moves).
  for (const t of transfers) {
    const val = num(t.total_cost);
    if (!val) continue;
    if (t.to_category) ensureCat(t.to_category).received += val;
    if (t.from_category) ensureCat(t.from_category).received -= val;
  }
  for (const b of production) {
    if (b.target_category) ensureCat(b.target_category).received += num(b.total_cost);
    for (const bi of ((b.production_batch_items ?? []) as any[])) {
      if (bi?.source_category) ensureCat(bi.source_category).received -= num(bi.total_cost);
    }
  }
  for (const e of transferExpenses) {
    const src = e.source_product_id ? prodById[e.source_product_id] : e.source_stock_item_id ? stockById[e.source_stock_item_id] : null;
    if (!src) continue;
    ensureCat(src.category ?? "—").received -= num(e.amount);
  }

  const generalExpenses = expenses.reduce((s, e) => s + num(e.amount), 0);
  const paidExpenses = expenses.reduce((s, e) => s + (((e.payment_status ?? "paid") === "paid") ? num(e.amount) : 0), 0);
  const unpaidExpenses = expenses.reduce((s, e) => s + (((e.payment_status ?? "paid") === "unpaid") ? num(e.amount) : 0), 0);
  const deliveryExpenseTotal = deliveryExpenses.reduce((s, e) => s + num(e.fuel_cost) + num(e.maintenance_cost), 0);
  const deliveryProfit = deliveryCharges - deliveryExpenseTotal;

  const catRows = Object.values(catMap).map((c) => {
    c.purchases = c.productPurchases + c.stockPurchases;
    // COGS = Opening + Purchases + Received Stock − Closing
    c.cogs = c.opening + c.purchases + c.received - c.closing;
    c.grossProfit = c.sales - c.cogs;
    c.allocatedExp = 0;
    c.deliveryProfit = 0;
    c.netProfit = c.grossProfit;
    return c;
  }).sort((a, b) => b.sales - a.sales || a.category.localeCompare(b.category));

  const productRows = Object.values(productMap).map((p) => ({ ...p, grossProfit: p.rev - p.cogs })).sort((a, b) => b.rev - a.rev || a.name.localeCompare(b.name));
  const totalOpening = catRows.reduce((s, c) => s + c.opening, 0);
  const totalPurch = catRows.reduce((s, c) => s + c.purchases, 0);
  const totalReceived = catRows.reduce((s, c) => s + c.received, 0);
  const totalClosing = catRows.reduce((s, c) => s + c.closing, 0);
  const totalCogs = totalOpening + totalPurch + totalReceived - totalClosing;

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
    totalReceived,

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