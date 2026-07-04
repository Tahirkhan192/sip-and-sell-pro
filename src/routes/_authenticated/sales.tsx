import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, today, num } from "@/lib/format";
import { PageHeader } from "@/components/CrudHelpers";
import { Pencil, Trash2, Check, AlertCircle, BookMarked } from "lucide-react";
import { toast } from "sonner";

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

type QuickRange = "today" | "yesterday" | "week" | "month" | "overall";

function rangeFor(q: QuickRange): { from?: string; to?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (q === "today") return { from: iso(midnight), to: iso(new Date(midnight.getTime() + 86400000)) };
  if (q === "yesterday") return { from: iso(new Date(midnight.getTime() - 86400000)), to: iso(midnight) };
  if (q === "week") {
    const dow = midnight.getDay(); const back = dow === 0 ? 6 : dow - 1;
    return { from: iso(new Date(midnight.getTime() - back * 86400000)), to: iso(new Date(midnight.getTime() + 86400000)) };
  }
  if (q === "month") {
    const m = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(m), to: iso(new Date(midnight.getTime() + 86400000)) };
  }
  return {};
}

function Page() {
  const qc = useQueryClient();
  const [quick, setQuick] = useState<QuickRange>("today");
  const [inv, setInv] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "completed">("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");

  const range = rangeFor(quick);

  const { data = [] } = useQuery({
    queryKey: ["sales", quick, inv, customer, status, pay, type],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("*, sale_items(quantity, price, total, products(name))")
        .is("deleted_at", null)
        .order("sale_date", { ascending: false })
        .limit(1000);
      if (range.from) q = q.gte("sale_date", range.from);
      if (range.to) q = q.lt("sale_date", range.to);
      if (inv) q = q.ilike("invoice_no", `%${inv}%`);
      if (customer) q = q.ilike("customer_name", `%${customer}%`);
      if (status !== "all") q = q.eq("status", status);
      if (type !== "all") q = q.eq("order_type" as any, type);
      const rows = (await q).data ?? [];
      if (pay === "all") return rows;
      return (rows as any[]).filter((s) => paymentStatus(s) === pay);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (sale: any) => {
      if (sale.status === "completed") {
        const { error: restoreErr } = await supabase.rpc("restore_sale_stock", { _sale_id: sale.id });
        if (restoreErr) throw restoreErr;
      }
      const { error } = await supabase.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", sale.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice deleted");
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
      const rem = Math.max(0, num(s.grand_total) - num(s.cash_paid) - num(s.online_paid));
      const st = paymentStatus(s);
      a.count += 1;
      a.sales += num(s.grand_total);
      a.paid += num(s.cash_paid) + num(s.online_paid);
      a.remaining += rem;
      if (st === "paid") a.paidInvoices += 1;
      else if (st === "katha") { a.kathaInvoices += 1; a.kathaAmt += rem; }
      else { a.unpaidInvoices += 1; a.unpaidAmt += rem; }
      return a;
    },
    { count: 0, sales: 0, paid: 0, remaining: 0, kathaAmt: 0, unpaidAmt: 0, paidInvoices: 0, unpaidInvoices: 0, kathaInvoices: 0 },
  );

  return (
    <div>
      <PageHeader title="Sales & Invoices" subtitle="Quick filters, payment summary and edit/delete" />

      <div className="flex flex-wrap gap-1 mb-3">
        {(["today", "yesterday", "week", "month", "overall"] as const).map((q) => (
          <Button key={q} size="sm" variant={quick === q ? "default" : "outline"} onClick={() => setQuick(q)} className="capitalize">
            {q === "week" ? "This Week" : q === "month" ? "This Month" : q}
          </Button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
        <Input placeholder="Invoice #" value={inv} onChange={(e) => setInv(e.target.value)} />
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
        <div><div className="text-xs text-muted-foreground">Total Invoices</div><div className="font-semibold">{summary.count}</div></div>
        <div><div className="text-xs text-muted-foreground">Total Sales</div><div className="font-semibold">{money(summary.sales)}</div></div>
        <div><div className="text-xs text-muted-foreground">Total Paid</div><div className="font-semibold text-emerald-600">{money(summary.paid)}</div></div>
        <div><div className="text-xs text-muted-foreground">Remaining Balance</div><div className="font-semibold text-destructive">{money(summary.remaining)}</div></div>
        <div><div className="text-xs text-muted-foreground">Added To Katha</div><div className="font-semibold">{money(summary.kathaAmt)} <span className="text-xs text-muted-foreground">({summary.kathaInvoices} inv)</span></div></div>
        <div><div className="text-xs text-muted-foreground">Not Paid Fully</div><div className="font-semibold">{money(summary.unpaidAmt)} <span className="text-xs text-muted-foreground">({summary.unpaidInvoices} inv)</span></div></div>
        <div><div className="text-xs text-muted-foreground">Fully Paid Invoices</div><div className="font-semibold text-emerald-600">{summary.paidInvoices}</div></div>
        <div><div className="text-xs text-muted-foreground">Katha Invoices</div><div className="font-semibold">{summary.kathaInvoices}</div></div>
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
                  {new Date(s.sale_date).toLocaleString()}
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
                <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Delete invoice ${s.invoice_no}? ${s.status === "completed" ? "Stock will be restored." : ""}`)) deleteMutation.mutate(s); }}>
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
