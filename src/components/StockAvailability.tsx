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
import { Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

type Period = { from: string; to: string; startUTC: string; endExclusiveUTC: string };

function currentPeriod(): Period {
  const r = buildRange("month");
  return { from: r.from, to: r.to, startUTC: r.startUTC, endExclusiveUTC: r.endExclusiveUTC };
}

/** Opening quantity for a period — the locked snapshot if one exists, else the live opening_stock. */
function useOpeningSnapshots(period: Period) {
  const year = Number(period.from.slice(0, 4));
  const month = Number(period.from.slice(5, 7));
  return useQuery({
    queryKey: ["stock-availability", "opening", year, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("stock_opening_snapshots")
        .select("scope,item_id,quantity")
        .eq("year", year)
        .eq("month", month);
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) map[`${r.scope}:${r.item_id}`] = num(r.quantity);
      return map;
    },
    staleTime: 0,
  });
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

export type ProductStockRow = {
  id: string;
  name: string;
  category: string;
  opening: number;
  produced: number;
  sold: number;
  remaining: number;
  salePrice: number;
  value: number;
};

export function useProductStockAvailable(period: Period = currentPeriod()) {
  const { data: openings = {} } = useOpeningSnapshots(period);
  return useQuery({
    queryKey: ["stock-availability", "products", period.from, period.to, Object.keys(openings).length],
    queryFn: async (): Promise<ProductStockRow[]> => {
      const [p, prod, sold] = await Promise.all([
        (supabase as any).from("products").select("id,name,category,opening_stock,current_stock,sale_price").is("deleted_at", null).order("name"),
        (supabase as any).from("production_batches").select("product_id,quantity").is("deleted_at", null).gte("batch_date", period.from).lte("batch_date", period.to),
        (supabase as any).from("sale_items").select("product_id,quantity,sales!inner(sale_date,status,deleted_at,hidden)")
          .gte("sales.sale_date", period.startUTC).lt("sales.sale_date", period.endExclusiveUTC),
      ]);
      if (p.error) throw p.error;
      const producedBy: Record<string, number> = {};
      for (const b of ((prod.data ?? []) as any[])) producedBy[b.product_id] = (producedBy[b.product_id] ?? 0) + num(b.quantity);
      const soldBy: Record<string, number> = {};
      for (const it of ((sold.data ?? []) as any[])) {
        const s = it.sales;
        if (!s || s.deleted_at || s.hidden) continue;
        soldBy[it.product_id] = (soldBy[it.product_id] ?? 0) + num(it.quantity);
      }
      return ((p.data ?? []) as any[]).map((r) => {
        const opening = openings[`product:${r.id}`] ?? num(r.opening_stock);
        const remaining = num(r.current_stock);
        const salePrice = num(r.sale_price);
        return {
          id: r.id,
          name: r.name,
          category: r.category ?? "—",
          opening,
          produced: producedBy[r.id] ?? 0,
          sold: soldBy[r.id] ?? 0,
          remaining,
          salePrice,
          value: remaining * salePrice,
        };
      });
    },
    staleTime: 0,
  });
}

export function ProductStockAvailable({ compact = false }: { compact?: boolean }) {
  const period = currentPeriod();
  const { data: rows = [], isLoading } = useProductStockAvailable(period);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const totalQty = filtered.reduce((s, r) => s + r.remaining, 0);
  const totalValue = filtered.reduce((s, r) => s + r.value, 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Product Stock Available</h3>
          <p className="text-[11px] text-muted-foreground">Products only · {period.from} → {period.to}</p>
        </div>
        <Input className="h-8 max-w-[200px] no-print" placeholder="Search product" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className={compact ? "max-h-[420px] overflow-auto" : "overflow-auto"}>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Opening Qty</TableHead>
            <TableHead className="text-right">Produced</TableHead>
            <TableHead className="text-right">Sold Qty</TableHead>
            <TableHead className="text-right">Remaining Qty</TableHead>
            <TableHead className="text-right">Selling Price</TableHead>
            <TableHead className="text-right">Current Product Value</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.category}</TableCell>
                <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.produced.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.sold.toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">{r.remaining.toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(r.salePrice)}</TableCell>
                <TableCell className="text-right font-medium">{money(r.value)}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">{isLoading ? "Loading…" : "No products"}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Product Quantity</span>
        <span>{totalQty.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Product Value</span>
        <span>{money(totalValue)}</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stock Item Available — RAW STOCK ITEMS ONLY                         */
/* ------------------------------------------------------------------ */

export type StockItemRow = {
  id: string;
  name: string;
  unit: string;
  opening: number;
  purchases: number;
  received: number;
  consumed: number;
  transferred: number;
  closing: number;
  avgPrice: number;
  manual: boolean;
  value: number;
};

export function useStockItemAvailable(period: Period = currentPeriod()) {
  const { data: openings = {} } = useOpeningSnapshots(period);
  return useQuery({
    queryKey: ["stock-availability", "stock-items", period.from, period.to, Object.keys(openings).length],
    queryFn: async (): Promise<StockItemRow[]> => {
      const [s, pur, tr] = await Promise.all([
        (supabase as any).from("stock_items").select("id,name,unit,opening_stock,current_stock,purchase_price,avg_price_override").is("deleted_at", null).order("name"),
        (supabase as any).from("stock_purchases").select("stock_item_id,quantity").is("deleted_at", null).not("stock_item_id", "is", null).gte("date", period.from).lte("date", period.to),
        (supabase as any).from("stock_transfers").select("stock_item_id,quantity,from_category,to_category").is("deleted_at", null).not("stock_item_id", "is", null)
          .gte("created_at", period.startUTC).lt("created_at", period.endExclusiveUTC),
      ]);
      if (s.error) throw s.error;
      const purchaseBy: Record<string, number> = {};
      for (const r of ((pur.data ?? []) as any[])) purchaseBy[r.stock_item_id] = (purchaseBy[r.stock_item_id] ?? 0) + num(r.quantity);
      const outBy: Record<string, number> = {};
      for (const r of ((tr.data ?? []) as any[])) outBy[r.stock_item_id] = (outBy[r.stock_item_id] ?? 0) + num(r.quantity);

      return ((s.data ?? []) as any[]).map((r) => {
        const manual = r.avg_price_override !== null && r.avg_price_override !== undefined;
        const avgPrice = manual ? num(r.avg_price_override) : num(r.purchase_price);
        const opening = openings[`stock_item:${r.id}`] ?? num(r.opening_stock);
        const purchases = purchaseBy[r.id] ?? 0;
        const received = 0; // stock received without a purchase record
        const transferred = outBy[r.id] ?? 0;
        const closing = num(r.current_stock);
        // Opening + Purchases + Received − Consumed − Transferred = Closing
        const consumed = Math.max(0, opening + purchases + received - transferred - closing);
        return { id: r.id, name: r.name, unit: r.unit ?? "pcs", opening, purchases, received, consumed, transferred, closing, avgPrice, manual, value: closing * avgPrice };
      });
    },
    staleTime: 0,
  });
}

export function StockItemAvailable({ editable = true, compact = false }: { editable?: boolean; compact?: boolean }) {
  const period = currentPeriod();
  const { data: rows = [], isLoading } = useStockItemAvailable(period);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const { guard, dialog } = usePinGate();
  const save = useOverrideMutation("stock_items", ["stock-availability", "report", "stock", "stock_items"]);

  const filtered = useMemo(() => rows.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())), [rows, search]);
  const totalQty = filtered.reduce((s, r) => s + r.closing, 0);
  const totalValue = filtered.reduce((s, r) => s + r.value, 0);

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
            <TableHead className="text-right">Received</TableHead>
            <TableHead className="text-right">Consumed</TableHead>
            <TableHead className="text-right">Transfers</TableHead>
            <TableHead className="text-right">Closing</TableHead>
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
                <TableCell className="text-right">{r.received.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.consumed.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.transferred.toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">{r.closing.toFixed(2)}</TableCell>
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
              <TableRow><TableCell colSpan={editable ? 10 : 9} className="text-center text-muted-foreground py-6">{isLoading ? "Loading…" : "No stock items"}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Stock Item Quantity</span>
        <span>{totalQty.toFixed(2)}</span>
      </div>
      <div className="flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Grand Total Stock Item Value</span>
        <span>{money(totalValue)}</span>
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
