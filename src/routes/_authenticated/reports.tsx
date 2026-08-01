import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { StockAvailability } from "@/components/StockAvailability";
import { money, num } from "@/lib/format";
import { useCategories } from "@/lib/use-categories";
import { useDateRangeFilter } from "@/components/DateRangeFilter";
import { useIsAdmin, useReportEngine, type ReportResult } from "@/lib/report-engine";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Daily • Monthly • Category • Stock • Purchases • Expenses • Sales"  action={<PrintButton title="Reports" />} />
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

function useReportData(r: ReturnType<typeof useRange>, categories: string[] = []) {
  return useReportEngine({ from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC }, categories);
}

// ============================================================ DAILY
function DailyReport() {
  const r = useRange("today");
  const { data } = useReportData(r);
  const rows = Object.values(data?.salesByBusinessDate ?? {}).sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.reduce((a, d) => ({
    count: a.count + d.count,
    sales: a.sales + d.totalSales,
    cash: a.cash + d.cash,
    card: a.card + d.online,
    delivery: a.delivery + d.delivery,
  }), { count: 0, sales: 0, cash: 0, card: 0, delivery: 0 });
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
          {rows.map((d) => (
            <TableRow key={d.date}>
              <TableCell>{d.date}</TableCell>
              <TableCell className="text-right">{d.count}</TableCell>
              <TableCell className="text-right">{money(d.cash)}</TableCell>
              <TableCell className="text-right">{money(d.online)}</TableCell>
              <TableCell className="text-right">{money(d.delivery)}</TableCell>
              <TableCell className="text-right font-semibold">{money(d.totalSales)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
        </TableBody>
      </Table>
      {rows.length > 0 && (
        <div className="border-t px-4 py-2 grid grid-cols-6 text-sm font-medium text-right">
          <div className="text-left">Totals</div>
          <div>{total.count}</div><div>{money(total.cash)}</div><div>{money(total.card)}</div><div>{money(total.delivery)}</div><div>{money(total.sales)}</div>
        </div>
      )}
    </Card>
  </>);
}

// ============================================================ MONTHLY
function MonthlyReport() {
  const r = useRange("month");
  const { data: categories = [] } = useCategories();
  const { data } = useReportData(r, categories);
  const totalCogs = data?.totalCogs ?? 0;
  const grossProfit = data?.grossProfit ?? 0;
  return (<>
    {r.el}
    <Card className="mb-4">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly P&amp;L — Step by Step (Business Date)</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableBody>
            <TableRow className="font-semibold"><TableCell>Total Sales (matches Sales page)</TableCell><TableCell className="text-right">{money(data?.totalSales)}</TableCell></TableRow>
            <TableRow><TableCell>− Delivery Charges</TableCell><TableCell className="text-right">{money(data?.deliveryCharges)}</TableCell></TableRow>
            <TableRow className="font-medium"><TableCell>= Sales (engine total)</TableCell><TableCell className="text-right">{money(data?.totalSales)}</TableCell></TableRow>
            <TableRow><TableCell>Opening Stock</TableCell><TableCell className="text-right">{money(data?.totalOpening)}</TableCell></TableRow>
            <TableRow><TableCell>+ Purchases</TableCell><TableCell className="text-right">{money(data?.totalPurch)}</TableCell></TableRow>
            <TableRow><TableCell>+ Received Stock (transfers &amp; production, net)</TableCell><TableCell className="text-right">{money(data?.totalReceived)}</TableCell></TableRow>
            <TableRow><TableCell>− Closing Stock</TableCell><TableCell className="text-right">{money(data?.totalClosing)}</TableCell></TableRow>

            <TableRow className="font-medium"><TableCell>= COGS</TableCell><TableCell className="text-right">{money(totalCogs)}</TableCell></TableRow>
            <TableRow className="font-medium"><TableCell>Gross Profit (Sales − COGS)</TableCell><TableCell className={"text-right " + (grossProfit >= 0 ? "text-primary" : "text-destructive")}>{money(grossProfit)}</TableCell></TableRow>
            <TableRow><TableCell>+ Delivery Profit (Charges − Delivery Expenses)</TableCell><TableCell className={"text-right " + ((data?.deliveryProfit ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{money(data?.deliveryProfit)}</TableCell></TableRow>
            <TableRow><TableCell>− General Expenses</TableCell><TableCell className="text-right">{money(data?.generalExpenses)}</TableCell></TableRow>
            <TableRow className="font-bold"><TableCell>Net Business Profit</TableCell><TableCell className={"text-right " + ((data?.netProfit ?? 0) >= 0 ? "text-primary" : "text-destructive")}>{money(data?.netProfit)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <ReportAudit data={data} />

    <div className="mb-4"><StockAvailability /></div>


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
  const { data } = useReportData(r, categories);
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
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Closing</TableHead>

          <TableHead className="text-right">COGS</TableHead>
          <TableHead className="text-right">Gross Profit</TableHead>
          <TableHead className="text-right">Delivery Profit</TableHead>
          <TableHead className="text-right">Expenses</TableHead>
          <TableHead className="text-right">Net Profit</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {(data?.catRows ?? []).map((c) => (
            <TableRow key={c.category}>
              <TableCell className="font-medium">{c.category}</TableCell>
              <TableCell className="text-right">{Number(c.revenueQty).toFixed(2)}</TableCell>
              <TableCell className="text-right">{money(c.sales)}</TableCell>
              <TableCell className="text-right">{money(c.opening)}</TableCell>
              <TableCell className="text-right">{money(c.productPurchases)}</TableCell>
              <TableCell className="text-right">{money(c.stockPurchases)}</TableCell>
              <TableCell className="text-right">{money(c.received)}</TableCell>
              <TableCell className="text-right">{money(c.closing)}</TableCell>

              <TableCell className="text-right">{money(c.cogs)}</TableCell>
              <TableCell className="text-right">{money(c.grossProfit)}</TableCell>
              <TableCell className="text-right">{money(c.deliveryProfit)}</TableCell>
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
  const [view, setView] = useState<"detailed" | "summary">("detailed");
  const { data = [] } = useQuery({
    queryKey: ["report", "purchases", r.from, r.to],
    queryFn: async () => (await supabase.from("stock_purchases").select("*, products(name), stock_items(name)").is("deleted_at", null).gte("date", r.from).lte("date", r.to).order("date", { ascending: false })).data ?? [],
  });
  const rows = data as any[];
  const total = rows.reduce((s, x) => s + num(x.total_cost), 0);

  const summary = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; total: number; unit: string }>();
    for (const p of rows) {
      const name = p.products?.name ?? p.stock_items?.name ?? "Unknown";
      const key = (p.product_id ?? p.stock_item_id ?? name) as string;
      const cur = m.get(key) ?? { name, qty: 0, total: 0, unit: "" };
      cur.qty += num(p.quantity);
      cur.total += num(p.total_cost);
      cur.unit = p.unit ?? cur.unit;
      m.set(key, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return (<>
    {r.el}
    <div className="flex gap-2 mb-3">
      <button
        className={`px-3 py-1 rounded border text-sm ${view === "detailed" ? "bg-primary text-primary-foreground" : ""}`}
        onClick={() => setView("detailed")}
      >Detailed</button>
      <button
        className={`px-3 py-1 rounded border text-sm ${view === "summary" ? "bg-primary text-primary-foreground" : ""}`}
        onClick={() => setView("summary")}
      >Summary</button>
    </div>
    <Card>
      {view === "detailed" ? (
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Product / Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Supplier</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((p) => (
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
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Product / Item</TableHead><TableHead className="text-right">Total Qty</TableHead><TableHead className="text-right">Avg. Rate</TableHead><TableHead className="text-right">Total Cost</TableHead></TableRow></TableHeader>
          <TableBody>
            {summary.map((s) => (
              <TableRow key={s.name}>
                <TableCell>{s.name}</TableCell>
                <TableCell className="text-right">{s.qty}{s.unit ? ` ${s.unit}` : ""}</TableCell>
                <TableCell className="text-right">{s.qty > 0 ? money(s.total / s.qty) : "—"}</TableCell>
                <TableCell className="text-right">{money(s.total)}</TableCell>
              </TableRow>
            ))}
            {summary.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No purchases</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
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
  const { data } = useReportData(r);
  const rows = data?.productRows ?? [];
  const totals = { qty: data?.totalQtySold ?? 0, rev: data?.totalSales ?? 0 };
  return (<>
    {r.el}
    <Card>
      <Table>
        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
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

function ReportAudit({ data }: { data?: ReportResult }) {
  const { data: isAdmin } = useIsAdmin();
  if (!isAdmin || !data) return null;
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2"><CardTitle className="text-sm">Report Audit</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Total invoices included" value={String(data.audit.totalInvoices)} />
        <Stat label="First Business Date" value={data.audit.firstBusinessDate ?? "—"} />
        <Stat label="Last Business Date" value={data.audit.lastBusinessDate ?? "—"} />
        <Stat label="Total Sales" value={money(data.audit.totalSales)} />
        <Stat label="Total COGS" value={money(data.audit.totalCogs)} />
        <Stat label="Total Expenses" value={money(data.audit.totalExpenses)} />
        <Stat label="Total Delivery Profit" value={money(data.audit.totalDeliveryProfit)} />
        <Stat label="Net Profit" value={money(data.audit.netProfit)} />
      </CardContent>
    </Card>
  );
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