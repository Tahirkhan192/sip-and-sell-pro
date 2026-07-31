import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, num } from "@/lib/format";
import { Trash2, Printer, Save, Clock, X, Search, User, Trash, AlertTriangle, Check, AlertCircle, BookMarked } from "lucide-react";
import { toast } from "sonner";
import { KATHA_CATEGORIES, kathaLabel, validateMovement, type KathaCategory } from "@/lib/money-movement";
import { z } from "zod";
import { sendWhatsappInvoice } from "@/lib/whatsapp";
import { useCategories } from "@/lib/use-categories";
import { businessToday, businessDateOf, businessDayStartUTC, formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

const searchSchema = z.object({ edit: z.string().optional() });

class SaveInProgress extends Error {
  constructor() { super("Save already in progress"); }
}

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
  const [staffId, setStaffId] = useState<string | null>(null);
  const [showCustomerResults, setShowCustomerResults] = useState(false);

  const [orderType, setOrderType] = useState<"walk_in" | "take_away" | "delivery">("walk_in");
  const [delivery, setDelivery] = useState<number | "">("");
  const [deliveryBoy, setDeliveryBoy] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [cashPaid, setCashPaid] = useState<number | "">("");
  const [onlinePaid, setOnlinePaid] = useState<number | "">("");
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState<number | "">("");
  const [saleDate, setSaleDate] = useState<string>(() => businessToday());
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [showInvoiceResults, setShowInvoiceResults] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [priorityBump, setPriorityBump] = useState<Record<string, number>>({});
  const [backdateDialog, setBackdateDialog] = useState(false);
  const [backdateChoice, setBackdateChoice] = useState<"current" | "original">("current");
  // Optional Money Movement inside POS
  const [mmEnabled, setMmEnabled] = useState(false);
  const [mmCashDir, setMmCashDir] = useState<"" | "in" | "out">("");
  const [mmCashAmt, setMmCashAmt] = useState<number | "">("");
  const [mmOnlineDir, setMmOnlineDir] = useState<"" | "in" | "out">("");
  const [mmOnlineAmt, setMmOnlineAmt] = useState<number | "">("");
  const [mmRemark, setMmRemark] = useState<string>("");
  const [mmCategory, setMmCategory] = useState<KathaCategory>("transaction");

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

  const hydratedEditIdRef = useRef<string | null>(null);
  const skipHydrateIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editingSale) return;
    const s: any = editingSale;
    if (skipHydrateIdRef.current === s.id) return; // just saved; ignore stale refetch
    if (hydratedEditIdRef.current === s.id) return; // already hydrated once
    hydratedEditIdRef.current = s.id;
    setCustomer(s.customer_name ?? "");
    setPhone(s.customer_phone ?? "");
    setStaffId(s.staff_id ?? null);
    setKatha(!!s.katha);

    setOrderType((s.order_type ?? "walk_in") as any);
    setDelivery(num(s.delivery_charges) || "");
    setDeliveryBoy(s.delivery_boy ?? "");
    setDeliveryAddress(s.delivery_address ?? "");
    setCashPaid(num(s.cash_paid) > 0 ? num(s.cash_paid) : "");
    setOnlinePaid(num(s.online_paid) > 0 ? num(s.online_paid) : "");
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
  }, [editingSale]);

  const { data: customerSuggestions = [] } = useQuery({
    queryKey: ["customers", "search", customerSearch.trim().toLowerCase()],
    enabled: customerSearch.trim().length >= 2,
    queryFn: async () => (await supabase.from("customers").select("id, name, phone, outstanding_balance")
      .is("deleted_at", null)
      .or(`name.ilike.%${customerSearch.trim()}%,phone.ilike.%${customerSearch.trim()}%`)
      .limit(6)).data ?? [],
  });

  const { data: staffSuggestions = [] } = useQuery({
    queryKey: ["staff", "search", customerSearch.trim().toLowerCase()],
    enabled: customerSearch.trim().length >= 2,
    queryFn: async () => (await supabase.from("staff" as any).select("id, name, phone, katha_balance")
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
    setCashPaid(""); setOnlinePaid(""); setOrderType("walk_in");
    setDiscountType("amount"); setDiscountValue("");
    setSaleDate(businessToday());
    setCustomerSearch(""); setShowCustomerResults(false); setStaffId(null);
    setSearch(""); setInvoiceSearch(""); setShowInvoiceResults(false);
    setHighlightIdx(0); setPriorityBump({});
    setMmEnabled(false); setMmCashDir(""); setMmCashAmt(""); setMmOnlineDir(""); setMmOnlineAmt(""); setMmRemark(""); setMmCategory("transaction");
    hydratedEditIdRef.current = null;
    // Drop any cached edit target so a subsequent load fetches fresh data.
    qc.removeQueries({ queryKey: ["sales", "edit"] });
    if (editId) navigate({ to: "/pos", search: {} });
    setTimeout(() => searchRef.current?.focus(), 0);
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
  const paidNum = round2(num(cashPaid) + num(onlinePaid));
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
      // Pending invoices already reduced stock — restore before soft-delete.
      const { error: restoreErr } = await supabase.rpc("restore_sale_stock" as any, { _sale_id: id });
      if (restoreErr) throw restoreErr;
      const { error } = await supabase.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pending KDF deleted");
      resetForm();
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to delete"),
  });

  type SaveArgs = { status: "pending" | "completed"; dateMode?: "current" | "original" };
  const submittingRef = useRef(false);
  const saveMutation = useMutation({
    mutationFn: async ({ status, dateMode }: SaveArgs) => {
      let ownsLock = false;
      try {
      if (submittingRef.current) {
        // A save is already running — ignore this click without touching the lock.
        throw new SaveInProgress();
      }
      submittingRef.current = true;
      ownsLock = true;

      // Build list of Money Movement rows to persist (if MM enabled) — shared rules with Money Movement page
      const mmRows = mmEnabled
        ? validateMovement({
            cashDir: mmCashDir,
            cashAmt: num(mmCashAmt),
            onlineDir: mmOnlineDir,
            onlineAmt: num(mmOnlineAmt),
            category: mmCategory,
          })
        : [];

      // MM-only save (no products): create movements and skip the sale entirely.
      if (cart.length === 0) {
        if (!mmEnabled || mmRows.length === 0) throw new Error("Cart is empty");
        const nowIso = new Date().toISOString();
        const bDate = businessToday();
        const payload = mmRows.map((r) => ({
          type: r.type,
          payment_source: r.payment_source,
          amount: r.amount,
          notes: mmRemark?.trim() ? mmRemark.trim() : "POS money movement",
          business_date: bDate,
          occurred_at: nowIso,
          reference_type: "pos_manual",
          katha_category: mmCategory,
        }));
        const { error } = await supabase.from("cash_movements" as any).insert(payload);
        if (error) throw error;
        return { sale: null, status, mmOnly: true };
      }

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
        _payment_method: num(onlinePaid) > num(cashPaid) ? "card" : "cash",
        _cash_paid: num(cashPaid),
        _online_paid: num(onlinePaid),
        _order_type: orderType,
        _delivery_boy: deliveryBoy,
        _customer_phone: phone,
        _katha: katha,
        _discount_type: discountType,
        _discount_value: num(discountValue),
        _delivery_address: deliveryAddress,
      };
      const today = businessToday();
      let saleTs: string | null;
      if (dateMode === "original") saleTs = null;
      else if (dateMode === "current") saleTs = new Date().toISOString();
      else saleTs = saleDate && saleDate !== today ? businessDayStartUTC(saleDate) : new Date().toISOString();

      let saleData: any;
      if (editId) {
        const { data, error } = await supabase.rpc("update_sale" as any, {
          _sale_id: editId, ...args,
          _sale_date: saleTs,
        });
        if (error) throw error;
        saleData = data;
      } else {
        const { data, error } = await supabase.rpc("save_sale" as any, args);
        if (error) throw error;
        saleData = data;
        if (data && saleTs && saleDate && saleDate !== today) {
          await supabase.from("sales").update({ sale_date: saleTs } as any).eq("id", (data as any).id);
        }
      }

      // Attach money movements linked to this sale.
      // On edit, remove any prior movements tied to this sale so totals stay in sync.
      if (saleData) {
        if (editId) {
          await supabase.from("cash_movements" as any)
            .update({ deleted_at: new Date().toISOString() })
            .eq("reference_type", "sale")
            .eq("reference_id", saleData.id)
            .is("deleted_at", null);
        }
        if (mmRows.length > 0) {
          const bDate = businessToday();
          const nowIso = new Date().toISOString();
          const payload = mmRows.map((r) => ({
            type: r.type,
            payment_source: r.payment_source,
            amount: r.amount,
            notes: mmRemark?.trim() ? mmRemark.trim() : `POS ${saleData.invoice_no ?? ""}`.trim(),
            business_date: bDate,
            occurred_at: nowIso,
            reference_type: "sale",
            reference_id: saleData.id ?? null,
            katha_category: mmCategory,
          }));
          const { error: mmErr } = await supabase.from("cash_movements" as any).insert(payload);
          if (mmErr) throw mmErr;
        }
      }

      return { sale: saleData, status, movements: mmRows.map((r) => ({ ...r, katha_category: mmCategory })) };
      } finally {
        if (ownsLock) submittingRef.current = false;
      }
    },
    onSuccess: async ({ sale, status, mmOnly, movements }: any) => {
      const lastMovements = movements ?? [];
      if (mmOnly) {
        toast.success("Money movement saved");
        resetForm();
        qc.invalidateQueries({ queryKey: ["cash_movements"] });
        qc.invalidateQueries({ queryKey: ["daily_closing"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["report"] });
        return;
      }
      if (editId) skipHydrateIdRef.current = editId; // prevent stale refetch from re-populating
      toast.success(status === "pending" ? `KDF ${sale.invoice_no} saved as pending` : `KDF ${sale.invoice_no} completed`);
      if (status === "completed") {
        setLastInvoice({ ...sale, items: cart, movements: lastMovements, movement_remark: mmRemark?.trim() || null });
        // Silent WhatsApp send (non-blocking)
        if (phone) {
          sendWhatsappInvoice({
            invoice_no: sale.invoice_no,
            customer_phone: phone,
            customer_name: customer,
            grand_total: num(sale.grand_total),
            cash_paid: num(cashPaid),
            online_paid: num(onlinePaid),
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
      qc.invalidateQueries({ queryKey: ["cash_movements"] });
      qc.invalidateQueries({ queryKey: ["daily_closing"] });
      qc.invalidateQueries({ queryKey: ["report"] });
    },
    onError: (e: any) => {
      if (e instanceof SaveInProgress) return;
      toast.error(e?.message ?? "Failed to save");
    },
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
            <Input placeholder="Customer / staff name"
              value={customer}
              onChange={(e) => { setCustomer(e.target.value); setCustomerSearch(e.target.value); setShowCustomerResults(true); setStaffId(null); }}
              onFocus={() => { setCustomerSearch(customer); setShowCustomerResults(true); }}
            />
            <Input placeholder="Mobile number"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setCustomerSearch(e.target.value); setShowCustomerResults(true); }}
              onFocus={() => { setCustomerSearch(phone); setShowCustomerResults(true); }}
            />
            {showCustomerResults && customerSearch.trim().length >= 2 && (customerSuggestions.length > 0 || staffSuggestions.length > 0) && (
              <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-md max-h-56 overflow-auto">
                {(customerSuggestions as any[]).map((c) => (
                  <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between"
                    onClick={() => { setCustomer(c.name); setPhone(c.phone ?? ""); setStaffId(null); setShowCustomerResults(false); }}>
                    <span><User className="h-3 w-3 inline mr-1" />{c.name}{c.phone ? ` · ${c.phone}` : ""}</span>
                    {num(c.outstanding_balance) > 0 && <span className="text-xs text-destructive">{money(c.outstanding_balance)}</span>}
                  </button>
                ))}
                {(staffSuggestions as any[]).map((s) => (
                  <button key={`staff-${s.id}`} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between"
                    onClick={() => { setCustomer(s.name); setPhone(s.phone ?? ""); setStaffId(s.id); setShowCustomerResults(false); }}>
                    <span>
                      <User className="h-3 w-3 inline mr-1" />{s.name}{s.phone ? ` · ${s.phone}` : ""}
                      <span className="ml-2 text-[10px] uppercase rounded bg-muted px-1 py-0.5">Staff</span>
                    </span>
                    {num(s.katha_balance) > 0 && <span className="text-xs text-destructive">{money(s.katha_balance)}</span>}
                  </button>
                ))}
              </div>
            )}
            {staffId && (
              <p className="col-span-2 text-[11px] text-muted-foreground">
                Staff selected — enabling “Added to Katha” will add the unpaid amount to this staff member’s katha balance.
              </p>
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

            {/* Split payment: Cash + Online */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Cash</Label>
                <div className="flex gap-1">
                  <Input type="number" step="0.01" value={cashPaid} placeholder="0.00"
                    onChange={(e) => setCashPaid(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
                  <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 px-2"
                    onClick={() => {
                      const fill = round2(Math.max(0, grandTotal - num(onlinePaid)));
                      setCashPaid(fill);
                    }} disabled={grandTotal <= 0}>Paid All</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Online</Label>
                <div className="flex gap-1">
                  <Input type="number" step="0.01" value={onlinePaid} placeholder="0.00"
                    onChange={(e) => setOnlinePaid(e.target.value === "" ? "" : Number(e.target.value))} className="h-9" />
                  <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 px-2"
                    onClick={() => {
                      const fill = round2(Math.max(0, grandTotal - num(cashPaid)));
                      setOnlinePaid(fill);
                    }} disabled={grandTotal <= 0}>Paid All</Button>
                </div>
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

          {/* Optional Money Movement inside invoice */}
          <div className="rounded-md border">
            <label className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={mmEnabled} onChange={(e) => setMmEnabled(e.target.checked)} />
              <span className="font-medium">Enable Money Movement</span>
              <span className="text-muted-foreground">(customer change / wallet exchange)</span>
            </label>
            {mmEnabled && (
              <div className="px-2 pb-2 space-y-2 border-t pt-2">
                <div className="grid grid-cols-[64px_1fr_1fr_auto] gap-1 items-center text-xs">
                  <span className="font-medium">Cash</span>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={mmCashDir === "in" ? "default" : "outline"} className="h-8 flex-1 px-2" onClick={() => setMmCashDir(mmCashDir === "in" ? "" : "in")}>In</Button>
                    <Button type="button" size="sm" variant={mmCashDir === "out" ? "destructive" : "outline"} className="h-8 flex-1 px-2" onClick={() => setMmCashDir(mmCashDir === "out" ? "" : "out")}>Out</Button>
                  </div>
                  <Input type="number" step="0.01" placeholder="0.00" value={mmCashAmt}
                    onChange={(e) => setMmCashAmt(e.target.value === "" ? "" : Number(e.target.value))} className="h-8" />
                  <Button type="button" size="sm" variant="outline" className="h-8 px-2 shrink-0" disabled={change <= 0}
                    onClick={() => { setMmCashAmt(change); if (!mmCashDir) setMmCashDir("out"); }}>Add Change</Button>
                </div>
                <div className="grid grid-cols-[64px_1fr_1fr_auto] gap-1 items-center text-xs">
                  <span className="font-medium">Online</span>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant={mmOnlineDir === "in" ? "default" : "outline"} className="h-8 flex-1 px-2" onClick={() => setMmOnlineDir(mmOnlineDir === "in" ? "" : "in")}>In</Button>
                    <Button type="button" size="sm" variant={mmOnlineDir === "out" ? "destructive" : "outline"} className="h-8 flex-1 px-2" onClick={() => setMmOnlineDir(mmOnlineDir === "out" ? "" : "out")}>Out</Button>
                  </div>
                  <Input type="number" step="0.01" placeholder="0.00" value={mmOnlineAmt}
                    onChange={(e) => setMmOnlineAmt(e.target.value === "" ? "" : Number(e.target.value))} className="h-8" />
                  <Button type="button" size="sm" variant="outline" className="h-8 px-2 shrink-0" disabled={change <= 0}
                    onClick={() => { setMmOnlineAmt(change); if (!mmOnlineDir) setMmOnlineDir("out"); }}>Add Change</Button>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Category</label>
                  <div className="flex gap-1">
                    {KATHA_CATEGORIES.map((c) => (
                      <Button key={c} type="button" size="sm" variant={mmCategory === c ? "default" : "outline"}
                        className="h-8 flex-1 px-2 text-xs" onClick={() => setMmCategory(c)}>
                        {kathaLabel(c)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Remark (optional)</label>
                  <Input value={mmRemark} onChange={(e) => setMmRemark(e.target.value)} placeholder='e.g. "Customer requested cash", "Wallet exchange"' className="h-8 text-xs" />
                </div>
                {cart.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No products in cart — Save will create only a Money Movement (no invoice).</p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => saveMutation.mutate({ status: "pending" })} disabled={cart.length === 0 || saveMutation.isPending}>
              <Clock className="h-4 w-4 mr-1" /> Save Pending
            </Button>
            <Button onClick={() => {
              const orig = (editingSale as any);
              if (editId && orig?.status === "pending" && orig?.sale_date && businessDateOf(orig.sale_date) !== businessToday()) {
                setBackdateDialog(true);
                return;
              }
              saveMutation.mutate({ status: "completed" });
            }} disabled={(cart.length === 0 && !mmEnabled) || saveMutation.isPending}>
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

      <Dialog open={backdateDialog} onOpenChange={setBackdateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete Pending Invoice</DialogTitle>
            <DialogDescription>
              This Pending Invoice was created on a previous Business Date. How would you like to record this sale?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent/40">
              <input type="radio" name="backdate" className="mt-1" checked={backdateChoice === "current"} onChange={() => setBackdateChoice("current")} />
              <div>
                <div className="text-sm font-medium">Save using CURRENT Business Date and Time</div>
                <div className="text-xs text-muted-foreground">Today ({formatBusinessDate(new Date())})</div>
              </div>
            </label>
            <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent/40">
              <input type="radio" name="backdate" className="mt-1" checked={backdateChoice === "original"} onChange={() => setBackdateChoice("original")} />
              <div>
                <div className="text-sm font-medium">Save using ORIGINAL Business Date and Time</div>
                <div className="text-xs text-muted-foreground">
                  {editingSale?.sale_date ? `${formatBusinessDate((editingSale as any).sale_date)} ${formatBusinessTime((editingSale as any).sale_date)}` : ""}
                </div>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackdateDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              setBackdateDialog(false);
              saveMutation.mutate({ status: "completed", dateMode: backdateChoice });
            }}>Complete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      {Array.isArray(invoice.movements) && invoice.movements.length > 0 && (
        <div className="border-t border-dashed mt-2 pt-2 text-xs space-y-1">
          <div className="font-semibold">Money Movement</div>
          {invoice.movements.map((m: any, i: number) => (
            <div key={i} className="flex justify-between">
              <span>{m.payment_source === "cash" ? "Cash" : "Online"} {m.type === "cash_in" ? "In" : "Out"}{m.katha_category && m.katha_category !== "transaction" ? ` (${kathaLabel(m.katha_category)})` : ""}</span>
              <span>{money(m.amount)}</span>
            </div>
          ))}
          {invoice.movement_remark && <div className="italic">{invoice.movement_remark}</div>}
        </div>
      )}
      <div className="text-center text-xs mt-3">Thank you — please come again</div>
    </div>
  );
}
