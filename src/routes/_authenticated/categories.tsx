import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/categories")({ component: Page });

type C = {
  id?: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sort_order: number | null;
  active: boolean;
};
const empty: C = { name: "", description: "", color: "", icon: "", sort_order: null, active: true };

function Page() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<C>(empty);

  const { data = [] } = useQuery({
    queryKey: ["categories", "admin"],
    queryFn: async () => (await supabase.from("categories" as any).select("*").is("deleted_at", null).order("sort_order").order("name")).data ?? [],
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["report"] });
    qc.invalidateQueries({ queryKey: ["products"] });
  };

  const save = useMutation({
    mutationFn: async (p: C) => {
      const payload: any = {
        name: p.name.trim(),
        description: p.description || null,
        color: p.color || null,
        icon: p.icon || null,
        sort_order: p.sort_order ?? 0,
        active: p.active,
      };
      const res = p.id
        ? await supabase.from("categories" as any).update(payload).eq("id", p.id)
        : await supabase.from("categories" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { invalidateAll(); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message?.includes("duplicate") ? "Category name already exists" : e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("categories" as any).update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(),
  });

  const del = useMutation({
    mutationFn: async (c: any) => {
      // Check if any product / stock_item references this category
      const [{ count: prodCount }, { count: stockCount }] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("category", c.name).is("deleted_at", null),
        supabase.from("stock_items").select("id", { count: "exact", head: true }).eq("category", c.name as any).is("deleted_at", null),
      ]);
      if ((prodCount ?? 0) > 0 || (stockCount ?? 0) > 0) {
        // mark inactive instead
        const { error } = await supabase.from("categories" as any).update({ active: false }).eq("id", c.id);
        if (error) throw error;
        return { softened: true };
      }
      const { error } = await supabase.from("categories" as any).update({ deleted_at: new Date().toISOString() }).eq("id", c.id);
      if (error) throw error;
      return { softened: false };
    },
    onSuccess: (r: any) => {
      invalidateAll();
      toast.success(r.softened ? "Category has products — marked Inactive" : "Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = useMemo(() => (data as any[]).filter((c) => c.name.toLowerCase().includes(search.toLowerCase())), [data, search]);

  return (
    <div>
      <PageHeader
        title="Categories"
        subtitle="Unlimited categories — drives Products, POS, Stock, Reports and Dashboard automatically"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Category</Button>}
      />
      <div className="relative max-w-sm mb-3">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search categories" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Color</TableHead>
              <TableHead>Icon</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell>{c.sort_order ?? 0}</TableCell>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">{c.description ?? "—"}</TableCell>
                <TableCell>
                  {c.color ? <span className="inline-flex items-center gap-1"><span className="inline-block h-4 w-4 rounded border" style={{ background: c.color }} /><span className="text-xs">{c.color}</span></span> : "—"}
                </TableCell>
                <TableCell className="text-xs">{c.icon ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch checked={!!c.active} onCheckedChange={(v) => toggleActive.mutate({ id: c.id, active: v })} />
                    {c.active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                  </div>
                </TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: c.id, name: c.name, description: c.description ?? "", color: c.color ?? "", icon: c.icon ?? "", sort_order: c.sort_order ?? 0, active: !!c.active }); setOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${c.name}"? Categories with existing records will be marked Inactive instead.`)) del.mutate(c); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No categories</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Category" : "Add Category"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Color</Label><Input type="color" value={form.color || "#888888"} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
          <div className="space-y-2"><Label>Icon (lucide name)</Label><Input value={form.icon} placeholder="coffee, pizza, beef…" onChange={(e) => setForm({ ...form, icon: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <div className="space-y-2"><Label>Display Order</Label><Input type="number" value={form.sort_order ?? ""} placeholder="0" onChange={(e) => setForm({ ...form, sort_order: e.target.value === "" ? null : Number(e.target.value) })} /></div>
          <div className="flex items-center gap-2 pb-2"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} /><span className="text-sm">Active</span></div>
        </div>
      </CrudDialog>
    </div>
  );
}
