import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Pencil, Search } from "lucide-react";
import { money, today } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/delivery-expenses")({ component: Page });

type D = { id?: string; date: string; fuel_cost: number; maintenance_cost: number; description: string; payment_status: "paid" | "unpaid"; payment_method: "cash" | "online" | "" };
const empty: D = { date: today(), fuel_cost: 0, maintenance_cost: 0, description: "", payment_status: "unpaid", payment_method: "" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<D>(empty);
  const [search, setSearch] = useState("");

  const { data = [] } = useQuery({
    queryKey: ["delivery_expenses"],
    queryFn: async () => (await supabase.from("delivery_expenses").select("*").is("deleted_at", null).order("date", { ascending: false }).range(0, 99999)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: D) => {
      const payload = { date: p.date, fuel_cost: p.fuel_cost, maintenance_cost: p.maintenance_cost, description: p.description || null };
      const res = p.id
        ? await supabase.from("delivery_expenses").update(payload).eq("id", p.id)
        : await supabase.from("delivery_expenses").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["delivery_expenses"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("delivery_expenses").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["delivery_expenses"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data as any[]).filter((e) => (e.description ?? "").toLowerCase().includes(q) || e.date.includes(q));
  }, [data, search]);

  const totals = filtered.reduce((a, x: any) => ({ fuel: a.fuel + Number(x.fuel_cost), maint: a.maint + Number(x.maintenance_cost) }), { fuel: 0, maint: 0 });

  return (
    <div>
      <PageHeader title="Delivery Expenses" subtitle="Fuel & motorcycle maintenance — NOT included in general business expenses"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>} />
      <div className="relative max-w-sm mb-3">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Fuel</TableHead><TableHead className="text-right">Maintenance</TableHead><TableHead>Description</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell className="text-right">{money(p.fuel_cost)}</TableCell>
                <TableCell className="text-right">{money(p.maintenance_cost)}</TableCell>
                <TableCell className="max-w-xs truncate">{p.description ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: p.id, date: p.date, fuel_cost: Number(p.fuel_cost), maintenance_cost: Number(p.maintenance_cost), description: p.description ?? "" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No delivery expenses</TableCell></TableRow>}
          </TableBody>
        </Table>
        {filtered.length > 0 && (
          <div className="flex justify-end gap-6 border-t px-4 py-2 text-sm font-medium">
            <span>Fuel: {money(totals.fuel)}</span>
            <span>Maintenance: {money(totals.maint)}</span>
            <span>Total: {money(totals.fuel + totals.maint)}</span>
          </div>
        )}
      </Card>

      <CrudDialog title={form.id ? "Edit Delivery Expense" : "New Delivery Expense"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.fuel_cost && !form.maintenance_cost) { toast.error("Enter at least one amount"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Fuel cost</Label><Input type="number" step="0.01" value={form.fuel_cost} onChange={(e) => setForm({ ...form, fuel_cost: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Maintenance</Label><Input type="number" step="0.01" value={form.maintenance_cost} onChange={(e) => setForm({ ...form, maintenance_cost: Number(e.target.value) })} /></div>
        </div>
        <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      </CrudDialog>
    </div>
  );
}
