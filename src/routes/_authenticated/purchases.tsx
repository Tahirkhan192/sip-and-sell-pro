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
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Search, Pencil, Copy } from "lucide-react";
import { money, today } from "@/lib/format";
import { useCategories } from "@/lib/use-categories";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type P = {
  id?: string;
  date: string;
  target: "product" | "stock_item";
  category: string;
  product_id: string;
  stock_item_id: string;
  quantity: number;
  unit_cost: number;
  supplier: string;
  notes: string;
};
const empty: P = { date: today(), target: "product", category: "", product_id: "", stock_item_id: "", quantity: 0, unit_cost: 0, supplier: "", notes: "" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<P>(empty);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const { data: categories = [] } = useCategories();

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active-all"],
    queryFn: async () => (await supabase.from("products").select("id,name,category").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: items = [] } = useQuery({
    queryKey: ["stock_items", "all"],
    queryFn: async () => (await supabase.from("stock_items").select("id,name,unit").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data = [] } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => (await supabase
      .from("stock_purchases")
      .select("*, products(name), stock_items(name)")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(500)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: P) => {
      const total = p.quantity * p.unit_cost;
      const payload: any = {
        date: p.date, quantity: p.quantity, unit_cost: p.unit_cost, total_cost: total,
        supplier: p.supplier || null, notes: p.notes || null,
        category: p.category,
        product_id: p.target === "product" ? p.product_id : null,
        stock_item_id: p.target === "stock_item" ? p.stock_item_id : null,
      };
      const res = p.id
        ? await supabase.from("stock_purchases").update(payload).eq("id", p.id)
        : await supabase.from("stock_purchases").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["stock_items"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["report"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("stock_purchases").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["purchases"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = (data as any[]).filter((p) => {
      const name = p.products?.name ?? p.stock_items?.name ?? "";
      return name.toLowerCase().includes(q) || (p.supplier ?? "").toLowerCase().includes(q);
    });
    if (catFilter !== "all") rows = rows.filter((p) => p.category === catFilter);
    return rows;
  }, [data, search, catFilter]);

  return (
    <div>
      <PageHeader title="Purchases" subtitle="Stock purchases — auto-adds to product/item current stock"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New Purchase</Button>} />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search product / supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Product / Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-32"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                <TableCell>{p.products?.name ?? p.stock_items?.name ?? "?"}</TableCell>
                <TableCell className="text-right">{Number(p.quantity)}</TableCell>
                <TableCell className="text-right">{money(p.unit_cost)}</TableCell>
                <TableCell className="text-right font-medium">{money(p.total_cost)}</TableCell>
                <TableCell>{p.supplier ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{p.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => {
                    setForm({
                      id: p.id, date: p.date,
                      target: p.product_id ? "product" : "stock_item",
                      category: p.category ?? "",
                      product_id: p.product_id ?? "", stock_item_id: p.stock_item_id ?? "",
                      quantity: Number(p.quantity), unit_cost: Number(p.unit_cost),
                      supplier: p.supplier ?? "", notes: p.notes ?? "",
                    });
                    setOpen(true);
                  }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => {
                    setForm({
                      date: today(),
                      target: p.product_id ? "product" : "stock_item",
                      category: p.category ?? "",
                      product_id: p.product_id ?? "", stock_item_id: p.stock_item_id ?? "",
                      quantity: Number(p.quantity), unit_cost: Number(p.unit_cost),
                      supplier: p.supplier ?? "", notes: p.notes ?? "",
                    });
                    setOpen(true);
                  }}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this purchase?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">No purchases</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Purchase" : "New Purchase"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.category) { toast.error("Category required"); return false; }
        if (form.target === "product" && !form.product_id) { toast.error("Pick a product"); return false; }
        if (form.target === "stock_item" && !form.stock_item_id) { toast.error("Pick a stock item"); return false; }
        if (!form.quantity) { toast.error("Quantity required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
        <div className="space-y-2"><Label>Category <span className="text-destructive">*</span></Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v, product_id: "" })}>
            <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>{categories.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Type</Label>
          <Select value={form.target} onValueChange={(v: any) => setForm({ ...form, target: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="stock_item">Stock Item</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.target === "product" ? (
          <div className="space-y-2"><Label>Product</Label>
            <Select value={form.product_id} onValueChange={(v) => {
              const prod = (products as any[]).find((x) => x.id === v);
              setForm({ ...form, product_id: v, category: prod?.category ?? form.category });
            }}>
              <SelectTrigger><SelectValue placeholder={form.category ? "Choose…" : "Pick category first"} /></SelectTrigger>
              <SelectContent>{(products as any[]).filter((i) => !form.category || i.category === form.category).map((i: any) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2"><Label>Stock item</Label>
            <Select value={form.stock_item_id} onValueChange={(v) => setForm({ ...form, stock_item_id: v })}>
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>{items.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Quantity</Label><Input type="number" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Purchase Price</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} /></div>
        </div>
        <div className="text-sm text-muted-foreground">Total: <span className="font-medium text-foreground">{money(form.quantity * form.unit_cost)}</span></div>
        <div className="space-y-2"><Label>Supplier</Label><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
        <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </CrudDialog>
    </div>
  );
}
