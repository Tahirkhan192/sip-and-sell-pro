import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Save, Plus, Search, X } from "lucide-react";
import { money } from "@/lib/format";
import { businessToday, formatBusinessTime, formatBusinessDate } from "@/lib/business-date";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";
import { cashMovementsRepository } from "@/repositories";
import { deleteMoneyMovementTransaction, saveMoneyMovementTransaction } from "@/pwa/transaction-engine";

export const Route = createFileRoute("/_authenticated/cash-movements")({ component: Page });

type Direction = "cash_in" | "cash_out";
type PaymentSource = "cash" | "online";

type FormState = {
  id?: string;
  direction: Direction;
  payment_source: PaymentSource;
  amount: number | "";
  notes: string;
};

const emptyForm = (): FormState => ({
  direction: "cash_in",
  payment_source: "cash",
  amount: "",
  notes: "",
});

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [now, setNow] = useState(() => new Date());
  const [date, setDate] = useState(businessToday());
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | Direction>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | PaymentSource>("all");

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const businessDateStr = formatBusinessDate(now);
  const businessTimeStr = formatBusinessTime(now);
  const businessDate = businessToday(now);

  const { data = [] } = useQuery({
    queryKey: ["cash_movements", date, typeFilter, sourceFilter],
    queryFn: async () => {
      let q =cashMovementsRepository.query().select("*").is("deleted_at", null).order("occurred_at", { ascending: false }).range(0, 99999);
      if (date) q = q.eq("business_date", date);
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      if (sourceFilter !== "all") q = q.eq("payment_source", sourceFilter);
      return (await q).data ?? [];
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["cash_movements"] });
    qc.invalidateQueries({ queryKey: ["daily_closing"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["report"] });
  };

  const openNew = () => {
    setForm(emptyForm());
    setNow(new Date());
    setOpen(true);
  };
  const openEdit = (r: any) => {
    setForm({
      id: r.id,
      direction: r.type as Direction,
      payment_source: (r.payment_source ?? "cash") as PaymentSource,
      amount: Number(r.amount),
      notes: r.notes ?? "",
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      if (!f.amount || Number(f.amount) <= 0) throw new Error("Enter a valid amount");
      await saveMoneyMovementTransaction({
        id: f.id,
        type: f.direction,
        payment_source: f.payment_source,
        amount: Number(f.amount),
        notes: f.notes || null,
      });
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
      await deleteMoneyMovementTransaction(id);
    },
    onSuccess: () => { invalidateAll(); toast.success("Deleted"); },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data as any[];
    return (data as any[]).filter((r) => (r.notes ?? "").toLowerCase().includes(q));
  }, [data, search]);

  const totals = useMemo(() => {
    const rows = filtered;
    const cin = rows.filter((r) => r.type === "cash_in" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const cout = rows.filter((r) => r.type === "cash_out" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const oin = rows.filter((r) => r.type === "cash_in" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    const oout = rows.filter((r) => r.type === "cash_out" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    return { cin, cout, oin, oout };
  }, [filtered]);

  const isIn = form.direction === "cash_in";

  return (
    <div>
      <PageHeader
        title="Money Movement"
        subtitle="Money In / Money Out — Cash or Online. Updates Cash Balance, Online Wallet, Daily Closing and Reports automatically."
        action={<Button onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Money Movement</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Cash In</div>
          <div className="font-semibold text-emerald-600 text-lg">{money(totals.cin)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Cash Out</div>
          <div className="font-semibold text-destructive text-lg">{money(totals.cout)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Online In</div>
          <div className="font-semibold text-emerald-600 text-lg">{money(totals.oin)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total Online Out</div>
          <div className="font-semibold text-destructive text-lg">{money(totals.oout)}</div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Input type="date" className="max-w-[180px]" value={date} onChange={(e) => setDate(e.target.value)} />
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
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Business Date</TableHead>
            <TableHead>Business Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-24"></TableHead>
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
                <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No movements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit Money Movement" : "Add Money Movement"}</DialogTitle>
          </DialogHeader>

          <div className={`border-t-4 -mt-2 pt-4 ${isIn ? "border-t-emerald-500" : "border-t-destructive"}`}>
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

            <div className="mt-4 space-y-2">
              <Label>Movement Type</Label>
              <RadioGroup
                value={form.direction}
                onValueChange={(v) => setForm((f) => ({ ...f, direction: v as Direction }))}
                className="grid grid-cols-2 gap-2"
              >
                <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${form.direction === "cash_in" ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : ""}`}>
                  <RadioGroupItem value="cash_in" id="mv-in" />
                  <ArrowDownCircle className="h-4 w-4 text-emerald-600" />
                  <span>Money In</span>
                </label>
                <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${form.direction === "cash_out" ? "border-destructive bg-destructive/10" : ""}`}>
                  <RadioGroupItem value="cash_out" id="mv-out" />
                  <ArrowUpCircle className="h-4 w-4 text-destructive" />
                  <span>Money Out</span>
                </label>
              </RadioGroup>
            </div>

            <div className="mt-4 space-y-2">
              <Label>Payment Method</Label>
              <RadioGroup
                value={form.payment_source}
                onValueChange={(v) => setForm((f) => ({ ...f, payment_source: v as PaymentSource }))}
                className="grid grid-cols-2 gap-2"
              >
                <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${form.payment_source === "cash" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="cash" id="pm-cash" />
                  <span>Cash</span>
                </label>
                <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${form.payment_source === "online" ? "border-primary bg-primary/5" : ""}`}>
                  <RadioGroupItem value="online" id="pm-online" />
                  <span>Online</span>
                </label>
              </RadioGroup>
            </div>

            <div className="mt-4 space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value === "" ? "" : Number(e.target.value) }))}
                className="text-lg font-semibold"
              />
            </div>

            <div className="mt-4 space-y-1">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                placeholder="e.g. Owner deposited cash, Bought vegetables, Bank deposit"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-1" /> Cancel
            </Button>
            <Button
              className={isIn ? "bg-emerald-600 hover:bg-emerald-700" : ""}
              variant={isIn ? "default" : "destructive"}
              onClick={() => save.mutate(form)}
              disabled={save.isPending}
            >
              <Save className="h-4 w-4 mr-1" /> {form.id ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
