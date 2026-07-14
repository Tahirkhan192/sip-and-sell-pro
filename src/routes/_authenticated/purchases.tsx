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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Search, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { money, today, num } from "@/lib/format";
import { useCategories } from "@/lib/use-categories";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type Line = {
  id?: string;
  target: "product" | "stock_item";
  product_id: string;
  stock_item_id: string;
  category: string;
  quantity: number | "";
  unit: string;
  unit_cost: number | "";
};
type Form = {
  id?: string;
  date: string;
  supplier: string;
  payment_status: "paid" | "unpaid";
  payment_method: "cash" | "online" | "";
  notes: string;
  items: Line[];
};
const emptyLine: Line = { target: "stock_item", product_id: "", stock_item_id: "", category: "", quantity: "", unit: "", unit_cost: "" };
const empty: Form = { date: today(), supplier: "", payment_status: "unpaid", payment_method: "", notes: "", items: [{ ...emptyLine }] };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data: categories = [] } = useCategories();

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active-all"],
    queryFn: async () => (await supabase.from("products").select("id,name,category,unit").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: items = [] } = useQuery({
    queryKey: ["stock_items", "all"],
    queryFn: async () => (await supabase.from("stock_items").select("id,name,unit,category").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data = [] } = useQuery({
    queryKey: ["purchases_v2"],
    queryFn: async () => (await (supabase as any)
      .from("purchases")
      .select("*, purchase_items(*, products(name,unit), stock_items(name,unit))")
      .is("deleted_at", null)
      .order("date", { ascending: false })
      .limit(500)).data ?? [],
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["purchases_v2"] });
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["stock_items"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["report"] });
    qc.invalidateQueries({ queryKey: ["cash_movements"] });
  };

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.items.length) throw new Error("Add at least one item");
      for (const [i, l] of f.items.entries()) {
        if (!l.category) throw new Error(`Row ${i + 1}: category required`);
        if (l.target === "product" && !l.product_id) throw new Error(`Row ${i + 1}: pick a product`);
        if (l.target === "stock_item" && !l.stock_item_id) throw new Error(`Row ${i + 1}: pick a stock item`);
        if (!l.quantity || num(l.quantity) <= 0) throw new Error(`Row ${i + 1}: quantity`);
      }
      if (f.payment_status === "paid" && !f.payment_method) throw new Error("Choose Cash or Online for paid purchase");

      const grand = f.items.reduce((a, l) => a + num(l.quantity) * num(l.unit_cost), 0);
      const parentPayload: any = {
        date: f.date,
        supplier: f.supplier || null,
        category: f.items[0]?.category ?? null,
        payment_status: f.payment_status,
        payment_method: f.payment_status === "paid" ? f.payment_method : null,
        grand_total: Number(grand.toFixed(2)),
        notes: f.notes || null,
      };

      let purchaseId = f.id;
      if (f.id) {
        // Delete old items (trigger reverses stock via stock_purchases mirror)
        await (supabase as any).from("purchase_items").delete().eq("purchase_id", f.id);
        const { error } = await (supabase as any).from("purchases").update(parentPayload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { data: ins, error } = await (supabase as any).from("purchases").insert(parentPayload).select("id").single();
        if (error) throw error;
        purchaseId = ins.id;
      }

      const rows = f.items.map((l) => ({
        purchase_id: purchaseId,
        product_id: l.target === "product" ? l.product_id : null,
        stock_item_id: l.target === "stock_item" ? l.stock_item_id : null,
        category: l.category,
        quantity: num(l.quantity),
        unit: l.unit || null,
        unit_cost: num(l.unit_cost),
        total_cost: Number((num(l.quantity) * num(l.unit_cost)).toFixed(2)),
      }));
      const { error: ie } = await (supabase as any).from("purchase_items").insert(rows);
      if (ie) throw ie;
    },
    onSuccess: () => { invalidateAll(); setOpen(false); setForm(empty); toast.success("Purchase saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      // hard delete children first (trigger reverses stock), then parent
      await (supabase as any).from("purchase_items").delete().eq("purchase_id", id);
      const { error } = await (supabase as any).from("purchases").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = (data as any[]).filter((p) => (p.supplier ?? "").toLowerCase().includes(q) || (p.notes ?? "").toLowerCase().includes(q));
    if (statusFilter !== "all") rows = rows.filter((p) => p.payment_status === statusFilter);
    return rows;
  }, [data, search, statusFilter]);

  const grandTotal = form.items.reduce((a, l) => a + num(l.quantity) * num(l.unit_cost), 0);

  return (
    <div>
      <PageHeader title="Purchases" subtitle="Multi-item purchases with paid/unpaid tracking"
        action={<Button onClick={() => { setForm({ ...empty, items: [{ ...emptyLine }] }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New Purchase</Button>} />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search supplier / notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="paid">Paid only</SelectItem>
            <SelectItem value="unpaid">Unpaid only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="text-right">Grand Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((p: any) => {
              const isOpen = !!expanded[p.id];
              return (
                <>
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => setExpanded({ ...expanded, [p.id]: !isOpen })}>
                    <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                    <TableCell>{p.date}</TableCell>
                    <TableCell>{p.supplier ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{(p.purchase_items ?? []).length} item(s)</TableCell>
                    <TableCell className="text-right font-medium">{money(p.grand_total)}</TableCell>
                    <TableCell>
                      {p.payment_status === "paid"
                        ? <Badge className="bg-emerald-600 hover:bg-emerald-600">Paid</Badge>
                        : <Badge variant="destructive">Unpaid</Badge>}
                    </TableCell>
                    <TableCell className="capitalize">{p.payment_method ?? "—"}</TableCell>
                    <TableCell className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" onClick={() => {
                        setForm({
                          id: p.id, date: p.date, supplier: p.supplier ?? "",
                          payment_status: p.payment_status, payment_method: (p.payment_method ?? "") as any,
                          notes: p.notes ?? "",
                          items: (p.purchase_items ?? []).map((it: any) => ({
                            target: it.product_id ? "product" : "stock_item",
                            product_id: it.product_id ?? "",
                            stock_item_id: it.stock_item_id ?? "",
                            category: it.category ?? "",
                            quantity: Number(it.quantity),
                            unit: it.unit ?? "",
                            unit_cost: Number(it.unit_cost),
                          })),
                        });
                        setOpen(true);
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this purchase?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/40">
                        <div className="p-2 space-y-1">
                          {(p.purchase_items ?? []).map((it: any) => (
                            <div key={it.id} className="flex justify-between text-sm gap-4">
                              <span className="flex-1">{it.products?.name ?? it.stock_items?.name ?? "?"} <span className="text-muted-foreground">({it.category})</span></span>
                              <span className="w-32 text-right">{Number(it.quantity)} {it.unit ?? ""}</span>
                              <span className="w-24 text-right">{money(it.unit_cost)}</span>
                              <span className="w-24 text-right font-medium">{money(it.total_cost)}</span>
                            </div>
                          ))}
                          {p.notes && <div className="text-xs text-muted-foreground pt-1">Notes: {p.notes}</div>}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No purchases</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit Purchase" : "New Purchase"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Purchase Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="space-y-1"><Label>Supplier</Label><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="e.g. Metro" /></div>
              <div className="space-y-1"><Label>Payment Status</Label>
                <Select value={form.payment_status} onValueChange={(v: any) => setForm({ ...form, payment_status: v, payment_method: v === "unpaid" ? "" : form.payment_method })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.payment_status === "paid" && (
                <div className="space-y-1"><Label>Payment Method <span className="text-destructive">*</span></Label>
                  <Select value={form.payment_method} onValueChange={(v: any) => setForm({ ...form, payment_method: v })}>
                    <SelectTrigger><SelectValue placeholder="Cash or Online" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-base">Items</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, items: [...form.items, { ...emptyLine }] })}>
                  <Plus className="h-3 w-3 mr-1" /> Add row
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((l, idx) => {
                  const catItems = (items as any[]).filter((i) => !l.category || i.category === l.category);
                  const catProducts = (products as any[]).filter((p) => !l.category || p.category === l.category);
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 border rounded-md">
                      <div className="col-span-2 space-y-1"><Label className="text-xs">Category</Label>
                        <Select value={l.category} onValueChange={(v) => {
                          const next = [...form.items]; next[idx] = { ...l, category: v, product_id: "", stock_item_id: "" }; setForm({ ...form, items: next });
                        }}>
                          <SelectTrigger><SelectValue placeholder="Cat" /></SelectTrigger>
                          <SelectContent>{categories.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2 space-y-1"><Label className="text-xs">Type</Label>
                        <Select value={l.target} onValueChange={(v: any) => {
                          const next = [...form.items]; next[idx] = { ...l, target: v, product_id: "", stock_item_id: "" }; setForm({ ...form, items: next });
                        }}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="stock_item">Stock Item</SelectItem>
                            <SelectItem value="product">Product</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3 space-y-1"><Label className="text-xs">Item</Label>
                        {l.target === "product" ? (
                          <Select value={l.product_id} onValueChange={(v) => {
                            const p = catProducts.find((x) => x.id === v);
                            const next = [...form.items]; next[idx] = { ...l, product_id: v, unit: p?.unit ?? l.unit }; setForm({ ...form, items: next });
                          }}>
                            <SelectTrigger><SelectValue placeholder={l.category ? "Choose…" : "Cat first"} /></SelectTrigger>
                            <SelectContent>{catProducts.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : (
                          <Select value={l.stock_item_id} onValueChange={(v) => {
                            const it = catItems.find((x) => x.id === v);
                            const next = [...form.items]; next[idx] = { ...l, stock_item_id: v, unit: it?.unit ?? l.unit }; setForm({ ...form, items: next });
                          }}>
                            <SelectTrigger><SelectValue placeholder={l.category ? "Choose…" : "Cat first"} /></SelectTrigger>
                            <SelectContent>{catItems.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
                          </Select>
                        )}
                      </div>
                      <div className="col-span-1 space-y-1"><Label className="text-xs">Qty</Label>
                        <Input type="number" step="0.01" value={l.quantity} onChange={(e) => {
                          const next = [...form.items]; next[idx] = { ...l, quantity: e.target.value === "" ? "" : Number(e.target.value) }; setForm({ ...form, items: next });
                        }} />
                      </div>
                      <div className="col-span-1 space-y-1"><Label className="text-xs">Unit</Label>
                        <Input value={l.unit} onChange={(e) => {
                          const next = [...form.items]; next[idx] = { ...l, unit: e.target.value }; setForm({ ...form, items: next });
                        }} />
                      </div>
                      <div className="col-span-1 space-y-1"><Label className="text-xs">Rate</Label>
                        <Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => {
                          const next = [...form.items]; next[idx] = { ...l, unit_cost: e.target.value === "" ? "" : Number(e.target.value) }; setForm({ ...form, items: next });
                        }} />
                      </div>
                      <div className="col-span-1 text-right text-sm font-medium">{money(num(l.quantity) * num(l.unit_cost))}</div>
                      <div className="col-span-1 flex justify-end">
                        <Button type="button" size="icon" variant="ghost" onClick={() => {
                          if (form.items.length === 1) { setForm({ ...form, items: [{ ...emptyLine }] }); return; }
                          setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
                        }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="flex justify-between items-center pt-2 border-t">
              <div className="text-sm text-muted-foreground">
                {form.payment_status === "paid" && form.payment_method
                  ? `Will record ${form.payment_method === "cash" ? "Cash Out" : "Online Out"} of ${money(grandTotal)}`
                  : "Unpaid — no cash/wallet impact until marked paid"}
              </div>
              <div className="text-lg font-semibold">Grand Total: {money(grandTotal)}</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(form)}>Save Purchase</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
