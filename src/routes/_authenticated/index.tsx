import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, num } from "@/lib/format";
import { AlertTriangle, TrendingUp, ShoppingBag, Wallet, Receipt, Truck, Bike, Tag } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { buildRange, businessToday } from "@/lib/business-date";
import { useCategories } from "@/lib/use-categories";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

async function fetchDashboard() {
  const todayRange = buildRange("today");
  const monthRange = buildRange("month");
  const businessDay = businessToday();

  const [
    todaySalesQ, monthSalesQ, monthExpensesQ, monthDelExpQ, todayDelExpQ,
    productsQ, last7Q, monthPurchQ, todaySaleItemsQ, monthSaleItemsQ,
  ] = await Promise.all([
    supabase.from("sales").select("grand_total, delivery_charges, sale_date").is("deleted_at", null)
      .gte("sale_date", todayRange.startUTC).lt("sale_date", todayRange.endExclusiveUTC),
    supabase.from("sales").select("grand_total, delivery_charges, sale_date").is("deleted_at", null)
      .gte("sale_date", monthRange.startUTC).lt("sale_date", monthRange.endExclusiveUTC),
    supabase.from("expenses").select("amount").is("deleted_at", null).gte("date", monthRange.from).lte("date", monthRange.to),
    supabase.from("delivery_expenses").select("fuel_cost, maintenance_cost").is("deleted_at", null).gte("date", monthRange.from).lte("date", monthRange.to),
    supabase.from("delivery_expenses").select("fuel_cost, maintenance_cost").is("deleted_at", null).eq("date", todayRange.from),
    supabase.from("products").select("id, name, current_stock, minimum_stock, cost_price, category").is("deleted_at", null),
    supabase.from("sales").select("grand_total, sale_date").is("deleted_at", null)
      .gte("sale_date", buildRange("custom", addDaysISO(businessDay, -6), businessDay).startUTC),
    supabase.from("stock_purchases").select("total_cost, category").is("deleted_at", null).gte("date", monthRange.from).lte("date", monthRange.to),
    supabase.from("sale_items").select("quantity, total, products!inner(category, cost_price), sales!inner(sale_date, status, deleted_at)")
      .gte("sales.sale_date", todayRange.startUTC).lt("sales.sale_date", todayRange.endExclusiveUTC),
    supabase.from("sale_items").select("quantity, total, products!inner(category, cost_price), sales!inner(sale_date, status, deleted_at)")
      .gte("sales.sale_date", monthRange.startUTC).lt("sales.sale_date", monthRange.endExclusiveUTC),
  ]);

  const sumGT = (rows: any[] | null | undefined) => (rows ?? []).reduce((s, r) => s + num(r.grand_total), 0);
  const sumDel = (rows: any[] | null | undefined) => (rows ?? []).reduce((s, r) => s + num(r.delivery_charges), 0);

  const todayRev = sumGT(todaySalesQ.data);
  const todayDelCharges = sumDel(todaySalesQ.data);
  const monthRev = sumGT(monthSalesQ.data);
  const monthDelCharges = sumDel(monthSalesQ.data);
  const monthExp = (monthExpensesQ.data ?? []).reduce((s, r: any) => s + num(r.amount), 0);
  const monthDelExp = (monthDelExpQ.data ?? []).reduce((s, r: any) => s + num(r.fuel_cost) + num(r.maintenance_cost), 0);
  const todayDelExp = (todayDelExpQ.data ?? []).reduce((s, r: any) => s + num(r.fuel_cost) + num(r.maintenance_cost), 0);
  const monthPurch = (monthPurchQ.data ?? []).reduce((s, r: any) => s + num(r.total_cost), 0);

  // Today's COGS for business profit (sum of item.qty * product.cost_price)
  const todayCogs = ((todaySaleItemsQ.data as any[]) ?? []).filter((it) => !it.sales?.deleted_at && it.sales?.status === "completed")
    .reduce((s, it) => s + num(it.quantity) * num(it.products?.cost_price), 0);
  const todaySalesExDel = todayRev - todayDelCharges;
  const todayBizProfit = todaySalesExDel - todayCogs;
  const todayDelProfit = todayDelCharges - todayDelExp;
  const todayTotalProfit = todayBizProfit + todayDelProfit;

  const monthSalesExDel = monthRev - monthDelCharges;
  const monthBizProfit = monthSalesExDel - monthPurch - monthExp;
  const monthDelProfit = monthDelCharges - monthDelExp;
  const monthOverall = monthBizProfit + monthDelProfit;

  // Per-category breakdown
  const catMap: Record<string, { todaySales: number; monthSales: number; monthCogs: number; monthPurch: number }> = {};
  const getCat = (c: string) => (catMap[c] ??= { todaySales: 0, monthSales: 0, monthCogs: 0, monthPurch: 0 });
  for (const it of (todaySaleItemsQ.data as any[]) ?? []) {
    if (it.sales?.deleted_at || it.sales?.status !== "completed") continue;
    getCat(it.products?.category ?? "—").todaySales += num(it.total);
  }
  for (const it of (monthSaleItemsQ.data as any[]) ?? []) {
    if (it.sales?.deleted_at || it.sales?.status !== "completed") continue;
    const c = getCat(it.products?.category ?? "—");
    c.monthSales += num(it.total);
    c.monthCogs += num(it.quantity) * num(it.products?.cost_price);
  }
  for (const r of (monthPurchQ.data as any[]) ?? []) {
    getCat(r.category ?? "—").monthPurch += num(r.total_cost);
  }

  const low = (productsQ.data ?? []).filter((r: any) => num(r.current_stock) < num(r.minimum_stock));

  const days: { day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDaysISO(businessDay, -i);
    const r = buildRange("custom", d, d);
    const total = (last7Q.data ?? []).filter((row: any) => row.sale_date >= r.startUTC && row.sale_date < r.endExclusiveUTC)
      .reduce((s, row: any) => s + num(row.grand_total), 0);
    days.push({ day: d.slice(5), total });
  }

  return {
    todayRev, todayDelCharges, todayDelProfit, todayBizProfit, todayTotalProfit,
    monthRev, monthBizProfit, monthDelProfit, monthOverall, low, days, catMap,
  };
}

