import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { StockPinDialog } from "@/components/StockPinDialog";
import { money } from "@/lib/format";
import { businessToday } from "@/lib/business-date";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X, Wallet, HandCoins, Banknote } from "lucide-react";

export const Route = createFileRoute("/_authenticated/staff")({
  component: StaffPage,
  head: () => ({
    meta: [
      { title: "Staff Management | Sip & Sell Pro POS" },
      { name: "description", content: "Manage staff records, daily attendance, salary, advances, salary payments and staff katha balances." },
      { property: "og:title", content: "Staff Management | Sip & Sell Pro POS" },
      { property: "og:description", content: "Staff attendance, salary calculation with carry-forward, advances and staff katha ledger." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const n = (v: any) => Number(v ?? 0) || 0;

type Staff = {
  id: string; name: string; father_name: string | null; phone: string | null; cnic: string | null;
  joining_date: string; monthly_salary: number; status: string; notes: string | null;
  opening_katha: number; katha_balance: number;
};

type SalaryRow = {
  staff_id: string; name: string; monthly_salary: number; present_days: number; absent_days: number;
  deduction: number; advance_taken: number; salary_paid: number; katha_purchases: number; carry_in: number;
  remaining_salary: number; katha_balance: number;
};

const emptyForm = {
  id: "" as string | undefined,
  name: "", father_name: "", phone: "", cnic: "",
  joining_date: businessToday(), monthly_salary: 0, status: "active", notes: "", opening_katha: 0,
};

function StaffPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(businessToday());
  const [month, setMonth] = useState(() => businessToday().slice(0, 7));
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [pin, setPin] = useState<{ open: boolean; action: null | (() => void); title: string }>({ open: false, action: null, title: "Owner PIN required" });
  const [payDialog, setPayDialog] = useState<null | { staff: Staff; kind: "salary" | "advance" | "katha_receipt" }>(null);

  const { data: staff = [] } = useQuery({
    queryKey: ["staff", "list"],
    queryFn: async () => ((await supabase.from("staff" as any).select("*").is("deleted_at", null).order("name")).data ?? []) as unknown as Staff[],
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ["staff", "attendance", date],
    queryFn: async () => ((await supabase.from("staff_attendance" as any).select("*").eq("date", date)).data ?? []) as any[],
  });

  const { data: salary = [] } = useQuery({
    queryKey: ["staff", "salary", month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_salary_summary" as any, { _month: `${month}-01` });
      if (error) throw error;
      return (data ?? []) as unknown as SalaryRow[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["staff", "payments", month],
    queryFn: async () => ((await supabase.from("staff_payments" as any).select("*")
      .gte("date", `${month}-01`)
      .lt("date", nextMonth(month))
      .order("date", { ascending: false })).data ?? []) as any[],
  });

  const { data: kathaSales = [] } = useQuery({
    queryKey: ["staff", "katha-sales"],
    queryFn: async () => ((await supabase.from("sales").select("staff_id, grand_total, cash_paid, online_paid")
      .not("staff_id", "is", null).eq("katha", true).eq("status", "completed").is("deleted_at", null)).data ?? []) as any[],
  });

  const attMap = useMemo(() => {
    const m: Record<string, "present" | "absent"> = {};
    for (const a of attendance as any[]) m[a.staff_id] = a.status;
    return m;
  }, [attendance]);

  const salaryMap = useMemo(() => {
    const m: Record<string, SalaryRow> = {};
    for (const r of salary as SalaryRow[]) m[r.staff_id] = r;
    return m;
  }, [salary]);

  const purchasesMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of kathaSales as any[]) {
      const owed = Math.max(0, n(s.grand_total) - n(s.cash_paid) - n(s.online_paid));
      m[s.staff_id] = (m[s.staff_id] ?? 0) + owed;
    }
    return m;
  }, [kathaSales]);

  const receiptsMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of payments as any[]) if (p.kind === "katha_receipt") m[p.staff_id] = (m[p.staff_id] ?? 0) + n(p.amount);
    return m;
  }, [payments]);

  const saveStaff = useMutation({
    mutationFn: async (f: typeof emptyForm) => {
      const payload = {
        name: f.name.trim(),
        father_name: f.father_name?.trim() || null,
        phone: f.phone?.trim() || null,
        cnic: f.cnic?.trim() || null,
        joining_date: f.joining_date,
        monthly_salary: n(f.monthly_salary),
        status: f.status,
        notes: f.notes?.trim() || null,
        opening_katha: n(f.opening_katha),
      };
      if (!payload.name) throw new Error("Name is required");
      if (f.id) {
        const { error } = await supabase.from("staff" as any).update(payload).eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff" as any).insert({ ...payload, katha_balance: n(f.opening_katha) });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Staff saved"); setForm(null); qc.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff" as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Staff deleted"); qc.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const mark = useMutation({
    mutationFn: async (rows: { staff_id: string; status: "present" | "absent" }[]) => {
      const { error } = await supabase.from("staff_attendance" as any)
        .upsert(rows.map((r) => ({ ...r, date })), { onConflict: "staff_id,date" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const totals = useMemo(() => {
    const rows = salary as SalaryRow[];
    return {
      staff: staff.length,
      monthly: rows.reduce((s, r) => s + n(r.monthly_salary), 0),
      paid: rows.reduce((s, r) => s + n(r.salary_paid), 0),
      remaining: rows.reduce((s, r) => s + n(r.remaining_salary), 0),
      advance: rows.reduce((s, r) => s + n(r.advance_taken), 0),
      deduction: rows.reduce((s, r) => s + n(r.deduction), 0),
      katha: staff.reduce((s, r) => s + n(r.katha_balance), 0),
    };
  }, [salary, staff]);

  function askPin(title: string, action: () => void) {
    setPin({ open: true, title, action });
  }

  return (
    <div>
      <PageHeader
        title="Staff Management"
        subtitle="Attendance, salary, advances and staff katha — daily salary is monthly salary ÷ 30"
        action={
          <div className="flex gap-2">
            <PrintButton title={`Staff Report ${month}`} />
            <Button size="sm" className="no-print" onClick={() => setForm({ ...emptyForm })}><Plus className="h-4 w-4 mr-1" /> Add Staff</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-4">
        <Stat label="Total Staff" value={String(totals.staff)} />
        <Stat label="Monthly Salary" value={money(totals.monthly)} />
        <Stat label="Salary Paid" value={money(totals.paid)} />
        <Stat label="Remaining Salary" value={money(totals.remaining)} />
        <Stat label="Total Advance" value={money(totals.advance)} />
        <Stat label="Salary Deduction" value={money(totals.deduction)} />
        <Stat label="Staff Katha Outstanding" value={money(totals.katha)} />
      </div>

      <div className="no-print flex flex-wrap items-end gap-3 mb-3">
        <div className="space-y-1">
          <Label className="text-xs">Attendance Date</Label>
          <Input type="date" className="w-[180px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Salary Month</Label>
          <Input type="month" className="w-[180px]" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => mark.mutate(staff.map((s) => ({ staff_id: s.id, status: "present" as const })))}>Present All</Button>
          <Button size="sm" variant="outline" onClick={() => mark.mutate(staff.map((s) => ({ staff_id: s.id, status: "absent" as const })))}>Absent All</Button>
        </div>
      </div>

      {/* Staff + salary table */}
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="text-left p-2">Staff</th>
              <th className="text-left p-2">Mobile</th>
              <th className="text-right p-2">Monthly</th>
              <th className="text-center p-2">Attendance ({date})</th>
              <th className="text-right p-2">Present</th>
              <th className="text-right p-2">Absent</th>
              <th className="text-right p-2">Deduction</th>
              <th className="text-right p-2">Advance</th>
              <th className="text-right p-2">Paid</th>
              <th className="text-right p-2">Katha Purchases</th>
              <th className="text-right p-2">Remaining</th>
              <th className="text-right p-2">Katha</th>
              <th className="text-right p-2 no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <tr><td colSpan={13} className="p-4 text-center text-muted-foreground">No staff yet</td></tr>}
            {staff.map((s) => {
              const r = salaryMap[s.id];
              const a = attMap[s.id];
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.father_name ? `s/o ${s.father_name} · ` : ""}Joined {s.joining_date}
                      {s.status !== "active" && <Badge variant="outline" className="ml-2">Inactive</Badge>}
                    </div>
                  </td>
                  <td className="p-2">{s.phone ?? "—"}</td>
                  <td className="p-2 text-right">{money(s.monthly_salary)}</td>
                  <td className="p-2">
                    <div className="flex justify-center gap-1 no-print">
                      <Button size="sm" variant={a === "present" ? "default" : "outline"} onClick={() => mark.mutate([{ staff_id: s.id, status: "present" }])}><Check className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant={a === "absent" ? "destructive" : "outline"} onClick={() => mark.mutate([{ staff_id: s.id, status: "absent" }])}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="hidden print:block text-center">{a ?? "—"}</div>
                  </td>
                  <td className="p-2 text-right">{r?.present_days ?? 0}</td>
                  <td className="p-2 text-right">{r?.absent_days ?? 0}</td>
                  <td className="p-2 text-right">{money(r?.deduction ?? 0)}</td>
                  <td className="p-2 text-right">{money(r?.advance_taken ?? 0)}</td>
                  <td className="p-2 text-right">{money(r?.salary_paid ?? 0)}</td>
                  <td className="p-2 text-right">{money(r?.katha_purchases ?? 0)}</td>
                  <td className={`p-2 text-right font-medium ${n(r?.remaining_salary) < 0 ? "text-destructive" : ""}`}>{money(r?.remaining_salary ?? 0)}</td>
                  <td className="p-2 text-right">{money(s.katha_balance)}</td>
                  <td className="p-2 no-print">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" title="Pay Salary" onClick={() => setPayDialog({ staff: s, kind: "salary" })}><Banknote className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" title="Advance" onClick={() => setPayDialog({ staff: s, kind: "advance" })}><Wallet className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" title="Receive Katha Payment" onClick={() => setPayDialog({ staff: s, kind: "katha_receipt" })}><HandCoins className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" title="Edit" onClick={() => askPin("Owner PIN required to edit staff", () => setForm({
                        id: s.id, name: s.name, father_name: s.father_name ?? "", phone: s.phone ?? "", cnic: s.cnic ?? "",
                        joining_date: s.joining_date, monthly_salary: n(s.monthly_salary), status: s.status, notes: s.notes ?? "", opening_katha: n(s.opening_katha),
                      }))}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" title="Delete" onClick={() => askPin("Owner PIN required to delete staff", () => removeStaff.mutate(s.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Staff Katha report */}
      <Card className="mt-4 overflow-auto">
        <div className="p-3 text-sm font-semibold">Staff Katha Report</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="text-left p-2">Staff</th>
              <th className="text-right p-2">Opening Katha</th>
              <th className="text-right p-2">New Purchases (credit)</th>
              <th className="text-right p-2">Payments Received ({month})</th>
              <th className="text-right p-2">Current Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.name}</td>
                <td className="p-2 text-right">{money(s.opening_katha)}</td>
                <td className="p-2 text-right">{money(purchasesMap[s.id] ?? 0)}</td>
                <td className="p-2 text-right">{money(receiptsMap[s.id] ?? 0)}</td>
                <td className="p-2 text-right font-medium">{money(s.katha_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Payment history */}
      <Card className="mt-4 overflow-auto">
        <div className="p-3 text-sm font-semibold">Payment History ({month})</div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Staff</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Method</th>
              <th className="text-left p-2">Remark</th>
              <th className="text-right p-2">Amount</th>
              <th className="text-right p-2 no-print">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No payments this month</td></tr>}
            {(payments as any[]).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{p.date}</td>
                <td className="p-2">{staff.find((s) => s.id === p.staff_id)?.name ?? "—"}</td>
                <td className="p-2">{p.kind === "salary" ? "Salary" : p.kind === "advance" ? "Advance" : "Katha Received"}</td>
                <td className="p-2 capitalize">{p.payment_method}</td>
                <td className="p-2">{p.remark ?? "—"}</td>
                <td className="p-2 text-right">{money(p.amount)}</td>
                <td className="p-2 text-right no-print">
                  <Button size="sm" variant="outline" onClick={() => askPin("Owner PIN required to delete a payment", async () => {
                    const { error } = await supabase.rpc("staff_payment_delete" as any, { _payment_id: p.id });
                    if (error) { toast.error(error.message); return; }
                    toast.success("Payment removed");
                    qc.invalidateQueries({ queryKey: ["staff"] });
                    qc.invalidateQueries({ queryKey: ["cash_movements"] });
                    qc.invalidateQueries({ queryKey: ["daily_closing"] });
                  })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Staff form */}
      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{form?.id ? "Edit Staff" : "Add Staff"}</DialogTitle></DialogHeader>
          {form && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Father Name (optional)"><Input value={form.father_name} onChange={(e) => setForm({ ...form, father_name: e.target.value })} /></Field>
              <Field label="Mobile Number"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="CNIC (optional)"><Input value={form.cnic} onChange={(e) => setForm({ ...form, cnic: e.target.value })} /></Field>
              <Field label="Joining Date"><Input type="date" value={form.joining_date} onChange={(e) => setForm({ ...form, joining_date: e.target.value })} /></Field>
              <Field label="Monthly Salary"><Input type="number" min={0} value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: Number(e.target.value) || 0 })} /></Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Opening Katha"><Input type="number" min={0} value={form.opening_katha} onChange={(e) => setForm({ ...form, opening_katha: Number(e.target.value) || 0 })} /></Field>
              <div className="sm:col-span-2">
                <Field label="Notes"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={() => form && saveStaff.mutate(form)} disabled={saveStaff.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PayDialog
        open={!!payDialog}
        info={payDialog}
        onClose={() => setPayDialog(null)}
        onSaved={() => {
          setPayDialog(null);
          qc.invalidateQueries({ queryKey: ["staff"] });
          qc.invalidateQueries({ queryKey: ["cash_movements"] });
          qc.invalidateQueries({ queryKey: ["daily_closing"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />

      <StockPinDialog
        open={pin.open}
        onOpenChange={(v) => setPin((p) => ({ ...p, open: v }))}
        onConfirm={() => pin.action?.()}
        title={pin.title}
        description="This action is protected. Enter the PIN to continue."
      />
    </div>
  );
}

function nextMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function PayDialog({ open, info, onClose, onSaved }: {
  open: boolean;
  info: null | { staff: Staff; kind: "salary" | "advance" | "katha_receipt" };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState<number | "">("");
  const [method, setMethod] = useState<"cash" | "online">("cash");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);

  const title = info?.kind === "salary" ? "Pay Salary" : info?.kind === "advance" ? "Advance Salary" : "Receive Katha Payment";

  async function submit() {
    if (!info) return;
    if (!amount || Number(amount) <= 0) { toast.error("Enter an amount"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("staff_pay" as any, {
        _staff_id: info.staff.id,
        _kind: info.kind,
        _amount: Number(amount),
        _method: method,
        _remark: remark || null,
        _date: businessToday(),
      });
      if (error) throw error;
      toast.success(`${title} saved`);
      setAmount(""); setRemark(""); setMethod("cash");
      onSaved();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}{info ? ` — ${info.staff.name}` : ""}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="Amount">
            <Input type="number" min={0} autoFocus value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))} />
          </Field>
          <Field label="Payment Method">
            <div className="grid grid-cols-2 gap-2">
              <Button variant={method === "cash" ? "default" : "outline"} onClick={() => setMethod("cash")}>Cash</Button>
              <Button variant={method === "online" ? "default" : "outline"} onClick={() => setMethod("online")}>Online</Button>
            </div>
          </Field>
          <Field label="Remark"><Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" /></Field>
          <p className="text-[11px] text-muted-foreground">
            {info?.kind === "katha_receipt"
              ? "Creates a Money Movement IN and reduces the staff katha balance."
              : "Creates a Money Movement OUT and updates the salary calculation."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
