/**
 * Local trigger engine — browser-side replacement for the cloud triggers that
 * used to run automatically on Lovable Cloud.
 *
 * The cloud database no longer runs any business rules (see migration that
 * drops trg_purchase_cash_movement, trg_purchase_item_apply,
 * trg_purchase_update_stock, trg_purchase_recalc_wac,
 * trg_purchase_sync_category, trg_stock_transfer_reverse). Every derived row
 * (cash_movements from paid purchases, stock_purchases from purchase_items,
 * current_stock / cost_price adjustments, stock reversal on transfer delete)
 * is produced here in the browser, applied to IndexedDB immediately, and
 * enqueued to the outbox so the same UUIDs land on the cloud on the next
 * sync.
 *
 * Call `runLocalTriggers` from the fetch interceptor AFTER the primary write
 * has landed in IndexedDB but BEFORE the outgoing cloud request is enqueued.
 * Any mutation to the primary row (e.g. filling `cash_movement_id` on a
 * purchase) is written back through the returned `mutatePrimary` object.
 */

import { localDb } from "./db";
import { enqueueRequest } from "./outbox";
import { businessToday } from "@/lib/business-date";

type Row = Record<string, any>;

function newUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nowIso(): string { return new Date().toISOString(); }

/** Rewrite the /rest/v1/<table> path of a URL to target a different table. */
function urlForTable(baseUrl: string, table: string): string {
  try {
    const u = new URL(baseUrl);
    u.pathname = u.pathname.replace(/\/rest\/v1\/[^/?]+$/, `/rest/v1/${table}`);
    u.search = "";
    return u.toString();
  } catch {
    return baseUrl;
  }
}

/** Enqueue an INSERT of a derived row to the cloud. Preserves UUID. */
async function enqueueDerivedInsert(
  refUrl: string,
  refHeaders: Record<string, string>,
  table: string,
  row: Row,
) {
  const headers = { ...refHeaders };
  // Force PostgREST to upsert on conflict and return the row.
  const existing = headers["Prefer"] ?? headers["prefer"] ?? "";
  const parts = new Set(existing.split(",").map((s) => s.trim()).filter(Boolean));
  parts.add("resolution=merge-duplicates");
  parts.add("return=representation");
  headers["Prefer"] = Array.from(parts).join(",");
  delete headers["prefer"];
  await enqueueRequest({
    url: urlForTable(refUrl, table),
    method: "POST",
    headers,
    body: JSON.stringify([row]),
  });
}

/** Enqueue a PATCH of a row identified by id. */
async function enqueueDerivedPatch(
  refUrl: string,
  refHeaders: Record<string, string>,
  table: string,
  id: string,
  patch: Row,
) {
  const url = urlForTable(refUrl, table) + `?id=eq.${encodeURIComponent(id)}`;
  await enqueueRequest({
    url,
    method: "PATCH",
    headers: refHeaders,
    body: JSON.stringify(patch),
  });
}

/** Enqueue a DELETE of a row identified by id. */
async function enqueueDerivedDelete(
  refUrl: string,
  refHeaders: Record<string, string>,
  table: string,
  id: string,
) {
  const url = urlForTable(refUrl, table) + `?id=eq.${encodeURIComponent(id)}`;
  await enqueueRequest({
    url,
    method: "DELETE",
    headers: refHeaders,
    body: null,
  });
}

/** Apply a local Dexie mutation without going through the fetch interceptor. */
async function putLocal(table: string, row: Row) {
  const dexie = localDb();
  if (!dexie.tables.some((t) => t.name === table)) return;
  await dexie.table(table).put({ ...row, _dirty: 1 } as never).catch(() => {});
}

