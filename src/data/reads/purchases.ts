/**
 * PHASE 5G / 5K — offline PURCHASE READS.
 *
 * Purchase WRITES stay on the cloud (see `src/data/repo/README.md` — the
 * `fn_purchase_cash_movement` / `fn_purchase_item_apply` triggers). Reads are a
 * different question: the Purchases screen shows nothing that Postgres derives
 * at read time. It is a plain parent/child join plus two name lookups, and the
 * Phase 3 seed already mirrors every one of those tables.
 *
 * Rules enforced here:
 *   * ALL-OR-NOTHING. A purchase view is served locally only when *every*
 *     table it needs (purchases, purchase_items, products, stock_items) is
 *     healthy and seeded. A half-local join could show an invoice with its
 *     items missing, which is worse than reading the cloud.
 *   * IDENTICAL SHAPE. `assemblePurchases` rebuilds exactly the nested object
 *     PostgREST returns for
 *     `*, purchase_items(*, products(name,unit), stock_items(name,unit))`,
 *     including the `null` embed for the side that is not used.
 *   * NO CALCULATION. Nothing is summed, rounded, defaulted or repaired. Rows
 *     come back exactly as stored.
 */

import { readRepo } from "@/data/repo";
import { canReadLocally } from "@/data/repo/health";
import type { Row, TableName } from "@/data/repo";
import { supabase } from "@/integrations/supabase/client";

const LIVE = { is: { deleted_at: null } } as const;

/** Tables the purchase list needs before it may be served from SQLite. */
export const PURCHASE_READ_TABLES: TableName[] = [
  "purchases",
  "purchase_items",
  "products",
  "stock_items",
];

/** All-or-nothing gate: every table must be locally readable. */
export async function canReadPurchasesLocally(
  tables: TableName[] = PURCHASE_READ_TABLES,
): Promise<boolean> {
  try {
    const results = await Promise.all(tables.map((t) => canReadLocally(t)));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

export type NameUnit = { name: string; unit: string | null } | null;

export type PurchaseItemRow = Row & {
  purchase_id: string;
  product_id: string | null;
  stock_item_id: string | null;
  products: NameUnit;
  stock_items: NameUnit;
};

export type PurchaseRow = Row & { id: string; purchase_items: PurchaseItemRow[] };

/**
 * Rebuilds the PostgREST-embedded shape from four flat row sets.
 * Pure — no I/O — so cloud/local parity can be asserted directly.
 */
export function assemblePurchases(
  purchases: Row[],
  items: Row[],
  products: Row[],
  stockItems: Row[],
): PurchaseRow[] {
  const productById = new Map<string, Row>(products.map((p) => [String(p.id), p]));
  const itemById = new Map<string, Row>(stockItems.map((s) => [String(s.id), s]));

  const byPurchase = new Map<string, PurchaseItemRow[]>();
  for (const raw of items) {
    const product = raw.product_id ? productById.get(String(raw.product_id)) : undefined;
    const stockItem = raw.stock_item_id ? itemById.get(String(raw.stock_item_id)) : undefined;
    const item: PurchaseItemRow = {
      ...raw,
      purchase_id: String(raw.purchase_id),
      product_id: (raw.product_id as string | null) ?? null,
      stock_item_id: (raw.stock_item_id as string | null) ?? null,
      products: product ? { name: String(product.name), unit: (product.unit as string) ?? null } : null,
      stock_items: stockItem
        ? { name: String(stockItem.name), unit: (stockItem.unit as string) ?? null }
        : null,
    };
    const list = byPurchase.get(item.purchase_id);
    if (list) list.push(item);
    else byPurchase.set(item.purchase_id, [item]);
  }

  return purchases.map((p) => ({
    ...p,
    id: String(p.id),
    purchase_items: byPurchase.get(String(p.id)) ?? [],
  })) as PurchaseRow[];
}

/** The exact cloud query the Purchases screen has always used. */
async function listPurchasesFromCloud(): Promise<PurchaseRow[]> {
  const { data } = await (supabase as any)
    .from("purchases")
    .select("*, purchase_items(*, products(name,unit), stock_items(name,unit))")
    .is("deleted_at", null)
    .order("date", { ascending: false })
    .range(0, 99999);
  return (data ?? []) as PurchaseRow[];
}

async function listPurchasesFromLocal(): Promise<PurchaseRow[]> {
  const repo = await readRepo("purchases");
  const itemRepo = await readRepo("purchase_items");
  const productRepo = await readRepo("products");
  const stockRepo = await readRepo("stock_items");

  const [purchases, items, products, stockItems] = await Promise.all([
    repo.list<Row>("purchases", {
      filter: { ...LIVE },
      order: [{ column: "date", ascending: false }],
    }),
    itemRepo.list<Row>("purchase_items", {}),
    productRepo.list<Row>("products", { columns: "id, name, unit" }),
    stockRepo.list<Row>("stock_items", { columns: "id, name, unit" }),
  ]);
  return assemblePurchases(purchases, items, products, stockItems);
}

/**
 * Purchase list with items — local when every required table is healthy and
 * seeded, otherwise byte-for-byte the cloud query used before Phase 5G.
 */
export async function listPurchasesWithItems(): Promise<PurchaseRow[]> {
  if (await canReadPurchasesLocally()) {
    try {
      return await listPurchasesFromLocal();
    } catch {
      // Any local read problem at all → the cloud, never a partial list.
      return listPurchasesFromCloud();
    }
  }
  return listPurchasesFromCloud();
}

/** One purchase with its items, or null. Same gate, same shape. */
export async function getPurchaseWithItems(id: string): Promise<PurchaseRow | null> {
  const all = await listPurchasesWithItems();
  return all.find((p) => String(p.id) === String(id)) ?? null;
}

/**
 * The `stock_purchases` ledger rows a purchase produced. Read-only: the rows
 * themselves are still written by the cloud trigger.
 */
export async function listStockPurchases(
  range?: { from: string; to: string },
): Promise<Row[]> {
  const repo = await readRepo("stock_purchases");
  const filter: any = { ...LIVE };
  if (range) {
    filter.gte = { date: range.from };
    filter.lte = { date: range.to };
  }
  return repo.list<Row>("stock_purchases", {
    filter,
    order: [{ column: "date", ascending: false }],
  });
}
