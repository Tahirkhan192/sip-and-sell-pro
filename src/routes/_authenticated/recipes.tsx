import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Search, Copy } from "lucide-react";
import { num } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recipes")({ component: RecipesPage });

type R = {
  id?: string;
  parent_product_id: string;
  component_product_id: string;
  quantity: number;
  unit: string;
};
const empty: R = { parent_product_id: "", component_product_id: "", quantity: 1, unit: "pcs" };

function RecipesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<R>(empty);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("id, name, unit").is("deleted_at", null).order("name")).data ?? [],
  });

  const { data = [] } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => (await supabase
      .from("recipes" as any)
      .select("id, parent_product_id, component_product_id, quantity, unit, parent:products!recipes_parent_product_id_fkey(name), component:products!recipes_component_product_id_fkey(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (r: R) => {
      if (!r.parent_product_id || !r.component_product_id) throw new Error("Select both products");
      if (r.parent_product_id === r.component_product_id) throw new Error("Parent and component cannot be the same");
      if (num(r.quantity) <= 0) throw new Error("Quantity must be > 0");
      const payload = { parent_product_id: r.parent_product_id, component_product_id: r.component_product_id, quantity: r.quantity, unit: r.unit };
      const res = r.id
        ? await supabase.from("recipes" as any).update(payload).eq("id", r.id)
        : await supabase.from("recipes" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipes"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recipes" as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipes"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data as any[]).filter((r) =>
      (r.parent?.name ?? "").toLowerCase().includes(q) ||
      (r.component?.name ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <div>
      <PageHeader
        title="Recipes"
        subtitle="Link a sold product (e.g. Chicken Karahi) to component products consumed from stock (e.g. Chicken 1 KG)"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Recipe</Button>}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search product" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sold product (parent)</TableHead>
              <TableHead>Uses (component)</TableHead>
              <TableHead className="text-right">Qty / sale</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.parent?.name ?? "—"}</TableCell>
                <TableCell>{r.component?.name ?? "—"}</TableCell>
                <TableCell className="text-right">{num(r.quantity).toFixed(3)}</TableCell>
                <TableCell className="uppercase text-xs">{r.unit}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: r.id, parent_product_id: r.parent_product_id, component_product_id: r.component_product_id, quantity: r.quantity, unit: r.unit }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ parent_product_id: r.parent_product_id, component_product_id: r.component_product_id, quantity: r.quantity, unit: r.unit }); setOpen(true); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this recipe link?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No recipes — products with no recipe deduct their own stock on sale</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog
        title={form.id ? "Edit Recipe" : "Add Recipe"}
        open={open}
        onOpenChange={setOpen}
        onSubmit={async () => { await save.mutateAsync(form); return true; }}
      >
        <div className="space-y-2">
          <Label>Sold product (parent)</Label>
          <Select value={form.parent_product_id} onValueChange={(v) => setForm({ ...form, parent_product_id: v })}>
            <SelectTrigger><SelectValue placeholder="Choose product sold to customer" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Component product (deducted from stock)</Label>
          <Select value={form.component_product_id} onValueChange={(v) => {
            const p = (products as any[]).find((x) => x.id === v);
            setForm({ ...form, component_product_id: v, unit: p?.unit ?? form.unit });
          }}>
            <SelectTrigger><SelectValue placeholder="Choose raw / stock product" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label>Quantity per sale</Label>
            <Input type="number" step="0.001" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pcs">PCS</SelectItem>
                <SelectItem value="kg">KG</SelectItem>
                <SelectItem value="ltr">LTR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CrudDialog>
    </div>
  );
}
