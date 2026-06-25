import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/CrudHelpers";
import { money, num, today, startOfMonth } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reports")({ component: Reports });

function Reports() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Daily • Monthly • Products • Ingredients" />
      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
        </TabsList>
        <TabsContent value="daily" className="pt-4"><DailyReport /></TabsContent>
        <TabsContent value="monthly" className="pt-4"><MonthlyReport /></TabsContent>
        <TabsContent value="products" className="pt-4"><ProductReport /></TabsContent>
        <TabsContent value="ingredients" className="pt-4"><IngredientReport /></TabsContent>
      </Tabs>
    </div>
  );
}

function rangeFilter(q: any, col: string, from: string, to: string) {
  if (from) q = q.gte(col, from);
  if (to) q = q.lte(col, to);
  return q;
}

function useRange(initFrom: string, initTo: string) {
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  return { from, to, setFrom, setTo,
    el: (
      <div className="grid grid-cols-2 gap-2 max-w-sm mb-4">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e)=>setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e)=>setTo(e.target.value)} /></div>
      </div>
    ),
  };
}

function DailyReport() {
  const r = useRange(today(), today());
  const { data } = useQuery({
    queryKey: ["report", "daily", r.from, r.to],
    queryFn: async () => {
      const sales = await rangeFilter(supabase.from("sales").select("grand_total"), "sale_date", r.from, r.to + "T23:59");
      const exp = await rangeFilter(supabase.from("expenses").select("amount"), "date", r.from, r.to);
      const rev = (sales.data ?? []).reduce((s,x:any)=>s+num(x.grand_total),0);
      const exps = (exp.data ?? []).reduce((s,x:any)=>s+num(x.amount),0);
      return { rev, exps, profit: rev - exps };
    },
  });
  return (<>
    {r.el}
    <div className="grid grid-cols-3 gap-3">
      <Stat label="Sales" value={money(data?.rev)} />
      <Stat label="Expenses" value={money(data?.exps)} />
      <Stat label="Profit (ex-COGS)" value={money(data?.profit)} />
    </div>
  </>);
}

function MonthlyReport() {
  const r = useRange(startOfMonth(), today());
  const { data } = useQuery({
    queryKey: ["report", "monthly", r.from, r.to],
    queryFn: async () => {
      const sales = await rangeFilter(supabase.from("sales").select("grand_total"), "sale_date", r.from, r.to + "T23:59");
      const exp = await rangeFilter(supabase.from("expenses").select("amount"), "date", r.from, r.to);
      // COGS = sum(consumption * avg unit_cost of that ingredient from all purchases)
      const movs = await rangeFilter(supabase.from("ingredient_movements").select("ingredient_id, quantity, unit_cost, movement_type"), "date", r.from, r.to);
      const avgByIng: Record<string, { q: number; c: number }> = {};
      const purchases = await supabase.from("ingredient_movements").select("ingredient_id, quantity, unit_cost").eq("movement_type", "purchase");
      for (const p of purchases.data ?? []) {
        const k = p.ingredient_id;
        avgByIng[k] ??= { q: 0, c: 0 };
        avgByIng[k].q += num(p.quantity);
        avgByIng[k].c += num(p.quantity) * num(p.unit_cost);
      }
      let cogs = 0;
      for (const m of movs.data ?? []) {
        if (m.movement_type !== "consumption") continue;
        const k = m.ingredient_id;
        const a = avgByIng[k];
        const unit = a && a.q > 0 ? a.c / a.q : 0;
        cogs += Math.abs(num(m.quantity)) * unit;
      }
      const rev = (sales.data ?? []).reduce((s,x:any)=>s+num(x.grand_total),0);
      const exps = (exp.data ?? []).reduce((s,x:any)=>s+num(x.amount),0);
      return { rev, cogs, exps, profit: rev - cogs - exps };
    },
  });
  return (<>
    {r.el}
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Revenue" value={money(data?.rev)} />
      <Stat label="COGS" value={money(data?.cogs)} />
      <Stat label="Expenses" value={money(data?.exps)} />
      <Stat label="Net Profit" value={money(data?.profit)} emphasize />
    </div>
  </>);
}

function ProductReport() {
  const r = useRange(startOfMonth(), today());
  const { data = [] } = useQuery({
    queryKey: ["report", "products", r.from, r.to],
    queryFn: async () => {
      const { data } = await rangeFilter(
        supabase.from("sale_items").select("quantity, total, products(name), sales!inner(sale_date)"),
        "sales.sale_date", r.from, r.to + "T23:59"
      );
      const map: Record<string, { name: string; qty: number; rev: number }> = {};
      for (const r of data ?? []) {
        const name = (r as any).products?.name ?? "?";
        map[name] ??= { name, qty: 0, rev: 0 };
        map[name].qty += num(r.quantity);
        map[name].rev += num(r.total);
      }
      return Object.values(map).sort((a,b)=>b.rev-a.rev);
    },
  });
  return (<>
    {r.el}
    <Card><Table>
      <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty Sold</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.map((r:any)=>(<TableRow key={r.name}><TableCell>{r.name}</TableCell><TableCell className="text-right">{r.qty}</TableCell><TableCell className="text-right">{money(r.rev)}</TableCell></TableRow>))}
        {data.length===0 && <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No sales</TableCell></TableRow>}
      </TableBody>
    </Table></Card>
  </>);
}

function IngredientReport() {
  const { data = [] } = useQuery({
    queryKey: ["report", "ingredients"],
    queryFn: async () => (await supabase.from("stock_summary").select("*").order("name")).data ?? [],
  });
  return (
    <Card><Table>
      <TableHeader><TableRow><TableHead>Ingredient</TableHead><TableHead className="text-right">Purchased</TableHead><TableHead className="text-right">Consumed</TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.map((r:any)=>(<TableRow key={r.ingredient_id}><TableCell>{r.name} <span className="text-xs text-muted-foreground">({r.unit})</span></TableCell><TableCell className="text-right">{num(r.purchased).toFixed(2)}</TableCell><TableCell className="text-right">{num(r.consumed).toFixed(2)}</TableCell><TableCell className="text-right font-semibold">{num(r.remaining).toFixed(2)}</TableCell></TableRow>))}
      </TableBody>
    </Table></Card>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-xs font-medium uppercase text-muted-foreground tracking-wide">{label}</CardTitle></CardHeader>
      <CardContent><div className={emphasize ? "text-2xl font-bold text-primary" : "text-xl font-semibold"}>{value}</div></CardContent>
    </Card>
  );
}
