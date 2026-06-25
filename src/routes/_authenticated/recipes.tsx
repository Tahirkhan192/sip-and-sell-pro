import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recipes")({ component: RecipesPage });

function RecipesPage() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState<string>("");
  const [ingredientId, setIngredientId] = useState<string>("");
  const [qty, setQty] = useState<number>(0);

  const { data: products = [] } = useQuery({ queryKey:["products"], queryFn: async () => (await supabase.from("products").select("id,name").order("name")).data ?? [] });
  const { data: ingredients = [] } = useQuery({ queryKey:["ingredients"], queryFn: async () => (await supabase.from("ingredients").select("id,name,unit").order("name")).data ?? [] });
  const { data: recipes = [] } = useQuery({
    queryKey: ["recipes", productId],
    enabled: !!productId,
    queryFn: async () => (await supabase.from("recipes").select("id, quantity_required, ingredient_id, ingredients(name, unit)").eq("product_id", productId)).data ?? [],
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!productId || !ingredientId || !qty) throw new Error("All fields required");
      const { error } = await supabase.from("recipes").insert({ product_id: productId, ingredient_id: ingredientId, quantity_required: qty });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["recipes"] }); setIngredientId(""); setQty(0); toast.success("Added"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("recipes").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes"] }),
  });

  return (
    <div>
      <PageHeader title="Recipes" subtitle="Define ingredients used per product. Used to auto-deduct stock on each sale." />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Select product</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
            {products.map((p: any) => (
              <button key={p.id} onClick={()=>setProductId(p.id)} className={`w-full text-left px-3 py-2 rounded-md text-sm ${productId===p.id?"bg-primary text-primary-foreground":"hover:bg-muted"}`}>{p.name}</button>
            ))}
            {products.length === 0 && <p className="text-sm text-muted-foreground">Add products first</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{productId ? `Recipe for ${products.find((p:any)=>p.id===productId)?.name}` : "Pick a product"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {productId && (
              <>
                <div className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Ingredient</Label>
                    <Select value={ingredientId} onValueChange={setIngredientId}>
                      <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>
                        {ingredients.map((i: any) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" step="0.01" value={qty} onChange={(e)=>setQty(Number(e.target.value))} /></div>
                  <Button onClick={()=>add.mutate()} disabled={add.isPending}><Plus className="h-4 w-4" /></Button>
                </div>

                <div className="border rounded-md divide-y">
                  {recipes.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{r.ingredients?.name}</span>
                        <span className="ml-2 text-muted-foreground">{Number(r.quantity_required)} {r.ingredients?.unit}</span>
                      </div>
                      <Button size="icon" variant="ghost" onClick={()=>del.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  {recipes.length===0 && <div className="px-3 py-6 text-sm text-muted-foreground text-center">No ingredients yet</div>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
