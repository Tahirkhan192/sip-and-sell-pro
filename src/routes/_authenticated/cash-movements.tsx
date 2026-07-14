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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Pencil, Trash2, ArrowDownCircle, ArrowUpCircle, Save, X } from "lucide-react";
import { money } from "@/lib/format";
import { businessToday, formatBusinessTime, formatBusinessDate } from "@/lib/business-date";
import { PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

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
  const [form, setForm] = useState<FormState>(emptyForm());
  const [now, setNow] = useState(() => new Date());
  const [date, setDate] = useState(businessToday());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const businessDate = businessToday(now);
  const businessTimeStr = formatBusinessTime(now);
  const businessDateStr = formatBusinessDate(now);

  const { data = [] } = useQuery({
    queryKey: ["cash_movements", date],
    queryFn: async () => {
      let q = supabase.from("cash_movements" as any).select("*").is("deleted_at", null).order("occurred_at", { ascending: false }).range(0, 99999);
      if (date) q = q.eq("business_date", date);
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
    mutationFn: async (f: FormState) => {
      if (!f.amount || Number(f.amount) <= 0) throw new Error("Enter a valid amount");
      const editing = !!f.id;
      const payload: any = {
        type: f.direction,
        payment_source: f.payment_source,
        amount: Number(f.amount),
        notes: f.notes || null,
        movement_category: null,
        subcategory: null,
        reason: f.notes || null,
      };
      if (!editing) {
        payload.business_date = businessDate;
        payload.occurred_at = new Date().toISOString();
      }
      const res = editing
        ? await supabase.from("cash_movements" as any).update(payload).eq("id", f.id!)
        : await supabase.from("cash_movements" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      toast.success(form.id ? "Movement updated" : `${form.direction === "cash_in" ? "Money In" : "Money Out"} saved`);
      invalidateAll();
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

  const editRow = (r: any) => {
    setForm({
      id: r.id,
      direction: r.type as Direction,
      payment_source: (r.payment_source ?? "cash") as PaymentSource,
      amount: Number(r.amount),
      notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const totals = useMemo(() => {
    const rows = data as any[];
    const cin = rows.filter((r) => r.type === "cash_in" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const cout = rows.filter((r) => r.type === "cash_out" && (r.payment_source ?? "cash") === "cash").reduce((s, r) => s + Number(r.amount), 0);
    const oin = rows.filter((r) => r.type === "cash_in" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    const oout = rows.filter((r) => r.type === "cash_out" && r.payment_source === "online").reduce((s, r) => s + Number(r.amount), 0);
    return { cin, cout, oin, oout, cashBal: cin - cout, walletBal: oin - oout };
  }, [data]);

  const isIn = form.direction === "cash_in";

  return (
    <div>
      <PageHeader title="Money Movement" subtitle="Record a single Money In or Money Out transaction. Updates Cash Balance, Online Wallet, Daily Closing and Reports automatically." />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,480px)_1fr] gap-4 mb-4">
        <Card className={`p-5 border-t-4 ${isIn ? "border-t-emerald-500" : "border-t-destructive"}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Money Movement</h3>
            {form.id && <Badge variant="outline">Editing</Badge>}
          </div>

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

          <div className="flex gap-2 mt-5">
            <Button
              className={`flex-1 ${isIn ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
              variant={isIn ? "default" : "destructive"}
              onClick={() => save.mutate(form)}
              disabled={save.isPending}
              size="lg"
            >
              <Save className="h-4 w-4 mr-2" />
              {form.id ? "Update" : "Save"}
            </Button>
            {form.id && (
              <Button variant="outline" size="lg" onClick={() => setForm(emptyForm())}>
                <X className="h-4 w-4 mr-1" /> Cancel
              </Button>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3">Balances ({date})</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Cash In</div>
              <div className="font-semibold text-emerald-600 text-lg">{money(totals.cin)}</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Cash Out</div>
              <div className="font-semibold text-destructive text-lg">{money(totals.cout)}</div>
            </div>
            <div className="border rounded-md p-3 bg-muted/40">
              <div className="text-xs text-muted-foreground">Cash Balance</div>
              <div className="font-bold text-lg">{money(totals.cashBal)}</div>
            </div>
            <div className="border rounded-md p-3 bg-muted/40">
              <div className="text-xs text-muted-foreground">Wallet Balance</div>
              <div className="font-bold text-lg">{money(totals.walletBal)}</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Online In</div>
              <div className="font-semibold text-emerald-600 text-lg">{money(totals.oin)}</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Online Out</div>
              <div className="font-semibold text-destructive text-lg">{money(totals.oout)}</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Label className="text-sm">View date:</Label>
        <Input type="date" className="max-w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Business Time</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Method</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data as any[]).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{formatBusinessTime(r.occurred_at)}</TableCell>
                <TableCell>
                  {r.type === "cash_in"
                    ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><ArrowDownCircle className="h-3 w-3 mr-1" />Money In</Badge>
                    : <Badge variant="destructive"><ArrowUpCircle className="h-3 w-3 mr-1" />Money Out</Badge>}
                </TableCell>
                <TableCell className="capitalize">{r.payment_source ?? "cash"}</TableCell>
                <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => editRow(r)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No movements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
