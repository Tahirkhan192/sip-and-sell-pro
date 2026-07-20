import { supabase } from "@/integrations/supabase/client";
import { businessDateOf, businessToday } from "@/lib/business-date";
import { localDb } from "./db";
import { notifyLocalDataChanged } from "./local-events";
import { notifyOutboxChanged, scheduleOutboxFlush, type QueuedRequest } from "./outbox";

type Row = Record<string, any>;
type PaymentSource = "cash" | "online";

export type SaleItemInput = { product_id: string; quantity: number; rate: number; unit?: string | null };
export type SaveSaleInput = {
  id?: string;
  items: SaleItemInput[];
  status: "pending" | "completed";
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_charges?: number;
  payment_method?: PaymentSource;
  cash_paid?: number;
  online_paid?: number;
  order_type?: "walk_in" | "take_away" | "delivery" | string;
  delivery_boy?: string | null;
  delivery_address?: string | null;
  katha?: boolean;
  discount_type?: "amount" | "percent";
  discount_value?: number;
  sale_date?: string | null;
};

export type PurchaseLineInput = {
  product_id?: string | null;
  stock_item_id?: string | null;
  category?: string | null;
  quantity: number;
  unit?: string | null;
  unit_cost: number;
};
export type SavePurchaseInput = {
  id?: string;
  date: string;
  supplier?: string | null;
  payment_status: "paid" | "unpaid";
  payment_method?: PaymentSource | "" | null;
  notes?: string | null;
  items: PurchaseLineInput[];
};

export type SaveExpenseInput = {
  id?: string;
  date: string;
  category: string;
  amount: number;
  description?: string | null;
  payment_method: PaymentSource;
  payment_status: "paid" | "unpaid";
};

export type SaveMoneyMovementInput = {
  id?: string;
  type: "cash_in" | "cash_out";
  payment_source: PaymentSource;
  amount: number;
  notes?: string | null;
};

const nowIso = () => new Date().toISOString();
const num = (v: unknown) => Number(v ?? 0) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function restUrl(table: string, id?: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const url = `${base}/rest/v1/${table}`;
  return id ? `${url}?id=eq.${encodeURIComponent(id)}` : url;
}

