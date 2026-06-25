import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { money } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products")({ component: ProductsPage });

type P = { id?: string; name: string; category: string; sale_price: number; cost_price: number; active: boolean };
const empty: P = { name: "", category: "", sale_price: 0, cost_price: 0, active: true };

function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<P>(empty);

  const { data = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: P) => {
      const payload = { name: p.name, category: p.category || null, sale_price: p.sale_price, cost_price: p.cost_price, active: p.active };
      const res = p.id
        ? await supabase.from("products").update(payload).eq("id", p.id)
        : await supabase.from("products").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("products").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = data.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Menu items sold at the café"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Product</Button>}
      />
      <div className="mb-3 relative max-w-sm">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search products" value={search} onChange={(e)=>setSearch(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Category</TableHead>
              <TableHead className="text-right">Sale</TableHead><TableHead className="text-right">Cost</TableHead>
              <TableHead>Status</TableHead><TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                <TableCell className="text-right">{money(p.sale_price)}</TableCell>
                <TableCell className="text-right">{money(p.cost_price)}</TableCell>
                <TableCell>{p.active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length===0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No products</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Product" : "Add Product"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} /></div>
        <div className="space-y-2"><Label>Category</Label><Input value={form.category} onChange={(e)=>setForm({...form, category: e.target.value})} placeholder="Drinks, Mains…" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Sale price</Label><Input type="number" value={form.sale_price} onChange={(e)=>setForm({...form, sale_price: Number(e.target.value)})} /></div>
          <div className="space-y-2"><Label>Cost price</Label><Input type="number" value={form.cost_price} onChange={(e)=>setForm({...form, cost_price: Number(e.target.value)})} /></div>
        </div>
        <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v)=>setForm({...form, active: v})} /><Label>Active</Label></div>
      </CrudDialog>
    </div>
  );
}
