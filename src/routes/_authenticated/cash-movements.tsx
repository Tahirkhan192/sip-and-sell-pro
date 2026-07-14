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
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Save } from "lucide-react";
import { money, today } from "@/lib/format";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cash-movements")({ component: Page });

type Direction = "cash_in" | "cash_out";
type PaymentSource = "cash" | "online";

type FormState = {
  id?: string;
  business_date: string;
  business_time: string; // HH:MM
  movement_category: string;
  subcategory: string;
  amount: number | "";
  payment_source: PaymentSource;
  notes: string;
};

const nowHM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const emptyForm = (): FormState => ({
  business_date: today(),
  business_time: nowHM(),
  movement_category: "",
  subcategory: "",
  amount: "",
  payment_source: "cash",
  notes: "",
});

function occurredAtISO(date: string, time: string): string {
  const t = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : "00:00:00";
  // Use local time — matches user's business time
  const d = new Date(`${date}T${t}`);
  return d.toISOString();
}

function useSubcategories() {
  return useQuery({
    queryKey: ["money_movement_subcategories"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("money_movement_subcategories")
        .select("id, category, name, active")
        .is("deleted_at", null)
        .eq("active", true)
        .order("category").order("sort_order").order("name");
      return (data ?? []) as { id: string; category: string; name: string }[];
    },
    staleTime: 60_000,
  });
}

const CATEGORY_OPTIONS = ["Expense", "Owner", "Customer", "Other"] as const;

