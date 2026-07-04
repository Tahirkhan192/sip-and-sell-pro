import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { money, today } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/cash-movements")({ component: Page });

type Row = {
  id?: string;
  business_date: string;
  type: "cash_in" | "cash_out";
  amount: number | "";
  reason: string;
  notes: string;
};
const empty: Row = { business_date: today(), type: "cash_in", amount: "", reason: "", notes: "" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Row>(empty);
  const [date, setDate] = useState(today());
  const [typeFilter, setTypeFilter] = useState<"all" | "cash_in" | "cash_out">("all");

  const { data = [] } = useQuery({
    queryKey: ["cash_movements", date, typeFilter],
    queryFn: async () => {
      let q = supabase.from("cash_movements" as any).select("*").is("deleted_at", null).order("occurred_at", { ascending: false }).limit(500);
      if (date) q = q.eq("business_date", date);
      if (typeFilter !== "all") q = q.eq("type", typeFilter);
      return (await q).data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async (p: Row) => {
      const payload = {
        business_date: p.business_date,
        type: p.type,
        amount: Number(p.amount || 0),
        reason: p.reason || null,
        notes: p.notes || null,
      };
      const res = p.id
        ? await supabase.from("cash_movements" as any).update(payload).eq("id", p.id)
        : await supabase.from("cash_movements" as any).insert(payload);
      if (res.error) throw res.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_movements"] });
      qc.invalidateQueries({ queryKey: ["daily_closing"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cash_movements" as any).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cash_movements"] });
      qc.invalidateQueries({ queryKey: ["daily_closing"] });
      toast.success("Deleted");
    },
  });

  const totals = useMemo(() => {
    const cin = (data as any[]).filter((r) => r.type === "cash_in").reduce((s, r) => s + Number(r.amount), 0);
    const cout = (data as any[]).filter((r) => r.type === "cash_out").reduce((s, r) => s + Number(r.amount), 0);
    return { cin, cout, net: cin - cout };
  }, [data]);

  return (
    <div>
      <PageHeader title="Cash Movements" subtitle="Cash In and Cash Out — feeds Daily Closing"
        action={<Button onClick={() => { setForm({ ...empty, business_date: date }); setOpen(true); }}><Plus className="h-4 w-4 mr-1" />Add</Button>} />

      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Input type="date" className="max-w-[200px]" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="flex gap-1">
          {(["all", "cash_in", "cash_out"] as const).map((t) => (
            <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} onClick={() => setTypeFilter(t)} className="capitalize">
              {t === "all" ? "All" : t.replace("_", " ")}
            </Button>
          ))}
        </div>
      </div>

      <Card className="mb-3 p-3 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-xs text-muted-foreground">Cash In</div><div className="font-semibold text-emerald-600">{money(totals.cin)}</div></div>
        <div><div className="text-xs text-muted-foreground">Cash Out</div><div className="font-semibold text-destructive">{money(totals.cout)}</div></div>
        <div><div className="text-xs text-muted-foreground">Net</div><div className="font-semibold">{money(totals.net)}</div></div>
      </Card>

      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Time</TableHead><TableHead>Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Reason</TableHead><TableHead>Notes</TableHead>
            <TableHead className="w-24"></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {(data as any[]).map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{new Date(r.occurred_at).toLocaleString()}</TableCell>
                <TableCell>
                  {r.type === "cash_in"
                    ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><ArrowDownCircle className="h-3 w-3 mr-1" />Cash In</Badge>
                    : <Badge variant="destructive"><ArrowUpCircle className="h-3 w-3 mr-1" />Cash Out</Badge>}
                </TableCell>
                <TableCell className="text-right font-medium">{money(r.amount)}</TableCell>
                <TableCell>{r.reason ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{r.notes ?? "—"}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => { setForm({ id: r.id, business_date: r.business_date, type: r.type, amount: Number(r.amount), reason: r.reason ?? "", notes: r.notes ?? "" }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete?")) del.mutate(r.id); }}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No movements</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title={form.id ? "Edit Movement" : "New Cash Movement"} open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.amount || Number(form.amount) <= 0) { toast.error("Amount required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.business_date} onChange={(e) => setForm({ ...form, business_date: e.target.value })} /></div>
          <div className="space-y-2"><Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash_in">Cash In</SelectItem>
                <SelectItem value="cash_out">Cash Out</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2"><Label>Amount</Label>
          <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value === "" ? "" : Number(e.target.value) })} />
        </div>
        <div className="space-y-2"><Label>Reason</Label>
          <Input placeholder="e.g. Owner withdrawal, Change money, Vegetable purchase" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </div>
        <div className="space-y-2"><Label>Notes</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </CrudDialog>
    </div>
  );
}
