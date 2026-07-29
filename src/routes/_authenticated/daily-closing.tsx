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
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/format";
import { toast } from "sonner";
import { businessDayEndUTC, businessDayStartUTC, businessToday } from "@/lib/business-date";
import { useReportEngine } from "@/lib/report-engine";

export const Route = createFileRoute("/_authenticated/daily-closing")({ component: Page });

type Summary = {
  closing_date: string;
  opening_cash: number; opening_wallet: number;
  cash_sales: number; online_sales: number; katha: number;
  cash_in: number; cash_out: number;
  online_in: number; online_out: number;
  cash_expenses: number; online_expenses: number;
  invoices: number;
  expected_cash: number; expected_wallet: number;
  actual_cash: number | null; actual_wallet: number | null;
  closed: boolean; notes: string | null;
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" | "muted" }) {
  const cls = tone === "danger" ? "text-destructive" : tone === "success" ? "text-emerald-600" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function Page() {
  const qc = useQueryClient();
  const [date, setDate] = useState(businessToday());
  const [actualCash, setActualCash] = useState<string>("");
  const [actualWallet, setActualWallet] = useState<string>("");
  const [notes, setNotes] = useState("");
  const { data: report } = useReportEngine({ from: date, to: date, startUTC: businessDayStartUTC(date), endExclusiveUTC: businessDayEndUTC(date) });

  const { data: summary } = useQuery<Summary>({
    queryKey: ["daily_closing", date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("daily_closing_summary" as any, { _date: date });
      if (error) throw error;
      const s = data as unknown as Summary;
      setActualCash(s.actual_cash === null ? "" : String(s.actual_cash));
      setActualWallet(s.actual_wallet === null ? "" : String(s.actual_wallet));
      setNotes(s.notes ?? "");
      return s;
    },
  });

  const displaySummary = useMemo<Summary | undefined>(() => {
    if (!summary) return undefined;
    if (!report) return summary;
    return {
      ...summary,
      cash_sales: report.totalCashPaid,
      online_sales: report.totalOnlinePaid,
      katha: report.kathaAmount,
      invoices: report.totalInvoices,
      expected_cash: summary.opening_cash + report.totalCashPaid + summary.cash_in - summary.cash_out - summary.cash_expenses,
      expected_wallet: summary.opening_wallet + report.totalOnlinePaid + summary.online_in - summary.online_out - summary.online_expenses,
    };
  }, [report, summary]);

  const { data: history = [] } = useQuery({
    queryKey: ["daily_closing", "history"],
    queryFn: async () => (await supabase.from("daily_closings" as any).select("*").order("closing_date", { ascending: false }).range(0, 99999)).data ?? [],
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        closing_date: date,
        actual_cash: Number(actualCash || 0),
        actual_wallet: Number(actualWallet || 0),
        notes: notes || null,
        closed_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("daily_closings" as any).upsert(payload, { onConflict: "closing_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Daily closing saved");
      qc.invalidateQueries({ queryKey: ["daily_closing"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cashDiff = useMemo(() => (actualCash === "" || !displaySummary ? null : Number(actualCash) - displaySummary.expected_cash), [actualCash, displaySummary]);
  const walletDiff = useMemo(() => (actualWallet === "" || !displaySummary ? null : Number(actualWallet) - displaySummary.expected_wallet), [actualWallet, displaySummary]);

  function statusBadge(diff: number | null) {
    if (diff === null) return <Badge variant="outline">Pending</Badge>;
    if (Math.abs(diff) < 0.01) return <Badge className="bg-emerald-600 hover:bg-emerald-600">Balanced</Badge>;
    if (diff < 0) return <Badge variant="destructive">Short {money(Math.abs(diff))}</Badge>;
    return <Badge className="bg-amber-500 hover:bg-amber-500">Excess {money(diff)}</Badge>;
  }

  if (!displaySummary) return <div>Loading…</div>;

  return (
    <div>
      <PageHeader title="Daily Closing" subtitle="One closing record per business date — cash & wallet reconciliation" action={<PrintButton title={`Daily Closing ${date}`} />} />

      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div className="space-y-1"><Label className="text-xs">Business Date</Label><Input type="date" className="w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Opening (from previous day closing)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Opening Cash" value={money(displaySummary.opening_cash)} />
          <Stat label="Opening Wallet" value={money(displaySummary.opening_wallet)} />
          <Stat label="Invoices" value={String(displaySummary.invoices)} />
          <Stat label="Added To Katha" value={money(displaySummary.katha)} tone="muted" />
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Today's Activity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Cash Sales" value={money(displaySummary.cash_sales)} tone="success" />
          <Stat label="Online Sales" value={money(displaySummary.online_sales)} tone="success" />
          <Stat label="Cash In" value={money(displaySummary.cash_in)} tone="success" />
          <Stat label="Cash Out" value={money(displaySummary.cash_out)} tone="danger" />
          <Stat label="Online In" value={money(displaySummary.online_in ?? 0)} tone="success" />
          <Stat label="Online Out" value={money(displaySummary.online_out ?? 0)} tone="danger" />
          <Stat label="Cash Expenses" value={money(displaySummary.cash_expenses)} tone="danger" />
          <Stat label="Online Expenses" value={money(displaySummary.online_expenses)} tone="danger" />
          <Stat label="Expected Cash" value={money(displaySummary.expected_cash)} />
          <Stat label="Expected Wallet" value={money(displaySummary.expected_wallet)} />
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Actual (enter what you counted)</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Actual Cash Available</Label>
            <Input type="number" step="0.01" placeholder="" value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
          </div>
          <div className="space-y-1"><Label>Actual Online Wallet</Label>
            <Input type="number" step="0.01" placeholder="" value={actualWallet} onChange={(e) => setActualWallet(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1 mt-3"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
          <Stat label="Cash Difference" value={cashDiff === null ? "—" : money(cashDiff)} tone={cashDiff === null ? undefined : Math.abs(cashDiff) < 0.01 ? "success" : cashDiff < 0 ? "danger" : "muted"} />
          <div><div className="text-xs text-muted-foreground">Cash Status</div><div>{statusBadge(cashDiff)}</div></div>
          <Stat label="Wallet Difference" value={walletDiff === null ? "—" : money(walletDiff)} tone={walletDiff === null ? undefined : Math.abs(walletDiff) < 0.01 ? "success" : walletDiff < 0 ? "danger" : "muted"} />
          <div><div className="text-xs text-muted-foreground">Wallet Status</div><div>{statusBadge(walletDiff)}</div></div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{displaySummary.closed ? "Update Closing" : "Save Closing"}</Button>
        </div>
      </Card>

      {/* Grand Totals: Expected vs Actual vs Difference */}
      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Grand Totals</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground mb-2">EXPECTED</div>
            <div className="flex justify-between"><span>Expected Cash</span><span>{money(displaySummary.expected_cash)}</span></div>
            <div className="flex justify-between"><span>Expected Online</span><span>{money(displaySummary.expected_wallet)}</span></div>
            <div className="flex justify-between font-semibold border-t mt-2 pt-2"><span>Grand Total</span><span>{money(displaySummary.expected_cash + displaySummary.expected_wallet)}</span></div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-muted-foreground mb-2">ACTUAL</div>
            <div className="flex justify-between"><span>Actual Cash</span><span>{actualCash === "" ? "—" : money(Number(actualCash))}</span></div>
            <div className="flex justify-between"><span>Actual Online</span><span>{actualWallet === "" ? "—" : money(Number(actualWallet))}</span></div>
            <div className="flex justify-between font-semibold border-t mt-2 pt-2"><span>Grand Total</span><span>{actualCash === "" || actualWallet === "" ? "—" : money(Number(actualCash) + Number(actualWallet))}</span></div>
          </div>
          {(() => {
            const hasBoth = actualCash !== "" && actualWallet !== "";
            const totalExpected = displaySummary.expected_cash + displaySummary.expected_wallet;
            const totalActual = hasBoth ? Number(actualCash) + Number(actualWallet) : 0;
            const diff = hasBoth ? totalActual - totalExpected : null;
            const tone = diff === null ? "muted" : Math.abs(diff) < 0.01 ? "success" : diff < 0 ? "danger" : "muted";
            const label = diff === null ? "Pending" : Math.abs(diff) < 0.01 ? "Balanced" : diff < 0 ? `Short ${money(Math.abs(diff))}` : `Excess ${money(diff)}`;
            const badgeCls = diff === null ? "" : Math.abs(diff) < 0.01 ? "bg-emerald-600 hover:bg-emerald-600" : diff < 0 ? "" : "bg-amber-500 hover:bg-amber-500";
            return (
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground mb-2">DIFFERENCE</div>
                <div className="flex justify-between"><span>Grand Total Expected</span><span>{money(totalExpected)}</span></div>
                <div className="flex justify-between"><span>Grand Total Actual</span><span>{hasBoth ? money(totalActual) : "—"}</span></div>
                <div className="flex justify-between font-semibold border-t mt-2 pt-2">
                  <span>Grand Total Difference</span>
                  <span className={tone === "success" ? "text-emerald-600" : tone === "danger" ? "text-destructive" : ""}>
                    {diff === null ? "—" : money(diff)}
                  </span>
                </div>
                <div className="mt-2">
                  {diff === null ? <Badge variant="outline">Pending</Badge> : <Badge variant={diff < 0 && Math.abs(diff) >= 0.01 ? "destructive" : "default"} className={badgeCls}>{label}</Badge>}
                </div>
              </div>
            );
          })()}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Actual Cash Sales {money(displaySummary.cash_sales)} · Cash In {money(displaySummary.cash_in)} · Cash Out {money(displaySummary.cash_out)}<br />
          Actual Online Sales {money(displaySummary.online_sales)} · Online In {money(displaySummary.online_in ?? 0)} · Online Out {money(displaySummary.online_out ?? 0)}<br />
          <span className="italic">Online Sales and Wallet Exchange (Money Movement) are tracked separately — never mixed.</span>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Recent Closings</h3>
        <div className="text-xs">
          {(history as any[]).length === 0 && <div className="text-muted-foreground">None yet.</div>}
          <div className="divide-y">
            {(history as any[]).map((h) => {
              const t = h.closed_at ? new Date(h.closed_at) : null;
              const timeStr = t ? t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
              return (
                <div key={h.id} className="flex justify-between py-2 gap-2">
                  <button className="underline" onClick={() => setDate(h.closing_date)}>{h.closing_date}</button>
                  <div className="text-muted-foreground">Closed at {timeStr}</div>
                  <div>Cash {money(h.actual_cash)} · Wallet {money(h.actual_wallet)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
