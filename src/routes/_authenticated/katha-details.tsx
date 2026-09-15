import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/format";
import { businessToday } from "@/lib/business-date";

export const Route = createFileRoute("/_authenticated/katha-details")({
  component: Page,
  validateSearch: (s: Record<string, unknown>) => ({
    to: typeof s.to === "string" ? s.to : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Katha Details | Sip & Sell Pro POS" },
      { name: "description", content: "Every katha entry behind the Digi Katha totals — bills, purchases, expenses, delivery expenses and loan movements, listed line by line." },
      { property: "og:title", content: "Katha Details | Sip & Sell Pro POS" },
      { property: "og:description", content: "Line-by-line katha ledger for cross-checking Loan To Get and Loan To Give." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Entry = { id: string; date: string; label: string; party?: string; total?: number; paid?: number; amount: number };
type Entries = {
  from: string;
  to: string;
  cutoff: string;
  katha_sales: Entry[];
  loan_given: Entry[];
  loan_recovered: Entry[];
  purchase_katha: Entry[];
  expense_katha: Entry[];
  delivery_expense_katha: Entry[];
  loan_taken: Entry[];
  loan_repaid: Entry[];
};

type Summary = {
  opening_loan_to_get: number;
  opening_loan_to_give: number;
  expected_loan_to_get: number;
  expected_loan_to_give: number;
};

const sum = (rows: Entry[] = []) => rows.reduce((a, r) => a + Number(r.amount || 0), 0);

function Section({
  title,
  rows,
  negative,
  to,
  showBill,
}: {
  title: string;
  rows: Entry[];
  negative?: boolean;
  to?: string;
  showBill?: boolean;
}) {
  const total = sum(rows);
  return (
    <div className="mb-4">
      <div className="flex justify-between items-baseline">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} <span className="normal-case font-normal">({rows.length})</span>
        </h4>
        <span className={`text-sm font-semibold ${negative ? "text-destructive" : ""}`}>
          {negative ? "−" : ""}
          {money(total)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">No entries</p>
      ) : (
        <div className="mt-1 divide-y text-xs">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1">
              <span className="w-[86px] shrink-0 text-muted-foreground">{r.date}</span>
              <span className="flex-1 min-w-0">
                {to ? (
                  <Link to={to} className="hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
                {r.party ? <span className="text-muted-foreground"> · {r.party}</span> : null}
                {showBill && r.total != null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · bill {money(Number(r.total))} · paid {money(Number(r.paid || 0))}
                  </span>
                ) : null}
              </span>
              <span className={`shrink-0 tabular-nums ${negative ? "text-destructive" : ""}`}>
                {negative ? "−" : ""}
                {money(Number(r.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Page() {
  const search = Route.useSearch();
  const endDefault = search.to ?? businessToday();
  const [to, setTo] = useState(endDefault);
  const [from, setFrom] = useState<string>("");

  const { data: e } = useQuery<Entries>({
    queryKey: ["katha_entries", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("digi_katha_entries" as any, { _from: from || null, _to: to });
      if (error) throw error;
      return data as unknown as Entries;
    },
  });

  const { data: s } = useQuery<Summary>({
    queryKey: ["digi_katha", to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("digi_katha_summary" as any, { _date: to });
      if (error) throw error;
      return data as unknown as Summary;
    },
  });

  const sinceOpening = !from || (e && from <= e.cutoff);

  const listedGet = e ? sum(e.katha_sales) + sum(e.loan_given) - sum(e.loan_recovered) : 0;
  const listedGive = e
    ? sum(e.purchase_katha) + sum(e.expense_katha) + sum(e.delivery_expense_katha) + sum(e.loan_taken) - sum(e.loan_repaid)
    : 0;

  const calcGet = (s?.opening_loan_to_get ?? 0) + listedGet;
  const calcGive = (s?.opening_loan_to_give ?? 0) + listedGive;
  const diffGet = s ? calcGet - s.expected_loan_to_get : 0;
  const diffGive = s ? calcGive - s.expected_loan_to_give : 0;

  return (
    <div>
      <PageHeader
        title="Katha Details"
        subtitle="Every katha entry behind the Digi Katha Closing totals — tick them off one by one"
        action={<PrintButton title={`Katha Details ${from || e?.cutoff || ""} to ${to}`} />}
      />

      <div className="no-print flex flex-wrap gap-2 mb-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <Input type="date" className="w-[170px]" value={from} onChange={(ev) => setFrom(ev.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <Input type="date" className="w-[170px]" value={to} onChange={(ev) => setTo(ev.target.value)} />
        </div>
        <Button size="sm" variant="outline" onClick={() => { setFrom(""); setTo(businessToday()); }}>Today</Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const d = new Date(businessToday());
            d.setDate(d.getDate() - 1);
            const y = d.toISOString().slice(0, 10);
            setFrom(y);
            setTo(y);
          }}
        >
          Yesterday
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setFrom(""); setTo(businessToday()); }}>Since opening</Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/digi-katha-closing">Back to Closing</Link>
        </Button>
      </div>

      {!e ? (
        <div>Loading…</div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground mb-3">
            Showing {e.from} to {e.to}. Only entries on or after the opening date ({e.cutoff}) are counted. Katha bills
            count the unpaid remainder only; staff bills, deleted, hidden and pending bills are excluded; internal
            stock-to-expense transfers are excluded.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">Loan To Get (receivable)</h3>
              <Section title="Katha POS Bills" rows={e.katha_sales} to="/sales" showBill />
              <Section title="Loan Given (Katha Out)" rows={e.loan_given} to="/cash-movements" />
              <Section title="Loan Recovered (Katha In)" rows={e.loan_recovered} to="/cash-movements" negative />
              <div className="border-t pt-2 mt-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opening {sinceOpening ? `(${e.cutoff})` : "(period start)"}</span>
                  <span>{money(s?.opening_loan_to_get ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Listed entries</span>
                  <span>{money(listedGet)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-emerald-600">{money(calcGet)}</span>
                </div>
                {sinceOpening && s ? (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Digi Katha Closing shows</span>
                    <span>{money(s.expected_loan_to_get)}</span>
                  </div>
                ) : null}
                {sinceOpening && s && Math.abs(diffGet) > 0.01 ? (
                  <p className="text-xs text-destructive font-medium">Difference of {money(diffGet)} — an entry may be missing or counted twice.</p>
                ) : null}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3">Loan To Give (payable)</h3>
              <Section title="Katha Purchases" rows={e.purchase_katha} to="/purchases" />
              <Section title="Katha Expenses" rows={e.expense_katha} to="/expenses" />
              <Section title="Katha Delivery Expenses" rows={e.delivery_expense_katha} to="/delivery-expenses" />
              <Section title="Loan Taken (Loan Get In)" rows={e.loan_taken} to="/cash-movements" />
              <Section title="Loan Paid (Loan Paid Out)" rows={e.loan_repaid} to="/cash-movements" negative />
              <div className="border-t pt-2 mt-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Opening {sinceOpening ? `(${e.cutoff})` : "(period start)"}</span>
                  <span>{money(s?.opening_loan_to_give ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Listed entries</span>
                  <span>{money(listedGive)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="text-destructive">{money(calcGive)}</span>
                </div>
                {sinceOpening && s ? (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Digi Katha Closing shows</span>
                    <span>{money(s.expected_loan_to_give)}</span>
                  </div>
                ) : null}
                {sinceOpening && s && Math.abs(diffGive) > 0.01 ? (
                  <p className="text-xs text-destructive font-medium">Difference of {money(diffGive)} — an entry may be missing or counted twice.</p>
                ) : null}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
