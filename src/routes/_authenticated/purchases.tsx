import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { money, today } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type P = { id?: string; date: string; ingredient_id: string; quantity: number; unit_cost: number; supplier: string };
const empty: P = { date: today(), ingredient_id: "", quantity: 0, unit_cost: 0, supplier: "" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<P>(empty);

  const { data: ingredients = [] } = useQuery({ queryKey: ["ingredients"], queryFn: async () => (await supabase.from("ingredients").select("id,name,unit").order("name")).data ?? [] });
  const { data = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => (await supabase.from("stock_purchases").select("*, ingredients(name, unit)").order("date", { ascending: false }).limit(200)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: P) => {
      const total = p.quantity * p.unit_cost;
      const { error } = await supabase.from("stock_purchases").insert({
        date: p.date, ingredient_id: p.ingredient_id, quantity: p.quantity, unit_cost: p.unit_cost, total_cost: total, supplier: p.supplier || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["stock"] }); toast.success("Purchase recorded"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("stock_purchases").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchases"] }),
  });

  return (
    <div>
      <PageHeader title="Stock Purchases" subtitle="Record purchased inventory — auto-adds to ingredient stock"
        action={<Button onClick={()=>{setForm(empty); setOpen(true);}}><Plus className="h-4 w-4 mr-1" />New Purchase</Button>} />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Ingredient</TableHead>
            <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead>Supplier</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.ingredients?.name}</TableCell>
                <TableCell className="text-right">{Number(p.quantity)} {p.ingredients?.unit}</TableCell>
                <TableCell className="text-right">{money(p.unit_cost)}</TableCell>
                <TableCell className="text-right font-medium">{money(p.total_cost)}</TableCell>
                <TableCell>{p.supplier ?? "—"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={()=>{if(confirm("Delete? This will not auto-reverse stock movement.")) del.mutate(p.id);}}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
            {data.length===0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No purchases yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title="New Purchase" open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.ingredient_id || !form.quantity) { toast.error("Ingredient & quantity required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e)=>setForm({...form, date: e.target.value})} /></div>
        <div className="space-y-2"><Label>Ingredient</Label>
          <Select value={form.ingredient_id} onValueChange={(v)=>setForm({...form, ingredient_id: v})}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>{ingredients.map((i:any)=><SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Quantity</Label><Input type="number" step="0.01" value={form.quantity} onChange={(e)=>setForm({...form, quantity: Number(e.target.value)})} /></div>
          <div className="space-y-2"><Label>Unit cost</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={(e)=>setForm({...form, unit_cost: Number(e.target.value)})} /></div>
        </div>
        <div className="text-sm text-muted-foreground">Total: <span className="font-medium text-foreground">{money(form.quantity * form.unit_cost)}</span></div>
        <div className="space-y-2"><Label>Supplier (optional)</Label><Input value={form.supplier} onChange={(e)=>setForm({...form, supplier: e.target.value})} /></div>
      </CrudDialog>
    </div>
  );
}
