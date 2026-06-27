import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Search, ArrowUpDown, Copy } from "lucide-react";
import { money, num } from "@/lib/format";
import { useCategories } from "@/lib/use-categories";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products")({ component: ProductsPage });

type P = {
  id?: string;
  name: string;
  category: string;
  sale_price: number;
  cost_price: number;
  opening_stock: number;
  current_stock: number;
  minimum_stock: number;
  active: boolean;
};
const empty: P = { name: "", category: "Karahi", sale_price: 0, cost_price: 0, opening_stock: 0, current_stock: 0, minimum_stock: 0, active: true };

type SortKey = "name" | "category" | "sale_price" | "current_stock";

function ProductsPage() {
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<P>(empty);

  const { data = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").is("deleted_at", null).order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: P) => {
      const payload = {
        name: p.name,
        category: p.category,
        sale_price: p.sale_price,
        cost_price: p.cost_price,
        opening_stock: p.opening_stock,
        current_stock: p.current_stock,
        minimum_stock: p.minimum_stock,
        active: p.active,
      };
      const res = p.id
        ? await supabase.from("products").update(payload).eq("id", p.id)
        : await supabase.from("products").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    let rows = (data as any[]).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== "all") rows = rows.filter((p) => p.category === catFilter);
    rows.sort((a, b) => {
      const av = a[sortBy]; const bv = b[sortBy];
      const cmp = typeof av === "string" ? String(av).localeCompare(String(bv)) : num(av) - num(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, search, catFilter, sortBy, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortBy === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(k); setSortDir("asc"); }
  }

  function SortHead({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: string }) {
    return (
      <TableHead className={align}>
        <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
          {children} <ArrowUpDown className="h-3 w-3 opacity-60" />
        </button>
      </TableHead>
    );
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Menu items with stock tracking"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Product</Button>}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead k="name">Name</SortHead>
              <SortHead k="category">Category</SortHead>
              <SortHead k="sale_price" align="text-right">Sale</SortHead>
              <TableHead className="text-right">Cost</TableHead>
              <SortHead k="current_stock" align="text-right">Stock</SortHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                <TableCell className="text-right">{money(p.sale_price)}</TableCell>
                <TableCell className="text-right">{money(p.cost_price)}</TableCell>
                <TableCell className={"text-right font-medium " + (num(p.current_stock) < num(p.minimum_stock) ? "text-destructive" : "")}>{num(p.current_stock).toFixed(2)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{num(p.minimum_stock).toFixed(2)}</TableCell>
                <TableCell>{p.active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { const { id, ...rest } = p; setForm({ ...rest, name: `${p.name} (copy)` } as P); setOpen(true); }}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete ${p.name}?`)) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No products</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Product" : "Add Product"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        if (!form.category) { toast.error("Category required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Category <span className="text-destructive">*</span></Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>{categories.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Sale price</Label><Input type="number" step="0.01" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Cost / Purchase price</Label><Input type="number" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2"><Label>Opening</Label><Input type="number" step="0.01" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Current</Label><Input type="number" step="0.01" value={form.current_stock} onChange={(e) => setForm({ ...form, current_stock: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Minimum</Label><Input type="number" step="0.01" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: Number(e.target.value) })} /></div>
        </div>
        <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Active</Label></div>
      </CrudDialog>
    </div>
  );
}
