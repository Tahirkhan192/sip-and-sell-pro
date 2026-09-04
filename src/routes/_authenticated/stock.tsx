import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/CrudHelpers";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StockToExpenseDialog } from "@/components/StockToExpenseDialog";
import { StockAvailability, useProductStockAvailable, useStockItemAvailable } from "@/components/StockAvailability";
import { OpeningStockHistory } from "@/components/OpeningStockHistory";
import { buildLockRows, lockMonthOpening, monthLabel, previousMonthOf } from "@/lib/month-opening";
import { money, num } from "@/lib/format";
import { CATEGORIES } from "@/lib/categories";
import { Search, CalendarClock, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";


export const Route = createFileRoute("/_authenticated/stock")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const now = new Date();
  const [lockOpen, setLockOpen] = useState(false);
  const [lockYear, setLockYear] = useState(now.getFullYear());
  const [lockMonth, setLockMonth] = useState(now.getMonth() + 1);
  const prev = previousMonthOf(lockYear, lockMonth);

  const preview = useQuery({
    queryKey: ["lock-preview", lockOpen],
    queryFn: buildLockRows,
    enabled: lockOpen,
  });

  const setOpening = useMutation({
    mutationFn: async () => {
      const rows = preview.data ?? (await buildLockRows());
      return lockMonthOpening(lockYear, lockMonth, rows);
    },
    onSuccess: (count) => {
      toast.success(`Saved: opening of ${monthLabel(lockYear, lockMonth)} and closing of ${monthLabel(prev.year, prev.month)} (${count} items)`);
      setLockOpen(false);
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["stock-monthly"] });
      qc.invalidateQueries({ queryKey: ["stock-opening-history"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["inventory-engine"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="Current stock & monthly movement"
        action={
          <Button variant="outline" onClick={() => setLockOpen(true)}>
            <CalendarClock className="h-4 w-4 mr-1" />Set As Opening Stock
          </Button>
        }
      />

      <Dialog open={lockOpen} onOpenChange={(v) => { if (!setOpening.isPending) setLockOpen(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set As Opening Stock</DialogTitle>
            <DialogDescription>
              The current stock of every product and stock item (after all adjustments) is written into the
              opening of the selected month and saved as the closing of the previous month. Opening is replaced,
              never added. Purchase price is carried automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <div className="space-y-1 flex-1"><Label className="text-xs">Opening Year</Label><Input type="number" value={lockYear} onChange={(e) => setLockYear(Number(e.target.value))} /></div>
            <div className="space-y-1 flex-1"><Label className="text-xs">Opening Month</Label><Input type="number" min={1} max={12} value={lockMonth} onChange={(e) => setLockMonth(Number(e.target.value))} /></div>
          </div>
          <div className="rounded-md border p-3 text-sm space-y-1">
            <div>Opening of <b>{monthLabel(lockYear, lockMonth)}</b></div>
            <div>Closing of <b>{monthLabel(prev.year, prev.month)}</b></div>
            <div className="text-muted-foreground">
              {preview.isLoading ? "Reading current stock…" : `${preview.data?.length ?? 0} items will be saved`}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockOpen(false)} disabled={setOpening.isPending}>Cancel</Button>
            <Button onClick={() => setOpening.mutate()} disabled={setOpening.isPending || preview.isLoading}>
              {setOpening.isPending ? "Saving…" : "Save Record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="current">
        <TabsList>
          <TabsTrigger value="current">Current Stock</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="history">Opening / Closing History</TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="pt-4"><CurrentStock /></TabsContent>
        <TabsContent value="monthly" className="pt-4"><MonthlyStock /></TabsContent>
        <TabsContent value="history" className="pt-4"><OpeningStockHistory /></TabsContent>
      </Tabs>
    </div>
  );
}


function CurrentStock() {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [transferTarget, setTransferTarget] = useState<any>(null);

  const { data: rawProducts = [] } = useQuery({
    queryKey: ["stock", "products"],
    queryFn: async () => (await supabase.from("products").select("id,name,category,current_stock,minimum_stock,cost_price,opening_stock").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: rawItems = [] } = useQuery({
    queryKey: ["stock", "items"],
    queryFn: async () => (await supabase.from("stock_items").select("id,name,unit,current_stock,minimum_stock,purchase_price,opening_stock").is("deleted_at", null).order("name")).data ?? [],
  });

  // Single source of truth — same calculated Remaining as Reports and POS.
  const { data: calcProducts = [] } = useProductStockAvailable();
  const { data: calcItems = [] } = useStockItemAvailable();
  const products = useMemo(() => {
    const m: Record<string, number> = {};
    // Untracked products are excluded from the engine (remaining = 0) —
    // keep their stored Current Stock so the column is never blanked out.
    for (const r of calcProducts) if (r.tracked) m[r.id] = r.remaining;
    return (rawProducts as any[]).map((p) => (m[p.id] === undefined ? p : { ...p, current_stock: m[p.id] }));
  }, [rawProducts, calcProducts]);
  const items = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of calcItems) m[r.id] = r.remaining;
    return (rawItems as any[]).map((p) => (m[p.id] === undefined ? p : { ...p, current_stock: m[p.id] }));
  }, [rawItems, calcItems]);

  const filtered = useMemo(() => {
    let rows = (products as any[]).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== "all") rows = rows.filter((p) => p.category === catFilter);
    return rows;
  }, [products, search, catFilter]);


  return (
    <div className="space-y-6">
      <StockAvailability />

      <div className="flex gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Products</h3>
        <Card>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Product</TableHead><TableHead>Category</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Stock Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.category ?? "—"}</TableCell>
                  <TableCell className="text-right">{num(r.opening_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">{num(r.current_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{num(r.minimum_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{money(num(r.current_stock) * num(r.cost_price))}</TableCell>
                  <TableCell>{num(r.current_stock) < num(r.minimum_stock) ? <Badge variant="destructive">Low</Badge> : <Badge>OK</Badge>}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" title="Transfer to Expense" onClick={() => setTransferTarget({ kind: "product", id: r.id, name: r.name, cost: num(r.cost_price), current: num(r.current_stock) })}>
                      <ArrowRightLeft className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No products</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Stock Items</h3>
        <Card>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Item</TableHead><TableHead>Unit</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Stock Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(items as any[]).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell className="text-right">{num(r.opening_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right font-medium">{num(r.current_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{num(r.minimum_stock).toFixed(2)}</TableCell>
                  <TableCell className="text-right">{money(num(r.current_stock) * num(r.purchase_price))}</TableCell>
                  <TableCell>{num(r.current_stock) < num(r.minimum_stock) ? <Badge variant="destructive">Low</Badge> : <Badge>OK</Badge>}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" title="Transfer to Expense" onClick={() => setTransferTarget({ kind: "stock_item", id: r.id, name: r.name, unit: r.unit, cost: num(r.purchase_price), current: num(r.current_stock) })}>
                      <ArrowRightLeft className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No stock items</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </div>
      <StockToExpenseDialog target={transferTarget} open={!!transferTarget} onOpenChange={(v) => { if (!v) setTransferTarget(null); }} />
    </div>
  );
}

function MonthlyStock() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10);
  const toNext = new Date(year, month, 1).toISOString().slice(0, 10);

  const { data: products = [] } = useQuery({
    queryKey: ["stock-monthly", "products"],
    queryFn: async () => (await supabase.from("products").select("id,name,opening_stock,current_stock,cost_price").is("deleted_at", null).order("name")).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["stock-monthly", "purchases", from, to],
    queryFn: async () => (await supabase.from("stock_purchases").select("product_id,quantity,total_cost").is("deleted_at", null).not("product_id", "is", null).gte("date", from).lte("date", to)).data ?? [],
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["stock-monthly", "sales", from, toNext],
    queryFn: async () => (await supabase.from("sale_items").select("product_id,quantity,sales!inner(sale_date,status,deleted_at)").gte("sales.sale_date", from).lt("sales.sale_date", toNext)).data ?? [],
  });

  const rows = useMemo(() => {
    const byProd: Record<string, { name: string; opening: number; purchased: number; sold: number; remaining: number; cost: number }> = {};
    for (const p of products as any[]) byProd[p.id] = { name: p.name, opening: num(p.opening_stock), purchased: 0, sold: 0, remaining: num(p.current_stock), cost: num(p.cost_price) };
    for (const pu of purchases as any[]) {
      if (byProd[pu.product_id]) byProd[pu.product_id].purchased += num(pu.quantity);
    }
    for (const s of sales as any[]) {
      const sa = s.sales;
      if (!sa || sa.deleted_at) continue;
      if (sa.status !== "completed") continue;
      if (byProd[s.product_id]) byProd[s.product_id].sold += num(s.quantity);
    }
    return Object.values(byProd);
  }, [products, purchases, sales]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-end max-w-sm">
        <div className="space-y-1 flex-1"><Label className="text-xs">Year</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
        <div className="space-y-1 flex-1"><Label className="text-xs">Month</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} /></div>
      </div>
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right">Purchased</TableHead>
            <TableHead className="text-right">Sold</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">Stock Value</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.purchased.toFixed(2)}</TableCell>
                <TableCell className="text-right">{r.sold.toFixed(2)}</TableCell>
                <TableCell className="text-right font-medium">{r.remaining.toFixed(2)}</TableCell>
                <TableCell className="text-right">{money(r.remaining * r.cost)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No products</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
