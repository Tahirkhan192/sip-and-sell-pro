import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { money } from "@/lib/format";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

type Sale = {
  id: string;
  invoice_no: string;
  sale_date: string;
  grand_total: number;
  customer_name: string | null;
  status: string;
  hidden: boolean;
};

type Mode = "exact" | "minute";

/** Admin utility: find duplicate invoices (identical timestamp, or same minute + same total)
 *  and hide or delete the extra copies. The oldest invoice of each group is always kept. */
export function DuplicateInvoiceManager() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("exact");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [includeHidden, setIncludeHidden] = useState(false);

  const { data: sales = [], isFetching } = useQuery({
    queryKey: ["dup-invoices", includeHidden],
    queryFn: async () => {
      const rows: Sale[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase
          .from("sales" as any)
          .select("id, invoice_no, sale_date, grand_total, customer_name, status, hidden")
          .is("deleted_at", null)
          .order("sale_date", { ascending: true })
          .range(from, from + 999);
        if (!includeHidden) q = q.eq("hidden", false);
        const { data, error } = await q;
        if (error) throw error;
        const page = (data ?? []) as unknown as Sale[];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows;
    },
  });

  const groups = useMemo(() => {
    const map: Record<string, Sale[]> = {};
    for (const s of sales) {
      const key =
        mode === "exact"
          ? `${s.sale_date}|${Number(s.grand_total)}`
          : `${s.sale_date.slice(0, 16)}|${Number(s.grand_total)}`;
      (map[key] ??= []).push(s);
    }
    return Object.entries(map)
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, list: [...list].sort((a, b) => a.sale_date.localeCompare(b.sale_date)) }));
  }, [sales, mode]);

  const duplicateIds = useMemo(() => groups.flatMap((g) => g.list.slice(1).map((s) => s.id)), [groups]);
  const selectedIds = Object.keys(selected).filter((id) => selected[id]);

  const apply = useMutation({
    mutationFn: async (action: "hide" | "unhide" | "delete") => {
      if (selectedIds.length === 0) throw new Error("Select at least one invoice");
      const patch =
        action === "delete"
          ? { deleted_at: new Date().toISOString() }
          : { hidden: action === "hide" };
      const { error } = await supabase.from("sales" as any).update(patch as any).in("id", selectedIds);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoices updated");
      setSelected({});
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">Duplicate Invoice Manager</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Finds invoices saved more than once. Hiding removes them from every report and closing without deleting data;
            deleting moves them to the recycle state (soft delete) and restores nothing else. The first (oldest) invoice of each group is kept.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={mode === "exact" ? "default" : "outline"} onClick={() => setMode("exact")}>
            Exact same date &amp; time
          </Button>
          <Button size="sm" variant={mode === "minute" ? "default" : "outline"} onClick={() => setMode("minute")}>
            Same minute &amp; same total
          </Button>
          <label className="flex items-center gap-2 text-xs ml-2">
            <Checkbox checked={includeHidden} onCheckedChange={(v) => setIncludeHidden(!!v)} />
            Include already hidden
          </label>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelected(Object.fromEntries(duplicateIds.map((id) => [id, true])))}
            disabled={duplicateIds.length === 0}
          >
            Select all duplicates ({duplicateIds.length})
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected({})} disabled={selectedIds.length === 0}>
            Clear
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => apply.mutate("hide")} disabled={apply.isPending || selectedIds.length === 0}>
            Hide selected ({selectedIds.length})
          </Button>
          <Button size="sm" variant="outline" onClick={() => apply.mutate("unhide")} disabled={apply.isPending || selectedIds.length === 0}>
            Unhide selected
          </Button>
          <Button size="sm" variant="destructive" onClick={() => apply.mutate("delete")} disabled={apply.isPending || selectedIds.length === 0}>
            Delete selected
          </Button>
        </div>

        {isFetching ? (
          <div className="text-sm text-muted-foreground">Scanning invoices…</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-muted-foreground">No duplicate invoices found.</div>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) =>
                  g.list.map((s, i) => (
                    <TableRow key={s.id} className={i === 0 ? "bg-muted/40" : ""}>
                      <TableCell>
                        {i === 0 ? null : (
                          <Checkbox
                            checked={!!selected[s.id]}
                            onCheckedChange={(v) => setSelected((p) => ({ ...p, [s.id]: !!v }))}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {s.invoice_no} {i === 0 && <Badge variant="secondary" className="ml-1">keep</Badge>}
                        {s.hidden && <Badge variant="outline" className="ml-1">hidden</Badge>}
                      </TableCell>
                      <TableCell>{formatBusinessDate(new Date(s.sale_date))}</TableCell>
                      <TableCell>{formatBusinessTime(new Date(s.sale_date))}</TableCell>
                      <TableCell>{s.customer_name ?? "—"}</TableCell>
                      <TableCell className="text-right">{money(s.grand_total)}</TableCell>
                      <TableCell>{s.status}</TableCell>
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
