import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, num } from "@/lib/format";
import { Trash2, Printer, Save, Clock, X, Search, User, Trash, AlertTriangle, Check, AlertCircle, BookMarked } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { sendWhatsappInvoice } from "@/lib/whatsapp";
import { useCategories } from "@/lib/use-categories";
import { businessToday, businessDateOf, businessDayStartUTC, formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

const searchSchema = z.object({ edit: z.string().optional() });

export const Route = createFileRoute("/_authenticated/pos")({
  component: POS,
  validateSearch: searchSchema,
});

type CartItem = {
  product_id: string;
  name: string;
  category: string;
  unit: string;
  selling_method: "fixed" | "weight";
  rate: number;
  quantity: number;
  total: number;
  current_stock: number;
};

const UNIT_LABEL: Record<string, string> = { kg: "KG", ltr: "LTR", pcs: "PCS" };

function round2(n: number) { return Math.round(n * 100) / 100; }
function round3(n: number) { return Math.round(n * 1000) / 1000; }

function POS() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { edit: editId } = Route.useSearch();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const { data: categoryList = [] } = useCategories();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [katha, setKatha] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [orderType, setOrderType] = useState<"walk_in" | "take_away" | "delivery">("walk_in");
  const [delivery, setDelivery] = useState<number | "">("");
  const [deliveryBoy, setDeliveryBoy] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [paid, setPaid] = useState<number | "">("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "online">("cash");
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState<number | "">("");
  const [saleDate, setSaleDate] = useState<string>(() => businessToday());
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [showInvoiceResults, setShowInvoiceResults] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [priorityBump, setPriorityBump] = useState<Record<string, number>>({});

  const { data: products = [] } = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () => (await supabase.from("products").select("*").eq("active", true).is("deleted_at", null)
      .order("last_sold_at" as any, { ascending: false, nullsFirst: false })
      .order("name")).data ?? [],
  });

  const { data: editingSale } = useQuery({
    queryKey: ["sales", "edit", editId],
    enabled: !!editId,
    queryFn: async () => (await supabase.from("sales").select("*, sale_items(*, products(id, name, category, sale_price, unit, selling_method, current_stock))").eq("id", editId!).maybeSingle()).data,
  });

  useEffect(() => {
    if (editingSale) {
      const s: any = editingSale;
      setCustomer(s.customer_name ?? "");
      setPhone(s.customer_phone ?? "");
      setKatha(!!s.katha);
      setOrderType((s.order_type ?? "walk_in") as any);
      setDelivery(num(s.delivery_charges) || "");
      setDeliveryBoy(s.delivery_boy ?? "");
      setDeliveryAddress(s.delivery_address ?? "");
      const totalPaid = num(s.cash_paid) + num(s.online_paid);
      setPaid(totalPaid > 0 ? totalPaid : "");
      setPaymentMethod(num(s.online_paid) > num(s.cash_paid) ? "online" : "cash");
      if (s.sale_date) setSaleDate(businessDateOf(s.sale_date));
      setDiscountType((s.discount_type ?? "amount") as any);
      setDiscountValue(num(s.discount_value) || "");
      setCart((s.sale_items ?? []).map((it: any) => ({
        product_id: it.product_id,
        name: it.products?.name ?? "Item",
        category: it.products?.category ?? "",
        unit: it.unit ?? it.products?.unit ?? "pcs",
        selling_method: (it.products?.selling_method ?? "fixed") as "fixed" | "weight",
        rate: num(it.price),
        quantity: num(it.quantity),
        total: num(it.total),
        current_stock: num(it.products?.current_stock),
      })));
      setInvoiceSearch("");
      setShowInvoiceResults(false);
    }
  }, [editingSale]);

  const { data: customerSuggestions = [] } = useQuery({
    queryKey: ["customers", "search", customerSearch.trim().toLowerCase()],
    enabled: customerSearch.trim().length >= 2,
    queryFn: async () => (await supabase.from("customers").select("id, name, phone, outstanding_balance")
      .is("deleted_at", null)
      .or(`name.ilike.%${customerSearch.trim()}%,phone.ilike.%${customerSearch.trim()}%`)
      .limit(6)).data ?? [],
  });

  const { data: pendingInvoices = [] } = useQuery({
    queryKey: ["sales", "pending-search", invoiceSearch.trim().toLowerCase()],
    enabled: invoiceSearch.trim().length >= 2,
    queryFn: async () => (await supabase.from("sales").select("id, invoice_no, customer_name, grand_total, sale_date").eq("status", "pending").is("deleted_at", null).ilike("customer_name", `%${invoiceSearch.trim()}%`).order("sale_date", { ascending: false }).limit(8)).data ?? [],
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let rows = products as any[];
    if (catFilter !== "all") rows = rows.filter((p) => p.category === catFilter);
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
    // Client-side priority bump for products just added this session
    const sorted = [...rows].sort((a, b) => (priorityBump[b.id] ?? 0) - (priorityBump[a.id] ?? 0));
    return sorted;
  }, [products, search, catFilter, priorityBump]);

  function addToCart(p: any) {
    setPriorityBump((m) => ({ ...m, [p.id]: Date.now() }));
    setCart((c) => {
      const idx = c.findIndex((i) => i.product_id === p.id);
      if (idx >= 0) {
        const next = [...c];
        const it = next[idx];
        const newQty = Math.floor(it.quantity) + 1;
        next[idx] = { ...it, quantity: newQty, total: round2(newQty * it.rate) };
        return next;
      }
      const rate = num(p.sale_price);
      return [
        ...c,
        {
          product_id: p.id, name: p.name, category: p.category ?? "",
          unit: p.unit ?? "pcs",
          selling_method: (p.selling_method ?? "fixed") as "fixed" | "weight",
          rate, quantity: 1, total: round2(rate),
          current_stock: num(p.current_stock),
        },
      ];
    });
    setSearch("");
    setHighlightIdx(0);
    searchRef.current?.focus();
  }

  function stepQty(idx: number, delta: number) {
    setCart((c) => c.map((it, i) => {
      if (i !== idx) return it;
      const base = Math.floor(it.quantity);
      const q = Math.max(delta > 0 ? 1 : 0, base + delta);
      return { ...it, quantity: q, total: round2(q * it.rate) };
    }));
  }

  function updateLine(idx: number, patch: Partial<CartItem> & { _changed?: "qty" | "rate" | "total" }) {
    setCart((c) => c.map((it, i) => {
      if (i !== idx) return it;
      const merged = { ...it, ...patch } as CartItem;
      const changed = (patch as any)._changed;
      if (changed === "qty" || changed === "rate") {
        merged.total = round2(merged.quantity * merged.rate);
      } else if (changed === "total" && it.selling_method === "weight" && merged.rate > 0) {
        merged.quantity = round3(merged.total / merged.rate);
      }
      return merged;
    }));
  }

  function removeLine(idx: number) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setCart([]); setCustomer(""); setPhone(""); setKatha(false);
    setDelivery(""); setDeliveryBoy(""); setDeliveryAddress("");
    setPaid(""); setPaymentMethod("cash"); setOrderType("walk_in");
    setDiscountType("amount"); setDiscountValue("");
    setSaleDate(businessToday());
    setCustomerSearch(""); setShowCustomerResults(false);
    if (editId) navigate({ to: "/pos", search: {} });
  }

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.total, 0), [cart]);
  const discountAmount = useMemo(() => {
    const v = num(discountValue);
    if (v <= 0) return 0;
    if (discountType === "percent") return round2(subtotal * Math.min(v, 100) / 100);
    return round2(Math.min(v, subtotal));
  }, [subtotal, discountType, discountValue]);
  const effectiveDelivery = orderType === "delivery" ? num(delivery) : 0;
  const grandTotal = round2(Math.max(0, subtotal - discountAmount) + effectiveDelivery);
  const paidNum = num(paid);
  const remaining = Math.max(0, round2(grandTotal - paidNum));
  const change = Math.max(0, round2(paidNum - grandTotal));
  const lowStock = useMemo(() => cart.filter((i) => i.selling_method === "fixed" && i.quantity > i.current_stock), [cart]);
  useEffect(() => { if (remaining <= 0 && katha) setKatha(false); }, [remaining, katha]);

  // Keyboard: '/' focus search, arrows navigate grid, Enter adds, Esc closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement | null;
      const inField = active?.tagName === "INPUT" || active?.tagName === "TEXTAREA";
      if (e.key === "/" && !inField) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === "Escape") { setShowInvoiceResults(false); setShowCustomerResults(false); (active as HTMLInputElement)?.blur?.(); return; }
      // Arrow / Enter work when search is focused or nothing focused
      const searchFocused = active === searchRef.current;
      if (!searchFocused && inField) return;
      if (filtered.length === 0) return;
      const cols = window.innerWidth >= 1280 ? 7 : window.innerWidth >= 1024 ? 6 : window.innerWidth >= 768 ? 5 : window.innerWidth >= 640 ? 4 : 3;
      if (e.key === "ArrowRight") { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - 1)); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(filtered.length - 1, i + cols)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(0, i - cols)); }
      else if (e.key === "Enter" && searchFocused) { e.preventDefault(); addToCart(filtered[highlightIdx] ?? filtered[0]); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, highlightIdx]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pending KDF deleted");
      resetForm();
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  const saveMutation = useMutation({
    mutationFn: async (status: "pending" | "completed") => {
      if (cart.length === 0) throw new Error("Cart is empty");
      const items = cart.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        rate: i.rate,
        unit: i.unit,
      }));
      const args: any = {
        _items: items,
        _customer_name: customer,
        _status: status,
        _delivery_charges: effectiveDelivery,
        _payment_method: paymentMethod === "online" ? "card" : "cash",
        _cash_paid: paymentMethod === "cash" ? paidNum : 0,
        _online_paid: paymentMethod === "online" ? paidNum : 0,
        _order_type: orderType,
        _delivery_boy: deliveryBoy,
        _customer_phone: phone,
        _katha: katha,
        _discount_type: discountType,
        _discount_value: num(discountValue),
        _delivery_address: deliveryAddress,
      };
      // Compute a timestamp that resolves to the intended business date.
      // If saleDate === today's business date, use "now" so business time is accurate.
      // Otherwise anchor to the start of that business day (08:00 local of that date).
      const today = businessToday();
      const saleTs = saleDate && saleDate !== today
        ? businessDayStartUTC(saleDate)
        : new Date().toISOString();
      if (editId) {
        const { data, error } = await supabase.rpc("update_sale" as any, {
          _sale_id: editId, ...args,
          _sale_date: saleTs,
        });
        if (error) throw error;
        return { sale: data, status };
      }
      const { data, error } = await supabase.rpc("save_sale" as any, args);
      if (error) throw error;
      // If cashier chose a back-date, sync sale_date
      if (data && saleDate && saleDate !== today) {
        await supabase.from("sales").update({ sale_date: saleTs } as any).eq("id", (data as any).id);
      }
      return { sale: data, status };
    },
    onSuccess: async ({ sale, status }: any) => {
      toast.success(status === "pending" ? `KDF ${sale.invoice_no} saved as pending` : `KDF ${sale.invoice_no} completed`);
      if (status === "completed") {
        setLastInvoice({ ...sale, items: cart });
        // Silent WhatsApp send (non-blocking)
        if (phone) {
          sendWhatsappInvoice({
            invoice_no: sale.invoice_no,
            customer_phone: phone,
            customer_name: customer,
            grand_total: num(sale.grand_total),
            cash_paid: paymentMethod === "cash" ? paidNum : 0,
            online_paid: paymentMethod === "online" ? paidNum : 0,
            items: cart.map((i) => ({ name: i.name, quantity: i.quantity, total: i.total, unit: i.unit })),
          }).then((r) => {
            if (r.ok) toast.success("WhatsApp KDF sent");
            else if (r.reason !== "not-configured" && r.reason !== "no-phone")
              toast.message("WhatsApp not sent — KDF saved", { description: r.reason });
          });
        }
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_460px]">
      <div className="space-y-3 no-print">
        <Input
          ref={searchRef}
          autoFocus
          placeholder="Search product…  (press / to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered.length > 0) { e.preventDefault(); addToCart(filtered[0]); }
          }}
          className="h-12 text-base"
        />
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={catFilter === "all" ? "default" : "outline"} className="h-7 text-xs" onClick={() => setCatFilter("all")}>All</Button>
          {(categoryList as string[]).map((c) => (
            <Button key={c} size="sm" variant={catFilter === c ? "default" : "outline"} className="h-7 text-xs" onClick={() => setCatFilter(c)}>{c}</Button>
          ))}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-1.5 max-h-[calc(100vh-200px)] overflow-auto pr-1">
          {filtered.map((p: any) => (
            <button key={p.id} onClick={() => addToCart(p)} className="rounded-md border bg-card hover:bg-accent/40 hover:border-accent transition px-1.5 py-1.5 text-left flex flex-col gap-0.5 min-h-[64px]">
              <div className="font-medium text-[11px] leading-tight line-clamp-2">{p.name}</div>
              <div className="mt-auto flex items-baseline justify-between gap-1">
                <div className="text-xs font-semibold text-primary">{money(p.sale_price)}</div>
                {p.track_stock !== false && (
                  <div className={"text-[9px] " + (num(p.current_stock) <= num(p.minimum_stock) ? "text-destructive" : "text-muted-foreground")}>
                    {num(p.current_stock).toFixed(p.unit === "pcs" ? 0 : 1)}
                  </div>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="text-sm text-muted-foreground col-span-full">No products. Add some in Products.</div>}
        </div>
      </div>

      <Card className="no-print h-fit">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{editId ? `Editing ${(editingSale as any)?.invoice_no ?? "…"}` : "Current Order"}</div>
            {editId && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => { if (confirm("Delete this pending KDF?")) deleteMutation.mutate(editId); }} disabled={deleteMutation.isPending}>
                  <Trash className="h-4 w-4 mr-1" /> Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={resetForm}><X className="h-4 w-4 mr-1" /> Cancel</Button>
              </div>
            )}
          </div>

          {!editId && (
            <div className="relative">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <Input placeholder="Find pending KDF by customer…" value={invoiceSearch} onChange={(e) => { setInvoiceSearch(e.target.value); setShowInvoiceResults(true); }} onFocus={() => setShowInvoiceResults(true)} className="h-9 text-sm" />
              </div>
              {showInvoiceResults && invoiceSearch.trim().length >= 2 && (
                <div className="absolute z-20 w-full mt-1 rounded-md border bg-popover shadow-md max-h-60 overflow-auto">
                  {pendingInvoices.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No pending KDFs found</div>
                  ) : (
                    (pendingInvoices as any[]).map((inv) => (
                      <button key={inv.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2" onClick={() => { navigate({ to: "/pos", search: { edit: inv.id } }); setInvoiceSearch(""); setShowInvoiceResults(false); }}>
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

          {/* Customer + phone with live suggestions */}
          <div className="relative grid grid-cols-2 gap-2">
            <Input placeholder="Customer name"
              value={customer}
              onChange={(e) => { setCustomer(e.target.value); setCustomerSearch(e.target.value); setShowCustomerResults(true); }}
              onFocus={() => { setCustomerSearch(customer); setShowCustomerResults(true); }}
            />
            <Input placeholder="Mobile number"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setCustomerSearch(e.target.value); setShowCustomerResults(true); }}
              onFocus={() => { setCustomerSearch(phone); setShowCustomerResults(true); }}
            />
            {showCustomerResults && customerSearch.trim().length >= 2 && customerSuggestions.length > 0 && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-md max-h-48 overflow-auto">
                {(customerSuggestions as any[]).map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between"
                    onClick={() => { setCustomer(c.name); setPhone(c.phone ?? ""); setShowCustomerResults(false); }}>
                    <span><User className="h-3 w-3 inline mr-1" />{c.name}{c.phone ? ` · ${c.phone}` : ""}</span>
                    {num(c.outstanding_balance) > 0 && <span className="text-xs text-destructive">{money(c.outstanding_balance)}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Order type */}
          <div className="grid grid-cols-3 gap-1">
            {(["walk_in", "take_away", "delivery"] as const).map((t) => (
              <Button key={t} size="sm" variant={orderType === t ? "default" : "outline"} onClick={() => setOrderType(t)} className="capitalize">{t.replace("_", " ")}</Button>
            ))}
          </div>

          {/* Cart */}
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tap products to add</p>
          ) : (
            <div className="max-h-[36vh] overflow-auto pr-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 text-[11px]">Product</TableHead>
                    <TableHead className="h-7 text-[11px] w-20">Qty</TableHead>
                    <TableHead className="h-7 text-[11px] w-20">Rate</TableHead>
                    <TableHead className="h-7 text-[11px] w-24 text-right">Total</TableHead>
                    <TableHead className="h-7 w-6"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cart.map((it, idx) => {
                    const low = it.selling_method === "fixed" && it.quantity > it.current_stock;
                    return (
                      <TableRow key={it.product_id}>
                        <TableCell className="py-1">
                          <div className="font-medium text-xs leading-tight">{it.name}</div>
                          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <span>{UNIT_LABEL[it.unit]}</span>
                            {low && <span className="text-destructive inline-flex items-center gap-0.5"><AlertTriangle className="h-2.5 w-2.5" /> low</span>}
                          </div>
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center gap-0.5">
                            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => stepQty(idx, -1)}>−</Button>
                            <Input
                              type="number" step={it.selling_method === "weight" ? "0.001" : "1"} min={0}
                              value={it.quantity === 0 ? "" : it.quantity}
                              placeholder="0"
                              onChange={(e) => updateLine(idx, { quantity: e.target.value === "" ? 0 : Number(e.target.value), _changed: "qty" } as any)}
                              className="h-7 text-xs px-1 w-12 text-center"
                            />
                            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => stepQty(idx, 1)}>+</Button>
                          </div>
                        </TableCell>
                        <TableCell className="py-1">
                          <Input
                            type="number" step="0.01" min={0}
                            value={it.rate === 0 ? "" : it.rate}
                            placeholder="0.00"
                            onChange={(e) => updateLine(idx, { rate: e.target.value === "" ? 0 : Number(e.target.value), _changed: "rate" } as any)}
                            className="h-7 text-xs px-1"
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          {it.selling_method === "weight" ? (
                            <Input
                              type="number" step="0.01" min={0}
                              value={it.total === 0 ? "" : it.total}
                              placeholder="0.00"
                              onChange={(e) => updateLine(idx, { total: e.target.value === "" ? 0 : Number(e.target.value), _changed: "total" } as any)}
                              className="h-7 text-xs px-1 text-right"
                            />
                          ) : (
                            <div className="text-xs text-right font-medium pr-1">{money(it.total)}</div>
                          )}
                        </TableCell>
                        <TableCell className="py-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {lowStock.length > 0 && (
            <div className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Low stock on {lowStock.length} item(s) — sale still allowed</div>
          )}

          {/* Delivery */}
          {orderType === "delivery" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Delivery Charges</Label>
                <Input type="number" step="0.01" value={delivery} placeholder="0.00" onChange={(e) => setDelivery(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delivery Boy</Label>
                <Input value={deliveryBoy} onChange={(e) => setDeliveryBoy(e.target.value)} className="h-9" placeholder="Name" />
              </div>
            </div>
          )}

          {/* Totals + payment */}
          <div className="border-t pt-3 space-y-2 text-sm">
            {/* KDF date + discount */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">KDF Date</Label>
                <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Discount</Label>
                <div className="flex gap-1">
                  <Input type="number" step="0.01" value={discountValue} placeholder="0"
                    onChange={(e) => setDiscountValue(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
                  <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 px-2"
                    onClick={() => setDiscountType(discountType === "amount" ? "percent" : "amount")}>
                    {discountType === "amount" ? "Rs" : "%"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></div>
            {discountAmount > 0 && <div className="flex items-center justify-between"><span className="text-muted-foreground">Discount</span><span className="text-destructive">− {money(discountAmount)}</span></div>}
            {effectiveDelivery > 0 && <div className="flex items-center justify-between"><span className="text-muted-foreground">Delivery</span><span>{money(effectiveDelivery)}</span></div>}
            <div className="flex items-center justify-between pt-1 border-t">
              <span className="text-muted-foreground">Grand Total</span>
              <span className="text-xl font-bold">{money(grandTotal)}</span>
            </div>

            {/* Payment method */}
            <div className="grid grid-cols-2 gap-1">
              <Button type="button" size="sm" variant={paymentMethod === "cash" ? "default" : "outline"} onClick={() => setPaymentMethod("cash")}>Cash</Button>
              <Button type="button" size="sm" variant={paymentMethod === "online" ? "default" : "outline"} onClick={() => setPaymentMethod("online")}>Online</Button>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Paid Amount</Label>
              <div className="flex gap-1">
                <Input type="number" step="0.01" value={paid} placeholder="0.00"
                  onChange={(e) => setPaid(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
                <Button type="button" size="sm" variant="outline" className="h-9 shrink-0"
                  onClick={() => setPaid(grandTotal)} disabled={grandTotal <= 0}>Paid All</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between bg-muted/50 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Remaining</span>
                <span className={"font-semibold " + (remaining > 0 ? "text-amber-600" : "")}>{money(remaining)}</span>
              </div>
              <div className="flex justify-between bg-muted/50 rounded px-2 py-1.5">
                <span className="text-muted-foreground">Change</span>
                <span className={"font-semibold " + (change > 0 ? "text-emerald-600" : "")}>{money(change)}</span>
              </div>
            </div>

            {/* Katha toggle */}
            <label className={"flex items-center gap-2 text-xs rounded px-2 py-1.5 border " + (remaining <= 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer")}>
              <input type="checkbox" disabled={remaining <= 0} checked={katha} onChange={(e) => setKatha(e.target.checked)} />
              <BookMarked className="h-3.5 w-3.5" />
              <span>Add remaining to Katha</span>
            </label>

            {/* Payment status badge */}
            {cart.length > 0 && (
              remaining <= 0 ? (
                <Badge className="w-full justify-center bg-emerald-600 hover:bg-emerald-600"><Check className="h-3 w-3 mr-1" /> FULLY PAID</Badge>
              ) : katha ? (
                <Badge className="w-full justify-center bg-emerald-600 hover:bg-emerald-600"><BookMarked className="h-3 w-3 mr-1" /> ADDED TO KATHA</Badge>
              ) : (
                <Badge variant="destructive" className="w-full justify-center"><AlertCircle className="h-3 w-3 mr-1" /> NOT PAID FULLY · {money(remaining)}</Badge>
              )
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => saveMutation.mutate("pending")} disabled={cart.length === 0 || saveMutation.isPending}>
              <Clock className="h-4 w-4 mr-1" /> Save Pending
            </Button>
            <Button onClick={() => saveMutation.mutate("completed")} disabled={cart.length === 0 || saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" /> {editId ? "Complete" : "Save"}
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={() => window.print()} disabled={!lastInvoice}>
            <Printer className="h-4 w-4 mr-1" /> Print Last
          </Button>
          {lastInvoice && <p className="text-xs text-muted-foreground text-center">Last: {lastInvoice.invoice_no}</p>}
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
  const items = invoice.items ?? invoice.sale_items ?? [];
  const subtotal = items.reduce((s: number, i: any) => s + num(i.total ?? (num(i.price ?? i.rate ?? 0) * num(i.quantity))), 0);
  return (
    <div className="p-8 text-black bg-white max-w-md mx-auto font-mono text-sm">
      <div className="text-center border-b border-dashed pb-2 mb-2">
        <div className="text-lg font-bold">Café Manager</div>
        <div className="text-xs">KDF</div>
      </div>
      <div className="flex justify-between text-xs mb-1">
        <span>{invoice.invoice_no}</span>
        <span>{formatBusinessDate(invoice.sale_date ?? new Date())} {formatBusinessTime(invoice.sale_date ?? new Date())}</span>
      </div>
      {name && <div className="text-xs mb-2">Customer: <span className="font-semibold">{name}</span></div>}
      <table className="w-full text-xs">
        <thead><tr className="border-b border-dashed"><th className="text-left">Item</th><th>Qty</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {items.map((i: any, idx: number) => (
            <tr key={idx}>
              <td>{i.name ?? i.products?.name}</td>
              <td className="text-center">{num(i.quantity)} {UNIT_LABEL[i.unit ?? "pcs"] ?? ""}</td>
              <td className="text-right">{money(i.total ?? num(i.price ?? i.rate ?? 0) * num(i.quantity))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-dashed mt-2 pt-2 text-xs space-y-1">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        {num(invoice.delivery_charges) > 0 && <div className="flex justify-between"><span>Delivery</span><span>{money(invoice.delivery_charges)}</span></div>}
        <div className="flex justify-between font-bold pt-1 border-t border-dashed"><span>TOTAL</span><span>{money(invoice.grand_total)}</span></div>
        {num(invoice.cash_paid) > 0 && <div className="flex justify-between"><span>Cash</span><span>{money(invoice.cash_paid)}</span></div>}
        {num(invoice.online_paid) > 0 && <div className="flex justify-between"><span>Online</span><span>{money(invoice.online_paid)}</span></div>}
      </div>
      <div className="text-center text-xs mt-3">Thank you — please come again</div>
    </div>
  );
}
