import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { money, num } from "@/lib/format";
import { usePinGate } from "@/lib/pin-locks";
import { buildRange } from "@/lib/business-date";
import { useInventoryEngine, type Period, type ProductInventoryRow, type StockItemInventoryRow } from "@/lib/inventory-engine";
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

function currentPeriod(): Period {
  const r = buildRange("month");
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
}

function useOverrideMutation(table: "products" | "stock_items", invalidate: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number | null }) => {
      const { error } = await (supabase as any).from(table).update({ avg_price_override: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Average purchase price updated");
      for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to update"),
  });
}

/* ------------------------------------------------------------------ */
/* Product Stock Available — PRODUCTS ONLY                             */
/* ------------------------------------------------------------------ */

export type ProductStockRow = ProductInventoryRow;

export function useProductStockAvailable(period: Period = currentPeriod()) {
  const q = useInventoryEngine(period);
  return { ...q, data: q.data?.products } as typeof q & { data: ProductInventoryRow[] | undefined };
}

export function ProductStockAvailable({ compact = false }: { compact?: boolean }) {
  const period = currentPeriod();
  const { data: rows = [], isLoading } = useProductStockAvailable(period);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const t = filtered.reduce((a, r) => ({
    opening: a.opening + r.opening,
    purchases: a.purchases + r.purchases,
    production: a.production + r.production,
    recipeUsage: a.recipeUsage + r.recipeUsage,
    directSales: a.directSales + r.directSales,
    transferOut: a.transferOut + r.transferOut,
    manualConsumption: a.manualConsumption + r.manualConsumption,
    manualAdjustment: a.manualAdjustment + r.manualAdjustment,
    remaining: a.remaining + r.remaining,
    value: a.value + r.value,
  }), { opening: 0, purchases: 0, production: 0, recipeUsage: 0, directSales: 0, transferOut: 0, manualConsumption: 0, manualAdjustment: 0, remaining: 0, value: 0 });

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b px-3 py-3 sm:px-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Product Stock Available</h3>
          <p className="text-[11px] text-muted-foreground truncate">Products only · {period.from} → {period.to}</p>
        </div>
        <Input className="h-8 w-[130px] sm:w-[200px] no-print" placeholder="Search product" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={compact ? "max-h-[420px] overflow-auto" : "overflow-x-auto"}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right">Purchases</TableHead>
            <TableHead className="text-right">Production</TableHead>
            <TableHead className="text-right">Recipe Usage</TableHead>
            <TableHead className="text-right">Direct Sales</TableHead>
            <TableHead className="text-right">Transfer Out</TableHead>
            <TableHead className="text-right">Manual Consumption</TableHead>
            <TableHead className="text-right">Manual Adjustment</TableHead>
            <TableHead className="text-right">Closing (Remaining)</TableHead>
            <TableHead className="text-right">Selling Price</TableHead>
            <TableHead className="text-right">Current Product Value</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.category}</TableCell>
                <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.purchases.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.production.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.recipeUsage.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.directSales.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.transferOut.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.manualConsumption.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.manualAdjustment.toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">{r.remaining.toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(r.salePrice)}</TableCell>
                <TableCell className="text-right font-medium">{money(r.value)}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-6">{isLoading ? "Loading…" : "No products"}</TableCell></TableRow>
            )}
            {filtered.length > 0 && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell colSpan={2}>Grand Total</TableCell>
                <TableCell className="text-right">{t.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.purchases.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.production.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.recipeUsage.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.directSales.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.transferOut.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.manualConsumption.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.manualAdjustment.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.remaining.toFixed(2)}</TableCell>
                <TableCell />
                <TableCell className="text-right">{money(t.value)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>


      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Product Quantity</span>
        <span>{t.remaining.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Product Value</span>
        <span>{money(t.value)}</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stock Item Available — RAW STOCK ITEMS ONLY                         */
/* ------------------------------------------------------------------ */

export type StockItemRow = StockItemInventoryRow;

export function useStockItemAvailable(period: Period = currentPeriod()) {
  const q = useInventoryEngine(period);
  return { ...q, data: q.data?.stockItems } as typeof q & { data: StockItemInventoryRow[] | undefined };
}

export function StockItemAvailable({ editable = true, compact = false }: { editable?: boolean; compact?: boolean }) {
  const period = currentPeriod();
  const { data: rows = [], isLoading } = useStockItemAvailable(period);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const { guard, dialog } = usePinGate();
  const save = useOverrideMutation("stock_items", ["inventory-engine", "stock-availability", "report", "stock", "stock_items"]);

  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const t = filtered.reduce((a, r) => ({
    opening: a.opening + r.opening,
    purchases: a.purchases + r.purchases,
    recipeUsage: a.recipeUsage + r.recipeUsage,
    transferOut: a.transferOut + r.transferOut,
    manualConsumption: a.manualConsumption + r.manualConsumption,
    manualAdjustment: a.manualAdjustment + r.manualAdjustment,
    remaining: a.remaining + r.remaining,
    value: a.value + r.value,
  }), { opening: 0, purchases: 0, recipeUsage: 0, transferOut: 0, manualConsumption: 0, manualAdjustment: 0, remaining: 0, value: 0 });
  const colCount = editable ? 11 : 10;


  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Stock Item Available</h3>
          <p className="text-[11px] text-muted-foreground">Raw stock items only · {period.from} → {period.to}</p>
        </div>
        <Input className="h-8 max-w-[200px] no-print" placeholder="Search item" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={compact ? "max-h-[420px] overflow-auto" : "overflow-auto"}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Stock Item</TableHead>
            <TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right">Purchases</TableHead>
            <TableHead className="text-right">Recipe Usage</TableHead>
            <TableHead className="text-right">Transfer Out</TableHead>
            <TableHead className="text-right">Manual Consumption</TableHead>
            <TableHead className="text-right">Closing (Remaining)</TableHead>
            <TableHead className="text-right">Avg Purchase Price</TableHead>
            <TableHead className="text-right">Current Stock Value</TableHead>
            {editable && <TableHead className="w-24 no-print"></TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}<span className="ml-2 text-xs text-muted-foreground">{r.unit}</span></TableCell>
                <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.purchases.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.recipeUsage.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.transferOut.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.manualConsumption.toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">{r.remaining.toFixed(2)}</TableCell>
                <TableCell className="text-right">
                  {editId === r.id ? (
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
                  <TableCell className="text-right whitespace-nowrap no-print">
                    {editId === r.id ? (
                      <>
                        <Button size="icon" variant="ghost" title="Save" onClick={() => { save.mutate({ id: r.id, value: priceInput.trim() === "" ? null : num(priceInput) }); setEditId(null); }}><Check className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Cancel" onClick={() => setEditId(null)}><X className="h-4 w-4" /></Button>
                      </>
                    ) : (
                      <Button size="icon" variant="ghost" title="Override average purchase price" onClick={() => guard("edit_stock", () => { setEditId(r.id); setPriceInput(r.manual ? String(r.avgPrice) : ""); })}><Pencil className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={colCount} className="text-center text-muted-foreground py-6">{isLoading ? "Loading…" : "No stock items"}</TableCell></TableRow>
            )}
            {filtered.length > 0 && (
              <TableRow className="font-semibold bg-muted/50">
                <TableCell>Grand Total</TableCell>
                <TableCell className="text-right">{t.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.purchases.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.recipeUsage.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.transferOut.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.manualConsumption.toFixed(2)}</TableCell>
                <TableCell className="text-right">{t.remaining.toFixed(2)}</TableCell>
                <TableCell />
                <TableCell className="text-right">{money(t.value)}</TableCell>
                {editable && <TableCell className="no-print" />}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Stock Item Quantity</span>
        <span>{t.remaining.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Stock Item Value</span>
        <span>{money(t.value)}</span>
      </div>
      {dialog}
    </Card>
  );
}

/** Both reports stacked — products and stock items are never mixed in one table. */
export function StockAvailability({ editable = true, compact = false }: { editable?: boolean; compact?: boolean }) {
  return (
    <div className="space-y-4">
      <ProductStockAvailable compact={compact} />
      <StockItemAvailable editable={editable} compact={compact} />
    </div>
  );
}
