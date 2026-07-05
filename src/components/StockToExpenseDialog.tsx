import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useExpenseCategories } from "@/lib/use-expense-categories";
import { money, num, today } from "@/lib/format";
import { toast } from "sonner";

type Target = { kind: "product" | "stock_item"; id: string; name: string; unit?: string; cost: number; current: number };

export function StockToExpenseDialog({ target, open, onOpenChange }: { target: Target | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: categories = [] } = useExpenseCategories({ activeOnly: true });
  const [quantity, setQuantity] = useState<number | "">("");
  const [category, setCategory] = useState<string>("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today());

  const cost = num(target?.cost) * num(quantity);

  const mut = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("No target");
      if (!quantity || Number(quantity) <= 0) throw new Error("Quantity required");
      if (!category) throw new Error("Expense category required");
      const args = {
        _product_id: target.kind === "product" ? target.id : null,
        _stock_item_id: target.kind === "stock_item" ? target.id : null,
        _quantity: Number(quantity),
        _expense_category: category,
        _reason: reason || null,
        _notes: notes || null,
        _date: date,
      };
      const { error } = await supabase.rpc("stock_to_expense_transfer" as any, args as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transferred to expense");
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock-monthly"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      onOpenChange(false);
      setQuantity(""); setReason(""); setNotes(""); setCategory("");
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Transfer to Expense</DialogTitle></DialogHeader>
        {target && (
          <div className="space-y-3">
            <div className="rounded border p-2 text-sm">
              <div className="font-medium">{target.name}</div>
              <div className="text-xs text-muted-foreground">Available: {num(target.current).toFixed(2)} {target.unit ?? ""} · Cost/unit: {money(target.cost)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>Quantity</Label><Input type="number" step="0.01" placeholder="" value={quantity} onChange={(e) => setQuantity(e.target.value === "" ? "" : Number(e.target.value))} /></div>
            </div>
            <div className="space-y-1"><Label>Expense Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reason</Label><Input placeholder="e.g. Staff Meal, Wastage, Testing" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <div className="space-y-1"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div className="flex justify-between rounded bg-muted/50 px-2 py-1.5 text-sm">
              <span>Cost Amount</span><span className="font-semibold">{money(cost)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>Transfer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
