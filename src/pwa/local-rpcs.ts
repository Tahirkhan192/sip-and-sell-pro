/**
 * Local emulations of Supabase RPCs used in save/complete flows.
 *
 * Cloud RPCs (`save_sale`, `update_sale`, `restore_sale_stock`) run PL/pgSQL
 * on the server. Without internet they'd throw and the UI save would fail.
 * This module re-implements those RPCs against IndexedDB and enqueues the
 * derived table writes to the outbox so the SAME UUIDs land on the cloud
 * once connectivity returns.
 *
 * Only wired in from the fetch interceptor for offline / network-failure
 * paths. Online, RPCs still go straight to Lovable Cloud.
 */

import { localDb } from "./db";
import { enqueueRequest } from "./outbox";

type Row = Record<string, any>;

function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const nowIso = () => new Date().toISOString();
const trimOrNull = (v: any) => { const s = String(v ?? "").trim(); return s ? s : null; };
const num = (v: any) => Number(v ?? 0) || 0;

function urlForTable(baseUrl: string, table: string): string {
  try {
    const u = new URL(baseUrl);
    u.pathname = u.pathname.replace(/\/rest\/v1\/[^/?]+.*$/, `/rest/v1/${table}`);
    u.search = "";
    return u.toString();
  } catch { return baseUrl; }
}

function withMergeHeaders(refHeaders: Record<string, string>): Record<string, string> {
  const headers = { ...refHeaders };
  const existing = headers["Prefer"] ?? headers["prefer"] ?? "";
  const parts = new Set(existing.split(",").map((s) => s.trim()).filter(Boolean));
  parts.add("resolution=merge-duplicates");
  parts.add("return=representation");
  headers["Prefer"] = Array.from(parts).join(",");
  delete headers["prefer"];
  return headers;
}

async function enqueueInsert(refUrl: string, refHeaders: Record<string, string>, table: string, rows: Row[]) {
  if (!rows.length) return;
  await enqueueRequest({
    url: urlForTable(refUrl, table),
    method: "POST",
    headers: withMergeHeaders(refHeaders),
    body: JSON.stringify(rows),
  });
}
async function enqueuePatch(refUrl: string, refHeaders: Record<string, string>, table: string, id: string, patch: Row) {
  await enqueueRequest({
    url: `${urlForTable(refUrl, table)}?id=eq.${encodeURIComponent(id)}`,
    method: "PATCH",
    headers: refHeaders,
    body: JSON.stringify(patch),
  });
}

async function putLocal(table: string, row: Row) {
  const db = localDb();
  if (!db.tables.some((t) => t.name === table)) return;
  await db.table(table).put({ ...row, _dirty: 1 } as never).catch(() => {});
}

/** Allocate a locally-unique invoice number that won't collide with cloud INV-<n>. */
async function nextLocalInvoiceNo(): Promise<string> {
  const db = localDb();
  const meta = await db.meta.get("local_invoice_seq").catch(() => undefined);
  const n = (meta ? Number(meta.value) : 0) + 1;
  await db.meta.put({ key: "local_invoice_seq", value: String(n) }).catch(() => {});
  // Timestamp suffix keeps it unique even if two devices push simultaneously.
  const ts = Date.now().toString(36).toUpperCase();
  return `INV-L${n}-${ts}`;
}

/**
 * Apply the stock delta for a sold product, mirroring apply_stock_for_sale_item.
 * _sign = 1 to deduct, -1 to restore.
 */
async function applyStockForSaleItem(
  productId: string,
  quantity: number,
  sign: 1 | -1,
  refUrl: string,
  refHeaders: Record<string, string>,
) {
  const db = localDb();
  const product = (await db.products.get(productId)) as Row | undefined;
  if (!product) return;
  const productName = String(product.name ?? "").toLowerCase().trim();

  const recipes = (await db.recipes.where("parent_product_id").equals(productId).toArray()) as Row[];
  const liveRecipes = recipes.filter((r) => !r.deleted_at);

  const patchProduct = async (pid: string, deltaOut: number) => {
    const p = (await db.products.get(pid)) as Row | undefined;
    if (!p) return;
    const next = { ...p, current_stock: num(p.current_stock) - deltaOut, updated_at: nowIso() };
    await putLocal("products", next);
    await enqueuePatch(refUrl, refHeaders, "products", pid, { current_stock: next.current_stock });
  };
  const patchStockItemById = async (sid: string, deltaOut: number) => {
    const s = (await db.stock_items.get(sid)) as Row | undefined;
    if (!s) return;
    const next = { ...s, current_stock: num(s.current_stock) - deltaOut, updated_at: nowIso() };
    await putLocal("stock_items", next);
    await enqueuePatch(refUrl, refHeaders, "stock_items", sid, { current_stock: next.current_stock });
  };
  const patchStockItemByName = async (name: string, deltaOut: number) => {
    if (!name) return;
    const target = name.toLowerCase().trim();
    const items = (await db.stock_items.toArray()) as Row[];
    const match = items.find((s) => !s.deleted_at && String(s.name ?? "").toLowerCase().trim() === target);
    if (!match) return;
    await patchStockItemById(String(match.id), deltaOut);
  };

  if (liveRecipes.length > 0) {
    for (const r of liveRecipes) {
      const qty = num(r.quantity) * quantity;
      if (r.component_product_id) {
        await patchProduct(String(r.component_product_id), sign * qty);
        const comp = (await db.products.get(String(r.component_product_id))) as Row | undefined;
        if (comp?.name) await patchStockItemByName(String(comp.name), sign * qty);
      } else if (r.component_stock_item_id) {
        await patchStockItemById(String(r.component_stock_item_id), sign * qty);
      }
    }
  } else if (product.track_stock !== false) {
    await patchProduct(productId, sign * quantity);
    if (productName) await patchStockItemByName(productName, sign * quantity);
  }
}

