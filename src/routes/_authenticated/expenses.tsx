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
import { Trash2, Plus, Pencil, Search } from "lucide-react";
import { money, today } from "@/lib/format";
import { useExpenseCategories, useExpenseCategoryMutations } from "@/lib/use-expense-categories";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Settings2 } from "lucide-react";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/expenses")({ component: Page });

type E = { id?: string; date: string; category: string; amount: number | ""; description: string; payment_method: "cash" | "online" | "stock_transfer"; payment_status: "paid" | "unpaid"; is_stock_transfer?: boolean };
const empty: E = { date: today(), category: "Miscellaneous", amount: "", description: "", payment_method: "cash", payment_status: "paid" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<E>(empty);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [manageOpen, setManageOpen] = useState(false);
  const [newCat, setNewCat] = useState("");
  const { data: categories = [] } = useExpenseCategories({ activeOnly: true });
  const { data: allCategories = [] } = useExpenseCategories({ activeOnly: false });
  const catMut = useExpenseCategoryMutations();

  const { data = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => (await supabase.from("expenses").select("*").is("deleted_at", null).order("date", { ascending: false }).range(0, 99999)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async (p: E) => {
      const amt = Number(p.amount || 0);
      const payload = {
        date: p.date,
        category: p.category,
        amount: amt,
        description: p.description || null,
        payment_method: p.payment_method,
        payment_status: p.payment_status,
        paid_amount: p.payment_status === "paid" ? amt : 0,
        paid_at: p.payment_status === "paid" ? new Date().toISOString() : null,
      };
      const res = p.id
        ? await supabase.from("expenses").update(payload).eq("id", p.id)
        : await supabase.from("expenses").insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (data as any[]).filter((e) => {
      if (catFilter !== "all" && e.category !== catFilter) return false;
      const status = e.payment_status ?? "paid";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      return e.category.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q);
    });
  }, [data, search, catFilter, statusFilter]);

  const total = filtered.reduce((s, x: any) => s + Number(x.amount), 0);
  const totalPaid = filtered.reduce((s, x: any) => s + (((x.payment_status ?? "paid") === "paid") ? Number(x.amount) : 0), 0);
  const totalUnpaid = filtered.reduce((s, x: any) => s + (((x.payment_status ?? "paid") === "unpaid") ? Number(x.amount) : 0), 0);

  return (
    <div>
      <PageHeader title="Expenses" subtitle="General business expenses (delivery costs go in Delivery Expenses)"
        action={<Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add Expense</Button>} />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="unpaid">Unpaid</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}><Settings2 className="h-4 w-4 mr-1" />Manage</Button>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Method</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.map((p: any) => {
              const status = (p.payment_status ?? "paid") as "paid" | "unpaid";
              return (
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell className="capitalize">{p.payment_method ?? "cash"}</TableCell>
                <TableCell><span className={"inline-block rounded px-2 py-0.5 text-xs " + (status === "paid" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>{status}</span></TableCell>
                <TableCell className="text-right font-medium">{money(p.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{p.description ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: p.id, date: p.date, category: p.category, amount: Number(p.amount), description: p.description ?? "", payment_method: (p.payment_method ?? "cash") as "cash" | "online", payment_status: status }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ date: today(), category: p.category, amount: Number(p.amount), description: p.description ?? "", payment_method: (p.payment_method ?? "cash") as "cash" | "online", payment_status: status }); setOpen(true); }}><Plus className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">No expenses</TableCell></TableRow>}
          </TableBody>
        </Table>
        {filtered.length > 0 && (
          <div className="flex justify-end gap-6 border-t px-4 py-2 text-sm font-medium">
            <span>Paid: {money(totalPaid)}</span>
            <span>Unpaid: {money(totalUnpaid)}</span>
            <span>Total: {money(total)}</span>
          </div>
        )}
      </Card>

      <CrudDialog title={form.id ? "Edit Expense" : "New Expense"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.amount) { toast.error("Amount required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div className="space-y-2"><Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Payment Method</Label>
            <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v as "cash" | "online" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="online">Online</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" placeholder="" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value === "" ? "" : Number(e.target.value) })} /></div>
        </div>
        <div className="space-y-2"><Label>Payment Status</Label>
          <Select value={form.payment_status} onValueChange={(v) => setForm({ ...form, payment_status: v as "paid" | "unpaid" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      </CrudDialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Manage Expense Categories</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input placeholder="New category name" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <Button onClick={async () => { if (!newCat.trim()) return; await catMut.add.mutateAsync(newCat.trim()); setNewCat(""); }}>Add</Button>
          </div>
          <div className="max-h-[50vh] overflow-auto divide-y">
            {allCategories.map((c) => (
              <div key={c.id} className="flex items-center gap-2 py-2">
                <Input defaultValue={c.name} className="h-8" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) catMut.rename.mutate({ id: c.id, name: v }); }} />
                <div className="flex items-center gap-1 text-xs"><Switch checked={c.active} onCheckedChange={(v) => catMut.toggle.mutate({ id: c.id, active: v })} /><span>{c.active ? "Active" : "Off"}</span></div>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete "${c.name}"?`)) catMut.remove.mutate(c.id); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
