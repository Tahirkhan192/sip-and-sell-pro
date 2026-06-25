import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { money, num } from "@/lib/format";
import { Trash2, Plus, Printer, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POS,
});

type CartItem = { product_id: string; name: string; price: number; quantity: number };

function POS() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastInvoice, setLastInvoice] = useState<any>(null);

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return products.slice(0, 12);
    return products.filter((p: any) => p.name.toLowerCase().includes(q)).slice(0, 16);
  }, [products, search]);

  function addToCart(p: any) {
    setCart((c) => {
      const idx = c.findIndex((i) => i.product_id === p.id);
      if (idx >= 0) {
        const next = [...c];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...c, { product_id: p.id, name: p.name, price: num(p.sale_price), quantity: 1 }];
    });
  }

  const grandTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const { data, error } = await supabase.rpc("save_sale", {
        _items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (sale: any) => {
      toast.success(`Invoice ${sale.invoice_no} saved`);
      setLastInvoice({ ...sale, items: cart });
      setCart([]);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  function handlePrint() {
    window.print();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="space-y-3 no-print">
        <Input
          autoFocus
          placeholder="Search product (type to filter, e.g. 'ch')"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-12 text-base"
        />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p: any) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="rounded-lg border bg-card hover:bg-accent/40 hover:border-accent transition p-3 text-left"
            >
              <div className="font-medium text-sm leading-tight">{p.name}</div>
              <div className="text-xs text-muted-foreground mt-1">{p.category ?? "—"}</div>
              <div className="text-sm font-semibold text-primary mt-2">{money(p.sale_price)}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground col-span-full">No products. Add some in Products.</div>
          )}
        </div>
      </div>

      <Card className="no-print h-fit">
        <CardContent className="p-4 space-y-3">
          <div className="font-semibold">Current Order</div>
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tap products to add</p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
              {cart.map((i, idx) => (
                <div key={i.product_id} className="flex items-center gap-2">
                  <div className="flex-1 text-sm">
                    <div className="font-medium leading-tight">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{money(i.price)} each</div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={i.quantity}
                    onChange={(e) => {
                      const q = Number(e.target.value);
                      setCart((c) => c.map((x, j) => (j === idx ? { ...x, quantity: q } : x)).filter((x) => x.quantity > 0));
                    }}
                    className="w-16 h-8 text-center"
                  />
                  <div className="w-20 text-right text-sm font-medium">{money(i.price * i.quantity)}</div>
                  <Button size="icon" variant="ghost" onClick={() => setCart((c) => c.filter((_, j) => j !== idx))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="border-t pt-3 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">Grand Total</div>
            <div className="text-xl font-bold">{money(grandTotal)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={cart.length === 0 || saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
            <Button variant="outline" onClick={handlePrint} disabled={!lastInvoice}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
          {lastInvoice && (
            <p className="text-xs text-muted-foreground text-center">Last: {lastInvoice.invoice_no}</p>
          )}
        </CardContent>
      </Card>

      {lastInvoice && (
        <div className="print-area hidden print:block">
          <InvoicePrint invoice={lastInvoice} />
        </div>
      )}
    </div>
  );
}

export function InvoicePrint({ invoice }: { invoice: any }) {
  return (
    <div className="p-8 text-black bg-white max-w-md mx-auto font-mono text-sm">
      <div className="text-center border-b border-dashed pb-2 mb-2">
        <div className="text-lg font-bold">Café Manager</div>
        <div className="text-xs">Tax Invoice</div>
      </div>
      <div className="flex justify-between text-xs mb-2">
        <span>{invoice.invoice_no}</span>
        <span>{new Date(invoice.sale_date ?? Date.now()).toLocaleString()}</span>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-dashed"><th className="text-left">Item</th><th>Qty</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {(invoice.items ?? []).map((i: any, idx: number) => (
            <tr key={idx}><td>{i.name}</td><td className="text-center">{i.quantity}</td><td className="text-right">{money(i.price * i.quantity)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed mt-2 pt-2 flex justify-between font-bold">
        <span>TOTAL</span><span>{money(invoice.grand_total)}</span>
      </div>
      <div className="text-center text-xs mt-3">Thank you — please come again</div>
    </div>
  );
}
