import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { money, num } from "@/lib/format";
import { Trash2, Printer, Save, Clock, X, Search, User, Trash } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const searchSchema = z.object({ edit: z.string().optional() });

export const Route = createFileRoute("/_authenticated/pos")({
  component: POS,
  validateSearch: searchSchema,
});

type CartItem = { product_id: string; name: string; price: number; quantity: number };

function POS() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { edit: editId } = Route.useSearch();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [showInvoiceResults, setShowInvoiceResults] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load pending sale for editing
  const { data: editingSale } = useQuery({
    queryKey: ["sales", "edit", editId],
    enabled: !!editId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("*, sale_items(*, products(id, name, sale_price))")
        .eq("id", editId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (editingSale) {
      setCustomer(editingSale.customer_name ?? "");
      setCart(
        (editingSale.sale_items ?? []).map((it: any) => ({
          product_id: it.product_id,
          name: it.products?.name ?? "Item",
          price: num(it.price),
          quantity: num(it.quantity),
        }))
      );
      setInvoiceSearch("");
      setShowInvoiceResults(false);
    }
  }, [editingSale]);

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["sales", "pending-search", invoiceSearch.trim().toLowerCase()],
    enabled: invoiceSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, invoice_no, customer_name, grand_total, sale_date")
        .eq("status", "pending")
        .ilike("customer_name", `%${invoiceSearch.trim()}%`)
        .order("sale_date", { ascending: false })
        .limit(8);
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

  function resetForm() {
    setCart([]);
    setCustomer("");
    if (editId) navigate({ to: "/pos", search: {} });
  }

  const grandTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pending invoice deleted");
      resetForm();
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  const saveMutation = useMutation({
    mutationFn: async (status: "pending" | "completed") => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const items = cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
      if (editId) {
        const { data, error } = await supabase.rpc("update_pending_sale", {
          _sale_id: editId,
          _items: items,
          _customer_name: customer,
          _status: status,
        });
        if (error) throw error;
        return { sale: data, status };
      }
      const { data, error } = await supabase.rpc("save_sale", {
        _items: items,
        _customer_name: customer,
        _status: status,
      });
      if (error) throw error;
      return { sale: data, status };
    },
    onSuccess: ({ sale, status }: any) => {
      toast.success(
        status === "pending"
          ? `Invoice ${sale.invoice_no} saved as pending`
          : `Invoice ${sale.invoice_no} completed`
      );
      if (status === "completed") setLastInvoice({ ...sale, items: cart });
      resetForm();
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
          <div className="flex items-center justify-between">
            <div className="font-semibold">
              {editId ? `Editing ${editingSale?.invoice_no ?? "…"}` : "Current Order"}
            </div>
            {editId && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm("Delete this pending invoice?")) deleteMutation.mutate(editId);
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash className="h-4 w-4 mr-1" /> Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm}>
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
              </div>
            )}
          </div>
          {!editId && (
            <div className="relative">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input
                  placeholder="Search pending invoice by customer name…"
                  value={invoiceSearch}
                  onChange={(e) => {
                    setInvoiceSearch(e.target.value);
                    setShowInvoiceResults(true);
                  }}
                  onFocus={() => setShowInvoiceResults(true)}
                  className="h-9 text-sm"
                />
              </div>
              {showInvoiceResults && invoiceSearch.trim().length >= 2 && (
                <div className="absolute z-20 w-full mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-auto">
                  {pendingInvoices.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No pending invoices found</div>
                  ) : (
                    pendingInvoices.map((inv: any) => (
                      <button
                        key={inv.id}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2"
                        onClick={() => {
                          navigate({ to: "/pos", search: { edit: inv.id } });
                          setInvoiceSearch("");
                          setShowInvoiceResults(false);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{inv.invoice_no} — {inv.customer_name || "Walk-in"}</span>
                        </div>
                        <span className="text-muted-foreground text-xs shrink-0">{money(inv.grand_total)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          <Input
            placeholder="Customer name (optional)"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tap products to add</p>
          ) : (
            <div className="space-y-2 max-h-[45vh] overflow-auto pr-1">
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
            <Button
              variant="outline"
              onClick={() => saveMutation.mutate("pending")}
              disabled={cart.length === 0 || saveMutation.isPending}
            >
              <Clock className="h-4 w-4 mr-1" /> Save Pending
            </Button>
            <Button
              onClick={() => saveMutation.mutate("completed")}
              disabled={cart.length === 0 || saveMutation.isPending}
            >
              <Save className="h-4 w-4 mr-1" /> {editId ? "Complete" : "Save"}
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={handlePrint} disabled={!lastInvoice}>
            <Printer className="h-4 w-4 mr-1" /> Print Last
          </Button>
          {lastInvoice && (
            <p className="text-xs text-muted-foreground text-center">Last: {lastInvoice.invoice_no}</p>
          )}
        </CardContent>
      </Card>

      {lastInvoice && (
        <div className="print-area hidden print:block">
          <InvoicePrint invoice={lastInvoice} customer={customer} />
        </div>
      )}
    </div>
  );
}

export function InvoicePrint({ invoice, customer }: { invoice: any; customer?: string }) {
  const name = customer ?? invoice.customer_name;
  return (
    <div className="p-8 text-black bg-white max-w-md mx-auto font-mono text-sm">
      <div className="text-center border-b border-dashed pb-2 mb-2">
        <div className="text-lg font-bold">Café Manager</div>
        <div className="text-xs">Tax Invoice</div>
      </div>
      <div className="flex justify-between text-xs mb-1">
        <span>{invoice.invoice_no}</span>
        <span>{new Date(invoice.sale_date ?? Date.now()).toLocaleString()}</span>
      </div>
      {name && <div className="text-xs mb-2">Customer: <span className="font-semibold">{name}</span></div>}
      <table className="w-full text-xs">
        <thead><tr className="border-b border-dashed"><th className="text-left">Item</th><th>Qty</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {(invoice.items ?? invoice.sale_items ?? []).map((i: any, idx: number) => (
            <tr key={idx}>
              <td>{i.name ?? i.products?.name}</td>
              <td className="text-center">{i.quantity}</td>
              <td className="text-right">{money((i.price ?? 0) * i.quantity)}</td>
            </tr>
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
