import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus } from "lucide-react";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ingredients")({ component: IngredientsPage });

type I = { id?: string; name: string; unit: string; minimum_stock: number };
const empty: I = { name: "", unit: "kg", minimum_stock: 0 };

function IngredientsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<I>(empty);

  const { data = [] } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => (await supabase.from("ingredients").select("*").order("name")).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: I) => {
      const payload = { name: p.name, unit: p.unit, minimum_stock: p.minimum_stock };
      const res = p.id
        ? await supabase.from("ingredients").update(payload).eq("id", p.id)
        : await supabase.from("ingredients").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("ingredients").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ingredients"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Ingredients"
        subtitle="Raw items consumed by recipes"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Ingredient</Button>}
      />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Min Stock</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.unit}</TableCell>
                <TableCell className="text-right">{Number(p.minimum_stock).toFixed(2)}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm(p); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length===0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No ingredients yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Ingredient" : "Add Ingredient"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name</Label><Input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} /></div>
        <div className="space-y-2"><Label>Unit</Label><Input value={form.unit} onChange={(e)=>setForm({...form, unit: e.target.value})} placeholder="kg, g, ml, pcs" /></div>
        <div className="space-y-2"><Label>Minimum stock</Label><Input type="number" step="0.01" value={form.minimum_stock} onChange={(e)=>setForm({...form, minimum_stock: Number(e.target.value)})} /></div>
      </CrudDialog>
    </div>
  );
}
