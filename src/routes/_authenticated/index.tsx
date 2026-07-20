import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, num } from "@/lib/format";
import { AlertTriangle, TrendingUp, ShoppingBag, Wallet, Receipt, Truck, Bike, Tag } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { buildRange, businessToday } from "@/lib/business-date";
import { useCategories } from "@/lib/use-categories";
import { fetchReportEngine } from "@/lib/report-engine";
import { listProductsLocal } from "@/lib/local-repo";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

async function fetchDashboard() {
  const todayRange = buildRange("today");
  const monthRange = buildRange("month");
  const businessDay = businessToday();
  const weekRange = buildRange("custom", addDaysISO(businessDay, -6), businessDay);

  const [todayReport, monthReport, products, weekReport] = await Promise.all([
    fetchReportEngine(todayRange),
    fetchReportEngine(monthRange),
    listProductsLocal(),
    fetchReportEngine(weekRange),
  ]);

  const todayRev = todayReport.totalSales;
  const todayDelCharges = todayReport.deliveryCharges;
  const todayBizProfit = todayReport.businessProfit;
  const todayDelProfit = todayReport.deliveryProfit;
  const todayTotalProfit = todayReport.netProfit;
  const monthRev = monthReport.totalSales;
  const monthBizProfit = monthReport.businessProfit;
  const monthDelProfit = monthReport.deliveryProfit;
  const monthOverall = monthReport.netProfit;

  // Per-category breakdown
  const catMap: Record<string, { todaySales: number; monthSales: number; monthCogs: number; monthPurch: number }> = {};
  const getCat = (c: string) => (catMap[c] ??= { todaySales: 0, monthSales: 0, monthCogs: 0, monthPurch: 0 });
  for (const c of todayReport.catRows) {
    getCat(c.category).todaySales += c.sales;
  }
  for (const r of monthReport.catRows) {
    const c = getCat(r.category);
    c.monthSales += r.sales;
    c.monthCogs += r.cogs;
    c.monthPurch += r.purchases;
  }

  const low = (products as any[]).filter((r: any) => num(r.current_stock) < num(r.minimum_stock));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysISO(businessDay, i - 6);
    return { day: d.slice(5), total: weekReport.salesByBusinessDate[d]?.totalSales ?? 0 };
  });

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
        <p className="text-sm text-muted-foreground">Live view of café operations</p>
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
