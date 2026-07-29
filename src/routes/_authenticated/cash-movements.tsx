import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Save, Plus, Search, X } from "lucide-react";
import { money } from "@/lib/format";
import { businessToday, formatBusinessTime, formatBusinessDate } from "@/lib/business-date";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { KATHA_CATEGORIES, kathaLabel, validateMovement, type KathaCategory, type Dir } from "@/lib/money-movement";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cash-movements")({ component: Page });

type FormState = {
  id?: string;
  /** when editing a single existing row */
  editSource?: "cash" | "online";
  cashDir: Dir;
  cashAmt: number | "";
  onlineDir: Dir;
  onlineAmt: number | "";
  category: KathaCategory;
  notes: string;
};

const emptyForm = (): FormState => ({
  cashDir: "",
  cashAmt: "",
  onlineDir: "",
  onlineAmt: "",
  category: "transaction",
  notes: "",
});

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [now, setNow] = useState(() => new Date());
  const [date, setDate] = useState<string>(businessToday());
  const [allDates, setAllDates] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "cash_in" | "cash_out">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "cash" | "online">("all");
  const [catFilter, setCatFilter] = useState<"all" | KathaCategory>("all");

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const businessDateStr = formatBusinessDate(now);
  const businessTimeStr = formatBusinessTime(now);
  const businessDate = businessToday(now);

  const { data = [] } = useQuery({
    queryKey: ["cash_movements", allDates ? "all" : date, typeFilter, sourceFilter, catFilter],
    queryFn: async () => {
      // Show EVERY movement (manual, POS, purchase, expense, delivery-generated).
      let q = supabase
        .from("cash_movements" as any)
        .select("*")
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .range(0, 99999);
      if (!allDates && date) q = q.eq("business_date", date);
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      if (sourceFilter !== "all") q = q.eq("payment_source", sourceFilter);
      if (catFilter !== "all") q = q.eq("katha_category", catFilter);
      let rows = ((await q).data ?? []) as any[];
      const needIds = rows.filter((r) => r.reference_type === "sale" && r.reference_id).map((r) => r.reference_id);
      if (needIds.length) {
        const { data: sales } = await supabase.from("sales").select("id, invoice_no").in("id", needIds as any);
        const map = new Map((sales ?? []).map((s: any) => [s.id, s.invoice_no]));
        rows = rows.map((r) =>
          r.reference_type === "sale" && r.reference_id ? { ...r, sale: { id: r.reference_id, invoice_no: map.get(r.reference_id) } } : r,
        );
      }
      return rows;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["cash_movements"] });
    qc.invalidateQueries({ queryKey: ["daily_closing"] });
    qc.invalidateQueries({ queryKey: ["digi_katha"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };

  const openNew = () => {
    setForm(emptyForm());
    setNow(new Date());
    setOpen(true);
  };
  const openEdit = (r: any) => {
    const src = (r.payment_source ?? "cash") as "cash" | "online";
    const dir: Dir = r.type === "cash_in" ? "in" : "out";
    setForm({
      id: r.id,
      editSource: src,
      cashDir: src === "cash" ? dir : "",
      cashAmt: src === "cash" ? Number(r.amount) : "",
      onlineDir: src === "online" ? dir : "",
      onlineAmt: src === "online" ? Number(r.amount) : "",
      category: (r.katha_category ?? "transaction") as KathaCategory,
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const rows = validateMovement({
        cashDir: f.cashDir,
        cashAmt: Number(f.cashAmt || 0),
        onlineDir: f.onlineDir,
        onlineAmt: Number(f.onlineAmt || 0),
        category: f.category,
      });
      if (f.id) {
        const row = rows.find((r) => r.payment_source === f.editSource) ?? rows[0];
        const { error } = await supabase
          .from("cash_movements" as any)
          .update({
            type: row.type,
            payment_source: row.payment_source,
            amount: row.amount,
            katha_category: f.category,
            notes: f.notes || null,
            reason: f.notes || null,
          })
          .eq("id", f.id);
        if (error) throw error;
        return;
      }
      const nowIso = new Date().toISOString();
      const payload = rows.map((r) => ({
        ...r,
        katha_category: f.category,
        notes: f.notes || null,
        reason: f.notes || null,
        business_date: businessDate,
        occurred_at: nowIso,
      }));
      const { error } = await supabase.from("cash_movements" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Movement updated" : "Movement saved");
      invalidateAll();
      setOpen(false);
      setForm(emptyForm());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cash_movements" as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data as any[];
    return (data as any[]).filter((r: any) => (r.notes ?? "").toLowerCase().includes(q) || (r.sale?.invoice_no ?? "").toLowerCase().includes(q));
  }, [data, search]);

  const totals = useMemo(() => {
    const rows = filtered;
    const sum = (t: string, s: string) =>
      rows.filter((r: any) => r.type === t && (r.payment_source ?? "cash") === s).reduce((a: number, r: any) => a + Number(r.amount), 0);
    return { cin: sum("cash_in", "cash"), cout: sum("cash_out", "cash"), oin: sum("cash_in", "online"), oout: sum("cash_out", "online") };
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Money Movement"
        subtitle="Every movement — manual, POS, purchase and expense generated. Updates Cash Balance, Online Wallet, Daily Closing and Digi Katha Closing automatically."
        action={
          <div className="flex gap-2">
            <PrintButton title="Money Movement Report" />
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Money Movement</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Cash In</div><div className="font-semibold text-emerald-600 text-lg">{money(totals.cin)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Cash Out</div><div className="font-semibold text-destructive text-lg">{money(totals.cout)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Online In</div><div className="font-semibold text-emerald-600 text-lg">{money(totals.oin)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Online Out</div><div className="font-semibold text-destructive text-lg">{money(totals.oout)}</div></Card>
      </div>

      <div className="no-print flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search notes or invoice" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Input type="date" className="max-w-[180px]" value={date} disabled={allDates} onChange={(e) => setDate(e.target.value)} />
        <Button size="sm" variant={allDates ? "default" : "outline"} onClick={() => setAllDates((v) => !v)}>All dates</Button>
        <div className="flex gap-1">
          {(["all", "cash_in", "cash_out"] as const).map((t) => (
            <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)}>
              {t === "all" ? "All types" : t === "cash_in" ? "Money In" : "Money Out"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "cash", "online"] as const).map((t) => (
            <Button key={t} size="sm" variant={sourceFilter === t ? "default" : "outline"} onClick={() => setSourceFilter(t)} className="capitalize">
              {t === "all" ? "All methods" : t}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", ...KATHA_CATEGORIES] as const).map((t) => (
            <Button key={t} size="sm" variant={catFilter === t ? "default" : "outline"} onClick={() => setCatFilter(t as any)}>
              {t === "all" ? "All categories" : kathaLabel(t as KathaCategory)}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Business Date</TableHead>
            <TableHead>Business Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Invoice / Source</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-24 no-print"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r: any) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(r)}>
                <TableCell className="text-xs">{formatBusinessDate(r.occurred_at)}</TableCell>
                <TableCell className="text-xs">{formatBusinessTime(r.occurred_at)}</TableCell>
                <TableCell>
                  {r.type === "cash_in"
                    ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><ArrowDownCircle className="h-3 w-3 mr-1" />Money In</Badge>
                    : <Badge variant="destructive"><ArrowUpCircle className="h-3 w-3 mr-1" />Money Out</Badge>}
                </TableCell>
                <TableCell className="capitalize">{r.payment_source ?? "cash"}</TableCell>
                <TableCell className="text-xs">
                  <Badge variant="outline">{kathaLabel((r.katha_category ?? "transaction") as KathaCategory)}</Badge>
                </TableCell>
                <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                <TableCell className="text-xs">
                  {r.reference_type === "sale" && r.sale?.invoice_no ? (
                    <a href={`/sales?edit=${r.reference_id}`} onClick={(e) => e.stopPropagation()} className="text-primary underline">
                      {r.sale.invoice_no}<span className="text-muted-foreground ml-1">(POS Invoice)</span>
                    </a>
                  ) : r.reference_type === "purchase" ? <span className="text-muted-foreground">Purchase</span>
                    : r.reference_type === "expense" ? <span className="text-muted-foreground">Expense</span>
                    : r.reference_type === "delivery_expense" ? <span className="text-muted-foreground">Delivery Expense</span>
                    : r.reference_type === "pos_manual" ? <span className="text-muted-foreground">POS</span>
                    : <span className="text-muted-foreground">Manual</span>}
                </TableCell>
                <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1 no-print" onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No movements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{form.id ? "Edit Money Movement" : "Add Money Movement"}</DialogTitle></DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Business Date</Label>
                <Input readOnly value={businessDateStr} className="bg-muted/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Business Time</Label>
                <Input readOnly value={businessTimeStr} className="bg-muted/50" />
              </div>
            </div>

            {/* Cash */}
            <div className="rounded-md border p-3 space-y-2">
              <Label>Cash</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={form.cashDir === "in" ? "default" : "outline"} className="flex-1"
                  onClick={() => setForm((f) => ({ ...f, cashDir: f.cashDir === "in" ? "" : "in" }))}>In</Button>
                <Button type="button" size="sm" variant={form.cashDir === "out" ? "destructive" : "outline"} className="flex-1"
                  onClick={() => setForm((f) => ({ ...f, cashDir: f.cashDir === "out" ? "" : "out" }))}>Out</Button>
                <Input type="number" step="0.01" placeholder="0.00" className="flex-1" value={form.cashAmt}
                  onChange={(e) => setForm((f) => ({ ...f, cashAmt: e.target.value === "" ? "" : Number(e.target.value) }))} />
              </div>
            </div>

            {/* Online */}
            <div className="rounded-md border p-3 space-y-2">
              <Label>Online</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={form.onlineDir === "in" ? "default" : "outline"} className="flex-1"
                  onClick={() => setForm((f) => ({ ...f, onlineDir: f.onlineDir === "in" ? "" : "in" }))}>In</Button>
                <Button type="button" size="sm" variant={form.onlineDir === "out" ? "destructive" : "outline"} className="flex-1"
                  onClick={() => setForm((f) => ({ ...f, onlineDir: f.onlineDir === "out" ? "" : "out" }))}>Out</Button>
                <Input type="number" step="0.01" placeholder="0.00" className="flex-1" value={form.onlineAmt}
                  onChange={(e) => setForm((f) => ({ ...f, onlineAmt: e.target.value === "" ? "" : Number(e.target.value) }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <div className="grid grid-cols-3 gap-2">
                {KATHA_CATEGORIES.map((c: KathaCategory) => (
                  <Button key={c} type="button" size="sm" variant={form.category === c ? "default" : "outline"}
                    onClick={() => setForm((f) => ({ ...f, category: c }))}>{kathaLabel(c)}</Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Transaction → Daily Closing only. Katha In = Loan Taken, Katha Out = Loan Given. Loan Paid Out = repaying a loan.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Remark</Label>
              <Textarea rows={2} placeholder="Optional remark" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-1" /> Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
              <Save className="h-4 w-4 mr-1" /> {form.id ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
