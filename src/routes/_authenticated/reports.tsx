import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/CrudHelpers";
import { money, num } from "@/lib/format";
import { useCategories } from "@/lib/use-categories";
import { useDateRangeFilter } from "@/components/DateRangeFilter";
import { businessDateOf, businessDayStartUTC, businessDayEndUTC } from "@/lib/business-date";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Daily • Monthly • Category • Stock • Purchases • Expenses • Sales" />
      <Tabs defaultValue="daily">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="category">Category</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="pt-4"><DailyReport /></TabsContent>
        <TabsContent value="monthly" className="pt-4"><MonthlyReport /></TabsContent>
        <TabsContent value="category" className="pt-4"><CategoryReport /></TabsContent>
        <TabsContent value="stock" className="pt-4"><StockReport /></TabsContent>
        <TabsContent value="purchases" className="pt-4"><PurchaseReport /></TabsContent>
        <TabsContent value="expenses" className="pt-4"><ExpenseReport /></TabsContent>
        <TabsContent value="sales" className="pt-4"><SalesReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function useRange(initPreset: "today" | "month" = "month") {
  const f = useDateRangeFilter(initPreset);
  return {
    from: f.range.from,
    to: f.range.to,
    startUTC: f.range.startUTC,
    endExclusiveUTC: f.range.endExclusiveUTC,
    el: f.el,
  };
}

function dayPlus(d: string) {
  return new Date(new Date(d).getTime() + 86400000).toISOString().slice(0, 10);
}

// ============================================================ DAILY
function DailyReport() {
  const r = useRange("today");
  const { data } = useQuery({
    queryKey: ["report", "daily", r.from, r.to],
    queryFn: async () => {
      const sales = await supabase.from("sales").select("grand_total, delivery_charges, payment_method, sale_date, invoice_no").is("deleted_at", null).gte("sale_date", r.startUTC).lt("sale_date", r.endExclusiveUTC);
      const rows = sales.data ?? [];
      const byDay: Record<string, { date: string; count: number; sales: number; cash: number; card: number; delivery: number }> = {};
      for (const s of rows as any[]) {
        // Business date honors the configured tz + rollover time
        const day = businessDateOf(s.sale_date);

        byDay[day] ??= { date: day, count: 0, sales: 0, cash: 0, card: 0, delivery: 0 };
        byDay[day].count += 1;
        byDay[day].sales += num(s.grand_total);
        byDay[day].delivery += num(s.delivery_charges);
        if (s.payment_method === "cash") byDay[day].cash += num(s.grand_total);
        if (s.payment_method === "card") byDay[day].card += num(s.grand_total);
      }
      return Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date));
    },
  });
  const total = (data ?? []).reduce((a, r) => ({ count: a.count + r.count, sales: a.sales + r.sales, cash: a.cash + r.cash, card: a.card + r.card, delivery: a.delivery + r.delivery }), { count: 0, sales: 0, cash: 0, card: 0, delivery: 0 });
  return (<>
    {r.el}
    <Card>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Invoices</TableHead>
          <TableHead className="text-right">Cash</TableHead>
          <TableHead className="text-right">Card</TableHead>
          <TableHead className="text-right">Delivery</TableHead>
          <TableHead className="text-right">Grand Total</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((d) => (
            <TableRow key={d.date}>
              <TableCell>{d.date}</TableCell>
              <TableCell className="text-right">{d.count}</TableCell>
              <TableCell className="text-right">{money(d.cash)}</TableCell>
              <TableCell className="text-right">{money(d.card)}</TableCell>
              <TableCell className="text-right">{money(d.delivery)}</TableCell>
              <TableCell className="text-right font-semibold">{money(d.sales)}</TableCell>
            </TableRow>
          ))}
          {(data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
        </TableBody>
      </Table>
      {(data ?? []).length > 0 && (
        <div className="border-t px-4 py-2 grid grid-cols-6 text-sm font-medium text-right">
          <div className="text-left">Totals</div>
          <div>{total.count}</div><div>{money(total.cash)}</div><div>{money(total.card)}</div><div>{money(total.delivery)}</div><div>{money(total.sales)}</div>
        </div>
      )}
    </Card>
  </>);
}

