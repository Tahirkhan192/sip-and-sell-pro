import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/CrudHelpers";
import { money, num } from "@/lib/format";
import { buildRange } from "@/lib/business-date";
import { useInventoryEngine, type Period } from "@/lib/inventory-engine";

function prodPeriod(): Period {
  const r = buildRange("month");
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
}
import { toast } from "sonner";
import { Trash2, ChefHat, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/production")({ component: ProductionPage });

function ProductionPage() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  // Only products that have a recipe are batchable
  const { data: recipeProducts = [] } = useQuery({
    queryKey: ["production", "recipe-products"],
    queryFn: async () => {
      const [recQ, prodQ] = await Promise.all([
        supabase.from("recipes").select("parent_product_id").is("deleted_at", null),
        supabase.from("products").select("id,name,category,cost_price,current_stock,unit").is("deleted_at", null).eq("active", true).order("name"),
      ]);
      const ids = new Set((recQ.data ?? []).map((r: any) => r.parent_product_id));
      return (prodQ.data ?? []).filter((p: any) => ids.has(p.id));
    },
  });

  // Current Stock always comes from the inventory engine.
  const { data: engine } = useInventoryEngine(prodPeriod());
  const calcStock = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of engine?.products ?? []) m[r.id] = r.remaining;
    return m;
  }, [engine]);

  const selectedProduct = useMemo(
    () => (recipeProducts as any[]).find((p) => p.id === productId),
    [recipeProducts, productId],
  );

  // Preview recipe cost for the entered quantity
  const { data: recipe = [] } = useQuery({
    queryKey: ["production", "recipe", productId],
    enabled: !!productId,
    queryFn: async () => (await supabase
      .from("recipes")
      .select("quantity, component_product_id, component_stock_item_id, products:component_product_id(name, category, cost_price), stock_items:component_stock_item_id(name, category, purchase_price)")
      .eq("parent_product_id", productId)
      .is("deleted_at", null)).data ?? [],
  });

  const previewCost = useMemo(() => {
    const q = num(quantity);
    if (q <= 0) return 0;
    return (recipe as any[]).reduce((s, r) => {
      const unit = r.component_product_id ? num(r.products?.cost_price) : num(r.stock_items?.purchase_price);
      return s + num(r.quantity) * q * unit;
    }, 0);
  }, [recipe, quantity]);

  const { data: batches = [] } = useQuery({
    queryKey: ["production", "batches"],
    queryFn: async () => (await supabase
      .from("production_batches")
      .select("*, products(name, category), production_batch_items(*, products:component_product_id(name, category), stock_items:component_stock_item_id(name, category))")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async () => {
      const q = num(quantity);
      if (!productId) throw new Error("Select a product");
      if (q <= 0) throw new Error("Quantity must be > 0");
      const { data, error } = await supabase.rpc("save_production" as any, {
        _product_id: productId,
        _quantity: q,
        _notes: notes || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Production batch saved");
      setProductId(""); setQuantity(""); setNotes("");
      qc.invalidateQueries({ queryKey: ["production"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-engine"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_production_batch" as any, { _batch_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Batch deleted, stock restored");
      qc.invalidateQueries({ queryKey: ["production"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-engine"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div>
      <PageHeader title="Production" subtitle="Batch cooking — consumes recipe ingredients now, adds finished stock" />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ChefHat className="h-4 w-4" /> New Batch</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Product (must have recipe)</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Choose finished product…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {(recipeProducts as any[]).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} · {p.category}</SelectItem>
                  ))}
                  {recipeProducts.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No products with recipes. Add a recipe first.</div>}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Batch quantity</Label>
                <Input type="number" step="0.001" min={0} value={quantity} placeholder="e.g. 100"
                  onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>Current stock</Label>
                <Input readOnly value={selectedProduct ? num(calcStock[selectedProduct.id] ?? 0).toFixed(2) : ""} className="bg-muted" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Morning shift, cook: Ali…" />
            </div>

            {productId && recipe.length > 0 && (
              <div className="rounded-md border">
                <div className="text-xs font-medium px-3 py-2 border-b bg-muted/40">Ingredients that will be consumed</div>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="h-8 text-[11px]">Component</TableHead>
                    <TableHead className="h-8 text-[11px] text-right">Per unit</TableHead>
                    <TableHead className="h-8 text-[11px] text-right">Needed</TableHead>
                    <TableHead className="h-8 text-[11px] text-right">Cost</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {(recipe as any[]).map((r, i) => {
                      const isProd = !!r.component_product_id;
                      const name = isProd ? r.products?.name : r.stock_items?.name;
                      const cat = isProd ? r.products?.category : r.stock_items?.category;
                      const unitCost = isProd ? num(r.products?.cost_price) : num(r.stock_items?.purchase_price);
                      const need = num(r.quantity) * num(quantity);
                      return (
                        <TableRow key={i}>
                          <TableCell className="py-1.5">
                            <div className="text-xs font-medium">{name}</div>
                            <div className="text-[10px] text-muted-foreground">{cat} · {isProd ? "Product" : "Stock Item"}</div>
                          </TableCell>
                          <TableCell className="py-1.5 text-right text-xs">{num(r.quantity).toFixed(3)}</TableCell>
                          <TableCell className="py-1.5 text-right text-xs">{need.toFixed(3)}</TableCell>
                          <TableCell className="py-1.5 text-right text-xs">{money(need * unitCost)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                <div className="border-t px-3 py-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Batch total cost</span>
                  <span className="font-semibold">{money(previewCost)}</span>
                </div>
                {num(quantity) > 0 && (
                  <div className="border-t px-3 py-2 flex justify-between text-sm">
                    <span className="text-muted-foreground">Per-unit cost (WAC)</span>
                    <span className="font-semibold">{money(previewCost / num(quantity))}</span>
                  </div>
                )}
              </div>
            )}

            <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending || !productId || num(quantity) <= 0}>
              <Plus className="h-4 w-4 mr-1" /> Save Production Batch
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent Batches</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(batches as any[]).map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="text-xs">{new Date(b.created_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="font-medium text-sm">{b.products?.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {b.products?.category}
                        {b.production_batch_items?.length ? ` · ${b.production_batch_items.length} ingredients` : ""}
                      </div>
                      {b.notes && <div className="text-[10px] text-muted-foreground italic">{b.notes}</div>}
                      {(b.production_batch_items ?? []).some((it: any) => (it.source_category ?? "") !== (b.products?.category ?? "")) && (
                        <Badge variant="outline" className="mt-1 text-[9px]">cross-category cost transfer</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">{num(b.quantity).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">{money(b.unit_cost)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{money(b.total_cost)}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost"
                        onClick={() => { if (confirm("Delete this batch? Ingredients will be restored and finished stock removed.")) del.mutate(b.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No batches yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
