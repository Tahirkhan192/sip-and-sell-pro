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
import { StockPinDialog } from "@/components/StockPinDialog";
import { useProductStockAvailable } from "@/components/StockAvailability";
import { businessToday } from "@/lib/business-date";


export const Route = createFileRoute("/_authenticated/products")({ component: ProductsPage });

type P = {
  id?: string;
  name: string;
  category: string;
  sale_price: number | "";
  cost_price: number | "";
  opening_stock: number | "";
  current_stock: number | "";
  minimum_stock: number | "";
  active: boolean;
  unit: string;
  selling_method: "fixed" | "weight";
  track_stock: boolean;
  auto_calc: boolean;
};
const empty: P = { name: "", category: "", sale_price: "", cost_price: "", opening_stock: "", current_stock: "", minimum_stock: "", active: true, unit: "pcs", selling_method: "fixed", track_stock: true, auto_calc: false };

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
  const [originalCurrent, setOriginalCurrent] = useState<number | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const { data = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("*").is("deleted_at", null).order("name")).data ?? [],
  });

  // Calculated Remaining from the inventory engine — the Stock column must match it.
  const { data: calcRows = [] } = useProductStockAvailable();
  const calcStock = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of calcRows) m[r.id] = r.remaining;
    return m;
  }, [calcRows]);

  const adjust = useMutation({
    mutationFn: async ({ productId, qty, reason }: { productId: string; qty: number; reason: string }) => {
      const ins = await (supabase as any).from("stock_adjustments").insert({
        scope: "product", product_id: productId, quantity: qty,
        reason: reason || null, date: businessToday(),
      });
      if (ins.error) throw ins.error;
    },
    onSuccess: () => {
      setAdjustQty(""); setAdjustReason("");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-engine"] });
      qc.invalidateQueries({ queryKey: ["stock-availability"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      toast.success("Stock adjusted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const save = useMutation({

    mutationFn: async (p: P) => {
      const payload = {
        name: p.name,
        category: p.category,
        sale_price: num(p.sale_price),
        cost_price: num(p.cost_price),
        opening_stock: num(p.opening_stock),
        // current_stock is never written from the form — Current Stock is calculated.
        minimum_stock: num(p.minimum_stock),
        active: p.active,
        unit: p.unit,
        selling_method: p.selling_method,
        track_stock: p.track_stock,
        auto_calc: p.auto_calc,
      } as any;
      const res = p.id
        ? await supabase.from("products").update(payload).eq("id", p.id).select("id").maybeSingle()
        : await supabase.from("products").insert(payload).select("id").maybeSingle();
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock-availability"] });
      qc.invalidateQueries({ queryKey: ["inventory-engine"] });
      toast.success("Saved");
    },
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
        action={<div className="flex gap-2">
          <Button variant="outline" onClick={async () => {
            if (!confirm("Copy Current Stock → Opening Stock for ALL products? Use this at the start of a new business month after physical stock counting.")) return;
            const rows = (data as any[]).map((p) => ({ id: p.id, opening_stock: num(p.current_stock) }));
            for (const r of rows) {
              const { error } = await supabase.from("products").update({ opening_stock: r.opening_stock }).eq("id", r.id);
              if (error) { toast.error(error.message); return; }
            }
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["report"] });
            toast.success("Opening Stock updated for all products");
          }}>Set Current as Opening</Button>
          <Button onClick={() => { setForm(empty); setOriginalCurrent(null); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Product</Button>
        </div>}
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
                <TableCell className={"text-right font-medium " + ((calcStock[p.id] ?? num(p.current_stock)) < num(p.minimum_stock) ? "text-destructive" : "")}>{(calcStock[p.id] ?? num(p.current_stock)).toFixed(2)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{num(p.minimum_stock).toFixed(2)}</TableCell>
                <TableCell>{p.active ? <Badge>Active</Badge> : <Badge variant="secondary">Off</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: p.id, name: p.name, category: p.category ?? "", sale_price: num(p.sale_price), cost_price: num(p.cost_price), opening_stock: num(p.opening_stock), current_stock: num(p.current_stock), minimum_stock: num(p.minimum_stock), active: p.active, unit: p.unit ?? "pcs", selling_method: (p.selling_method ?? "fixed") as "fixed" | "weight", track_stock: p.track_stock !== false, auto_calc: p.auto_calc === true }); setOriginalCurrent(num(p.current_stock)); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ name: `${p.name} (copy)`, category: p.category ?? "", sale_price: num(p.sale_price), cost_price: num(p.cost_price), opening_stock: num(p.opening_stock), current_stock: num(p.current_stock), minimum_stock: num(p.minimum_stock), active: p.active, unit: p.unit ?? "pcs", selling_method: (p.selling_method ?? "fixed") as "fixed" | "weight", track_stock: p.track_stock !== false, auto_calc: p.auto_calc === true }); setOriginalCurrent(null); setOpen(true); }}><Copy className="h-4 w-4" /></Button>
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
          <div className="space-y-2"><Label>Unit</Label>
            <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pcs">PCS</SelectItem>
                <SelectItem value="kg">KG</SelectItem>
                <SelectItem value="ltr">LTR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Selling method</Label>
            <Select value={form.selling_method} onValueChange={(v: any) => setForm({ ...form, selling_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed price (per piece)</SelectItem>
                <SelectItem value="weight">Weight / Volume (per KG / LTR)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>{form.selling_method === "weight" ? `Sale price per ${form.unit.toUpperCase()}` : "Sale price"}</Label><Input type="number" step="0.01" placeholder="0.00" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value === "" ? "" : Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Cost price <span className="text-xs text-muted-foreground">(auto — Weighted Avg from Purchases)</span></Label><Input type="number" step="0.01" placeholder="0.00" value={form.cost_price} readOnly disabled /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2"><Label>Opening</Label><Input type="number" step="0.01" placeholder="" value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: e.target.value === "" ? "" : Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Current Stock <span className="text-xs text-muted-foreground">(auto)</span></Label><Input readOnly disabled value={form.id ? (calcStock[form.id] ?? 0).toFixed(2) : "0.00"} /></div>
          <div className="space-y-2"><Label>Minimum</Label><Input type="number" step="0.01" placeholder="" value={form.minimum_stock} onChange={(e) => setForm({ ...form, minimum_stock: e.target.value === "" ? "" : Number(e.target.value) })} /></div>
        </div>
        <div className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div>
            <Label>Stock Tracking</Label>
            <p className="text-xs text-muted-foreground">Off = don't reduce this product's own stock (e.g. Tea, Samosa). Recipe ingredients still reduce.</p>
          </div>
          <Switch checked={form.track_stock} onCheckedChange={(v) => setForm({ ...form, track_stock: v })} />
        </div>
        <div className="flex items-center justify-between gap-2 rounded border px-3 py-2">
          <div className="min-w-0">
            <Label>Auto Calculation</Label>
            <p className="text-xs text-muted-foreground">On = Remaining is rebuilt from history (Opening + Purchases + Produced + Received − Sold − Transferred − Wasted). Off = keep the manual Remaining.</p>
          </div>
          <Switch className="shrink-0" checked={form.auto_calc} onCheckedChange={(v) => setForm({ ...form, auto_calc: v })} />
        </div>
        {form.id && (
          <div className="space-y-2 rounded border px-3 py-2">
            <div>
              <Label>Manual Stock Adjustment</Label>
              <p className="text-xs text-muted-foreground">
                Enter +5 to increase or -1 to decrease. Applies immediately to Current Stock, Remaining and reports.
                Current Stock: <span className="font-medium">{(calcStock[form.id] ?? 0).toFixed(2)}</span>
              </p>
            </div>
            <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] gap-2">
              <Input type="number" step="0.01" placeholder="+5 / -1" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
              <Input placeholder="Reason (optional)" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              <Button type="button" variant="secondary" disabled={adjust.isPending || adjustQty.trim() === "" || Number(adjustQty) === 0}
                onClick={() => adjust.mutate({ productId: form.id!, qty: Number(adjustQty), reason: adjustReason.trim() })}>
                Apply
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><Label>Active</Label></div>
      </CrudDialog>
      <StockPinDialog open={pinOpen} onOpenChange={setPinOpen} onConfirm={async () => {
        await save.mutateAsync(form);
        setOpen(false);
      }} />
    </div>
  );
}
