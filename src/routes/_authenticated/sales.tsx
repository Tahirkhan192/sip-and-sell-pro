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

function Page() {
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [inv, setInv] = useState("");
  const [customer, setCustomer] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "completed">("all");
  const [pay, setPay] = useState<PayFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");

  const { data = [] } = useQuery({
    queryKey: ["sales", date, inv, customer, status, pay, type],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select("*, sale_items(quantity, price, total, products(name))")
        .is("deleted_at", null)
        .order("sale_date", { ascending: false })
        .limit(500);
      if (date) q = q.gte("sale_date", date).lt("sale_date", new Date(new Date(date).getTime() + 86400000).toISOString().slice(0, 10));
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
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const totals = data.reduce(
    (a: any, s: any) => ({
      count: a.count + 1,
      sales: a.sales + num(s.grand_total),
      delivery: a.delivery + num(s.delivery_charges),
      cash: a.cash + num(s.cash_paid),
      online: a.online + num(s.online_paid),
      remaining: a.remaining + Math.max(0, num(s.grand_total) - num(s.cash_paid) - num(s.online_paid)),
    }),
    { count: 0, sales: 0, delivery: 0, cash: 0, online: 0, remaining: 0 },
  );

  return (
    <div>
      <PageHeader title="Sales & Invoices" subtitle="All invoices with payment status, filters and edit/delete" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

      {data.length > 0 && (
        <Card className="mb-3 p-3 grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Invoices</div><div className="font-semibold">{totals.count}</div></div>
          <div><div className="text-xs text-muted-foreground">Total Sales</div><div className="font-semibold">{money(totals.sales)}</div></div>
          <div><div className="text-xs text-muted-foreground">Cash</div><div className="font-semibold">{money(totals.cash)}</div></div>
          <div><div className="text-xs text-muted-foreground">Online</div><div className="font-semibold">{money(totals.online)}</div></div>
          <div><div className="text-xs text-muted-foreground">Delivery</div><div className="font-semibold">{money(totals.delivery)}</div></div>
          <div><div className="text-xs text-muted-foreground">Remaining</div><div className="font-semibold text-destructive">{money(totals.remaining)}</div></div>
        </Card>
      )}

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
