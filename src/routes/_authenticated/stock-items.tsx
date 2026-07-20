import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { money, num, today } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { useCategories } from "@/lib/use-categories";
import { toast } from "sonner";
import { stockItemsRepository, suppliersRepository } from "@/repositories";

export const Route = createFileRoute("/_authenticated/stock-items")({ component: Page });

type S = {
  id?: string;
  name: string;
  category: string;
  unit: string;
  opening_stock: number | null;
  current_stock: number | null;
  minimum_stock: number | null;
  purchase_price: number | null;
  supplier_id: string | null;
  purchase_date: string | null;
  notes: string;
};
const empty: S = {
  name: "", category: "", unit: "pcs",
  opening_stock: null, current_stock: null, minimum_stock: null, purchase_price: null,
  supplier_id: null, purchase_date: today(), notes: "",
};

function Page() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<S>(empty);
  const { data: categories = [] } = useCategories();

  const { data = [] } = useQuery({
    queryKey: ["stock_items"],
    queryFn: async () => (await stockItemsRepository.query().select("*").is("deleted_at", null).order("name")).data ?? [],
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await suppliersRepository.query().select("id, name").is("deleted_at", null).order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: S) => {
      const payload: any = {
        name: p.name,
        category: p.category,
        unit: p.unit,
        opening_stock: p.opening_stock ?? 0,
        current_stock: p.current_stock ?? 0,
        minimum_stock: p.minimum_stock ?? 0,
        purchase_price: p.purchase_price ?? 0,
        supplier_id: p.supplier_id || null,
        purchase_date: p.purchase_date || null,
        notes: p.notes || null,
      };
      const res = p.id ? await stockItemsRepository.query().update(payload).eq("id", p.id) : await stockItemsRepository.query().insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_items"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await stockItemsRepository.query().update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stock_items"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    let rows = (data as any[]).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== "all") rows = rows.filter((p) => p.category === catFilter);
    return rows;
  }, [data, search, catFilter]);

  return (
    <div>
      <PageHeader
        title="Stock Items"
        subtitle="Non-product stock (raw materials). Category links purchases to category reports."
        action={<div className="flex gap-2">
          <Button variant="outline" onClick={async () => {
            if (!confirm("Copy Current Stock → Opening Stock for ALL stock items? Use this at the start of a new business month after physical stock counting.")) return;
            for (const r of data as any[]) {
              const { error } = await stockItemsRepository.query().update({ opening_stock: num(r.current_stock) }).eq("id", r.id);
              if (error) { toast.error(error.message); return; }
            }
            qc.invalidateQueries({ queryKey: ["stock_items"] });
            qc.invalidateQueries({ queryKey: ["report"] });
            toast.success("Opening Stock updated for all stock items");
          }}>Set Current as Opening</Button>
          <Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Item</Button>
        </div>}
      />

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.category ?? "—"}</TableCell>
                <TableCell>{p.unit}</TableCell>
                <TableCell className="text-right">{num(p.opening_stock).toFixed(2)}</TableCell>
                <TableCell className={"text-right font-medium " + (num(p.current_stock) < num(p.minimum_stock) ? "text-destructive" : "")}>{num(p.current_stock).toFixed(2)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{num(p.minimum_stock).toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(p.purchase_price)}</TableCell>
                <TableCell>{num(p.current_stock) < num(p.minimum_stock) ? <Badge variant="destructive">Low</Badge> : <Badge>OK</Badge>}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({
                    id: p.id, name: p.name, category: p.category ?? "", unit: p.unit,
                    opening_stock: num(p.opening_stock), current_stock: num(p.current_stock),
                    minimum_stock: num(p.minimum_stock), purchase_price: num(p.purchase_price),
                    supplier_id: p.supplier_id ?? null, purchase_date: p.purchase_date ?? null,
                    notes: p.notes ?? "",
                  }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">No stock items</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Stock Item" : "Add Stock Item"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        if (!form.category) { toast.error("Category required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="space-y-2"><Label>Category *</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kg, g, pcs" /></div>
          <div className="space-y-2"><Label>Purchase price</Label><Input type="number" step="0.01" value={form.purchase_price ?? ""} placeholder="0.00" onChange={(e) => setForm({ ...form, purchase_price: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-2"><Label>Opening</Label><Input type="number" step="0.01" value={form.opening_stock ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, opening_stock: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Current</Label><Input type="number" step="0.01" value={form.current_stock ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, current_stock: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="space-y-2"><Label>Minimum</Label><Input type="number" step="0.01" value={form.minimum_stock ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, minimum_stock: e.target.value === "" ? null : Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Supplier</Label>
            <Select value={form.supplier_id ?? ""} onValueChange={(v) => setForm({ ...form, supplier_id: v || null })}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {(suppliers as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={form.purchase_date ?? ""} onChange={(e) => setForm({ ...form, purchase_date: e.target.value || null })} /></div>
        </div>
        <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </CrudDialog>
    </div>
  );
}
