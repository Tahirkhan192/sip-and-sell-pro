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
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Plus, Search, Copy } from "lucide-react";
import { num } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recipes")({ component: RecipesPage });

type ComponentType = "product" | "stock_item";
type OrderType = "walk_in" | "take_away" | "delivery";
type R = {
  id?: string;
  parent_product_id: string;
  component_type: ComponentType;
  component_product_id: string | null;
  component_stock_item_id: string | null;
  quantity: number;
  unit: string;
  applies_to: OrderType[];
};
const ALL_ORDER_TYPES: OrderType[] = ["walk_in", "take_away", "delivery"];
const ORDER_LABEL: Record<OrderType, string> = { walk_in: "Walk-in", take_away: "Take Away", delivery: "Delivery" };
const empty: R = { parent_product_id: "", component_type: "stock_item", component_product_id: null, component_stock_item_id: null, quantity: 1, unit: "pcs", applies_to: ["walk_in", "take_away", "delivery"] };


function RecipesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<R>(empty);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => (await supabase.from("products").select("id, name, unit").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: stockItems = [] } = useQuery({
    queryKey: ["stock_items"],
    queryFn: async () => (await supabase.from("stock_items").select("id, name, unit").is("deleted_at", null).order("name")).data ?? [],
  });

  const { data = [] } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => (await supabase
      .from("recipes" as any)
      .select("id, parent_product_id, component_product_id, component_stock_item_id, quantity, unit, applies_to, parent:products!recipes_parent_product_id_fkey(name), component:products!recipes_component_product_id_fkey(name), stock_component:stock_items(name)")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (r: R) => {
      if (!r.parent_product_id) throw new Error("Select the finished product");
      if (r.component_type === "product" && !r.component_product_id) throw new Error("Choose a component product");
      if (r.component_type === "stock_item" && !r.component_stock_item_id) throw new Error("Choose a component stock item");
      if (r.component_type === "product" && r.parent_product_id === r.component_product_id) throw new Error("Parent and component cannot be the same");
      if (num(r.quantity) <= 0) throw new Error("Quantity must be > 0");
      if (!r.applies_to || r.applies_to.length === 0) throw new Error("Choose at least one Apply-For option");
      const payload = {
        parent_product_id: r.parent_product_id,
        component_product_id: r.component_type === "product" ? r.component_product_id : null,
        component_stock_item_id: r.component_type === "stock_item" ? r.component_stock_item_id : null,
        quantity: r.quantity,
        unit: r.unit,
        applies_to: r.applies_to,
      };
      const res = r.id
        ? await supabase.from("recipes" as any).update(payload).eq("id", r.id)
        : await supabase.from("recipes" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipes"] }); toast.success("Saved"); setOpen(false); },
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
      (r.component?.name ?? "").toLowerCase().includes(q) ||
      (r.stock_component?.name ?? "").toLowerCase().includes(q)
    );
  }, [data, search]);

  return (
    <div>
      <PageHeader
        title="Recipes"
        subtitle="Link a sold product to ingredients — either Stock Items or Products — consumed from stock on sale"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Recipe</Button>}
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search product / ingredient" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sold product (parent)</TableHead>
              <TableHead>Uses (component)</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Qty / sale</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Apply For</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r: any) => {
              const isStock = !!r.component_stock_item_id;
              const compName = isStock ? r.stock_component?.name : r.component?.name;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.parent?.name ?? "—"}</TableCell>
                  <TableCell>{compName ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{isStock ? "Stock Item" : "Product"}</Badge></TableCell>
                  <TableCell className="text-right">{num(r.quantity).toFixed(3)}</TableCell>
                  <TableCell className="uppercase text-xs">{r.unit}</TableCell>
                  <TableCell className="text-xs">
                    {((r.applies_to?.length ? r.applies_to : ALL_ORDER_TYPES) as OrderType[])
                      .map((o) => ORDER_LABEL[o]).join(", ")}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => {
                      setForm({
                        id: r.id, parent_product_id: r.parent_product_id,
                        component_type: isStock ? "stock_item" : "product",
                        component_product_id: r.component_product_id,
                        component_stock_item_id: r.component_stock_item_id,
                        quantity: r.quantity, unit: r.unit,
                        applies_to: (r.applies_to?.length ? r.applies_to : ALL_ORDER_TYPES) as OrderType[],
                      });
                      setOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" title="Duplicate" onClick={() => {
                      setForm({
                        parent_product_id: r.parent_product_id,
                        component_type: isStock ? "stock_item" : "product",
                        component_product_id: r.component_product_id,
                        component_stock_item_id: r.component_stock_item_id,
                        quantity: r.quantity, unit: r.unit,
                        applies_to: (r.applies_to?.length ? r.applies_to : ALL_ORDER_TYPES) as OrderType[],
                      });
                      setOpen(true);
                    }}><Copy className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this recipe link?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No recipes</TableCell></TableRow>}
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
          <Label>Connection Type</Label>
          <div className="grid grid-cols-2 gap-1">
            <Button type="button" size="sm" variant={form.component_type === "product" ? "default" : "outline"}
              onClick={() => setForm({ ...form, component_type: "product", component_stock_item_id: null })}>Product → Product</Button>
            <Button type="button" size="sm" variant={form.component_type === "stock_item" ? "default" : "outline"}
              onClick={() => setForm({ ...form, component_type: "stock_item", component_product_id: null })}>Product → Stock</Button>
          </div>
        </div>

        {form.component_type === "stock_item" ? (
          <div className="space-y-2">
            <Label>Stock item (deducted from stock)</Label>
            <Select value={form.component_stock_item_id ?? ""} onValueChange={(v) => {
              const s = (stockItems as any[]).find((x) => x.id === v);
              setForm({ ...form, component_stock_item_id: v, unit: s?.unit ?? form.unit });
            }}>
              <SelectTrigger><SelectValue placeholder="Choose stock item" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(stockItems as any[]).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>Component product (deducted from stock)</Label>
            <Select value={form.component_product_id ?? ""} onValueChange={(v) => {
              const p = (products as any[]).find((x) => x.id === v);
              setForm({ ...form, component_product_id: v, unit: p?.unit ?? form.unit });
            }}>
              <SelectTrigger><SelectValue placeholder="Choose product" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(products as any[]).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

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
