import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/CrudHelpers";
import { PrintButton } from "@/components/PrintButton";
import { money } from "@/lib/format";
import { businessToday } from "@/lib/business-date";

export const Route = createFileRoute("/_authenticated/digi-katha-closing")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Digi Katha Closing | Sip & Sell Pro POS" },
      { name: "description", content: "Track loan to get and loan to give per business date — katha sales, katha purchases, katha expenses and cash loans." },
      { property: "og:title", content: "Digi Katha Closing | Sip & Sell Pro POS" },
      { property: "og:description", content: "Daily katha loan book: expected loan to get and loan to give by business date." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Summary = {
  business_date: string;
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
        subtitle="Loan book by business date (8 AM rollover) — katha sales, katha purchases/expenses and cash loans"
        action={<PrintButton title={`Digi Katha Closing ${date}`} />}
      />

      <div className="no-print flex flex-wrap gap-2 mb-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Business Date</Label>
          <Input type="date" className="w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {!s ? (
        <div>Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Loan To Get (receivable)</h3>
              <Row label="Previous Loan To Get" value={s.previous_loan_to_get} />
              <Row label="Today's Added Katha Sales" value={s.katha_sales} />
              <Row label="Today's Loan Given (Katha Out)" value={s.loan_given} />
              <Row label="Less: Loan Recovered Today (Katha In)" value={-s.loan_recovered} />
              <Row label="Expected Loan To Get" value={s.expected_loan_to_get} strong tone="get" />
            </Card>

            <Card className="p-4 text-sm">
              <h3 className="text-sm font-semibold mb-2">Loan To Give (payable)</h3>
              <Row label="Previous Loan To Give" value={s.previous_loan_to_give} />
              <Row label="Today's Purchase Katha" value={s.purchase_katha} />
              <Row label="Today's Expense Katha" value={s.expense_katha} />
              <Row label="Today's Loan Taken (Loan Get In)" value={s.loan_taken} />
              <Row label="Less: Loan Paid Today (Loan Paid Out)" value={-s.loan_repaid} />
              <Row label="Expected Loan To Give" value={s.expected_loan_to_give} strong tone="give" />

            </Card>
          </div>

          <Card className="p-4 mt-4 text-sm">
            <h3 className="text-sm font-semibold mb-2">Net Katha Position</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Loan To Get − Expected Loan To Give</span>
              <span className={`font-semibold ${s.expected_loan_to_get - s.expected_loan_to_give >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {money(s.expected_loan_to_get - s.expected_loan_to_give)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              All figures follow the configured business date. Money Movement rules: "Katha" Out = new loan given (increases Loan To Get),
              "Katha" In = loan recovered (decreases Loan To Get), "Loan Get" In = money borrowed (increases Loan To Give),
              "Loan Paid" Out = repayment (decreases Loan To Give). "Transaction" movements affect Daily Closing only.
            </p>

          </Card>
        </>
      )}
    </div>
  );
}
