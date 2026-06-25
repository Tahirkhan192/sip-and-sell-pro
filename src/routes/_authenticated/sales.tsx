import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, today } from "@/lib/format";
import { PageHeader } from "@/components/CrudHelpers";

export const Route = createFileRoute("/_authenticated/sales")({ component: Page });

function Page() {
  const [date, setDate] = useState(today());
  const [inv, setInv] = useState("");

  const { data = [] } = useQuery({
    queryKey: ["sales", date, inv],
    queryFn: async () => {
      let q = supabase.from("sales").select("*, sale_items(quantity, price, total, products(name))").order("sale_date", { ascending: false }).limit(200);
      if (date) q = q.gte("sale_date", date).lt("sale_date", new Date(new Date(date).getTime()+86400000).toISOString().slice(0,10));
      if (inv) q = q.ilike("invoice_no", `%${inv}%`);
      return (await q).data ?? [];
    },
  });

  return (
    <div>
      <PageHeader title="Daily Sales" subtitle="All invoices with line items" />
      <div className="grid grid-cols-2 gap-2 mb-3 max-w-md">
        <Input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
        <Input placeholder="Invoice #" value={inv} onChange={(e)=>setInv(e.target.value)} />
      </div>
      <div className="space-y-3">
        {data.map((s: any) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="font-semibold">{s.invoice_no}</div>
                <div className="text-xs text-muted-foreground">{new Date(s.sale_date).toLocaleString()}</div>
              </div>
              <div className="text-lg font-bold">{money(s.grand_total)}</div>
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
