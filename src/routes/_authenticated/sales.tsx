import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, num } from "@/lib/format";
import { PageHeader } from "@/components/CrudHelpers";
import { Pencil, Trash2, Check, AlertCircle, BookMarked } from "lucide-react";
import { toast } from "sonner";
import { useReportEngine } from "@/lib/report-engine";

export const Route = createFileRoute("/_authenticated/sales")({ component: Page });

type PayFilter = "all" | "paid" | "unpaid" | "katha";
type TypeFilter = "all" | "walk_in" | "take_away" | "delivery";

function paymentStatus(s: any): "paid" | "unpaid" | "katha" {
  const remaining = Math.max(0, num(s.grand_total) - num(s.cash_paid) - num(s.online_paid));
  if (remaining <= 0) return "paid";
  return s.katha ? "katha" : "unpaid";
}

function StatusBadge({ s }: { s: any }) {
  const st = paymentStatus(s);
  if (st === "paid") return <Badge className="bg-emerald-600 hover:bg-emerald-600"><Check className="h-3 w-3 mr-1" />Fully Paid</Badge>;
  if (st === "katha") return <Badge className="bg-emerald-600 hover:bg-emerald-600"><BookMarked className="h-3 w-3 mr-1" />Katha</Badge>;
  return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" />Not Paid Fully</Badge>;
}

type QuickRange = "date" | "week" | "month" | "overall";

import { buildRange, formatBusinessTime, businessDateOf, businessToday, businessDayStartUTC, businessDayEndUTC } from "@/lib/business-date";

function rangeFor(q: QuickRange, date: string): { from?: string; to?: string; startUTC?: string; endExclusiveUTC?: string } {
  if (q === "overall") return {};
  if (q === "date") return { from: date, to: date, startUTC: businessDayStartUTC(date), endExclusiveUTC: businessDayEndUTC(date) };
  const map = { week: "week", month: "month" } as const;
  const r = buildRange(map[q]);
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
}

