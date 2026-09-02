/**
 * Staff salary figures on a fixed 30-day basis.
 *
 * Everything is rebuilt from the records that already exist (staff,
 * attendance, salary payments and POS katha invoices) — no schema change and
 * no stored totals, so it works exactly the same online and offline.
 *
 *   Daily Base Salary      = Monthly Salary ÷ 30
 *   Actual Earned Salary   = Daily Base Salary × Present days (up to today)
 *   Remaining Salary       = Opening + Monthly Salary − Paid − POS + Received
 *   Actual Remaining Salary= Opening + Earned         − Paid − POS + Received
 *
 * A member's Actual Remaining Salary rolls into the next month automatically as
 * the Opening Balance, unless the owner set one manually (staff_month_carry).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { businessDateOf, businessToday } from "@/lib/business-date";

const n = (v: any) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type StaffSalary = {
  staffId: string;
  monthlySalary: number;
  dailyBase: number;
  presentDays: number;
  absentDays: number;
  openingBalance: number;
  openingManual: boolean;
  earnedSalary: number;
  salaryPaid: number;
  posAmount: number;
  receivedAmount: number;
  remainingSalary: number;
  actualRemainingSalary: number;
};

function monthKey(d: string) {
  return d.slice(0, 7);
}
function firstDay(month: string) {
  return `${month}-01`;
}
function lastDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).toISOString().slice(0, 10);
}
function addMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000) + 1);
}

export type StaffSalaryInput = {
  staff: any[];
  attendance: any[];
  payments: any[];
  sales: any[];
  carry: any[];
};

/** Rebuilds every member's month-by-month balances up to the selected month. */
export function computeStaffSalaries(month: string, input: StaffSalaryInput): Record<string, StaffSalary> {
  const today = businessToday();
  const out: Record<string, StaffSalary> = {};

  const absentByStaffMonth: Record<string, number> = {};
  for (const a of input.attendance ?? []) {
    if (a.status !== "absent") continue;
    const key = `${a.staff_id}|${monthKey(String(a.date))}`;
    absentByStaffMonth[key] = (absentByStaffMonth[key] ?? 0) + 1;
  }

  const paidByStaffMonth: Record<string, number> = {};
  const receivedByStaffMonth: Record<string, number> = {};
  for (const p of input.payments ?? []) {
    const key = `${p.staff_id}|${monthKey(String(p.date))}`;
    if (p.kind === "katha_receipt") receivedByStaffMonth[key] = (receivedByStaffMonth[key] ?? 0) + n(p.amount);
    else paidByStaffMonth[key] = (paidByStaffMonth[key] ?? 0) + n(p.amount);
  }

  const posByStaffMonth: Record<string, number> = {};
  for (const s of input.sales ?? []) {
    if (!s.staff_id) continue;
    const owed = Math.max(0, n(s.grand_total) - n(s.cash_paid) - n(s.online_paid));
    if (owed <= 0) continue;
    const key = `${s.staff_id}|${monthKey(businessDateOf(s.sale_date))}`;
    posByStaffMonth[key] = (posByStaffMonth[key] ?? 0) + owed;
  }

  const manualByStaffMonth: Record<string, number> = {};
  for (const c of input.carry ?? []) {
    const key = `${c.staff_id}|${c.year}-${String(c.month).padStart(2, "0")}`;
    manualByStaffMonth[key] = n(c.prev_remaining) - n(c.prev_advance);
  }

  for (const s of input.staff ?? []) {
    const monthly = n(s.monthly_salary);
    const daily = monthly / 30;
    let m = monthKey(String(s.joining_date ?? month));
    if (m > month) m = month;

    let carry = 0;
    let row: StaffSalary | null = null;

    while (m <= month) {
      const key = `${s.id}|${m}`;
      const absent = absentByStaffMonth[key] ?? 0;
      const start = firstDay(m) > String(s.joining_date) ? firstDay(m) : String(s.joining_date);
      const monthEnd = lastDay(m);
      const end = monthEnd < today ? monthEnd : today;
      const elapsed = end < start ? 0 : daysBetween(start, end);
      const present = Math.max(0, elapsed - absent);
      const earned = r2(daily * present);
      const paid = r2(paidByStaffMonth[key] ?? 0);
      const pos = r2(posByStaffMonth[key] ?? 0);
      const received = r2(receivedByStaffMonth[key] ?? 0);

      if (m === month) {
        const manual = manualByStaffMonth[key];
        const opening = manual === undefined ? r2(carry) : r2(manual);
        row = {
          staffId: s.id,
          monthlySalary: monthly,
          dailyBase: r2(daily),
          presentDays: present,
          absentDays: absent,
          openingBalance: opening,
          openingManual: manual !== undefined,
          earnedSalary: earned,
          salaryPaid: paid,
          posAmount: pos,
          receivedAmount: received,
          remainingSalary: r2(opening + monthly - paid - pos + received),
          actualRemainingSalary: r2(opening + earned - paid - pos + received),
        };
      }

      // Next month opens with this month's Actual Remaining Salary.
      carry = r2(carry + earned - paid - pos + received);
      m = addMonth(m);
    }

    if (row) out[s.id] = row;
  }

  return out;
}

async function loadInput(): Promise<StaffSalaryInput> {
  const [staff, attendance, payments, sales, carry] = await Promise.all([
    supabase.from("staff" as any).select("id, name, joining_date, monthly_salary").is("deleted_at", null),
    supabase.from("staff_attendance" as any).select("staff_id, date, status").eq("status", "absent"),
    supabase.from("staff_payments" as any).select("staff_id, date, kind, amount"),
    supabase
      .from("sales")
      .select("staff_id, sale_date, grand_total, cash_paid, online_paid")
      .not("staff_id", "is", null)
      .eq("katha", true)
      .eq("status", "completed")
      .is("deleted_at", null)
      .eq("hidden", false),
    supabase.from("staff_month_carry" as any).select("staff_id, year, month, prev_remaining, prev_advance"),
  ]);
  return {
    staff: (staff.data ?? []) as any[],
    attendance: (attendance.data ?? []) as any[],
    payments: (payments.data ?? []) as any[],
    sales: (sales.data ?? []) as any[],
    carry: (carry.data ?? []) as any[],
  };
}

/** Salary figures for every staff member in the given month ("YYYY-MM"). */
export function useStaffSalaries(month: string) {
  return useQuery({
    queryKey: ["staff", "salary-calc", month],
    queryFn: async () => computeStaffSalaries(month, await loadInput()),
  });
}
