import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/format";
import { businessToday, formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/staff_/$staffId")({
  component: StaffDetailPage,
  head: () => ({
    meta: [
      { title: "Staff Detail | Sip & Sell Pro POS" },
      { name: "description", content: "Complete staff profile with salary, attendance, POS katha purchases, payment history and balances." },
      { property: "og:title", content: "Staff Detail | Sip & Sell Pro POS" },
      { property: "og:description", content: "Salary, attendance, POS purchase history and payments for a single staff member." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const n = (v: any) => Number(v ?? 0) || 0;

type SalaryRow = {
  staff_id: string; name: string; monthly_salary: number; present_days: number; absent_days: number;
  deduction: number; advance_taken: number; salary_paid: number; katha_purchases: number; carry_in: number;
  prev_remaining: number; prev_advance: number; payment_this_month: number; katha_this_month: number;
  remaining_salary: number; katha_balance: number;
};

function nextMonth(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, "0")}-01`;
}

function StaffDetailPage() {
  const { staffId } = Route.useParams();
  const [month, setMonth] = useState(() => businessToday().slice(0, 7));

  const { data: staff } = useQuery({
    queryKey: ["staff", "one", staffId],
    queryFn: async () => (await supabase.from("staff" as any).select("*").eq("id", staffId).maybeSingle()).data as any,
  });

  const { data: salary } = useQuery({
    queryKey: ["staff", "salary", month, staffId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("staff_salary_summary" as any, { _month: `${month}-01` });
      if (error) throw error;
      return ((data ?? []) as unknown as SalaryRow[]).find((r) => r.staff_id === staffId) ?? null;
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["staff", "payments", "all", staffId],
    queryFn: async () => ((await supabase.from("staff_payments" as any).select("*").eq("staff_id", staffId)
      .order("date", { ascending: false }).order("created_at", { ascending: false })).data ?? []) as any[],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["staff", "invoices", staffId],
    queryFn: async () => ((await supabase.from("sales")
      .select("id, invoice_no, sale_date, status, grand_total, cash_paid, online_paid, katha, discount_amount, sale_items(quantity, price, total, products(name))")
      .eq("staff_id", staffId).is("deleted_at", null).eq("hidden", false)
      .order("sale_date", { ascending: false })).data ?? []) as any[],
  });

  const { data: absentDays = [] } = useQuery({
    queryKey: ["staff", "attendance", "month", month, staffId],
    queryFn: async () => ((await supabase.from("staff_attendance" as any).select("date,status")
      .eq("staff_id", staffId).eq("status", "absent")
      .gte("date", `${month}-01`).lt("date", nextMonth(month)).order("date")).data ?? []) as any[],
  });

  const dailySalary = n(staff?.monthly_salary) / 30;

  const monthPayments = useMemo(
    () => (payments as any[]).filter((p) => p.date >= `${month}-01` && p.date < nextMonth(month)),
    [payments, month],
  );

  if (!staff) return <div className="p-4 text-muted-foreground">Loading staff…</div>;

  return (
    <div className="space-y-4 print-area">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link to="/staff" className="no-print inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Staff
          </Link>
          <h1 className="truncate text-xl font-semibold sm:text-2xl">{staff.name}</h1>
          <p className="text-xs text-muted-foreground">
            {staff.role ?? "Staff"} · {staff.phone ?? "No mobile"} · Joined {staff.joining_date}
            {staff.status !== "active" && <Badge variant="outline" className="ml-2">Inactive</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="no-print space-y-1">
            <Label className="text-xs">Salary Month</Label>
            <Input type="month" className="h-9 w-[150px]" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <PrintButton title={`Staff Detail - ${staff.name} - ${month}`} />
        </div>
      </div>

      {/* Profile + salary snapshot */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Mobile Number" value={staff.phone ?? "—"} />
        <Stat label="Position" value={staff.role ?? "Staff"} />
        <Stat label="Joining Date" value={staff.joining_date} />
        <Stat label="Monthly Salary" value={money(staff.monthly_salary)} />
        <Stat label="Daily Base Salary" value={money(calc?.dailyBase ?? dailySalary)} />
        <Stat label="Status" value={staff.status === "active" ? "Active" : "Inactive"} />
        <Stat label="Present Days" value={String(calc?.presentDays ?? 0)} />
        <Stat label="Absent Days" value={String(calc?.absentDays ?? 0)} />
        <Stat label="Opening Balance" value={money(calc?.openingBalance ?? 0)} />
        <Stat label="Actual Earned Salary" value={money(calc?.earnedSalary ?? 0)} />
        <Stat label="Salary Paid" value={money(calc?.salaryPaid ?? 0)} />
        <Stat label="POS Amounts" value={money(calc?.posAmount ?? 0)} />
        <Stat label="Received From Member" value={money(calc?.receivedAmount ?? 0)} />
        <Stat label="Remaining Salary" value={money(calc?.remainingSalary ?? 0)} />
        <Stat label="Actual Remaining Salary" value={money(calc?.actualRemainingSalary ?? 0)} highlight />
        <Stat label="Staff Katha Balance" value={money(staff.katha_balance)} />
      </div>

      {/* Opening balance carried from last month — automatic, adjustable */}
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Opening Balance for {month}</div>
            <div className="text-sm font-semibold">
              {money(calc?.openingBalance ?? 0)}{" "}
              <span className="text-[11px] font-normal text-muted-foreground">
                {calc?.openingManual ? "(manually set)" : "(carried automatically from last month)"}
              </span>
            </div>
          </div>
          <div className="no-print space-y-1">
            <Label className="text-xs">Adjust opening balance</Label>
            <Input
              type="number"
              className="h-9 w-[160px]"
              value={openingEdit}
              onChange={(e) => setOpeningEdit(e.target.value)}
              placeholder={String(calc?.openingBalance ?? 0)}
            />
          </div>
          <Button className="no-print" onClick={() => saveOpening.mutate()} disabled={saveOpening.isPending}>Save Opening</Button>
        </div>
      </Card>



      {/* POS purchase history */}
      <Card className="overflow-hidden">
        <div className="border-b px-3 py-2 text-sm font-semibold">POS Purchase History</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Invoice</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Products</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Discount</th>
                <th className="p-2 text-right">Grand Total</th>
                <th className="p-2 text-right">Staff Katha</th>
                <th className="p-2 text-right">Cash</th>
                <th className="p-2 text-right">Online</th>
                <th className="p-2 text-right">Remaining</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan={12} className="p-4 text-center text-muted-foreground">No POS purchases</td></tr>}
              {(invoices as any[]).map((s) => {
                const items = (s.sale_items ?? []) as any[];
                const qty = items.reduce((a, i) => a + n(i.quantity), 0);
                const rem = Math.max(0, n(s.grand_total) - n(s.cash_paid) - n(s.online_paid));
                return (
                  <tr key={s.id} className="border-t align-top">
                    <td className="p-2 font-medium whitespace-nowrap">{s.invoice_no}</td>
                    <td className="p-2 whitespace-nowrap">{formatBusinessDate(s.sale_date)}</td>
                    <td className="p-2 whitespace-nowrap">{formatBusinessTime(s.sale_date)}</td>
                    <td className="p-2 min-w-[180px]">
                      {items.map((i, idx) => (
                        <div key={idx} className="text-xs">
                          {i.products?.name ?? "Item"} × {n(i.quantity)}
                        </div>
                      ))}
                    </td>
                    <td className="p-2 text-right">{qty}</td>
                    <td className="p-2 text-right">{money(s.discount_amount)}</td>
                    <td className="p-2 text-right font-medium">{money(s.grand_total)}</td>
                    <td className="p-2 text-right">{s.katha ? money(rem) : money(0)}</td>
                    <td className="p-2 text-right">{money(s.cash_paid)}</td>
                    <td className="p-2 text-right">{money(s.online_paid)}</td>
                    <td className="p-2 text-right">{money(rem)}</td>
                    <td className="p-2 capitalize">{s.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Payment / salary history */}
      <Card className="overflow-hidden">
        <div className="border-b px-3 py-2 text-sm font-semibold">Salary &amp; Payment History</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Time</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Payment Method</th>
                <th className="p-2 text-right">Cash</th>
                <th className="p-2 text-right">Online</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">No payments recorded</td></tr>}
              {(payments as any[]).map((p) => {
                const isCash = p.payment_method === "cash";
                return (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{p.date}</td>
                    <td className="p-2 whitespace-nowrap">{p.created_at ? formatBusinessTime(p.created_at) : "—"}</td>
                    <td className="p-2">{p.kind === "salary" ? "Salary" : p.kind === "advance" ? "Advance" : "Katha Received"}</td>
                    <td className="p-2 capitalize">{p.payment_method}</td>
                    <td className="p-2 text-right">{isCash ? money(p.amount) : money(0)}</td>
                    <td className="p-2 text-right">{isCash ? money(0) : money(p.amount)}</td>
                    <td className="p-2 text-right font-medium">{money(p.amount)}</td>
                    <td className="p-2">{p.remark ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between border-t px-3 py-2 text-sm font-semibold">
          <span>Total Paid in {month}</span>
          <span>{money(monthPayments.reduce((a, p) => a + n(p.amount), 0))}</span>
        </div>
      </Card>

      {/* Attendance */}
      <Card className="overflow-hidden">
        <div className="border-b px-3 py-2 text-sm font-semibold">Attendance ({month}) — present by default, absences listed below</div>
        <div className="p-3 text-sm">
          {absentDays.length === 0 ? (
            <span className="text-muted-foreground">No absences recorded this month.</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {(absentDays as any[]).map((a) => (
                <Badge key={a.date} variant="destructive" className="font-normal">{a.date}</Badge>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={"mt-0.5 truncate text-sm font-semibold " + (highlight ? "text-primary" : "")}>{value}</div>
    </Card>
  );
}
