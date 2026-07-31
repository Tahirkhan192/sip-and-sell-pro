import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { StockPinDialog } from "@/components/StockPinDialog";
import { money } from "@/lib/format";
import { businessToday } from "@/lib/business-date";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/digi-katha-closing")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Digi Katha Closing | Sip & Sell Pro POS" },
      { name: "description", content: "Track loan to get and loan to give per business date — opening balances, katha sales, katha purchases, katha expenses and cash loans." },
      { property: "og:title", content: "Digi Katha Closing | Sip & Sell Pro POS" },
      { property: "og:description", content: "Daily katha loan book: opening balances plus expected loan to get and loan to give by business date." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Summary = {
  business_date: string;
  opening_loan_to_get: number;
  opening_loan_to_give: number;
  previous_loan_to_get: number;
  previous_loan_to_give: number;
  katha_sales: number;
  loan_given: number;
  loan_recovered: number;
  purchase_katha: number;
  expense_katha: number;
  loan_taken: number;
  loan_repaid: number;
  expected_loan_to_get: number;
  expected_loan_to_give: number;
};

function Row({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "get" | "give" }) {
  return (
    <div className={`flex justify-between py-1.5 ${strong ? "border-t mt-2 pt-2 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? (tone === "get" ? "text-emerald-600" : "text-destructive") : ""}>{money(value)}</span>
    </div>
  );
}

function OpeningBalanceCard() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [get, setGet] = useState<number | "">("");
  const [give, setGive] = useState<number | "">("");
  const [asOf, setAsOf] = useState(businessToday());
  const [note, setNote] = useState("");

  const { data } = useQuery({
    queryKey: ["katha_opening"],
    queryFn: async () => (await supabase.from("katha_opening" as any).select("*").eq("id", 1).maybeSingle()).data as any,
  });

  useEffect(() => {
    if (!data) return;
    setGet(Number(data.opening_loan_to_get) || 0);
    setGive(Number(data.opening_loan_to_give) || 0);
    setAsOf(data.as_of_date ?? businessToday());
    setNote(data.note ?? "");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("katha_opening" as any).upsert({
        id: 1,
        opening_loan_to_get: Number(get) || 0,
        opening_loan_to_give: Number(give) || 0,
        as_of_date: asOf,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Opening Digi Katha balance saved");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["katha_opening"] });
      qc.invalidateQueries({ queryKey: ["digi_katha"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="p-4 text-sm mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Opening Digi Katha Balance</h3>
          <p className="text-[11px] text-muted-foreground">
            Permanent starting balances from before the system was used. These are not daily transactions.
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" className="no-print" onClick={() => setPinOpen(true)}>
            <Lock className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-3">
        <div className="space-y-1">
          <Label className="text-xs">Opening Loan To Get</Label>
          <Input type="number" min={0} disabled={!editing} value={get} onChange={(e) => setGet(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Opening Loan To Give</Label>
          <Input type="number" min={0} disabled={!editing} value={give} onChange={(e) => setGive(e.target.value === "" ? "" : Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <Input type="date" disabled={!editing} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Input disabled={!editing} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      {editing && (
        <div className="flex justify-end gap-2 mt-3 no-print">
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); if (data) { setGet(Number(data.opening_loan_to_get) || 0); setGive(Number(data.opening_loan_to_give) || 0); } }}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save Opening Balance</Button>
        </div>
      )}

      <StockPinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        onConfirm={() => setEditing(true)}
        title="Owner PIN required"
        description="Editing the Opening Digi Katha Balance is protected. Enter the PIN to continue."
      />
    </Card>
  );
}

function Page() {
  const [date, setDate] = useState(businessToday());

  const { data: s } = useQuery<Summary>({
    queryKey: ["digi_katha", date],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("digi_katha_summary" as any, { _date: date });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  return (
    <div>
      <PageHeader
        title="Digi Katha Closing"
        subtitle="Loan book by business date — opening balances, katha sales, katha purchases/expenses and cash loans"
        action={<PrintButton title={`Digi Katha Closing ${date}`} />}
      />

      <div className="no-print flex flex-wrap gap-2 mb-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Business Date</Label>
          <Input type="date" className="w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <OpeningBalanceCard />

      {!s ? (
        <div>Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Loan To Get (receivable)</h3>
              <Row label="Opening Loan To Get" value={s.opening_loan_to_get ?? 0} />
              <Row label="Previous Loan To Get (incl. opening)" value={s.previous_loan_to_get} />
              <Row label="Today's Added Katha Sales" value={s.katha_sales} />
              <Row label="Today's Loan Given (Katha Out)" value={s.loan_given} />
              <Row label="Less: Loan Recovered Today (Katha In)" value={-s.loan_recovered} />
              <Row label="Current Loan To Get" value={s.expected_loan_to_get} strong tone="get" />
            </Card>

            <Card className="p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Loan To Give (payable)</h3>
              <Row label="Opening Loan To Give" value={s.opening_loan_to_give ?? 0} />
              <Row label="Previous Loan To Give (incl. opening)" value={s.previous_loan_to_give} />
              <Row label="Today's Purchase Katha" value={s.purchase_katha} />
              <Row label="Today's Expense Katha" value={s.expense_katha} />
              <Row label="Today's Loan Taken (Loan Get In)" value={s.loan_taken} />
              <Row label="Less: Loan Paid Today (Loan Paid Out)" value={-s.loan_repaid} />
              <Row label="Current Loan To Give" value={s.expected_loan_to_give} strong tone="give" />
            </Card>
          </div>

          <Card className="p-4 mt-4 text-sm">
            <h3 className="text-sm font-semibold mb-2">Net Katha Position</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Loan To Get − Current Loan To Give</span>
              <span className={`font-semibold ${s.expected_loan_to_get - s.expected_loan_to_give >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {money(s.expected_loan_to_get - s.expected_loan_to_give)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Opening balances are added permanently to the loan book. Money Movement rules: "Katha" Out = new loan given (increases Loan To Get),
              "Katha" In = loan recovered (decreases Loan To Get), "Loan Get" In = money borrowed (increases Loan To Give),
              "Loan Paid" Out = repayment (decreases Loan To Give). "Transaction" movements affect Daily Closing only.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
