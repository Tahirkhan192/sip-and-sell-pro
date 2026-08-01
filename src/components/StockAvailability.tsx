import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StockPinDialog } from "@/components/StockPinDialog";
import { money, num } from "@/lib/format";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

export type StockAvailabilityRow = {
  id: string;
  kind: "product" | "stock_item";
  name: string;
  unit: string;
  category: string;
  qty: number;
  avgPrice: number;
  manual: boolean;
  value: number;
};

export function useStockAvailability() {
  return useQuery({
    queryKey: ["stock-availability"],
    queryFn: async (): Promise<StockAvailabilityRow[]> => {
      const [p, s] = await Promise.all([
        (supabase as any).from("products").select("id,name,unit,category,current_stock,cost_price,avg_price_override").is("deleted_at", null).order("name"),
        (supabase as any).from("stock_items").select("id,name,unit,category,current_stock,purchase_price,avg_price_override").is("deleted_at", null).order("name"),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      const rows: StockAvailabilityRow[] = [];
      for (const r of (p.data ?? []) as any[]) {
        const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
        const avg = manual ? num(r.avg_price_override) : num(r.cost_price);
        rows.push({ id: r.id, kind: "product", name: r.name, unit: r.unit ?? "pcs", category: r.category ?? "—", qty: num(r.current_stock), avgPrice: avg, manual, value: num(r.current_stock) * avg });
      }
      for (const r of (s.data ?? []) as any[]) {
        const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
        const avg = manual ? num(r.avg_price_override) : num(r.purchase_price);
        rows.push({ id: r.id, kind: "stock_item", name: r.name, unit: r.unit ?? "pcs", category: r.category ?? "—", qty: num(r.current_stock), avgPrice: avg, manual, value: num(r.current_stock) * avg });
      }
      return rows.sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 0,
  });
}

/**
 * "Stock Items Available" — every product and stock item with quantity, unit,
 * average purchase price (weighted average, or Owner override) and stock value.
 */
export function StockAvailability({ editable = true, compact = false }: { editable?: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useStockAvailability();
  const [search, setSearch] = useState("");
  const [pinFor, setPinFor] = useState<StockAvailabilityRow | null>(null);
  const [editRow, setEditRow] = useState<StockAvailabilityRow | null>(null);
  const [priceInput, setPriceInput] = useState("");

  const filtered = useMemo(
    () => rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
    [rows, search],
  );
  const grandTotal = filtered.reduce((s, r) => s + r.value, 0);

  const save = useMutation({
    mutationFn: async ({ row, value }: { row: StockAvailabilityRow; value: number | null }) => {
      const table = row.kind === "product" ? "products" : "stock_items";
      const { error } = await (supabase as any).from(table).update({ avg_price_override: value }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Average purchase price updated");
      setEditRow(null);
      qc.invalidateQueries({ queryKey: ["stock-availability"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Stock Items Available</h3>
        <Input className="h-8 max-w-[200px]" placeholder="Search item" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={compact ? "max-h-[420px] overflow-auto" : ""}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Avg Purchase Price</TableHead>
            <TableHead className="text-right">Stock Value</TableHead>
            {editable && <TableHead className="w-24"></TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={`${r.kind}-${r.id}`}>
                <TableCell className="font-medium">
                  {r.name}
                  <span className="ml-2 text-xs text-muted-foreground">{r.kind === "product" ? r.category : "Stock item"}</span>
                </TableCell>
                <TableCell className="text-right">{r.qty.toFixed(2)}</TableCell>
                <TableCell>{r.unit}</TableCell>
                <TableCell className="text-right">
                  {editRow && editRow.kind === r.kind && editRow.id === r.id ? (
                    <Input className="h-8 w-28 ml-auto text-right" type="number" step="0.01" autoFocus value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {money(r.avgPrice)}
                      {r.manual && <Badge variant="secondary" className="text-[10px]">Manual</Badge>}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium">{money(r.value)}</TableCell>
                {editable && (
                  <TableCell className="text-right whitespace-nowrap">
                    {editRow && editRow.kind === r.kind && editRow.id === r.id ? (
                      <>
                        <Button size="icon" variant="ghost" title="Save" onClick={() => save.mutate({ row: r, value: priceInput.trim() === "" ? null : num(priceInput) })}><Check className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Cancel" onClick={() => setEditRow(null)}><X className="h-4 w-4" /></Button>
                      </>
                    ) : (
                      <Button size="icon" variant="ghost" title="Override average purchase price" onClick={() => setPinFor(r)}><Pencil className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={editable ? 6 : 5} className="text-center text-muted-foreground py-6">{isLoading ? "Loading…" : "No stock items"}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Stock Value</span>
        <span>{money(grandTotal)}</span>
      </div>

      <StockPinDialog
        open={!!pinFor}
        onOpenChange={(v) => { if (!v) setPinFor(null); }}
        title="Owner PIN"
        description="Overriding the Average Purchase Price is protected. Enter your PIN to continue."
        onConfirm={() => {
          const row = pinFor;
          setPinFor(null);
          if (!row) return;
          setEditRow(row);
          setPriceInput(row.manual ? String(row.avgPrice) : "");
        }}
      />
    </Card>
  );
}