// ============================================================ MONTHLY
function useMonthlyData(from: string, to: string, categories: string[]) {
  return useQuery({
    queryKey: ["report", "monthly-full", from, to, categories.join(",")],
    queryFn: async () => {
      const startUTC = `${from}T03:00:00.000Z`;
      const toNext = new Date(`${to}T00:00:00.000Z`); toNext.setUTCDate(toNext.getUTCDate() + 1);
      const endExclusiveUTC = `${toNext.toISOString().slice(0, 10)}T03:00:00.000Z`;
      const [salesQ, expQ, delExpQ, purchProdQ, purchStockQ, prodsQ, saleItemsQ, overridesQ] = await Promise.all([
        supabase.from("sales").select("grand_total, delivery_charges, sale_date, status").is("deleted_at", null).gte("sale_date", startUTC).lt("sale_date", endExclusiveUTC),
        supabase.from("expenses").select("amount").is("deleted_at", null).gte("date", from).lte("date", to),
        supabase.from("delivery_expenses").select("fuel_cost, maintenance_cost").is("deleted_at", null).gte("date", from).lte("date", to),
        supabase.from("stock_purchases").select("product_id, total_cost, quantity, unit_cost, category").is("deleted_at", null).not("product_id", "is", null).gte("date", from).lte("date", to),
        supabase.from("stock_purchases").select("total_cost, category").is("deleted_at", null).not("stock_item_id", "is", null).gte("date", from).lte("date", to),
        supabase.from("products").select("id, name, category, cost_price, opening_stock, current_stock").is("deleted_at", null),
        supabase.from("sale_items").select("product_id, quantity, total, sales!inner(sale_date, status, deleted_at)").gte("sales.sale_date", startUTC).lt("sales.sale_date", endExclusiveUTC),
        supabase.from("monthly_stock_overrides").select("*").eq("year", Number(from.slice(0, 4))).eq("month", Number(from.slice(5, 7))),
      ]);

      // Determine if "from" is a full month start (for overrides to apply)
      const fromYear = Number(from.slice(0, 4));
      const fromMonth = Number(from.slice(5, 7));

      const sales = (salesQ.data ?? []) as any[];
      const monthRev = sales.reduce((s, x) => s + num(x.grand_total), 0);
      const monthDelCharges = sales.reduce((s, x) => s + num(x.delivery_charges), 0);
      const monthSalesExDel = monthRev - monthDelCharges;
      const monthExp = (expQ.data ?? []).reduce((s, x: any) => s + num(x.amount), 0);
      const monthDelExp = (delExpQ.data ?? []).reduce((s, x: any) => s + num(x.fuel_cost) + num(x.maintenance_cost), 0);

      const prods = (prodsQ.data ?? []) as any[];
      const prodById: Record<string, any> = {};
      for (const p of prods) prodById[p.id] = p;

      // Per-product purchase totals & quantities in range
      const purchByProd: Record<string, { qty: number; cost: number }> = {};
      for (const p of (purchProdQ.data ?? []) as any[]) {
        purchByProd[p.product_id] ??= { qty: 0, cost: 0 };
        purchByProd[p.product_id].qty += num(p.quantity);
        purchByProd[p.product_id].cost += num(p.total_cost);
      }

      // Per-product sales in range
      const soldByProd: Record<string, { qty: number; revenue: number }> = {};
      for (const it of (saleItemsQ.data ?? []) as any[]) {
        const sa = it.sales;
        if (!sa || sa.deleted_at) continue;
        soldByProd[it.product_id] ??= { qty: 0, revenue: 0 };
        soldByProd[it.product_id].qty += num(it.quantity);
        soldByProd[it.product_id].revenue += num(it.total);
      }

      // Overrides
      const overrides = (overridesQ.data ?? []) as any[];
      const catOverride: Record<string, { opening?: number; closing?: number }> = {};
      const prodOverride: Record<string, { opening?: number; closing?: number }> = {};
      for (const o of overrides) {
        if (o.scope === "category" && o.category) catOverride[o.category] = { opening: o.opening_value ?? undefined, closing: o.closing_value ?? undefined };
        if (o.scope === "product" && o.product_id) prodOverride[o.product_id] = { opening: o.opening_value ?? undefined, closing: o.closing_value ?? undefined };
      }

      // Per-category aggregation — track product purchases vs stock-item purchases separately
      const catData: Record<string, { sales: number; revenueQty: number; opening: number; productPurchases: number; stockPurchases: number; purchases: number; closing: number; cogs: number }> = {};
      const ensure = (cat: string) => (catData[cat] ??= { sales: 0, revenueQty: 0, opening: 0, productPurchases: 0, stockPurchases: 0, purchases: 0, closing: 0, cogs: 0 });
      for (const cat of categories) ensure(cat);

      for (const p of prods) {
        const cat = p.category ?? "—";
        const cd = ensure(cat);
        const cp = num(p.cost_price);
        const openingVal = prodOverride[p.id]?.opening ?? num(p.opening_stock) * cp;
        const closingVal = prodOverride[p.id]?.closing ?? num(p.current_stock) * cp;
        const purch = purchByProd[p.id] ?? { qty: 0, cost: 0 };
        const sold = soldByProd[p.id] ?? { qty: 0, revenue: 0 };
        cd.opening += openingVal;
        cd.closing += closingVal;
        cd.productPurchases += purch.cost;
        cd.sales += sold.revenue;
        cd.revenueQty += sold.qty;
      }
      // Add stock-item purchases by their category
      for (const r of ((purchStockQ.data ?? []) as any[])) {
        const cat = r.category ?? "—";
        ensure(cat).stockPurchases += num(r.total_cost);
      }
      // Apply category-level overrides (replace, not add)
      for (const [cat, ov] of Object.entries(catOverride)) {
        const cd = ensure(cat);
        if (ov.opening !== undefined) cd.opening = ov.opening;
        if (ov.closing !== undefined) cd.closing = ov.closing;
      }
      // Total purchases per category + COGS
      for (const c of Object.keys(catData)) {
        catData[c].purchases = catData[c].productPurchases + catData[c].stockPurchases;
        catData[c].cogs = catData[c].opening + catData[c].purchases - catData[c].closing;
      }

      // Category Net Profit = Sales + Closing - (Opening + Purchases).
      // General expenses are NEVER subtracted from individual category profits.
      const catRows = Object.entries(catData).map(([category, c]) => {
        const grossProfit = c.sales - c.cogs;
        const netProfit = c.sales + c.closing - (c.opening + c.purchases);
        return { category, ...c, allocatedExp: 0, grossProfit, netProfit };
      });

      // Totals
      const totalOpening = catRows.reduce((s, c) => s + c.opening, 0);
      const totalPurch = catRows.reduce((s, c) => s + c.purchases, 0);
      const totalClosing = catRows.reduce((s, c) => s + c.closing, 0);
      const sumCategoryNet = catRows.reduce((s, c) => s + c.netProfit, 0);
      // Overall = Σ category net − general expenses + delivery profit
      const deliveryProfit = monthDelCharges - monthDelExp;
      const businessProfit = sumCategoryNet - monthExp;
      const overall = businessProfit + deliveryProfit;

      return {
        fromYear, fromMonth,
        monthRev, monthSalesExDel, monthDelCharges, monthExp, monthDelExp,
        totalOpening, totalPurch, totalClosing,
        businessProfit, deliveryProfit, overall,
        catRows,
      };
    },
  });
}

