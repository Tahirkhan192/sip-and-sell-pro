/**
 * Permanent month-end stock record.
 *
 * Shows, for any month, the saved Opening quantity/value of that month and the
 * saved Closing quantity/value of that month (which is the next month's
 * opening). Read-only history — nothing here recalculates.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PrintButton } from "@/components/PrintButton";
import { money, num } from "@/lib/format";
import { monthLabel } from "@/lib/month-opening";

type Snap = { scope: string; item_id: string; kind: string; quantity: number; unit_value: number };

type Row = {
  id: string;
  name: string;
  unit: string;
  openingQty: number;
  openingValue: number;
  closingQty: number;
  closingValue: number;
  hasRecord: boolean;
};

export function OpeningStockHistory() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ["stock-opening-history", year, month],
    queryFn: async () => {
      const [snapQ, prodQ, itemQ] = await Promise.all([
        (supabase as any).from("stock_opening_snapshots").select("scope,item_id,kind,quantity,unit_value").eq("year", year).eq("month", month),
        (supabase as any).from("products").select("id,name").is("deleted_at", null).order("name"),
        (supabase as any).from("stock_items").select("id,name,unit").is("deleted_at", null).order("name"),
      ]);
      return {
        snaps: (snapQ.data ?? []) as Snap[],
        products: (prodQ.data ?? []) as any[],
        items: (itemQ.data ?? []) as any[],
      };
    },
  });

  const { products, stockItems } = useMemo(() => {
    const snaps = data?.snaps ?? [];
    const byKey: Record<string, { opening?: Snap; closing?: Snap }> = {};
    for (const s of snaps) {
      const k = `${s.scope}:${s.item_id}`;
      (byKey[k] ??= {})[s.kind === "closing" ? "closing" : "opening"] = s;
    }
    const build = (list: any[], scope: string): Row[] =>
      list.map((r) => {
        const rec = byKey[`${scope}:${r.id}`] ?? {};
        const openingQty = num(rec.opening?.quantity);
        const closingQty = num(rec.closing?.quantity);
        return {
          id: r.id,
          name: r.name,
          unit: r.unit ?? "pcs",
          openingQty,
          openingValue: openingQty * num(rec.opening?.unit_value),
          closingQty,
          closingValue: closingQty * num(rec.closing?.unit_value),
          hasRecord: !!rec.opening || !!rec.closing,
        };
      }).filter((r) => r.hasRecord);
    return {
      products: build(data?.products ?? [], "product"),
      stockItems: build(data?.items ?? [], "stock_item"),
    };
  }, [data]);

  const totals = (rows: Row[]) => rows.reduce(
    (a, r) => ({ o: a.o + r.openingValue, c: a.c + r.closingValue }),
    { o: 0, c: 0 },
  );

  const section = (title: string, rows: Row[]) => {
    const t = totals(rows);
    return (
      <Card className="overflow-x-auto">
        <div className="px-4 pt-4 font-semibold">{title}</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Opening Qty</TableHead>
            <TableHead className="text-right">Opening Value</TableHead>
            <TableHead className="text-right">Closing Qty</TableHead>
            <TableHead className="text-right">Closing Value</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.openingQty.toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(r.openingValue)}</TableCell>
                <TableCell className="text-right">{r.closingQty.toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(r.closingValue)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                {isLoading ? "Loading…" : "No saved record for this month"}
              </TableCell></TableRow>
            )}
            {rows.length > 0 && (
              <TableRow className="font-semibold bg-muted/40">
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell className="text-right">{money(t.o)}</TableCell>
                <TableCell />
                <TableCell className="text-right">{money(t.c)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1 w-28"><Label className="text-xs">Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
        <div className="space-y-1 w-28"><Label className="text-xs">Month</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} /></div>
        <div className="ml-auto"><PrintButton title={`Opening & Closing Stock — ${monthLabel(year, month)}`} /></div>
      </div>
      <p className="text-sm text-muted-foreground">
        Saved record for {monthLabel(year, month)}. Closing of this month is the same figure saved as next month's opening.
      </p>
      {section("Products", products)}
      {section("Stock Items", stockItems)}
    </div>
  );
}
