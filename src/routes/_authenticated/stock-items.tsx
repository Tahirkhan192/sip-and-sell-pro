import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { money, num } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/stock-items")({ component: Page });

type S = {
  id?: string;
  name: string;
  unit: string;
  opening_stock: number;
  current_stock: number;
  minimum_stock: number;
  purchase_price: number;
};
const empty: S = { name: "", unit: "pcs", opening_stock: 0, current_stock: 0, minimum_stock: 0, purchase_price: 0 };

function Page() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<S>(empty);

  const { data = [] } = useQuery({
    queryKey: ["stock_items"],
    queryFn: async () => (await supabase.from("stock_items").select("*").is("deleted_at", null).order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: S) => {
      const payload = { name: p.name, unit: p.unit, opening_stock: p.opening_stock, current_stock: p.current_stock, minimum_stock: p.minimum_stock, purchase_price: p.purchase_price };
      const res = p.id ? await supabase.from("stock_items").update(payload).eq("id", p.id) : await supabase.from("stock_items").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_items"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_items").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_items"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => (data as any[]).filter((p) => p.name.toLowerCase().includes(search.toLowerCase())), [data, search]);

  return (
    <div>
      <PageHeader
        title="Stock Items"
        subtitle="Non-product stock (raw materials). Name-matched deduction runs on POS."
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Item</Button>}
      />
      <div className="relative max-w-sm mb-3">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Unit</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Purchase Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.unit}</TableCell>
                <TableCell className="text-right">{num(p.opening_stock).toFixed(2)}</TableCell>
                <TableCell className={"text-right font-medium " + (num(p.current_stock) < num(p.minimum_stock) ? "text-destructive" : "")}>{num(p.current_stock).toFixed(2)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{num(p.minimum_stock).toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(p.purchase_price)}</TableCell>
                <TableCell>{num(p.current_stock) < num(p.minimum_stock) ? <Badge variant="destructive">Low</Badge> : <Badge>OK</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No stock items</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Stock Item" : "Add Stock Item"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg, g, pcs" /></div>
          <div className="space-y-2"><Label>Purchase price</Label><Input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2"><Label>Opening</Label><Input type="number" step="0.01" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Current</Label><Input type="number" step="0.01" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Minimum</Label><Input type="number" step="0.01" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: Number(e.target.value) })} /></div>
        </div>
      </CrudDialog>
    </div>
  );
}
