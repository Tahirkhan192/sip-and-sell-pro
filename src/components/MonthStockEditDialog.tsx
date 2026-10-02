/**
 * Edit one item's stock for a chosen month (used for last month):
 *  • Opening  → saved as that month's opening record (replaces the old one).
 *  • Closing  → a manual adjustment dated the month's last business day for the
 *               difference, so Current/Closing becomes exactly the typed value.
 * Afterwards "Save as Opening" for the next month copies this closing.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export type MonthEditTarget = {
  scope: "product" | "stock_item";
  id: string;
  name: string;
  unit: string;
  opening: number;
  current: number;
  price: number;
};

export function MonthStockEditDialog({ target, from, to, onClose }: {
  target: MonthEditTarget | null; from: string; to: string; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) { setOpening(String(target.opening)); setClosing(String(target.current)); }
  }, [target]);

  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));

  async function save() {
    if (!target) return;
    const o = Number(opening), c = Number(closing);
    if (!Number.isFinite(o) || !Number.isFinite(c)) { toast.error("Enter valid numbers"); return; }
    setBusy(true);
    try {
      const sb = supabase as any;
      const openingChanged = Math.abs(o - target.opening) > 0.0001;
      if (openingChanged) {
        await sb.from("stock_opening_snapshots").delete()
          .eq("scope", target.scope).eq("item_id", target.id).eq("year", year).eq("month", month).eq("kind", "opening");
        const { error } = await sb.from("stock_opening_snapshots").insert({
          scope: target.scope, item_id: target.id, year, month, kind: "opening", quantity: o, unit_value: target.price,
        });
        if (error) throw error;
      }
      // Closing after the new opening = old closing + opening change.
      const closingNow = target.current + (o - target.opening);
      const diff = c - closingNow;
      if (Math.abs(diff) > 0.0001) {
        const { error } = await sb.from("stock_adjustments").insert({
          scope: target.scope,
          product_id: target.scope === "product" ? target.id : null,
          stock_item_id: target.scope === "stock_item" ? target.id : null,
          quantity: diff, reason: "Month closing correction", date: to,
        });
        if (error) throw error;
      }
      toast.success(`${target.name} updated`);
      for (const k of ["stock", "inventory-engine", "stock-opening-history", "report", "products", "stock-monthly"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      qc.invalidateQueries();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit month stock — {target?.name}</DialogTitle>
          <DialogDescription>
            Month {from} → {to}. Opening replaces the saved opening. Closing is set by a manual adjustment dated {to}.
            Then press "Save as Opening" for the next month to copy this closing as its opening.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label className="text-xs">Opening ({target?.unit})</Label>
            <Input type="number" step="any" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Closing ({target?.unit})</Label>
            <Input type="number" step="any" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
