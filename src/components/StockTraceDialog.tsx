/**
 * Shows where every number on the Current Stock row came from — the actual
 * purchases, sales, recipe usage, transfers and adjustments behind it.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useStockTrace } from "@/lib/stock-trace";
import type { Period } from "@/lib/inventory-engine";

export type TraceTarget = {
  scope: "product" | "stock_item";
  id: string;
  name: string;
  unit?: string;
  opening: number;
  formulaActive: boolean;
  current: number;
};

export function StockTraceDialog({
  target,
  period,
  onOpenChange,
}: {
  target: TraceTarget | null;
  period: Period;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: groups = [], isLoading } = useStockTrace(target?.scope ?? "product", target?.id ?? null, period);

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {target?.name}
            {target && (
              <Badge variant={target.formulaActive ? "default" : "secondary"}>
                {target.formulaActive ? "Formula Active" : "Formula Inactive"}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {target?.formulaActive
              ? "Opening + Purchase − Direct Sale − Recipe Usage − Transfer Out ± Adjustment"
              : "Formula is inactive — the saved stock value is shown as entered."}
            {" · "}{period.from} → {period.to}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border p-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span>Opening: <b>{(target?.opening ?? 0).toFixed(2)}</b></span>
          {groups.map((g) => (
            <span key={g.key}>{g.title}: <b>{g.total.toFixed(2)}</b></span>
          ))}
          <span>Current / Closing: <b>{(target?.current ?? 0).toFixed(2)} {target?.unit ?? ""}</b></span>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading transactions…</p>}

        {groups.map((g) => (
          <div key={g.key} className="space-y-1">
            <h4 className="text-sm font-semibold">{g.title} · {g.total.toFixed(2)}</h4>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right w-28">Quantity</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {g.lines.map((l, i) => (
                  <TableRow key={`${g.key}-${i}`}>
                    <TableCell>{l.date}</TableCell>
                    <TableCell>{l.ref}{l.note ? <span className="text-xs text-muted-foreground"> · {l.note}</span> : null}</TableCell>
                    <TableCell className="text-right">{l.quantity.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {g.lines.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-3">No transactions</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
