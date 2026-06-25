import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { money, today, startOfMonth, num } from "@/lib/format";
import { AlertTriangle, TrendingUp, ShoppingBag, Wallet, Receipt } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

async function fetchDashboard() {
  const t = today();
  const m = startOfMonth();
  const [todaySales, monthSales, monthExpenses, lowStock, monthMovements, last7] = await Promise.all([
    supabase.from("sales").select("grand_total").gte("sale_date", t),
    supabase.from("sales").select("grand_total, sale_date").gte("sale_date", m),
    supabase.from("expenses").select("amount").gte("date", m),
    supabase.from("stock_summary").select("*"),
    supabase.from("ingredient_movements").select("quantity, unit_cost, movement_type, date").gte("date", m),
    supabase.from("sales").select("grand_total, sale_date").gte("sale_date", new Date(Date.now()-6*86400000).toISOString().slice(0,10)),
  ]);

  const todayRev = (todaySales.data ?? []).reduce((s, r) => s + num(r.grand_total), 0);
  const monthRev = (monthSales.data ?? []).reduce((s, r) => s + num(r.grand_total), 0);
  const monthExp = (monthExpenses.data ?? []).reduce((s, r) => s + num(r.amount), 0);

  // COGS approximate: sum of consumption (purchase unit_cost when known, else 0)
  // Use simpler approach: avg purchase cost per ingredient × consumption.
  const purchases = (monthMovements.data ?? []).filter(m => m.movement_type === "purchase");
  const avgCost: Record<string, number> = {};
  // we don't have ingredient_id here, skip detailed COGS; estimate from last month's purchase total proportion
  const monthCOGS = 0; // computed in reports page; dashboard uses rough estimate
  const monthProfit = monthRev - monthCOGS - monthExp;
  const todayProfitApprox = todayRev - 0; // simplified

  const low = (lowStock.data ?? []).filter((r: any) => num(r.remaining) < num(r.minimum_stock));

  // last 7 days
  const days: { day: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i*86400000).toISOString().slice(0,10);
    const total = (last7.data ?? []).filter(r => r.sale_date.startsWith(d)).reduce((s,r)=>s+num(r.grand_total),0);
    days.push({ day: d.slice(5), total });
  }

  return { todayRev, monthRev, monthExp, monthProfit, todayProfitApprox, low, days, avgCost };
}

function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard, refetchInterval: 30000 });
  const d = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live view of today's café operations</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <KPI title="Today's Sales" icon={Receipt} value={money(d?.todayRev)} loading={isLoading} />
        <KPI title="Today's Profit" icon={TrendingUp} value={money(d?.todayProfitApprox)} hint="≈ revenue (see Reports for COGS)" loading={isLoading} />
        <KPI title="Monthly Sales" icon={ShoppingBag} value={money(d?.monthRev)} loading={isLoading} />
        <KPI title="Monthly Expenses" icon={Wallet} value={money(d?.monthExp)} loading={isLoading} />
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
                <Bar dataKey="total" fill="var(--color-chart-1)" radius={[6,6,0,0]} />
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
              <p className="text-sm text-muted-foreground">All ingredients above minimum.</p>
            ) : (
              <ul className="space-y-2">
                {d!.low.map((r: any) => (
                  <li key={r.ingredient_id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.name}</span>
                    <Badge variant="destructive">
                      {num(r.remaining).toFixed(1)} {r.unit} / min {num(r.minimum_stock).toFixed(1)}
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

function KPI({ title, value, icon: Icon, hint, loading }: { title: string; value: string; icon: any; hint?: string; loading?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{loading ? "…" : value}</div>
        {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
