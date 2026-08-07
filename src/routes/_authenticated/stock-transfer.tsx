import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, CrudDialog } from "@/components/CrudHelpers";
import { useCategories } from "@/lib/use-categories";
import { useExpenseCategories } from "@/lib/use-expense-categories";
import { money, num, today } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/stock-transfer")({ component: Page });

type ItemType = "product" | "stock_item";
type DestType = "category" | "expense";
type F = {
  item_type: ItemType;
  dest_type: DestType;
  product_id: string | null;
  stock_item_id: string | null;
  from_category: string;
  to_category: string;
  expense_category: string;
  quantity: number | "";
  reason: string;
  notes: string;
  date: string;
};
const empty: F = {
  item_type: "product",
  dest_type: "category",
  product_id: null,
  stock_item_id: null,
  from_category: "",
  to_category: "",
  expense_category: "",
  quantity: "",
  reason: "",
  notes: "",
  date: today(),
};

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<F>(empty);
  const { data: categoryList = [] } = useCategories();
  const { data: expenseCategories = [] } = useExpenseCategories({ activeOnly: true });

  const { data: rawProducts = [] } = useQuery({
    queryKey: ["products", "all-for-transfer"],
    queryFn: async () => (await supabase.from("products").select("id, name, category, unit, cost_price, current_stock").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: rawStockItems = [] } = useQuery({
    queryKey: ["stock_items", "all-for-transfer"],
    queryFn: async () => (await supabase.from("stock_items").select("id, name, category, unit, purchase_price, current_stock").is("deleted_at", null).order("name")).data ?? [],
  });
  // Single source of truth for Current Stock — the inventory engine.
  const { data: engine } = useInventoryEngine(transferPeriod());
  const products = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of engine?.products ?? []) m[r.id] = r.remaining;
    return (rawProducts as any[]).map((p) => (m[p.id] === undefined ? p : { ...p, current_stock: m[p.id] }));
  }, [rawProducts, engine]);
  const stockItems = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of engine?.stockItems ?? []) m[r.id] = r.remaining;
    return (rawStockItems as any[]).map((p) => (m[p.id] === undefined ? p : { ...p, current_stock: m[p.id] }));
  }, [rawStockItems, engine]);
  const { data: transfers = [] } = useQuery({
    queryKey: ["stock_transfers"],
    queryFn: async () => (await (supabase as any).from("stock_transfers").select("*").is("deleted_at", null).order("created_at", { ascending: false }).range(0, 99999)).data ?? [],
  });

  const selectedItem = useMemo(() => {
    if (form.item_type === "product") return (products as any[]).find((p) => p.id === form.product_id);
    return (stockItems as any[]).find((s) => s.id === form.stock_item_id);
  }, [form, products, stockItems]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["stock_transfers"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["report"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["inventory-engine"] });
    qc.invalidateQueries({ queryKey: ["stock_items"] });
    qc.invalidateQueries({ queryKey: ["inventory-engine"] });
    qc.invalidateQueries({ queryKey: ["stock"] });
    qc.invalidateQueries({ queryKey: ["stock-monthly"] });
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["daily_closing"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (form.item_type === "product" && !form.product_id) throw new Error("Choose a product");
      if (form.item_type === "stock_item" && !form.stock_item_id) throw new Error("Choose a stock item");
      if (num(form.quantity) <= 0) throw new Error("Quantity must be greater than 0");

      if (form.dest_type === "expense") {
        if (!form.expense_category) throw new Error("Choose an expense category");
        const { error } = await (supabase as any).rpc("stock_to_expense_transfer", {
          _product_id: form.item_type === "product" ? form.product_id : null,
          _stock_item_id: form.item_type === "stock_item" ? form.stock_item_id : null,
          _quantity: num(form.quantity),
          _expense_category: form.expense_category,
          _reason: form.reason || null,
          _notes: form.notes || null,
          _date: form.date,
        });
        if (error) throw error;
        return;
      }

      if (!form.from_category || !form.to_category) throw new Error("Both categories are required");
      if (form.from_category === form.to_category) throw new Error("From and To categories must differ");
      const { error } = await (supabase as any).rpc("save_stock_transfer", {
        _item_type: form.item_type,
        _product_id: form.item_type === "product" ? form.product_id : null,
        _stock_item_id: form.item_type === "stock_item" ? form.stock_item_id : null,
        _from_category: form.from_category,
        _to_category: form.to_category,
        _quantity: num(form.quantity),
        _reason: form.reason || null,
        _notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer saved");
      invalidateAll();
      setOpen(false);
      setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("stock_transfers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); toast.success("Transfer removed"); },
  });

  const unitCost = selectedItem ? num((selectedItem as any).cost_price ?? (selectedItem as any).purchase_price) : 0;
  const totalCost = unitCost * num(form.quantity);

  return (
    <div>
      <PageHeader
        title="Stock Transfer"
        subtitle="Move a Product or Stock Item between Categories, or transfer it out as an Expense (Wastage, Staff Food, Damage, etc.)."
        action={<Button onClick={() => { setForm({ ...empty, date: today() }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />New Transfer</Button>}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Movement</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(transfers as any[]).map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</TableCell>
                <TableCell className="font-medium">{t.item_name}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] capitalize">{t.item_type.replace("_"," ")}</Badge></TableCell>
                <TableCell className="text-right">{num(t.quantity).toFixed(3)} <span className="text-[10px] uppercase text-muted-foreground">{t.unit}</span></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-xs">
                    <Badge variant="secondary">{t.from_category}</Badge>
                    <ArrowRight className="h-3 w-3" />
                    <Badge>{t.to_category}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right">{money(t.total_cost)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.reason ?? "—"}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Remove this transfer?")) del.mutate(t.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {transfers.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No transfers yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog
        title="New Transfer"
        open={open}
        onOpenChange={setOpen}
        onSubmit={async () => { await save.mutateAsync(); return true; }}
      >
        <div className="space-y-2">
          <Label>Item Type</Label>
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" size="sm" variant={form.item_type === "product" ? "default" : "outline"}
              onClick={() => setForm({ ...form, item_type: "product", stock_item_id: null })}>Product</Button>
            <Button type="button" size="sm" variant={form.item_type === "stock_item" ? "default" : "outline"}
              onClick={() => setForm({ ...form, item_type: "stock_item", product_id: null })}>Stock Item</Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Item</Label>
          {form.item_type === "product" ? (
            <Select value={form.product_id ?? ""} onValueChange={(v) => {
              const p = (products as any[]).find((x) => x.id === v);
              setForm({ ...form, product_id: v, from_category: p?.category ?? form.from_category });
            }}>
              <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} <span className="text-xs text-muted-foreground">· {p.category}</span></SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Select value={form.stock_item_id ?? ""} onValueChange={(v) => {
              const s = (stockItems as any[]).find((x) => x.id === v);
              setForm({ ...form, stock_item_id: v, from_category: s?.category ?? form.from_category });
            }}>
              <SelectTrigger><SelectValue placeholder="Choose stock item" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(stockItems as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} <span className="text-xs text-muted-foreground">· {s.category}</span></SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {selectedItem && (
            <p className="text-xs text-muted-foreground">
              In stock: {num((selectedItem as any).current_stock).toFixed(3)} {(selectedItem as any).unit} · Unit cost: {money(unitCost)}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Transfer To</Label>
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" size="sm" variant={form.dest_type === "category" ? "default" : "outline"}
              onClick={() => setForm({ ...form, dest_type: "category" })}>Another Category</Button>
            <Button type="button" size="sm" variant={form.dest_type === "expense" ? "default" : "outline"}
              onClick={() => setForm({ ...form, dest_type: "expense" })}>Expenses</Button>
          </div>
        </div>

        {form.dest_type === "category" ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>From Category</Label>
              <Select value={form.from_category} onValueChange={(v) => setForm({ ...form, from_category: v })}>
                <SelectTrigger><SelectValue placeholder="From" /></SelectTrigger>
                <SelectContent>
                  {(categoryList as string[]).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Category</Label>
              <Select value={form.to_category} onValueChange={(v) => setForm({ ...form, to_category: v })}>
                <SelectTrigger><SelectValue placeholder="To" /></SelectTrigger>
                <SelectContent>
                  {(categoryList as string[]).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Expense Category</Label>
              <Select value={form.expense_category} onValueChange={(v) => setForm({ ...form, expense_category: v })}>
                <SelectTrigger><SelectValue placeholder="e.g. Wastage, Staff Food" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {expenseCategories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Quantity</Label>
          <Input type="number" step="0.001" min={0} value={form.quantity} placeholder="e.g. 3"
            onChange={(e) => setForm({ ...form, quantity: e.target.value === "" ? "" : Number(e.target.value) })} />
          {selectedItem && num(form.quantity) > 0 && (
            <p className="text-xs text-muted-foreground">Total cost: <span className="font-semibold">{money(totalCost)}</span></p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Reason (optional)</Label>
          <Input value={form.reason} placeholder={form.dest_type === "expense" ? "e.g. Wasted, Given to staff" : "e.g. Used in Biryani prep"} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Notes (optional)</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </CrudDialog>
    </div>
  );
}
