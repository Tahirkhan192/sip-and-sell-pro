import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";
import { money, today } from "@/lib/format";
import { CrudDialog, PageHeader } from "@/components/CrudHelpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/expenses")({ component: Page });

const CATEGORIES = ["Fuel","Salary","Electricity","Gas","Maintenance","Internet","Other"];
type E = { id?: string; date: string; category: string; amount: number; description: string };
const empty: E = { date: today(), category: "Other", amount: 0, description: "" };

function Page() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<E>(empty);

  const { data = [] } = useQuery({ queryKey: ["expenses"], queryFn: async () => (await supabase.from("expenses").select("*").order("date",{ascending:false}).limit(200)).data ?? [] });

  const save = useMutation({
    mutationFn: async (p: E) => {
      const res = p.id
        ? await supabase.from("expenses").update({ date:p.date, category:p.category, amount:p.amount, description:p.description||null }).eq("id", p.id)
        : await supabase.from("expenses").insert({ date:p.date, category:p.category, amount:p.amount, description:p.description||null });
      if (res.error) throw res.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("expenses").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
  });

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Operating expenses by category"
        action={<Button onClick={()=>{setForm(empty); setOpen(true);}}><Plus className="h-4 w-4 mr-1" />Add Expense</Button>} />
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Description</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {data.map((p:any)=>(
              <TableRow key={p.id}>
                <TableCell>{p.date}</TableCell>
                <TableCell>{p.category}</TableCell>
                <TableCell className="text-right font-medium">{money(p.amount)}</TableCell>
                <TableCell className="max-w-xs truncate">{p.description ?? "—"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={()=>{if(confirm("Delete?")) del.mutate(p.id);}}><Trash2 className="h-4 w-4" /></Button></TableCell>
              </TableRow>
            ))}
            {data.length===0 && <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">No expenses</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <CrudDialog title="New Expense" open={open} onOpenChange={setOpen} onSubmit={async () => {
        if (!form.amount) { toast.error("Amount required"); return false; }
        await save.mutateAsync(form); return true;
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>Date</Label><Input type="date" value={form.date} onChange={(e)=>setForm({...form, date:e.target.value})} /></div>
          <div className="space-y-2"><Label>Category</Label>
            <Select value={form.category} onValueChange={(v)=>setForm({...form, category: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(c=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2"><Label>Amount</Label><Input type="number" step="0.01" value={form.amount} onChange={(e)=>setForm({...form, amount:Number(e.target.value)})} /></div>
        <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})} /></div>
      </CrudDialog>
    </div>
  );
}
