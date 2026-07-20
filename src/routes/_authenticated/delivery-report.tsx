import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/CrudHelpers";
import { money, num, today, startOfMonth } from "@/lib/format";
import { deliveryExpensesRepository, salesRepository } from "@/repositories";

export const Route = createFileRoute("/_authenticated/delivery-report")({ component: Page });

function Page() {
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());

  const { data: deliveries = [] } = useQuery({
    queryKey: ["delivery_report", from, to],
    queryFn: async () => (await salesRepository.query()
      .select("id, invoice_no, sale_date, customer_name, delivery_charges, status, grand_total")
      .is("deleted_at", null)
      .gt("delivery_charges", 0)
      .gte("sale_date", from)
      .lt("sale_date", new Date(new Date(to).getTime() + 86400000).toISOString().slice(0, 10))
      .order("sale_date", { ascending: false })
    ).data ?? [],
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["delivery_expenses_report", from, to],
    queryFn: async () => (await deliveryExpensesRepository.query()
      .select("*")
      .is("deleted_at", null)
      .gte("date", from)
      .lte("date", to)
    ).data ?? [],
  });

  const totalCharges = deliveries.reduce((s, d: any) => s + num(d.delivery_charges), 0);
  const totalFuel = expenses.reduce((s, e: any) => s + num(e.fuel_cost), 0);
  const totalMaint = expenses.reduce((s, e: any) => s + num(e.maintenance_cost), 0);
  const profit = totalCharges - totalFuel - totalMaint;

  return (
    <div>
      <PageHeader title="Delivery Report" subtitle="Delivery income and profit" />
      <div className="grid grid-cols-2 max-w-sm gap-2 mb-4">
        <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Total Delivery Charges" value={money(totalCharges)} />
        <Stat label="Fuel Cost" value={money(totalFuel)} />
        <Stat label="Maintenance" value={money(totalMaint)} />
        <Stat label="Delivery Profit" value={money(profit)} emphasize positive={profit >= 0} />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Delivery Charges</TableHead>
              <TableHead className="text-right">Invoice Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell>{new Date(d.sale_date).toLocaleDateString()}</TableCell>
                <TableCell className="font-medium">{d.invoice_no}</TableCell>
                <TableCell>{d.customer_name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{money(d.delivery_charges)}</TableCell>
                <TableCell className="text-right">{money(d.grand_total)}</TableCell>
                <TableCell><Badge variant={d.status === "pending" ? "secondary" : "default"}>{d.status}</Badge></TableCell>
              </TableRow>
            ))}
            {deliveries.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No deliveries in this range</TableCell></TableRow>}
          </TableBody>
        </Table>
        {deliveries.length > 0 && (
          <div className="flex justify-end border-t px-4 py-2 text-sm font-semibold">Total Delivery Income: {money(totalCharges)}</div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, emphasize, positive }: { label: string; value: string; emphasize?: boolean; positive?: boolean }) {
  return (
    <Card className="p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={emphasize ? "text-2xl font-bold " + (positive ? "text-primary" : "text-destructive") : "text-xl font-semibold"}>{value}</div>
    </Card>
  );
}