async function cloudHeaders(): Promise<Record<string, string>> {
  const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
  const headers: Record<string, string> = {
    apikey: publishable,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch { /* token is refreshed again during outbox replay */ }
  return headers;
}

function stripLocal(row: Row): Row {
  const { _dirty, _op, ...rest } = row;
  return rest;
}

async function queue(req: QueuedRequest, table: string, rowId: string, op: "insert" | "update" | "delete") {
  await localDb().outbox.add({
    table,
    row_id: rowId,
    op,
    payload: req,
    attempts: 0,
    created_at: nowIso(),
    next_retry_at: nowIso(),
  } as any);
}

async function queueInsert(table: string, row: Row, headers: Record<string, string>) {
  await queue({ url: restUrl(table), method: "POST", headers, body: JSON.stringify([stripLocal(row)]) }, table, String(row.id), "insert");
}

async function queuePatch(table: string, id: string, patch: Row, headers: Record<string, string>) {
  await queue({ url: restUrl(table, id), method: "PATCH", headers, body: JSON.stringify(stripLocal(patch)) }, table, id, "update");
}

async function queueDelete(table: string, id: string, headers: Record<string, string>) {
  await queue({ url: restUrl(table, id), method: "DELETE", headers, body: null }, table, id, "delete");
}

async function putLocal(table: string, row: Row, op: "insert" | "update" = "insert") {
  await localDb().table(table).put({ ...row, updated_at: row.updated_at ?? nowIso(), _dirty: 1, _op: op } as never);
}

async function nextLocalInvoiceNo(): Promise<string> {
  const db = localDb();
  const meta = await db.meta.get("local_invoice_seq");
  const n = (meta ? Number(meta.value) : 0) + 1;
  await db.meta.put({ key: "local_invoice_seq", value: String(n) });
  return `INV-L${n}-${Date.now().toString(36).toUpperCase()}`;
}

async function upsertCustomerByPhone(name: string | null | undefined, phone: string | null | undefined, headers: Record<string, string>): Promise<string | null> {
  const p = clean(phone);
  if (!p) return null;
  const db = localDb();
  const found = ((await db.customers.toArray()) as Row[]).find((c) => !c.deleted_at && String(c.phone ?? "").trim() === p);
  const n = clean(name) ?? "Guest";
  if (found) {
    if (n && n !== found.name) {
      const next = { ...found, name: n, updated_at: nowIso() };
      await putLocal("customers", next, "update");
      await queuePatch("customers", String(found.id), { name: n, updated_at: next.updated_at }, headers);
    }
    return String(found.id);
  }
  const row: Row = {
    id: newUuid(),
    name: n,
    phone: p,
    total_orders: 0,
    total_purchases: 0,
    outstanding_balance: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putLocal("customers", row, "insert");
  await queueInsert("customers", row, headers);
  return row.id;
}

async function patchProductStock(productId: string, deltaOut: number, headers: Record<string, string>) {
  const db = localDb();
  const p = (await db.products.get(productId)) as Row | undefined;
  if (!p) throw new Error("Product not found in local database");
  const next = { ...p, current_stock: num(p.current_stock) - deltaOut, updated_at: nowIso() };
  await putLocal("products", next, "update");
  await queuePatch("products", productId, { current_stock: next.current_stock, updated_at: next.updated_at }, headers);
}

async function patchStockItemStock(stockItemId: string, deltaOut: number, headers: Record<string, string>) {
  const db = localDb();
  const s = (await db.stock_items.get(stockItemId)) as Row | undefined;
  if (!s) throw new Error("Stock item not found in local database");
  const next = { ...s, current_stock: num(s.current_stock) - deltaOut, updated_at: nowIso() };
  await putLocal("stock_items", next, "update");
  await queuePatch("stock_items", stockItemId, { current_stock: next.current_stock, updated_at: next.updated_at }, headers);
}

async function patchStockItemByName(name: string, deltaOut: number, headers: Record<string, string>) {
  const target = name.toLowerCase().trim();
  if (!target) return;
  const match = ((await localDb().stock_items.toArray()) as Row[]).find((s) => !s.deleted_at && String(s.name ?? "").toLowerCase().trim() === target);
  if (match) await patchStockItemStock(String(match.id), deltaOut, headers);
}

async function applySaleStock(productId: string, quantity: number, sign: 1 | -1, headers: Record<string, string>) {
  const db = localDb();
  const product = (await db.products.get(productId)) as Row | undefined;
  if (!product) throw new Error("Product not found in local database");
  const recipes = ((await db.recipes.where("parent_product_id").equals(productId).toArray()) as Row[]).filter((r) => !r.deleted_at);
  if (recipes.length) {
    for (const r of recipes) {
      const used = sign * num(r.quantity) * quantity;
      if (r.component_product_id) {
        await patchProductStock(String(r.component_product_id), used, headers);
        const comp = (await db.products.get(String(r.component_product_id))) as Row | undefined;
        if (comp?.name) await patchStockItemByName(String(comp.name), used, headers);
      } else if (r.component_stock_item_id) {
        await patchStockItemStock(String(r.component_stock_item_id), used, headers);
      }
    }
    return;
  }
  if (product.track_stock !== false) {
    await patchProductStock(productId, sign * quantity, headers);
    if (product.name) await patchStockItemByName(String(product.name), sign * quantity, headers);
  }
}

function discountAmount(subtotal: number, type: "amount" | "percent" | undefined, value: number | undefined) {
  const v = Math.max(0, num(value));
  if (type === "percent") return round2(subtotal * Math.min(v, 100) / 100);
  return round2(Math.min(v, subtotal));
}

async function reverseSaleEffects(sale: Row, headers: Record<string, string>) {
  const db = localDb();
  const oldItems = (await db.sale_items.where("sale_id").equals(String(sale.id)).toArray()) as Row[];
  for (const it of oldItems) {
    if (it.product_id) await applySaleStock(String(it.product_id), num(it.quantity), -1, headers);
    await db.sale_items.delete(String(it.id));
    await queueDelete("sale_items", String(it.id), headers);
  }
  const movements = ((await db.cash_movements.toArray()) as Row[]).filter((m) => m.reference_type === "sale" && m.reference_id === sale.id && !m.deleted_at);
  for (const m of movements) {
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("cash_movements", { ...m, ...patch }, "update");
    await queuePatch("cash_movements", String(m.id), patch, headers);
  }
  if (sale.customer_id && sale.status === "completed") {
    const c = (await db.customers.get(String(sale.customer_id))) as Row | undefined;
    if (c) {
      const rem = Math.max(0, num(sale.grand_total) - num(sale.cash_paid) - num(sale.online_paid));
      const next = {
        ...c,
        total_orders: Math.max(0, num(c.total_orders) - 1),
        total_purchases: Math.max(0, num(c.total_purchases) - num(sale.grand_total)),
        outstanding_balance: Math.max(0, num(c.outstanding_balance) - (sale.katha ? rem : 0)),
        updated_at: nowIso(),
      };
      await putLocal("customers", next, "update");
      await queuePatch("customers", String(c.id), {
        total_orders: next.total_orders,
        total_purchases: next.total_purchases,
        outstanding_balance: next.outstanding_balance,
        updated_at: next.updated_at,
      }, headers);
    }
  }
}

async function createSalePaymentMovements(sale: Row, headers: Record<string, string>) {
  if (sale.status !== "completed") return;
  const cash = num(sale.cash_paid);
  const online = num(sale.online_paid);
  const rows: Row[] = [];
  const make = (amount: number, source: PaymentSource) => ({
    id: newUuid(),
    business_date: businessDateOf(sale.sale_date),
    date: businessDateOf(sale.sale_date),
    occurred_at: sale.sale_date,
    time: new Date(sale.sale_date).toISOString().slice(11, 19),
    type: "cash_in",
    kind: source === "cash" ? "cash_in" : "online_in",
    payment_source: source,
    amount,
    movement_category: "Sale",
    reason: `Sale ${sale.invoice_no}`,
    notes: `Sale ${sale.invoice_no}`,
    reference_type: "sale",
    reference_id: sale.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (cash > 0) rows.push(make(cash, "cash"));
  if (online > 0) rows.push(make(online, "online"));
  for (const row of rows) {
    await putLocal("cash_movements", row, "insert");
    await queueInsert("cash_movements", row, headers);
  }
}

async function applyCustomerSaleTotals(sale: Row, headers: Record<string, string>) {
  if (!sale.customer_id || sale.status !== "completed") return;
  const db = localDb();
  const c = (await db.customers.get(String(sale.customer_id))) as Row | undefined;
  if (!c) return;
  const remaining = Math.max(0, num(sale.grand_total) - num(sale.cash_paid) - num(sale.online_paid));
  const next = {
    ...c,
    last_visit: sale.sale_date,
    total_orders: num(c.total_orders) + 1,
    total_purchases: num(c.total_purchases) + num(sale.grand_total),
    outstanding_balance: num(c.outstanding_balance) + (sale.katha ? remaining : 0),
    updated_at: nowIso(),
  };
  await putLocal("customers", next, "update");
  await queuePatch("customers", String(c.id), {
    last_visit: next.last_visit,
    total_orders: next.total_orders,
    total_purchases: next.total_purchases,
    outstanding_balance: next.outstanding_balance,
    updated_at: next.updated_at,
  }, headers);
}

export async function saveSaleTransaction(input: SaveSaleInput): Promise<Row> {
  if (!input.items.length) throw new Error("Cart is empty");
  const headers = await cloudHeaders();
  const db = localDb();
  let saved!: Row;
  await db.transaction("rw", [db.sales, db.sale_items, db.products, db.stock_items, db.recipes, db.customers, db.cash_movements, db.outbox, db.meta], async () => {
    const existing = input.id ? ((await db.sales.get(input.id)) as Row | undefined) : undefined;
    if (input.id && !existing) throw new Error("Invoice not found in local database");
    if (existing) await reverseSaleEffects(existing, headers);
    const saleId = input.id ?? newUuid();
    const createdAt = existing?.created_at ?? nowIso();
    const saleDate = input.sale_date ?? existing?.sale_date ?? nowIso();
    const customerId = await upsertCustomerByPhone(input.customer_name, input.customer_phone, headers);
    let subtotal = 0;
    const itemRows: Row[] = [];
    for (const item of input.items) {
      const product = (await db.products.get(item.product_id)) as Row | undefined;
      if (!product) throw new Error("Product not found in local database");
      const qty = num(item.quantity);
      if (qty <= 0) throw new Error("Quantity must be greater than zero");
      const rate = num(item.rate) || num(product.sale_price) || num(product.price);
      const total = round2(qty * rate);
      subtotal += total;
      const row: Row = {
        id: newUuid(), sale_id: saleId, product_id: item.product_id, quantity: qty,
        unit: item.unit ?? product.unit ?? null, price: rate, total, created_at: nowIso(), updated_at: nowIso(), business_date: businessDateOf(saleDate),
      };
      itemRows.push(row);
      await putLocal("sale_items", row, "insert");
      await applySaleStock(item.product_id, qty, 1, headers);
    }
    const discount = discountAmount(subtotal, input.discount_type, input.discount_value);
    const grand = round2(Math.max(0, subtotal - discount) + num(input.delivery_charges));
    saved = {
      ...(existing ?? {}),
      id: saleId,
      invoice_no: existing?.invoice_no ?? await nextLocalInvoiceNo(),
      status: input.status,
      customer_name: clean(input.customer_name),
      customer_phone: clean(input.customer_phone),
      customer_id: customerId,
      delivery_charges: num(input.delivery_charges),
      payment_method: input.payment_method === "online" ? "card" : "cash",
      cash_paid: num(input.cash_paid),
      online_paid: num(input.online_paid),
      order_type: input.order_type ?? "walk_in",
      delivery_boy: clean(input.delivery_boy),
      delivery_address: clean(input.delivery_address),
      katha: !!input.katha,
      discount_type: input.discount_type ?? "amount",
      discount_value: num(input.discount_value),
      discount_amount: discount,
      subtotal: round2(subtotal),
      grand_total: grand,
      sale_date: saleDate,
      business_date: businessDateOf(saleDate),
      created_at: createdAt,
      updated_at: nowIso(),
      deleted_at: null,
    };
    await putLocal("sales", saved, existing ? "update" : "insert");
    if (existing) await queuePatch("sales", saleId, saved, headers);
    else await queueInsert("sales", saved, headers);
    for (const row of itemRows) await queueInsert("sale_items", row, headers);
    await applyCustomerSaleTotals(saved, headers);
    await createSalePaymentMovements(saved, headers);
  });
  afterCommit();
  return saved;
}

export async function deleteSaleTransaction(id: string): Promise<void> {
  const headers = await cloudHeaders();
  const db = localDb();
  await db.transaction("rw", [db.sales, db.sale_items, db.products, db.stock_items, db.recipes, db.customers, db.cash_movements, db.outbox], async () => {
    const sale = (await db.sales.get(id)) as Row | undefined;
    if (!sale) throw new Error("Invoice not found in local database");
    if (!sale.deleted_at) await reverseSaleEffects(sale, headers);
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("sales", { ...sale, ...patch }, "update");
    await queuePatch("sales", id, patch, headers);
  });
  afterCommit();
}

async function adjustPurchasedStock(line: PurchaseLineInput, sign: 1 | -1, headers: Record<string, string>, affectedProducts: Set<string>, affectedStock: Set<string>) {
  const deltaIn = sign * num(line.quantity);
  if (line.product_id) {
    const p = (await localDb().products.get(String(line.product_id))) as Row | undefined;
    if (!p) throw new Error("Product not found in local database");
    const next = { ...p, current_stock: num(p.current_stock) + deltaIn, updated_at: nowIso() };
    await putLocal("products", next, "update");
    await queuePatch("products", String(line.product_id), { current_stock: next.current_stock, updated_at: next.updated_at }, headers);
    affectedProducts.add(String(line.product_id));
  }
  if (line.stock_item_id) {
    const s = (await localDb().stock_items.get(String(line.stock_item_id))) as Row | undefined;
    if (!s) throw new Error("Stock item not found in local database");
    const next = { ...s, current_stock: num(s.current_stock) + deltaIn, updated_at: nowIso() };
    await putLocal("stock_items", next, "update");
    await queuePatch("stock_items", String(line.stock_item_id), { current_stock: next.current_stock, updated_at: next.updated_at }, headers);
    affectedStock.add(String(line.stock_item_id));
  }
}

async function recalcWac(affectedProducts: Set<string>, affectedStock: Set<string>, headers: Record<string, string>) {
  const rows = ((await localDb().stock_purchases.toArray()) as Row[]).filter((r) => !r.deleted_at);
  for (const id of affectedProducts) {
    const rel = rows.filter((r) => r.product_id === id);
    const qty = rel.reduce((s, r) => s + num(r.quantity), 0);
    const total = rel.reduce((s, r) => s + num(r.total_cost), 0);
    if (qty <= 0) continue;
    const wac = Math.round((total / qty) * 10000) / 10000;
    const p = (await localDb().products.get(id)) as Row | undefined;
    if (p) {
      await putLocal("products", { ...p, cost_price: wac, updated_at: nowIso() }, "update");
      await queuePatch("products", id, { cost_price: wac, updated_at: nowIso() }, headers);
    }
  }
  for (const id of affectedStock) {
    const rel = rows.filter((r) => r.stock_item_id === id);
    const qty = rel.reduce((s, r) => s + num(r.quantity), 0);
    const total = rel.reduce((s, r) => s + num(r.total_cost), 0);
    if (qty <= 0) continue;
    const wac = Math.round((total / qty) * 10000) / 10000;
    const si = (await localDb().stock_items.get(id)) as Row | undefined;
    if (si) {
      await putLocal("stock_items", { ...si, purchase_price: wac, updated_at: nowIso() }, "update");
      await queuePatch("stock_items", id, { purchase_price: wac, updated_at: nowIso() }, headers);
    }
  }
}

async function removePurchaseEffects(purchaseId: string, headers: Record<string, string>, affectedProducts: Set<string>, affectedStock: Set<string>) {
  const db = localDb();
  const purchase = (await db.purchases.get(purchaseId)) as Row | undefined;
  const items = (await db.purchase_items.where("purchase_id").equals(purchaseId).toArray()) as Row[];
  for (const it of items) {
    await adjustPurchasedStock({ product_id: it.product_id, stock_item_id: it.stock_item_id, quantity: num(it.quantity), unit_cost: num(it.unit_cost) }, -1, headers, affectedProducts, affectedStock);
    const spRows = ((await db.stock_purchases.toArray()) as Row[]).filter((sp) => sp.purchase_item_id === it.id && !sp.deleted_at);
    for (const sp of spRows) {
      const patch = { deleted_at: nowIso(), updated_at: nowIso() };
      await putLocal("stock_purchases", { ...sp, ...patch }, "update");
      await queuePatch("stock_purchases", String(sp.id), patch, headers);
    }
    await db.purchase_items.delete(String(it.id));
    await queueDelete("purchase_items", String(it.id), headers);
  }
  const movements = ((await db.cash_movements.toArray()) as Row[]).filter((m) => m.reference_type === "purchase" && m.reference_id === purchaseId && !m.deleted_at);
  for (const m of movements) {
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("cash_movements", { ...m, ...patch }, "update");
    await queuePatch("cash_movements", String(m.id), patch, headers);
  }
  if (purchase?.cash_movement_id) {
    const m = (await db.cash_movements.get(String(purchase.cash_movement_id))) as Row | undefined;
    if (m && !m.deleted_at) {
      const patch = { deleted_at: nowIso(), updated_at: nowIso() };
      await putLocal("cash_movements", { ...m, ...patch }, "update");
      await queuePatch("cash_movements", String(m.id), patch, headers);
    }
  }
}

export async function savePurchaseTransaction(input: SavePurchaseInput): Promise<Row> {
  if (!input.items.length) throw new Error("Add at least one item");
  if (input.payment_status === "paid" && input.payment_method !== "cash" && input.payment_method !== "online") throw new Error("Choose Cash or Online for paid purchase");
  const headers = await cloudHeaders();
  const db = localDb();
  let saved!: Row;
  await db.transaction("rw", [db.purchases, db.purchase_items, db.stock_purchases, db.products, db.stock_items, db.cash_movements, db.outbox], async () => {
    const affectedProducts = new Set<string>();
    const affectedStock = new Set<string>();
    const existing = input.id ? ((await db.purchases.get(input.id)) as Row | undefined) : undefined;
    if (input.id && !existing) throw new Error("Purchase not found in local database");
    if (existing) await removePurchaseEffects(input.id!, headers, affectedProducts, affectedStock);
    const grand = round2(input.items.reduce((s, l) => s + num(l.quantity) * num(l.unit_cost), 0));
    const purchaseId = input.id ?? newUuid();
    saved = {
      ...(existing ?? {}), id: purchaseId, date: input.date, business_date: input.date,
      supplier: clean(input.supplier), category: input.items[0]?.category ?? null,
      payment_status: input.payment_status, payment_method: input.payment_status === "paid" ? input.payment_method : null,
      grand_total: grand, notes: clean(input.notes), created_at: existing?.created_at ?? nowIso(), updated_at: nowIso(), deleted_at: null,
    };
    await putLocal("purchases", saved, existing ? "update" : "insert");
    if (existing) await queuePatch("purchases", purchaseId, saved, headers); else await queueInsert("purchases", saved, headers);
    for (const l of input.items) {
      if (num(l.quantity) <= 0) throw new Error("Quantity must be greater than zero");
      const item: Row = {
        id: newUuid(), purchase_id: purchaseId, product_id: l.product_id ?? null, stock_item_id: l.stock_item_id ?? null,
        category: l.category ?? null, quantity: num(l.quantity), unit: l.unit ?? null, unit_cost: num(l.unit_cost),
        total_cost: round2(num(l.quantity) * num(l.unit_cost)), created_at: nowIso(), updated_at: nowIso(), business_date: input.date,
      };
      await putLocal("purchase_items", item, "insert");
      await queueInsert("purchase_items", item, headers);
      const sp: Row = {
        id: newUuid(), date: input.date, business_date: input.date, product_id: item.product_id, stock_item_id: item.stock_item_id,
        category: item.category, supplier: saved.supplier, quantity: item.quantity, unit: item.unit, unit_cost: item.unit_cost,
        total_cost: item.total_cost, purchase_item_id: item.id, created_at: nowIso(), updated_at: nowIso(),
      };
      await putLocal("stock_purchases", sp, "insert");
      await queueInsert("stock_purchases", sp, headers);
      await adjustPurchasedStock({
        product_id: item.product_id,
        stock_item_id: item.stock_item_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
      }, 1, headers, affectedProducts, affectedStock);
    }
    await recalcWac(affectedProducts, affectedStock, headers);
    if (input.payment_status === "paid" && grand > 0) {
      const movement: Row = {
        id: newUuid(), business_date: input.date, date: input.date, occurred_at: `${input.date}T00:00:00.000Z`,
        type: "cash_out", kind: input.payment_method === "online" ? "online_out" : "cash_out", payment_source: input.payment_method,
        amount: grand, movement_category: "Purchase", reason: `Purchase${saved.supplier ? ` — ${saved.supplier}` : ""}`,
        notes: saved.notes, reference_type: "purchase", reference_id: purchaseId, created_at: nowIso(), updated_at: nowIso(),
      };
      await putLocal("cash_movements", movement, "insert");
      await queueInsert("cash_movements", movement, headers);
      saved.cash_movement_id = movement.id;
      await putLocal("purchases", saved, "update");
      await queuePatch("purchases", purchaseId, { cash_movement_id: movement.id, updated_at: saved.updated_at }, headers);
    }
  });
  afterCommit();
  return saved;
}

export async function deletePurchaseTransaction(id: string): Promise<void> {
  const headers = await cloudHeaders();
  const db = localDb();
  await db.transaction("rw", [db.purchases, db.purchase_items, db.stock_purchases, db.products, db.stock_items, db.cash_movements, db.outbox], async () => {
    const purchase = (await db.purchases.get(id)) as Row | undefined;
    if (!purchase) throw new Error("Purchase not found in local database");
    const affectedProducts = new Set<string>();
    const affectedStock = new Set<string>();
    await removePurchaseEffects(id, headers, affectedProducts, affectedStock);
    await recalcWac(affectedProducts, affectedStock, headers);
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("purchases", { ...purchase, ...patch }, "update");
    await queuePatch("purchases", id, patch, headers);
  });
  afterCommit();
}

async function removeExpenseMovement(expenseId: string, headers: Record<string, string>) {
  const rows = ((await localDb().cash_movements.toArray()) as Row[]).filter((m) => m.reference_type === "expense" && m.reference_id === expenseId && !m.deleted_at);
  for (const m of rows) {
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("cash_movements", { ...m, ...patch }, "update");
    await queuePatch("cash_movements", String(m.id), patch, headers);
  }
}

export async function saveExpenseTransaction(input: SaveExpenseInput): Promise<Row> {
  if (num(input.amount) <= 0) throw new Error("Amount required");
  const headers = await cloudHeaders();
  const db = localDb();
  let saved!: Row;
  await db.transaction("rw", [db.expenses, db.cash_movements, db.outbox], async () => {
    const existing = input.id ? ((await db.expenses.get(input.id)) as Row | undefined) : undefined;
    if (input.id && !existing) throw new Error("Expense not found in local database");
    if (existing) await removeExpenseMovement(input.id!, headers);
    const id = input.id ?? newUuid();
    saved = {
      ...(existing ?? {}), id, date: input.date, business_date: input.date, category: input.category,
      amount: round2(num(input.amount)), description: clean(input.description), payment_method: input.payment_method,
      payment_status: input.payment_status, paid_amount: input.payment_status === "paid" ? round2(num(input.amount)) : 0,
      paid_at: input.payment_status === "paid" ? nowIso() : null, created_at: existing?.created_at ?? nowIso(), updated_at: nowIso(), deleted_at: null,
    };
    await putLocal("expenses", saved, existing ? "update" : "insert");
    if (existing) await queuePatch("expenses", id, saved, headers); else await queueInsert("expenses", saved, headers);
    if (input.payment_status === "paid") {
      const movement: Row = {
        id: newUuid(), business_date: input.date, date: input.date, occurred_at: `${input.date}T00:00:00.000Z`,
        type: "cash_out", kind: input.payment_method === "online" ? "online_out" : "cash_out", payment_source: input.payment_method,
        amount: saved.amount, movement_category: "Expense", reason: input.category, notes: saved.description,
        reference_type: "expense", reference_id: id, created_at: nowIso(), updated_at: nowIso(),
      };
      await putLocal("cash_movements", movement, "insert");
      await queueInsert("cash_movements", movement, headers);
      saved.cash_movement_id = movement.id;
      await putLocal("expenses", saved, "update");
      await queuePatch("expenses", id, { cash_movement_id: movement.id, updated_at: saved.updated_at }, headers);
    }
  });
  afterCommit();
  return saved;
}

export async function deleteExpenseTransaction(id: string): Promise<void> {
  const headers = await cloudHeaders();
  const db = localDb();
  await db.transaction("rw", [db.expenses, db.cash_movements, db.outbox], async () => {
    const row = (await db.expenses.get(id)) as Row | undefined;
    if (!row) throw new Error("Expense not found in local database");
    await removeExpenseMovement(id, headers);
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("expenses", { ...row, ...patch }, "update");
    await queuePatch("expenses", id, patch, headers);
  });
  afterCommit();
}

export async function saveMoneyMovementTransaction(input: SaveMoneyMovementInput): Promise<Row> {
  if (num(input.amount) <= 0) throw new Error("Enter a valid amount");
  const headers = await cloudHeaders();
  const db = localDb();
  let saved!: Row;
  await db.transaction("rw", [db.cash_movements, db.outbox], async () => {
    const existing = input.id ? ((await db.cash_movements.get(input.id)) as Row | undefined) : undefined;
    if (input.id && !existing) throw new Error("Movement not found in local database");
    const occurredAt = existing?.occurred_at ?? nowIso();
    const id = input.id ?? newUuid();
    saved = {
      ...(existing ?? {}), id, business_date: existing?.business_date ?? businessToday(new Date(occurredAt)),
      date: existing?.date ?? businessToday(new Date(occurredAt)), occurred_at: occurredAt,
      type: input.type, kind: input.payment_source === "online" ? (input.type === "cash_in" ? "online_in" : "online_out") : input.type,
      payment_source: input.payment_source, amount: round2(num(input.amount)), notes: clean(input.notes), reason: clean(input.notes),
      movement_category: null, subcategory: null, created_at: existing?.created_at ?? nowIso(), updated_at: nowIso(), deleted_at: null,
    };
    await putLocal("cash_movements", saved, existing ? "update" : "insert");
    if (existing) await queuePatch("cash_movements", id, saved, headers); else await queueInsert("cash_movements", saved, headers);
  });
  afterCommit();
  return saved;
}

export async function deleteMoneyMovementTransaction(id: string): Promise<void> {
  const headers = await cloudHeaders();
  const db = localDb();
  await db.transaction("rw", [db.cash_movements, db.outbox], async () => {
    const row = (await db.cash_movements.get(id)) as Row | undefined;
    if (!row) throw new Error("Movement not found in local database");
    const patch = { deleted_at: nowIso(), updated_at: nowIso() };
    await putLocal("cash_movements", { ...row, ...patch }, "update");
    await queuePatch("cash_movements", id, patch, headers);
  });
  afterCommit();
}

function afterCommit() {
  notifyOutboxChanged();
  notifyLocalDataChanged();
  scheduleOutboxFlush(typeof navigator !== "undefined" && navigator.onLine ? 50 : 0);
}