function MonthlyReport() {
  const r = useRange("month");
  const { data: categories = [] } = useCategories();
  const { data } = useMonthlyData(r.from, r.to, categories);
  const totalCogs = (data?.totalOpening ?? 0) + (data?.totalPurch ?? 0) - (data?.totalClosing ?? 0);
  const grossProfit = (data?.monthSalesExDel ?? 0) - totalCogs;
  return (<>
    {r.el}
    <Card className="mb-4">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly P&amp;L — Step by Step</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableBody>
            <TableRow><TableCell>Sales (excl. delivery)</TableCell><TableCell className="text-right">{money(data?.monthSalesExDel)}</TableCell></TableRow>
            <TableRow><TableCell>Opening Stock</TableCell><TableCell className="text-right">{money(data?.totalOpening)}</TableCell></TableRow>
            <TableRow><TableCell>+ Purchases</TableCell><TableCell className="text-right">{money(data?.totalPurch)}</TableCell></TableRow>
            <TableRow><TableCell>− Closing Stock</TableCell><TableCell className="text-right">{money(data?.totalClosing)}</TableCell></TableRow>
            <TableRow className="font-medium"><TableCell>= COGS</TableCell><TableCell className="text-right">{money(totalCogs)}</TableCell></TableRow>
            <TableRow className="font-medium"><TableCell>Gross Profit (Sales − COGS)</TableCell><TableCell className={"text-right " + (grossProfit >= 0 ? "text-primary" : "text-destructive")}>{money(grossProfit)}</TableCell></TableRow>
            <TableRow><TableCell>− General Expenses</TableCell><TableCell className="text-right">{money(data?.monthExp)}</TableCell></TableRow>
            <TableRow className="font-semibold"><TableCell>Business Profit</TableCell><TableCell className={"text-right " + ((data?.businessProfit ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{money(data?.businessProfit)}</TableCell></TableRow>
            <TableRow><TableCell>+ Delivery Profit</TableCell><TableCell className={"text-right " + ((data?.deliveryProfit ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{money(data?.deliveryProfit)}</TableCell></TableRow>
            <TableRow className="font-bold"><TableCell>Overall Profit</TableCell><TableCell className={"text-right " + ((data?.overall ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{money(data?.overall)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>


    <Card className="mb-3">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Profit by Category</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Sales</TableHead>
            <TableHead className="text-right">COGS</TableHead>
            <TableHead className="text-right">Gross Profit</TableHead>
            <TableHead className="text-right">Expenses</TableHead>
            <TableHead className="text-right">Net Profit</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data?.catRows ?? []).map((r) => (
              <TableRow key={r.category}>
                <TableCell className="font-medium">{r.category}</TableCell>
                <TableCell className="text-right">{money(r.sales)}</TableCell>
                <TableCell className="text-right">{money(r.cogs)}</TableCell>
                <TableCell className="text-right">{money(r.grossProfit)}</TableCell>
                <TableCell className="text-right">{money(r.allocatedExp)}</TableCell>
                <TableCell className={"text-right font-semibold " + (r.netProfit >= 0 ? "text-primary" : "text-destructive")}>{money(r.netProfit)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </>);
}

// ============================================================ CATEGORY
function CategoryReport() {
  const r = useRange("month");
  const { data: categories = [] } = useCategories();
  const { data } = useMonthlyData(r.from, r.to, categories);
  return (<>
    {r.el}
    <Card>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="text-right">Qty Sold</TableHead>
          <TableHead className="text-right">Total Revenue</TableHead>
          <TableHead className="text-right">Opening</TableHead>
          <TableHead className="text-right">Product Purchases</TableHead>
          <TableHead className="text-right">Stock Item Purchases</TableHead>
          <TableHead className="text-right">Closing</TableHead>
          <TableHead className="text-right">COGS</TableHead>
          <TableHead className="text-right">Gross Profit</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Net Profit</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(data?.catRows ?? []).map((c: any) => (
            <TableRow key={c.category}>
              <TableCell className="font-medium">{c.category}</TableCell>
              <TableCell className="text-right">{Number(c.revenueQty).toFixed(2)}</TableCell>
              <TableCell className="text-right">{money(c.sales)}</TableCell>
              <TableCell className="text-right">{money(c.opening)}</TableCell>
              <TableCell className="text-right">{money(c.productPurchases)}</TableCell>
              <TableCell className="text-right">{money(c.stockPurchases)}</TableCell>
              <TableCell className="text-right">{money(c.closing)}</TableCell>
              <TableCell className="text-right">{money(c.cogs)}</TableCell>
              <TableCell className="text-right">{money(c.grossProfit)}</TableCell>
              <TableCell className="text-right">{money(c.allocatedExp)}</TableCell>
              <TableCell className={"text-right font-semibold " + (c.netProfit >= 0 ? "text-primary" : "text-destructive")}>{money(c.netProfit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  </>);
}

// ============================================================ STOCK
function StockReport() {
  const { data = [] } = useQuery({
    queryKey: ["report", "stock"],
    queryFn: async () => (await supabase.from("products").select("*").is("deleted_at", null).order("name")).data ?? [],
  });
  const totalValue = (data as any[]).reduce((s, p) => s + num(p.current_stock) * num(p.cost_price), 0);
  return (
    <Card>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Product</TableHead><TableHead>Category</TableHead>
          <TableHead className="text-right">Opening</TableHead>
          <TableHead className="text-right">Remaining</TableHead>
          <TableHead className="text-right">Min</TableHead>
          <TableHead className="text-right">Cost Price</TableHead>
          <TableHead className="text-right">Stock Value</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(data as any[]).map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.category ?? "—"}</TableCell>
              <TableCell className="text-right">{num(r.opening_stock).toFixed(2)}</TableCell>
              <TableCell className="text-right font-medium">{num(r.current_stock).toFixed(2)}</TableCell>
              <TableCell className="text-right">{num(r.minimum_stock).toFixed(2)}</TableCell>
              <TableCell className="text-right">{money(r.cost_price)}</TableCell>
              <TableCell className="text-right">{money(num(r.current_stock) * num(r.cost_price))}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end border-t px-4 py-2 text-sm font-semibold">Total stock value: {money(totalValue)}</div>
    </Card>
  );
}

// ============================================================ PURCHASES
function PurchaseReport() {
  const r = useRange("month");
  const { data = [] } = useQuery({
    queryKey: ["report", "purchases", r.from, r.to],
    queryFn: async () => (await supabase.from("stock_purchases").select("*, products(name), stock_items(name)").is("deleted_at", null).gte("date", r.from).lte("date", r.to).order("date", { ascending: false })).data ?? [],
  });
  const total = (data as any[]).reduce((s, x) => s + num(x.total_cost), 0);
  return (<>
    {r.el}
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product / Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Supplier</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data as any[]).map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.date}</TableCell>
              <TableCell>{p.products?.name ?? p.stock_items?.name}</TableCell>
              <TableCell className="text-right">{Number(p.quantity)}</TableCell>
              <TableCell className="text-right">{money(p.unit_cost)}</TableCell>
              <TableCell className="text-right">{money(p.total_cost)}</TableCell>
              <TableCell>{p.supplier ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end border-t px-4 py-2 text-sm font-semibold">Total: {money(total)}</div>
    </Card>
  </>);
}

// ============================================================ EXPENSES
function ExpenseReport() {
  const r = useRange("month");
  const { data = [] } = useQuery({
    queryKey: ["report", "expenses", r.from, r.to],
    queryFn: async () => (await supabase.from("expenses").select("*").is("deleted_at", null).gte("date", r.from).lte("date", r.to).order("date", { ascending: false })).data ?? [],
  });
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of data as any[]) m[e.category] = (m[e.category] ?? 0) + num(e.amount);
    return m;
  }, [data]);
  const total = Object.values(byCat).reduce((s, v) => s + v, 0);
  return (<>
    {r.el}
    <div className="grid sm:grid-cols-3 gap-3 mb-3">
      {Object.entries(byCat).map(([c, v]) => <Stat key={c} label={c} value={money(v)} />)}
    </div>
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data as any[]).map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.date}</TableCell>
              <TableCell>{p.category}</TableCell>
              <TableCell className="text-right">{money(p.amount)}</TableCell>
              <TableCell className="max-w-xs truncate">{p.description ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end border-t px-4 py-2 text-sm font-semibold">Total: {money(total)}</div>
    </Card>
  </>);
}

// ============================================================ SALES
function SalesReport() {
  const r = useRange("month");
  const { data = [] } = useQuery({
    queryKey: ["report", "sales-items", r.from, r.to],
    queryFn: async () => (await supabase.from("sale_items").select("quantity, total, products(name, category), sales!inner(sale_date, status, deleted_at)").gte("sales.sale_date", r.startUTC).lt("sales.sale_date", r.endExclusiveUTC)).data ?? [],
  });
  const rows = useMemo(() => {
    const m: Record<string, { name: string; category: string; qty: number; rev: number }> = {};
    for (const it of data as any[]) {
      if (it.sales?.deleted_at) continue;
      const name = it.products?.name ?? "?";
      m[name] ??= { name, category: it.products?.category ?? "—", qty: 0, rev: 0 };
      m[name].qty += num(it.quantity);
      m[name].rev += num(it.total);
    }
    return Object.values(m).sort((a, b) => b.rev - a.rev);
  }, [data]);
  const totals = rows.reduce((a, r) => ({ qty: a.qty + r.qty, rev: a.rev + r.rev }), { qty: 0, rev: 0 });
  return (<>
    {r.el}
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.category}</TableCell>
              <TableCell className="text-right">{r.qty.toFixed(2)}</TableCell>
              <TableCell className="text-right">{money(r.rev)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex justify-end gap-6 border-t px-4 py-2 text-sm font-semibold">
        <span>Qty: {totals.qty.toFixed(2)}</span>
        <span>Total: {money(totals.rev)}</span>
      </div>
    </Card>
  </>);
}

function Stat({ label, value, hint, emphasize, positive }: { label: string; value: string; hint?: string; emphasize?: boolean; positive?: boolean }) {
  return (
    <Card className="p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={emphasize ? "text-2xl font-bold " + (positive ?? true ? "text-primary" : "text-destructive") : "text-xl font-semibold"}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
