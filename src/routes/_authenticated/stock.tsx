import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/CrudHelpers";
import { num } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/stock")({ component: Page });

function Page() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12

  const { data: summary = [] } = useQuery({
    queryKey: ["stock", "summary"],
    queryFn: async () => (await supabase.from("stock_summary").select("*").order("name")).data ?? [],
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["stock", "movements", year, month],
    queryFn: async () => {
      const start = `${year}-${String(month).padStart(2,"0")}-01`;
      const endDate = new Date(year, month, 0); // last day of month
      const end = `${year}-${String(month).padStart(2,"0")}-${String(endDate.getDate()).padStart(2,"0")}`;
      return (await supabase.from("ingredient_movements").select("ingredient_id, movement_type, quantity, date, ingredients(name, unit, minimum_stock)").gte("date", start).lte("date", end)).data ?? [];
    },
  });

  // Build matrix per ingredient per day
  const matrix = useMemo(() => {
    const days = new Date(year, month, 0).getDate();
    const byIng = new Map<string, { name: string; unit: string; rows: { purchase: number[]; sell: number[]; remaining: number[] } }>();
    for (const m of movements as any[]) {
      const key = m.ingredient_id;
      if (!byIng.has(key)) {
        byIng.set(key, { name: m.ingredients?.name ?? "?", unit: m.ingredients?.unit ?? "", rows: { purchase: Array(days).fill(0), sell: Array(days).fill(0), remaining: Array(days).fill(0) } });
      }
      const d = Number(m.date.slice(8, 10)) - 1;
      if (m.movement_type === "purchase") byIng.get(key)!.rows.purchase[d] += num(m.quantity);
      else if (m.movement_type === "consumption") byIng.get(key)!.rows.sell[d] += Math.abs(num(m.quantity));
    }
    // compute remaining running balance per month
    byIng.forEach((v) => {
      let bal = 0;
      for (let i = 0; i < days; i++) {
        bal += v.rows.purchase[i] - v.rows.sell[i];
        v.rows.remaining[i] = bal;
      }
    });
    return { days, byIng: Array.from(byIng.entries()) };
  }, [movements, year, month]);

  return (
    <div>
      <PageHeader title="Stock" subtitle="Live dashboard + monthly purchase/sell/remaining matrix" />

      <Tabs defaultValue="dashboard">
        <TabsList><TabsTrigger value="dashboard">Dashboard</TabsTrigger><TabsTrigger value="monthly">Monthly Stock</TabsTrigger></TabsList>

        <TabsContent value="dashboard" className="pt-4">
          <Card>
            <Table>
              <TableHeader><TableRow><TableHead>Ingredient</TableHead><TableHead className="text-right">Purchased</TableHead><TableHead className="text-right">Consumed</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {summary.map((r: any) => (
                  <TableRow key={r.ingredient_id}>
                    <TableCell className="font-medium">{r.name} <span className="text-xs text-muted-foreground">({r.unit})</span></TableCell>
                    <TableCell className="text-right">{num(r.purchased).toFixed(2)}</TableCell>
                    <TableCell className="text-right">{num(r.consumed).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">{num(r.remaining).toFixed(2)}</TableCell>
                    <TableCell>{num(r.remaining) < num(r.minimum_stock) ? <Badge variant="destructive">Low</Badge> : <Badge>OK</Badge>}</TableCell>
                  </TableRow>
                ))}
                {summary.length===0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No ingredients</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="monthly" className="pt-4 space-y-3">
          <div className="flex gap-2 items-end max-w-sm">
            <div className="space-y-1 flex-1"><Label className="text-xs">Year</Label><Input type="number" value={year} onChange={(e)=>setYear(Number(e.target.value))} /></div>
            <div className="space-y-1 flex-1"><Label className="text-xs">Month</Label><Input type="number" min={1} max={12} value={month} onChange={(e)=>setMonth(Number(e.target.value))} /></div>
          </div>

          <Card className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2 sticky left-0 bg-muted z-10">Ingredient</th>
                  <th className="p-2">Type</th>
                  {Array.from({length: matrix.days}).map((_,i)=><th key={i} className="p-2 min-w-[42px]">{String(i+1).padStart(2,"0")}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.byIng.map(([id, v]) => (
                  <>
                    <tr key={id+"p"} className="border-t">
                      <td rowSpan={3} className="p-2 sticky left-0 bg-card font-medium align-top">{v.name}<div className="text-[10px] text-muted-foreground">{v.unit}</div></td>
                      <td className="p-2 text-success">Purchase</td>
                      {v.rows.purchase.map((q,i)=><td key={i} className="p-2 text-right tabular-nums">{q ? q.toFixed(1) : "—"}</td>)}
                    </tr>
                    <tr key={id+"s"}>
                      <td className="p-2 text-destructive">Sell</td>
                      {v.rows.sell.map((q,i)=><td key={i} className="p-2 text-right tabular-nums">{q ? q.toFixed(1) : "—"}</td>)}
                    </tr>
                    <tr key={id+"r"} className="border-b">
                      <td className="p-2 font-medium">Remaining</td>
                      {v.rows.remaining.map((q,i)=><td key={i} className="p-2 text-right tabular-nums font-medium">{q.toFixed(1)}</td>)}
                    </tr>
                  </>
                ))}
                {matrix.byIng.length===0 && <tr><td colSpan={matrix.days+2} className="p-6 text-center text-muted-foreground">No movements this month</td></tr>}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
