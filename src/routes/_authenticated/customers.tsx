import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Plus, Search } from "lucide-react";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { money } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers")({ component: Page });

type C = { id?: string; name: string; phone: string; address: string; notes: string };
const empty: C = { name: "", phone: "", address: "", notes: "" };

function Page() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<C>(empty);

  const { data = [] } = useQuery({
    queryKey: ["customers", search],
    queryFn: async () => {
      let q = supabase.from("customers").select("*").is("deleted_at", null).order("last_visit", { ascending: false, nullsFirst: false }).order("name").range(0, 99999);
      if (search.trim()) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      return (await q).data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (p: C) => {
      const payload = { name: p.name.trim(), phone: p.phone.trim() || null, address: p.address || null, notes: p.notes || null };
      const res = p.id
        ? await supabase.from("customers").update(payload).eq("id", p.id)
        : await supabase.from("customers").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message?.includes("duplicate") ? "Phone already exists" : e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customers"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => data as any[], [data]);

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Auto-saved when invoices include a phone number — never duplicated"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Customer</Button>}
      />
      <div className="relative max-w-sm mb-3">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Last Visit</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c: any) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate">{c.address ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.last_visit ? new Date(c.last_visit).toLocaleDateString() : "—"}</TableCell>
                <TableCell className="text-right">{c.total_orders ?? 0}</TableCell>
                <TableCell className="text-right">{money(c.total_purchases ?? 0)}</TableCell>
                <TableCell className="text-right">
                  {Number(c.outstanding_balance ?? 0) > 0
                    ? <Badge variant="destructive">{money(c.outstanding_balance)}</Badge>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: c.id, name: c.name, phone: c.phone ?? "", address: c.address ?? "", notes: c.notes ?? "" }); setOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(c.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">No customers</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Customer" : "Add Customer"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.name.trim()) { toast.error("Name required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="space-y-2"><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-2"><Label>Mobile Number</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="space-y-2"><Label>Address</Label><Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
        <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      </CrudDialog>
    </div>
  );
}
