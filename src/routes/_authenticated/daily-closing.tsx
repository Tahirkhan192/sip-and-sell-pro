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
import { money, today } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/daily-closing")({ component: Page });

type Summary = {
  closing_date: string;
  opening_cash: number; opening_wallet: number;
  cash_sales: number; online_sales: number; katha: number;
  cash_in: number; cash_out: number;
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
  const [date, setDate] = useState(today());
  const [actualCash, setActualCash] = useState<string>("");
  const [actualWallet, setActualWallet] = useState<string>("");
  const [notes, setNotes] = useState("");

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

  const { data: history = [] } = useQuery({
    queryKey: ["daily_closing", "history"],
    queryFn: async () => (await supabase.from("daily_closings" as any).select("*").order("closing_date", { ascending: false }).limit(30)).data ?? [],
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

  const cashDiff = useMemo(() => (actualCash === "" || !summary ? null : Number(actualCash) - summary.expected_cash), [actualCash, summary]);
  const walletDiff = useMemo(() => (actualWallet === "" || !summary ? null : Number(actualWallet) - summary.expected_wallet), [actualWallet, summary]);

  function statusBadge(diff: number | null) {
    if (diff === null) return <Badge variant="outline">Pending</Badge>;
    if (Math.abs(diff) < 0.01) return <Badge className="bg-emerald-600 hover:bg-emerald-600">Balanced</Badge>;
    if (diff < 0) return <Badge variant="destructive">Short {money(Math.abs(diff))}</Badge>;
    return <Badge className="bg-amber-500 hover:bg-amber-500">Excess {money(diff)}</Badge>;
  }

  if (!summary) return <div>Loading…</div>;

  return (
    <div>
      <PageHeader title="Daily Closing" subtitle="One closing record per business date — cash & wallet reconciliation" />

      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <div className="space-y-1"><Label className="text-xs">Business Date</Label><Input type="date" className="w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>

      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Opening (from previous day closing)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Opening Cash" value={money(summary.opening_cash)} />
          <Stat label="Opening Wallet" value={money(summary.opening_wallet)} />
          <Stat label="Invoices" value={String(summary.invoices)} />
          <Stat label="Added To Katha" value={money(summary.katha)} tone="muted" />
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <h3 className="text-sm font-semibold mb-3">Today's Activity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Cash Sales" value={money(summary.cash_sales)} tone="success" />
          <Stat label="Online Sales" value={money(summary.online_sales)} tone="success" />
          <Stat label="Cash In" value={money(summary.cash_in)} tone="success" />
          <Stat label="Cash Out" value={money(summary.cash_out)} tone="danger" />
          <Stat label="Cash Expenses" value={money(summary.cash_expenses)} tone="danger" />
          <Stat label="Online Expenses" value={money(summary.online_expenses)} tone="danger" />
          <Stat label="Expected Cash" value={money(summary.expected_cash)} />
          <Stat label="Expected Wallet" value={money(summary.expected_wallet)} />
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
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{summary.closed ? "Update Closing" : "Save Closing"}</Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-2">Recent Closings</h3>
        <div className="text-xs">
          {(history as any[]).length === 0 && <div className="text-muted-foreground">None yet.</div>}
          <div className="divide-y">
            {(history as any[]).map((h) => (
              <div key={h.id} className="flex justify-between py-2">
                <button className="underline" onClick={() => setDate(h.closing_date)}>{h.closing_date}</button>
                <div>Cash {money(h.actual_cash)} · Wallet {money(h.actual_wallet)}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