function addDaysISO(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard, refetchInterval: 30000 });
  const { data: categories = [] } = useCategories();
  const d = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live view of café operations • business day rolls over 08:00 PKT</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KPI title="Today's Sales" icon={Receipt} value={money(d?.todayRev)} loading={isLoading} />
        <KPI title="Today's Business Profit" icon={Wallet} value={money(d?.todayBizProfit)} loading={isLoading} />
        <KPI title="Today's Delivery Profit" icon={Bike} value={money(d?.todayDelProfit)} loading={isLoading} />
        <KPI title="Today's Total Profit" icon={TrendingUp} value={money(d?.todayTotalProfit)} loading={isLoading} emphasize />
        <KPI title="Monthly Sales" icon={ShoppingBag} value={money(d?.monthRev)} loading={isLoading} />
        <KPI title="Monthly Business Profit" icon={Wallet} value={money(d?.monthBizProfit)} loading={isLoading} />
        <KPI title="Monthly Delivery Profit" icon={Truck} value={money(d?.monthDelProfit)} loading={isLoading} />
        <KPI title="Overall Monthly Profit" icon={TrendingUp} value={money(d?.monthOverall)} loading={isLoading} emphasize />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" /> Category Sales Summary</CardTitle>
          <span className="text-xs text-muted-foreground">Today • This month</span>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c) => {
              const cd = d?.catMap?.[c] ?? { todaySales: 0, monthSales: 0, monthCogs: 0, monthPurch: 0 };
              const monthProfit = cd.monthSales - cd.monthCogs;
              return (
                <div key={c} className="rounded-lg border p-3 bg-card">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Today</span><span className="font-medium">{money(cd.todaySales)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Month</span><span className="font-medium">{money(cd.monthSales)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Profit</span><span className={"font-semibold " + (monthProfit >= 0 ? "text-primary" : "text-destructive")}>{money(monthProfit)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Sales — last 7 business days</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d?.days ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="day" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Low stock alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            {(d?.low?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">All products above minimum.</p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-auto">
                {d!.low.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="destructive">
                      {num(r.current_stock).toFixed(1)} / min {num(r.minimum_stock).toFixed(1)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPI({ title, value, icon: Icon, hint, loading, emphasize }: { title: string; value: string; icon: any; hint?: string; loading?: boolean; emphasize?: boolean }) {
  return (
    <Card className={emphasize ? "border-primary/50" : ""}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={emphasize ? "text-2xl font-bold text-primary" : "text-2xl font-bold"}>{loading ? "…" : value}</div>
        {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