/** Find or create a customer by phone. Returns customer id or null. */
async function upsertCustomerByPhone(
  name: string | null,
  phone: string | null,
  refUrl: string,
  refHeaders: Record<string, string>,
): Promise<string | null> {
  const p = trimOrNull(phone);
  if (!p) return null;
  const db = localDb();
  const all = (await db.customers.toArray()) as Row[];
  const found = all.find((c) => !c.deleted_at && String(c.phone ?? "").trim() === p);
  if (found) {
    const n = trimOrNull(name);
    if (n && n !== found.name) {
      const next = { ...found, name: n, updated_at: nowIso() };
      await putLocal("customers", next);
      await enqueuePatch(refUrl, refHeaders, "customers", String(found.id), { name: n });
    }
    return String(found.id);
  }
  const id = newUuid();
  const row: Row = {
    id,
    name: trimOrNull(name) ?? "Guest",
    phone: p,
    total_orders: 0,
    total_purchases: 0,
    outstanding_balance: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await putLocal("customers", row);
  await enqueueInsert(refUrl, refHeaders, "customers", [row]);
  return id;
}

function computeDiscount(subtotal: number, type: string, value: number): number {
  const v = Math.max(0, num(value));
  if (type === "percent") {
    return Math.round(subtotal * Math.min(v, 100) / 100 * 100) / 100;
  }
  return Math.min(v, subtotal);
}

/* -------------------------------------------------------------------------- */

async function localSaveSale(args: Row, refUrl: string, refHeaders: Record<string, string>): Promise<Row> {
  const items = Array.isArray(args._items) ? args._items : [];
  if (!items.length) throw new Error("Empty cart");

  const status = args._status === "pending" ? "pending" : "completed";
  const paymentMethod = args._payment_method === "card" ? "card" : "cash";
  const orderType = ["walk_in", "take_away", "delivery"].includes(args._order_type) ? args._order_type : "walk_in";
  const discountType = args._discount_type === "percent" ? "percent" : "amount";
  const delivery = orderType === "delivery" ? num(args._delivery_charges) : 0;

  const customerId = await upsertCustomerByPhone(args._customer_name, args._customer_phone, refUrl, refHeaders);

  const saleId = newUuid();
  const invoiceNo = await nextLocalInvoiceNo();
  const createdAt = nowIso();

  // Insert sale_items and reduce stock per item; compute subtotal.
  let subtotal = 0;
  const db = localDb();
  const saleItemRows: Row[] = [];
  for (const it of items) {
    const productId = String(it.product_id);
    const product = (await db.products.get(productId)) as Row | undefined;
    if (!product) throw new Error("Product not found");
    const qty = num(it.quantity);
    const rate = num(it.rate) || num(product.sale_price);
    const total = Math.round(qty * rate * 100) / 100;
    subtotal += total;
    const siRow: Row = {
      id: newUuid(),
      sale_id: saleId,
      product_id: productId,
      quantity: qty,
      price: rate,
      total,
      unit: it.unit ?? product.unit ?? null,
      created_at: createdAt,
      updated_at: createdAt,
    };
    saleItemRows.push(siRow);
    await putLocal("sale_items", siRow);
    await applyStockForSaleItem(productId, qty, 1, refUrl, refHeaders);
    if (status === "completed") {
      const next = { ...product, last_sold_at: createdAt, updated_at: createdAt };
      await putLocal("products", next);
      await enqueuePatch(refUrl, refHeaders, "products", productId, { last_sold_at: createdAt });
    }
  }

  const discountAmount = computeDiscount(subtotal, discountType, num(args._discount_value));
  const grandTotal = Math.max(subtotal - discountAmount, 0) + delivery;

  const sale: Row = {
    id: saleId,
    invoice_no: invoiceNo,
    status,
    customer_name: trimOrNull(args._customer_name),
    customer_phone: trimOrNull(args._customer_phone),
    customer_id: customerId,
    delivery_charges: delivery,
    payment_method: paymentMethod,
    cash_paid: num(args._cash_paid),
    online_paid: num(args._online_paid),
    order_type: orderType,
    delivery_boy: trimOrNull(args._delivery_boy),
    delivery_address: trimOrNull(args._delivery_address),
    katha: !!args._katha,
    discount_type: discountType,
    discount_value: num(args._discount_value),
    discount_amount: discountAmount,
    grand_total: grandTotal,
    sale_date: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  };
  await putLocal("sales", sale);

  // Cloud replay: insert sale first, then sale_items (FK order).
  await enqueueInsert(refUrl, refHeaders, "sales", [sale]);
  await enqueueInsert(refUrl, refHeaders, "sale_items", saleItemRows);

  // Customer aggregates on completed sales.
  if (customerId && status === "completed") {
    const remaining = Math.max(grandTotal - num(args._cash_paid) - num(args._online_paid), 0);
    const c = (await db.customers.get(customerId)) as Row | undefined;
    if (c) {
      const next = {
        ...c,
        last_visit: createdAt,
        total_orders: num(c.total_orders) + 1,
        total_purchases: num(c.total_purchases) + grandTotal,
        outstanding_balance: num(c.outstanding_balance) + (args._katha ? remaining : 0),
        updated_at: createdAt,
      };
      await putLocal("customers", next);
      await enqueuePatch(refUrl, refHeaders, "customers", customerId, {
        last_visit: next.last_visit,
        total_orders: next.total_orders,
        total_purchases: next.total_purchases,
        outstanding_balance: next.outstanding_balance,
      });
    }
  }

  return sale;
}

async function localUpdateSale(args: Row, refUrl: string, refHeaders: Record<string, string>): Promise<Row> {
  const saleId = String(args._sale_id);
  const db = localDb();
  const existing = (await db.sales.get(saleId)) as Row | undefined;
  if (!existing) throw new Error("Sale not found");
  const items = Array.isArray(args._items) ? args._items : [];
  if (!items.length) throw new Error("Empty cart");

  // 1) Revert previous stock deductions and customer aggregates.
  const oldItems = (await db.sale_items.where("sale_id").equals(saleId).toArray()) as Row[];
  for (const oi of oldItems) {
    if (oi.product_id) await applyStockForSaleItem(String(oi.product_id), num(oi.quantity), -1, refUrl, refHeaders);
  }
  if (existing.customer_id && existing.status === "completed") {
    const c = (await db.customers.get(String(existing.customer_id))) as Row | undefined;
    if (c) {
      const oldRemaining = Math.max(num(existing.grand_total) - num(existing.cash_paid) - num(existing.online_paid), 0);
      const next = {
        ...c,
        total_orders: Math.max(num(c.total_orders) - 1, 0),
        total_purchases: Math.max(num(c.total_purchases) - num(existing.grand_total), 0),
        outstanding_balance: Math.max(num(c.outstanding_balance) - (existing.katha ? oldRemaining : 0), 0),
        updated_at: nowIso(),
      };
      await putLocal("customers", next);
      await enqueuePatch(refUrl, refHeaders, "customers", String(c.id), {
        total_orders: next.total_orders,
        total_purchases: next.total_purchases,
        outstanding_balance: next.outstanding_balance,
      });
    }
  }
  // Delete old sale_items locally + on cloud.
  for (const oi of oldItems) {
    await db.sale_items.delete(String(oi.id)).catch(() => {});
    await enqueueRequest({
      url: `${urlForTable(refUrl, "sale_items")}?id=eq.${encodeURIComponent(String(oi.id))}`,
      method: "DELETE", headers: refHeaders, body: null,
    });
  }

  // 2) Re-apply new items / stock.
  const status = args._status === "pending" ? "pending" : "completed";
  const paymentMethod = args._payment_method === "card" ? "card" : "cash";
  const orderType = ["walk_in", "take_away", "delivery"].includes(args._order_type) ? args._order_type : "walk_in";
  const discountType = args._discount_type === "percent" ? "percent" : "amount";
  const delivery = orderType === "delivery" ? num(args._delivery_charges) : 0;

  const customerId = await upsertCustomerByPhone(args._customer_name, args._customer_phone, refUrl, refHeaders);
  const now = nowIso();

  let subtotal = 0;
  const newItemRows: Row[] = [];
  for (const it of items) {
    const productId = String(it.product_id);
    const product = (await db.products.get(productId)) as Row | undefined;
    if (!product) throw new Error("Product not found");
    const qty = num(it.quantity);
    const rate = num(it.rate) || num(product.sale_price);
    const total = Math.round(qty * rate * 100) / 100;
    subtotal += total;
    const siRow: Row = {
      id: newUuid(),
      sale_id: saleId,
      product_id: productId,
      quantity: qty,
      price: rate,
      total,
      unit: it.unit ?? product.unit ?? null,
      created_at: now,
      updated_at: now,
    };
    newItemRows.push(siRow);
    await putLocal("sale_items", siRow);
    await applyStockForSaleItem(productId, qty, 1, refUrl, refHeaders);
  }

  const discountAmount = computeDiscount(subtotal, discountType, num(args._discount_value));
  const grandTotal = Math.max(subtotal - discountAmount, 0) + delivery;

  const patch: Row = {
    customer_name: trimOrNull(args._customer_name),
    customer_phone: trimOrNull(args._customer_phone),
    customer_id: customerId,
    status,
    delivery_charges: delivery,
    payment_method: paymentMethod,
    cash_paid: num(args._cash_paid),
    online_paid: num(args._online_paid),
    order_type: orderType,
    delivery_boy: trimOrNull(args._delivery_boy),
    delivery_address: trimOrNull(args._delivery_address),
    katha: !!args._katha,
    discount_type: discountType,
    discount_value: num(args._discount_value),
    discount_amount: discountAmount,
    grand_total: grandTotal,
    sale_date: args._sale_date ?? existing.sale_date,
    updated_at: now,
  };
  const updated = { ...existing, ...patch };
  await putLocal("sales", updated);
  await enqueuePatch(refUrl, refHeaders, "sales", saleId, patch);
  await enqueueInsert(refUrl, refHeaders, "sale_items", newItemRows);

  if (customerId && status === "completed") {
    const remaining = Math.max(grandTotal - num(args._cash_paid) - num(args._online_paid), 0);
    const c = (await db.customers.get(customerId)) as Row | undefined;
    if (c) {
      const next = {
        ...c,
        last_visit: now,
        total_orders: num(c.total_orders) + 1,
        total_purchases: num(c.total_purchases) + grandTotal,
        outstanding_balance: num(c.outstanding_balance) + (args._katha ? remaining : 0),
        updated_at: now,
      };
      await putLocal("customers", next);
      await enqueuePatch(refUrl, refHeaders, "customers", customerId, {
        last_visit: next.last_visit,
        total_orders: next.total_orders,
        total_purchases: next.total_purchases,
        outstanding_balance: next.outstanding_balance,
      });
    }
  }

  return updated;
}

async function localRestoreSaleStock(args: Row, refUrl: string, refHeaders: Record<string, string>): Promise<void> {
  const saleId = String(args._sale_id);
  const db = localDb();
  const sale = (await db.sales.get(saleId)) as Row | undefined;
  if (!sale) return;
  if (!["pending", "completed"].includes(String(sale.status))) return;
  const items = (await db.sale_items.where("sale_id").equals(saleId).toArray()) as Row[];
  for (const it of items) {
    if (it.product_id) await applyStockForSaleItem(String(it.product_id), num(it.quantity), -1, refUrl, refHeaders);
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Try to serve an RPC call locally. Returns a Response on success, or null if
 * the RPC isn't emulated (caller should keep going to the network).
 *
 * The original RPC request is NOT enqueued — instead we enqueue the underlying
 * table writes so cloud state converges via ordinary PostgREST calls.
 */
export async function serveLocalRpc(
  rpcName: string,
  body: string | null,
  refUrl: string,
  refHeaders: Record<string, string>,
): Promise<Response | null> {
  let args: Row = {};
  if (body) {
    try { args = JSON.parse(body) ?? {}; } catch { args = {}; }
  }
  try {
    if (rpcName === "save_sale") {
      const sale = await localSaveSale(args, refUrl, refHeaders);
      return new Response(JSON.stringify(sale), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-local-first": "1" },
      });
    }
    if (rpcName === "update_sale") {
      const sale = await localUpdateSale(args, refUrl, refHeaders);
      return new Response(JSON.stringify(sale), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-local-first": "1" },
      });
    }
    if (rpcName === "restore_sale_stock") {
      await localRestoreSaleStock(args, refUrl, refHeaders);
      return new Response("null", {
        status: 200,
        headers: { "Content-Type": "application/json", "x-local-first": "1" },
      });
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ message: err?.message ?? "Local RPC failed", code: "LOCAL_RPC_ERROR" }),
      { status: 400, headers: { "Content-Type": "application/json", "x-local-first": "1" } },
    );
  }
  return null;
}

export function isKnownLocalRpc(name: string): boolean {
  return name === "save_sale" || name === "update_sale" || name === "restore_sale_stock";
}