async function deleteLocal(table: string, id: string) {
  const dexie = localDb();
  if (!dexie.tables.some((t) => t.name === table)) return;
  await dexie.table(table).delete(id).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/*                                 Triggers                                   */
/* -------------------------------------------------------------------------- */

export type TriggerCtx = {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  before: Row | null;
  after: Row | null;
  /** Reference request so derived writes can reuse the auth headers. */
  refUrl: string;
  refHeaders: Record<string, string>;
};

/**
 * fn_purchase_cash_movement — creates/replaces/reverses the linked
 * cash_movements row when a purchase is paid.
 */
async function tPurchaseCashMovement(ctx: TriggerCtx): Promise<{ mutatePrimary?: Row }> {
  const { op, before, after, refUrl, refHeaders } = ctx;

  // Step 1: remove any previously linked movement.
  const oldMovementId: string | null =
    (op === "update" || op === "delete") && before?.cash_movement_id
      ? String(before.cash_movement_id)
      : null;
  if (oldMovementId) {
    await deleteLocal("cash_movements", oldMovementId);
    await enqueueDerivedDelete(refUrl, refHeaders, "cash_movements", oldMovementId);
  }

  if (op === "delete") return {};
  if (!after) return {};

  const paid = after.payment_status === "paid";
  const method = String(after.payment_method ?? "");
  const notDeleted = after.deleted_at == null;
  const total = Number(after.grand_total ?? 0);

  if (!(paid && (method === "cash" || method === "online") && notDeleted && total > 0)) {
    // Not eligible — clear the linkage.
    return { mutatePrimary: { cash_movement_id: null } };
  }

  const movementId = newUuid();
  const bizDate = String(after.date ?? businessToday());
  const occurredAt = after.date
    ? new Date(String(after.date)).toISOString()
    : nowIso();
  const supplier = after.supplier ? ` — ${after.supplier}` : "";
  const reason = `Purchase${supplier}`;
  const movement: Row = {
    id: movementId,
    business_date: bizDate,
    occurred_at: occurredAt,
    type: "cash_out",
    payment_source: method,
    amount: total,
    movement_category: "Purchase",
    notes: after.notes ?? reason,
    reason,
    reference_type: "purchase",
    reference_id: after.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await putLocal("cash_movements", movement);
  await enqueueDerivedInsert(refUrl, refHeaders, "cash_movements", movement);

  return { mutatePrimary: { cash_movement_id: movementId } };
}

/**
 * fn_purchase_item_apply — materialises a stock_purchases row for each
 * purchase_item, and deletes it on purchase_item delete.
 */
async function tPurchaseItemApply(ctx: TriggerCtx) {
  const { op, before, after, refUrl, refHeaders } = ctx;

  if (op === "insert" || op === "upsert") {
    if (!after) return {};
    const parent = (await localDb().purchases.get(String(after.purchase_id))) as Row | undefined;
    const spId = newUuid();
    const spRow: Row = {
      id: spId,
      date: parent?.date ?? businessToday(),
      product_id: after.product_id ?? null,
      stock_item_id: after.stock_item_id ?? null,
      category: after.category ?? null,       // sync_category runs next
      quantity: after.quantity,
      unit_cost: after.unit_cost,
      total_cost: after.total_cost,
      supplier: parent?.supplier ?? null,
      notes: null,
      purchase_item_id: after.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    // Emulate BEFORE INSERT sync_category by resolving category from linked
    // product / stock_item.
    spRow.category = await resolveCategory(spRow.category, spRow.product_id, spRow.stock_item_id);
    await putLocal("stock_purchases", spRow);
    await enqueueDerivedInsert(refUrl, refHeaders, "stock_purchases", spRow);
    // Cascading AFTER-triggers on stock_purchases:
    await tPurchaseUpdateStock({ ...ctx, table: "stock_purchases", op: "insert", before: null, after: spRow });
    await tPurchaseRecalcWac({ ...ctx, table: "stock_purchases", op: "insert", before: null, after: spRow });
    return {};
  }

  if (op === "delete" && before) {
    const spRows = await localDb().stock_purchases.where("purchase_item_id").equals(before.id).toArray();
    for (const sp of spRows) {
      await deleteLocal("stock_purchases", String(sp.id));
      await enqueueDerivedDelete(refUrl, refHeaders, "stock_purchases", String(sp.id));
      // Cascade the AFTER-DELETE trigger locally.
      await tPurchaseUpdateStock({ ...ctx, table: "stock_purchases", op: "delete", before: sp, after: null });
      await tPurchaseRecalcWac({ ...ctx, table: "stock_purchases", op: "delete", before: sp, after: null });
    }
    return {};
  }

  return {};
}

/** BEFORE INSERT/UPDATE on stock_purchases — fill `category` from parent. */
async function resolveCategory(current: string | null | undefined, productId: string | null, stockItemId: string | null): Promise<string> {
  let cat = current && String(current).trim() ? String(current) : "";
  if (!cat && productId) {
    const p = (await localDb().products.get(productId)) as Row | undefined;
    if (p?.category) cat = String(p.category);
  }
  if (!cat && stockItemId) {
    const s = (await localDb().stock_items.get(stockItemId)) as Row | undefined;
    if (s?.category) cat = String(s.category);
  }
  if (!cat) {
    const cats = await localDb().categories.toArray();
    const first = cats
      .filter((c) => !(c as Row).deleted_at)
      .sort((a, b) => Number((a as Row).sort_order ?? 0) - Number((b as Row).sort_order ?? 0))[0] as Row | undefined;
    cat = first?.name ?? "Snacks";
  }
  return cat;
}

/**
 * fn_purchase_update_stock — adjust products.current_stock or
 * stock_items.current_stock on stock_purchases changes.
 */
async function tPurchaseUpdateStock(ctx: TriggerCtx) {
  const { op, before, after, refUrl, refHeaders } = ctx;

  const applyDelta = async (
    productId: string | null,
    stockItemId: string | null,
    delta: number,
  ) => {
    if (!delta) return;
    if (productId) {
      const p = (await localDb().products.get(productId)) as Row | undefined;
      if (!p) return;
      const next = { ...p, current_stock: Number(p.current_stock ?? 0) + delta, updated_at: nowIso() };
      await putLocal("products", next);
      await enqueueDerivedPatch(refUrl, refHeaders, "products", productId, {
        current_stock: next.current_stock,
      });
    } else if (stockItemId) {
      const s = (await localDb().stock_items.get(stockItemId)) as Row | undefined;
      if (!s) return;
      const next = { ...s, current_stock: Number(s.current_stock ?? 0) + delta, updated_at: nowIso() };
      await putLocal("stock_items", next);
      await enqueueDerivedPatch(refUrl, refHeaders, "stock_items", stockItemId, {
        current_stock: next.current_stock,
      });
    }
  };

  if (op === "insert" || op === "upsert") {
    if (!after || after.deleted_at) return {};
    await applyDelta(after.product_id ?? null, after.stock_item_id ?? null, Number(after.quantity ?? 0));
    return {};
  }

  if (op === "update") {
    const oldQty = before && !before.deleted_at ? Number(before.quantity ?? 0) : 0;
    const newQty = after && !after.deleted_at ? Number(after.quantity ?? 0) : 0;
    const oldPid = before?.product_id ?? null;
    const newPid = after?.product_id ?? null;
    const oldSid = before?.stock_item_id ?? null;
    const newSid = after?.stock_item_id ?? null;
    const targetChanged = oldPid !== newPid || oldSid !== newSid;
    if (targetChanged) {
      if (oldQty) await applyDelta(oldPid, oldSid, -oldQty);
      if (newQty) await applyDelta(newPid, newSid, newQty);
    } else {
      const delta = newQty - oldQty;
      if (delta) await applyDelta(newPid, newSid, delta);
    }
    return {};
  }

  if (op === "delete") {
    if (!before || before.deleted_at) return {};
    await applyDelta(before.product_id ?? null, before.stock_item_id ?? null, -Number(before.quantity ?? 0));
    return {};
  }
  return {};
}

/**
 * fn_purchase_recalc_wac — recompute weighted-average cost on the affected
 * product / stock item. Mirrors the SQL exactly.
 */
async function tPurchaseRecalcWac(ctx: TriggerCtx) {
  const { op, before, after, refUrl, refHeaders } = ctx;
  const productIds = new Set<string>();
  const stockIds = new Set<string>();
  if ((op === "insert" || op === "upsert" || op === "update") && after) {
    if (after.product_id) productIds.add(String(after.product_id));
    if (after.stock_item_id) stockIds.add(String(after.stock_item_id));
  }
  if ((op === "update" || op === "delete") && before) {
    if (before.product_id) productIds.add(String(before.product_id));
    if (before.stock_item_id) stockIds.add(String(before.stock_item_id));
  }

  const allPurchases = await localDb().stock_purchases.toArray();
  const live = allPurchases.filter((r: Row) => !r.deleted_at);

  for (const pid of productIds) {
    const rows = live.filter((r: Row) => r.product_id === pid);
    const qty = rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
    const amt = rows.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
    if (qty > 0) {
      const wac = Math.round((amt / qty) * 10000) / 10000;
      const p = (await localDb().products.get(pid)) as Row | undefined;
      if (p && Number(p.cost_price ?? 0) !== wac) {
        const next = { ...p, cost_price: wac, updated_at: nowIso() };
        await putLocal("products", next);
        await enqueueDerivedPatch(refUrl, refHeaders, "products", pid, { cost_price: wac });
      }
    }
  }
  for (const sid of stockIds) {
    const rows = live.filter((r: Row) => r.stock_item_id === sid);
    const qty = rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
    const amt = rows.reduce((s, r) => s + Number(r.total_cost ?? 0), 0);
    if (qty > 0) {
      const wac = Math.round((amt / qty) * 10000) / 10000;
      const s = (await localDb().stock_items.get(sid)) as Row | undefined;
      if (s && Number(s.purchase_price ?? 0) !== wac) {
        const next = { ...s, purchase_price: wac, updated_at: nowIso() };
        await putLocal("stock_items", next);
        await enqueueDerivedPatch(refUrl, refHeaders, "stock_items", sid, { purchase_price: wac });
      }
    }
  }
  return {};
}

/**
 * fn_stock_transfer_reverse — when a stock_transfers row is soft-deleted,
 * restore the transferred quantity on the source stock.
 */
async function tStockTransferReverse(ctx: TriggerCtx) {
  const { op, before, after, refUrl, refHeaders } = ctx;
  if (op !== "update" || !after || !before) return {};
  const nowDeleted = !!after.deleted_at && !before.deleted_at;
  if (!nowDeleted) return {};
  const qty = Number(after.quantity ?? 0);
  if (!qty) return {};
  if (after.item_type === "product" && after.product_id) {
    const p = (await localDb().products.get(after.product_id)) as Row | undefined;
    if (p) {
      const next = { ...p, current_stock: Number(p.current_stock ?? 0) + qty, updated_at: nowIso() };
      await putLocal("products", next);
      await enqueueDerivedPatch(refUrl, refHeaders, "products", after.product_id, { current_stock: next.current_stock });
    }
    // Also bump matching stock_item by name (mirrors the SQL behaviour).
    if (after.item_name) {
      const target = String(after.item_name).toLowerCase().trim();
      const items = await localDb().stock_items.toArray();
      const match = items.find(
        (s: Row) => !s.deleted_at && String(s.name ?? "").toLowerCase().trim() === target,
      );
      if (match) {
        const next = { ...match, current_stock: Number(match.current_stock ?? 0) + qty, updated_at: nowIso() };
        await putLocal("stock_items", next);
        await enqueueDerivedPatch(refUrl, refHeaders, "stock_items", String(match.id), { current_stock: next.current_stock });
      }
    }
  } else if (after.item_type === "stock_item" && after.stock_item_id) {
    const s = (await localDb().stock_items.get(after.stock_item_id)) as Row | undefined;
    if (s) {
      const next = { ...s, current_stock: Number(s.current_stock ?? 0) + qty, updated_at: nowIso() };
      await putLocal("stock_items", next);
      await enqueueDerivedPatch(refUrl, refHeaders, "stock_items", after.stock_item_id, { current_stock: next.current_stock });
    }
  }
  return {};
}

/* -------------------------------------------------------------------------- */
/*                                 Dispatcher                                 */
/* -------------------------------------------------------------------------- */

/**
 * Run every local trigger relevant to the given table/op. Returns an
 * optional patch to apply back to the primary row (e.g. purchases.cash_movement_id).
 */
export async function runLocalTriggers(ctx: TriggerCtx): Promise<{ mutatePrimary?: Row }> {
  try {
    if (ctx.table === "purchases") {
      return await tPurchaseCashMovement(ctx);
    }
    if (ctx.table === "purchase_items") {
      return await tPurchaseItemApply(ctx);
    }
    if (ctx.table === "stock_purchases") {
      await tPurchaseUpdateStock(ctx);
      await tPurchaseRecalcWac(ctx);
      return {};
    }
    if (ctx.table === "stock_transfers") {
      return await tStockTransferReverse(ctx);
    }
  } catch (err) {
    console.warn("[local-triggers] failed", ctx.table, ctx.op, err);
  }
  return {};
}