function MovementForm({
  direction,
  form,
  onChange,
  onSubmit,
  onReset,
  saving,
  subcategories,
}: {
  direction: Direction;
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
  onSubmit: () => void;
  onReset: () => void;
  saving: boolean;
  subcategories: { category: string; name: string }[];
}) {
  const isIn = direction === "cash_in";
  const subs = subcategories.filter((s) => s.category === form.movement_category);
  return (
    <Card className={`p-4 border-t-4 ${isIn ? "border-t-emerald-500" : "border-t-destructive"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isIn
            ? <ArrowDownCircle className="h-5 w-5 text-emerald-600" />
            : <ArrowUpCircle className="h-5 w-5 text-destructive" />}
          <h3 className="font-semibold text-lg">{isIn ? "Money In" : "Money Out"}</h3>
        </div>
        {form.id && <Badge variant="outline" className="text-[10px]">Editing</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label>Category</Label>
          <Select value={form.movement_category} onValueChange={(v) => onChange({ movement_category: v, subcategory: "" })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Sub Category</Label>
          <Select value={form.subcategory} onValueChange={(v) => onChange({ subcategory: v })} disabled={!form.movement_category}>
            <SelectTrigger><SelectValue placeholder={form.movement_category ? "Select" : "Pick category first"} /></SelectTrigger>
            <SelectContent>
              {subs.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input type="number" step="0.01" placeholder="" value={form.amount}
            onChange={(e) => onChange({ amount: e.target.value === "" ? "" : Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label>Payment Method</Label>
          <Select value={form.payment_source} onValueChange={(v) => onChange({ payment_source: v as PaymentSource })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="online">Online (Wallet)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <div className="space-y-1">
          <Label>Date</Label>
          <Input type="date" value={form.business_date} onChange={(e) => onChange({ business_date: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Business Time</Label>
          <Input type="time" value={form.business_time} onChange={(e) => onChange({ business_time: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1 mt-2">
        <Label>Notes</Label>
        <Textarea rows={2} value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </div>

      <div className="flex gap-2 mt-3">
        <Button
          className={`flex-1 ${isIn ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
          variant={isIn ? "default" : "destructive"}
          onClick={onSubmit}
          disabled={saving}
        >
          <Save className="h-4 w-4 mr-1" />
          {form.id ? "Update" : `Save ${isIn ? "Money In" : "Money Out"}`}
        </Button>
        {form.id && <Button variant="outline" onClick={onReset}>Cancel</Button>}
      </div>
    </Card>
  );
}

function Page() {
  const qc = useQueryClient();
  const [inForm, setInForm] = useState<FormState>(emptyForm());
  const [outForm, setOutForm] = useState<FormState>(emptyForm());
  const [date, setDate] = useState(today());
  const [typeFilter, setTypeFilter] = useState<"all" | Direction>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | PaymentSource>("all");
  const { data: subcategories = [] } = useSubcategories();

  const { data = [] } = useQuery({
    queryKey: ["cash_movements", date, typeFilter, sourceFilter],
    queryFn: async () => {
      let q = supabase.from("cash_movements" as any).select("*").is("deleted_at", null).order("occurred_at", { ascending: false }).range(0, 99999);
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

  const save = useMutation({
    mutationFn: async (p: { form: FormState; direction: Direction }) => {
      const f = p.form;
      if (!f.amount || Number(f.amount) <= 0) throw new Error("Amount required");
      if (!f.movement_category) throw new Error("Category required");
      const payload = {
        business_date: f.business_date,
        occurred_at: occurredAtISO(f.business_date, f.business_time),
        type: p.direction,
        payment_source: f.payment_source,
        amount: Number(f.amount),
        movement_category: f.movement_category || null,
        subcategory: f.subcategory || null,
        reason: f.subcategory || f.movement_category || null,
        notes: f.notes || null,
      };
      const res = f.id
        ? await supabase.from("cash_movements" as any).update(payload).eq("id", f.id)
        : await supabase.from("cash_movements" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.direction === "cash_in" ? "Money In saved" : "Money Out saved");
      invalidateAll();
      if (vars.direction === "cash_in") setInForm(emptyForm());
      else setOutForm(emptyForm());
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

  const editRow = (r: any) => {
    const d = new Date(r.occurred_at);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const f: FormState = {
      id: r.id,
      business_date: r.business_date,
      business_time: hm,
      movement_category: r.movement_category ?? "",
      subcategory: r.subcategory ?? "",
      amount: Number(r.amount),
      payment_source: (r.payment_source ?? "cash") as PaymentSource,
      notes: r.notes ?? "",
    };
    if (r.type === "cash_in") setInForm(f); else setOutForm(f);
  };

  const totals = useMemo(() => {
    const rows = data as any[];
    const cin = rows.filter((r) => r.type === "cash_in" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const cout = rows.filter((r) => r.type === "cash_out" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const oin = rows.filter((r) => r.type === "cash_in" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    const oout = rows.filter((r) => r.type === "cash_out" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    return { cin, cout, oin, oout, cashBal: cin - cout, walletBal: oin - oout };
  }, [data]);

  return (
    <div>
      <PageHeader title="Money Movements" subtitle="Money In and Money Out — Cash or Online. Updates Cash Balance, Online Wallet, Daily Closing and Dashboard automatically." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <MovementForm
          direction="cash_in"
          form={inForm}
          onChange={(p) => setInForm((f) => ({ ...f, ...p }))}
          onSubmit={() => save.mutate({ form: inForm, direction: "cash_in" })}
          onReset={() => setInForm(emptyForm())}
          saving={save.isPending}
          subcategories={subcategories}
        />
        <MovementForm
          direction="cash_out"
          form={outForm}
          onChange={(p) => setOutForm((f) => ({ ...f, ...p }))}
          onSubmit={() => save.mutate({ form: outForm, direction: "cash_out" })}
          onReset={() => setOutForm(emptyForm())}
          saving={save.isPending}
          subcategories={subcategories}
        />
      </div>

      <Card className="mb-3 p-3 grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
        <div><div className="text-xs text-muted-foreground">Cash In</div><div className="font-semibold text-emerald-600">{money(totals.cin)}</div></div>
        <div><div className="text-xs text-muted-foreground">Cash Out</div><div className="font-semibold text-destructive">{money(totals.cout)}</div></div>
        <div><div className="text-xs text-muted-foreground">Cash Balance</div><div className="font-semibold">{money(totals.cashBal)}</div></div>
        <div><div className="text-xs text-muted-foreground">Online In</div><div className="font-semibold text-emerald-600">{money(totals.oin)}</div></div>
        <div><div className="text-xs text-muted-foreground">Online Out</div><div className="font-semibold text-destructive">{money(totals.oout)}</div></div>
        <div><div className="text-xs text-muted-foreground">Wallet Balance</div><div className="font-semibold">{money(totals.walletBal)}</div></div>
      </Card>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input type="date" className="max-w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="flex gap-1">
          {(["all", "cash_in", "cash_out"] as const).map((t) => (
            <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)} className="capitalize">
              {t === "all" ? "All types" : t === "cash_in" ? "Money In" : "Money Out"}
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(["all", "cash", "online"] as const).map((t) => (
            <Button key={t} size="sm" variant={sourceFilter === t ? "default" : "outline"} onClick={() => setSourceFilter(t)} className="capitalize">
              {t === "all" ? "All sources" : t}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Business Time</TableHead><TableHead>Type</TableHead><TableHead>Source</TableHead>
            <TableHead>Category</TableHead><TableHead>Sub Category</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data as any[]).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{new Date(r.occurred_at).toLocaleString()}</TableCell>
                <TableCell>
                  {r.type === "cash_in"
                    ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><ArrowDownCircle className="h-3 w-3 mr-1" />Money In</Badge>
                    : <Badge variant="destructive"><ArrowUpCircle className="h-3 w-3 mr-1" />Money Out</Badge>}
                </TableCell>
                <TableCell className="capitalize">{r.payment_source ?? "cash"}</TableCell>
                <TableCell>{r.movement_category ?? "—"}</TableCell>
                <TableCell>{r.subcategory ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => editRow(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No movements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