function Page() {
  const qc = useQueryClient();
  const [quick, setQuick] = useState<QuickRange>("month");
  const [date, setDate] = useState<string>(businessToday());
  const [inv, setInv] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "completed">("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");

  const range = rangeFor(quick, date);

  const { data: report } = useReportEngine(range);
  const data = ((report?.invoices ?? []) as any[]).filter((s) => {
    if (inv && !String(s.invoice_no ?? "").toLowerCase().includes(inv.toLowerCase())) return false;
    if (customer && !String(s.customer_name ?? "").toLowerCase().includes(customer.toLowerCase())) return false;
    if (status !== "all" && s.status !== status) return false;
    if (type !== "all" && s.order_type !== type) return false;
    if (pay !== "all" && paymentStatus(s) !== pay) return false;
    return true;
  });

  const deleteMutation = useMutation({
    mutationFn: async (sale: any) => {
      if (sale.status === "completed" || sale.status === "pending") {
        const { error: restoreErr } = await supabase.rpc("restore_sale_stock", { _sale_id: sale.id });
        if (restoreErr) throw restoreErr;
      }
      const { error } = await supabase.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", sale.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("KDF deleted");
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["daily_closing"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const summary = (data as any[]).reduce(
    (a, s) => {
      a.count += 1;
      if (s.status === "pending") { a.pendingInvoices += 1; return a; }
      const rem = Math.max(0, num(s.grand_total) - num(s.cash_paid) - num(s.online_paid));
      const st = paymentStatus(s);
      a.sales += num(s.grand_total);
      a.paid += num(s.cash_paid) + num(s.online_paid);
      a.remaining += rem;
      if (st === "paid") a.paidInvoices += 1;
      else if (st === "katha") { a.kathaInvoices += 1; a.kathaAmt += rem; }
      else { a.unpaidInvoices += 1; a.unpaidAmt += rem; }
      return a;
    },
    { count: 0, sales: 0, paid: 0, remaining: 0, kathaAmt: 0, unpaidAmt: 0, paidInvoices: 0, unpaidInvoices: 0, kathaInvoices: 0, pendingInvoices: 0 },
  );


  return (
    <div>
      <PageHeader title="Sales & KDFs" subtitle="Quick filters, payment summary and edit/delete" />

      <div className="flex flex-wrap gap-1 mb-3 items-center">
        {(["date", "week", "month", "overall"] as const).map((q) => (
          <Button key={q} size="sm" variant={quick === q ? "default" : "outline"} onClick={() => setQuick(q)} className="capitalize">
            {q === "date" ? "Calendar Date" : q === "week" ? "This Week" : q === "month" ? "This Month" : "Overall"}
          </Button>
        ))}
        {quick === "date" && (
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-auto ml-2" />
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
        <Input placeholder="KDF #" value={inv} onChange={(e) => setInv(e.target.value)} />
        <Input placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
        <div className="flex gap-1">
          {(["all", "pending", "completed"] as const).map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)} className="flex-1 capitalize">{s}</Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mb-3">
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-muted-foreground mr-1">Payment:</span>
          {(["all", "paid", "unpaid", "katha"] as const).map((s) => (
            <Button key={s} size="sm" variant={pay === s ? "default" : "outline"} onClick={() => setPay(s)} className="capitalize">{s === "paid" ? "Fully Paid" : s === "unpaid" ? "Not Paid" : s}</Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-muted-foreground mr-1">Order:</span>
          {(["all", "walk_in", "take_away", "delivery"] as const).map((s) => (
            <Button key={s} size="sm" variant={type === s ? "default" : "outline"} onClick={() => setType(s)} className="capitalize">{s.replace("_", " ")}</Button>
          ))}
        </div>
      </div>

      <Card className="mb-3 p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div><div className="text-xs text-muted-foreground">Total KDFs</div><div className="font-semibold">{summary.count}</div></div>
        <div><div className="text-xs text-muted-foreground">Total Sales</div><div className="font-semibold">{money(summary.sales)}</div></div>
        <div><div className="text-xs text-muted-foreground">Total Paid</div><div className="font-semibold text-emerald-600">{money(summary.paid)}</div></div>
        <div><div className="text-xs text-muted-foreground">Remaining Balance</div><div className="font-semibold text-destructive">{money(summary.remaining)}</div></div>
        <div><div className="text-xs text-muted-foreground">Added To Katha</div><div className="font-semibold">{money(summary.kathaAmt)} <span className="text-xs text-muted-foreground">({summary.kathaInvoices} KDFs)</span></div></div>
        <div><div className="text-xs text-muted-foreground">Not Paid Fully</div><div className="font-semibold">{money(summary.unpaidAmt)} <span className="text-xs text-muted-foreground">({summary.unpaidInvoices} KDFs)</span></div></div>
        <div><div className="text-xs text-muted-foreground">Fully Paid KDFs</div><div className="font-semibold text-emerald-600">{summary.paidInvoices}</div></div>
        <div><div className="text-xs text-muted-foreground">Katha KDFs</div><div className="font-semibold">{summary.kathaInvoices}</div></div>
        <div><div className="text-xs text-muted-foreground">Pending KDFs</div><div className="font-semibold">{summary.pendingInvoices}</div></div>

      </Card>


      <div className="space-y-3">
        {data.map((s: any) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="font-semibold">{s.invoice_no}</div>
                  <Badge variant={s.status === "pending" ? "secondary" : "default"} className="capitalize">{s.status}</Badge>
                  <StatusBadge s={s} />
                  {s.order_type && <Badge variant="outline" className="capitalize">{String(s.order_type).replace("_", " ")}</Badge>}
                  {num(s.delivery_charges) > 0 && <Badge variant="outline">Delivery {money(s.delivery_charges)}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span>Business Date: {businessDateOf(s.sale_date)}</span>
                  <span className="ml-2">Business Time: {formatBusinessTime(s.sale_date)}</span>
                  {s.customer_name && <span className="ml-2">• {s.customer_name}{s.customer_phone ? ` · ${s.customer_phone}` : ""}</span>}
                </div>

              </div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-bold">{money(s.grand_total)}</div>
                {s.status === "pending" && (
                  <Badge variant="outline" className="text-[10px]">Pending</Badge>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to="/pos" search={{ edit: s.id }}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete KDF ${s.invoice_no}? ${s.status === "completed" ? "Stock will be restored." : ""}`)) deleteMutation.mutate(s); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {(s.sale_items ?? []).map((it: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell>{it.products?.name}</TableCell>
                    <TableCell className="text-right">{it.quantity}</TableCell>
                    <TableCell className="text-right">{money(it.price)}</TableCell>
                    <TableCell className="text-right">{money(it.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        ))}
        {data.length === 0 && <p className="text-sm text-muted-foreground">No sales for these filters.</p>}
      </div>
    </div>
  );
}
