import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, today, startOfMonth, num } from "@/lib/format";
import { AlertTriangle, TrendingUp, ShoppingBag, Wallet, Receipt, Truck, Bike } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

async function fetchDashboard() {
  const t = today();
  const m = startOfMonth();
  const tomorrow = new Date(new Date(t).getTime() + 86400000).toISOString().slice(0, 10);
  const [todaySalesQ, monthSalesQ, monthExpensesQ, monthDelExpQ, todayDelExpQ, productsQ, last7Q, monthPurchQ] = await Promise.all([
    supabase.from("sales").select("grand_total, delivery_charges, sale_date").is("deleted_at", null).gte("sale_date", t).lt("sale_date", tomorrow),
    supabase.from("sales").select("grand_total, delivery_charges, sale_date").is("deleted_at", null).gte("sale_date", m),
    supabase.from("expenses").select("amount").is("deleted_at", null).gte("date", m),
    supabase.from("delivery_expenses").select("fuel_cost, maintenance_cost").is("deleted_at", null).gte("date", m),
    supabase.from("delivery_expenses").select("fuel_cost, maintenance_cost").is("deleted_at", null).eq("date", t),
    supabase.from("products").select("id, name, current_stock, minimum_stock, cost_price, category").is("deleted_at", null),
    supabase.from("sales").select("grand_total, sale_date").is("deleted_at", null).gte("sale_date", new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)),
    supabase.from("stock_purchases").select("total_cost").is("deleted_at", null).gte("date", m),
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

  // Approximate business profit: monthly sales (ex delivery) - purchases - general expenses (closing stock approx ignored on dashboard)
  const monthSalesExDel = monthRev - monthDelCharges;
  const monthBizProfit = monthSalesExDel - monthPurch - monthExp;
  const monthDelProfit = monthDelCharges - monthDelExp;
  const monthOverall = monthBizProfit + monthDelProfit;
  const todayDelProfit = todayDelCharges - todayDelExp;
  const todayProfitApprox = todayRev - todayDelCharges; // simplified: revenue ex delivery

  const low = (productsQ.data ?? []).filter((r: any) => num(r.current_stock) < num(r.minimum_stock));

  const days: { day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const total = (last7Q.data ?? []).filter((r: any) => r.sale_date.startsWith(d)).reduce((s, r: any) => s + num(r.grand_total), 0);
    days.push({ day: d.slice(5), total });
  }

  return { todayRev, todayDelCharges, todayDelProfit, todayProfitApprox, monthRev, monthBizProfit, monthDelProfit, monthOverall, low, days };
}

function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard, refetchInterval: 30000 });
  const d = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live view of café operations</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KPI title="Today's Sales" icon={Receipt} value={money(d?.todayRev)} loading={isLoading} />
        <KPI title="Today's Profit" icon={TrendingUp} value={money(d?.todayProfitApprox)} hint="approx — full P&L in Reports" loading={isLoading} />
        <KPI title="Today's Delivery Charges" icon={Truck} value={money(d?.todayDelCharges)} loading={isLoading} />
        <KPI title="Today's Delivery Profit" icon={Bike} value={money(d?.todayDelProfit)} loading={isLoading} />
        <KPI title="Monthly Sales" icon={ShoppingBag} value={money(d?.monthRev)} loading={isLoading} />
        <KPI title="Monthly Business Profit" icon={Wallet} value={money(d?.monthBizProfit)} loading={isLoading} />
        <KPI title="Monthly Delivery Profit" icon={Bike} value={money(d?.monthDelProfit)} loading={isLoading} />
        <KPI title="Overall Monthly Profit" icon={TrendingUp} value={money(d?.monthOverall)} loading={isLoading} emphasize />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Sales — last 7 days</CardTitle></CardHeader>
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
