/**
 * PHASE 5J / 5K — offline REPORTING READS.
 *
 * The report engine is already a pure client-side calculation: every number on
 * the Reports / Dashboard screens is derived in `src/lib/report-engine.ts` from
 * fourteen raw row sets. None of the reporting SQL functions
 * (`monthly_financial_summary`, `category_monthly_report`,
 * `dashboard_category_cards`) is used by the UI, so nothing has to be ported —
 * only the *row sets* need a local source.
 *
 * Rules enforced here:
 *   * NO FORMULA IS TOUCHED. This module only loads rows. `computeReport()`
 *     is the single calculation path for both cloud and local inputs.
 *   * IDENTICAL SHAPE. `assembleSales` / `assembleProduction` rebuild exactly
 *     the nested objects PostgREST returns, and `filterReportInputs` repeats
 *     exactly the WHERE clauses the cloud queries use.
 *   * ONLINE ALWAYS READS THE CLOUD. Sales, purchases and stock movements are
 *     still written cloud-side, so the mirror can be behind. Local reporting
 *     is served only while the browser is offline, where the alternative is no
 *     report at all — and the result is stamped with the seed timestamp.
 *   * ALL-OR-NOTHING. Every core table must be healthy and seeded; otherwise
 *     the cloud path is used.
 */

import { LocalRepository } from "@/data/repo/local-repository";
import { localReadHealth } from "@/data/repo/health";
import type { Row, TableName } from "@/data/repo/types";

/** The fourteen row sets the report engine consumes. */
export type ReportInputs = {
  sales: Row[];
  expenses: Row[];
  deliveryExpenses: Row[];
  purchases: Row[];
  products: Row[];
  stockItems: Row[];
  recipes: Row[];
  transfers: Row[];
  production: Row[];
  transferExpenses: Row[];
  /** stock_adjustments - manual (+/-) corrections feeding the stock position. */
  adjustments: Row[];
  overrides: Row[];
  snapshot: Row[];
  staff: Row[];
  attendance: Row[];
};

export type ReportRangeFilter = {
  from?: string;
  to?: string;
  startUTC?: string;
  endExclusiveUTC?: string;
};

/** Tables that MUST be seeded before a report may be served locally. */
export const REPORT_CORE_TABLES: TableName[] = ["sales", "sale_items", "products"];

/** Tables read for reporting that may legitimately contain zero rows. */
export const REPORT_OPTIONAL_TABLES: TableName[] = [
  "expenses",
  "delivery_expenses",
  "stock_purchases",
  "stock_items",
  "recipes",
  "stock_transfers",
  "production_batches",
  "production_batch_items",
  "stock_adjustments",
  "monthly_stock_overrides",
  "stock_opening_snapshots",
  "staff",
  "staff_attendance",
];

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * May the report be built from SQLite right now? Only offline, only with a
 * verified seed, and only when every core table actually holds rows.
 */
export async function canReadReportsLocally(): Promise<boolean> {
  try {
    if (!isOffline()) return false;
    const health = await localReadHealth();
    if (!health.usable) return false;
    return REPORT_CORE_TABLES.every((t) => (health.seededTables[t] ?? 0) > 0);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Pure shape rebuilders — no I/O, so cloud/local parity is testable.
 * ------------------------------------------------------------------ */

/** Rebuilds `sales(..., sale_items(..., products(...)))`. */
export function assembleSales(sales: Row[], saleItems: Row[], products: Row[]): Row[] {
  const productById = new Map<string, Row>(products.map((p) => [String(p.id), p]));
  const bySale = new Map<string, Row[]>();
  for (const raw of saleItems) {
    const product = raw.product_id ? productById.get(String(raw.product_id)) : undefined;
    const item: Row = {
      id: raw.id,
      product_id: (raw.product_id as string | null) ?? null,
      quantity: raw.quantity,
      price: raw.price,
      total: raw.total,
      unit: (raw.unit as string | null) ?? null,
      products: product
        ? {
            id: product.id,
            name: product.name,
            category: product.category,
            cost_price: product.cost_price,
          }
        : null,
    };
    const key = String(raw.sale_id);
    const list = bySale.get(key);
    if (list) list.push(item);
    else bySale.set(key, [item]);
  }
  return sales.map((s) => ({ ...s, sale_items: bySale.get(String(s.id)) ?? [] }));
}

/** Rebuilds `production_batches(..., production_batch_items(...))`. */
export function assembleProduction(batches: Row[], items: Row[]): Row[] {
  const byBatch = new Map<string, Row[]>();
  for (const raw of items) {
    const key = String(raw.batch_id);
    const entry = {
      source_category: raw.source_category ?? null,
      total_cost: raw.total_cost,
      component_product_id: raw.component_product_id ?? null,
      component_stock_item_id: raw.component_stock_item_id ?? null,
      quantity: raw.quantity,
    };
    const list = byBatch.get(key);
    if (list) list.push(entry);
    else byBatch.set(key, [entry]);
  }
  return batches.map((b) => ({ ...b, production_batch_items: byBatch.get(String(b.id)) ?? [] }));
}

function inDateRange(value: unknown, from?: string, to?: string): boolean {
  if (!from || !to) return true;
  const d = String(value ?? "").slice(0, 10);
  return d >= from && d <= to;
}

function inTimestampRange(value: unknown, startUTC?: string, endExclusiveUTC?: string): boolean {
  if (!startUTC || !endExclusiveUTC) return true;
  const t = Date.parse(String(value ?? ""));
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(startUTC) && t < Date.parse(endExclusiveUTC);
}

/**
 * Applies exactly the WHERE clauses the cloud report queries use, so a full
 * local table produces the same set of rows PostgREST would have returned.
 */
export function filterReportInputs(all: ReportInputs, range: ReportRangeFilter): ReportInputs {
  const { from, to, startUTC, endExclusiveUTC } = range;
  const hasTs = Boolean(startUTC && endExclusiveUTC);
  const year = from ? Number(from.slice(0, 4)) : null;
  const month = from ? Number(from.slice(5, 7)) : null;
  const periodMatch = (r: Row) => year === null || (Number(r.year) === year && Number(r.month) === month);

  return {
    sales: hasTs
      ? all.sales.filter((s) => inTimestampRange(s.sale_date, startUTC, endExclusiveUTC))
      : all.sales,
    expenses: all.expenses.filter((e) => inDateRange(e.date, from, to)),
    deliveryExpenses: all.deliveryExpenses.filter((e) => inDateRange(e.date, from, to)),
    purchases: all.purchases.filter((p) => inDateRange(p.date, from, to)),
    products: all.products,
    stockItems: all.stockItems,
    recipes: all.recipes,
    transfers: all.transfers.filter((t) => inTimestampRange(t.created_at, startUTC, endExclusiveUTC)),
    production: all.production.filter((b) => inDateRange(b.batch_date, from, to)),
    transferExpenses: all.transferExpenses.filter((e) => inDateRange(e.date, from, to)),
    adjustments: all.adjustments.filter((a) => inDateRange(a.date, from, to)),
    overrides: from ? all.overrides.filter(periodMatch) : [],
    snapshot: from ? all.snapshot.filter(periodMatch) : [],
    staff: all.staff,
    attendance: from && to ? all.attendance.filter((a) => inDateRange(a.date, from, to)) : all.attendance,
  };
}

/* ------------------------------------------------------------------ *
 * Local loading
 * ------------------------------------------------------------------ */

const LIVE = { is: { deleted_at: null } } as const;

/** Reads every reporting row set out of SQLite, unfiltered. */
export async function loadLocalReportInputs(repo = new LocalRepository()): Promise<ReportInputs> {
  const [
    sales,
    saleItems,
    expenses,
    deliveryExpenses,
    purchases,
    products,
    stockItems,
    recipes,
    transfers,
    batches,
    batchItems,
    overrides,
    snapshot,
    staff,
    attendance,
    adjustments,
  ] = await Promise.all([
    repo.list<Row>("sales", {
      filter: { ...LIVE, eq: { hidden: false } },
      order: [{ column: "sale_date", ascending: false }],
    }),
    repo.list<Row>("sale_items", {}),
    repo.list<Row>("expenses", { filter: { ...LIVE } }),
    repo.list<Row>("delivery_expenses", { filter: { ...LIVE } }),
    repo.list<Row>("stock_purchases", { filter: { ...LIVE } }),
    repo.list<Row>("products", { filter: { ...LIVE }, order: [{ column: "name" }] }),
    repo.list<Row>("stock_items", { filter: { ...LIVE }, order: [{ column: "name" }] }),
    repo.list<Row>("recipes", { filter: { ...LIVE } }),
    repo.list<Row>("stock_transfers", {
      filter: { ...LIVE },
      order: [{ column: "created_at", ascending: false }],
    }),
    repo.list<Row>("production_batches", {
      filter: { ...LIVE },
      order: [{ column: "batch_date", ascending: false }],
    }),
    repo.list<Row>("production_batch_items", {}),
    repo.list<Row>("monthly_stock_overrides", {}),
    repo.list<Row>("stock_opening_snapshots", {}),
    repo.list<Row>("staff", { filter: { ...LIVE } }),
    repo.list<Row>("staff_attendance", { filter: { eq: { status: "present" } } }),
    repo.list<Row>("stock_adjustments", { filter: { ...LIVE } }),
  ]);

  return {
    sales: assembleSales(sales, saleItems, products),
    expenses,
    deliveryExpenses,
    purchases,
    products,
    stockItems,
    recipes,
    transfers,
    production: assembleProduction(batches, batchItems),
    transferExpenses: expenses.filter((e) => e.is_stock_transfer === true),
    adjustments,
    overrides,
    snapshot,
    staff,
    attendance,
  };
}

/** Local report inputs for one range, or `null` when the gate says no. */
export async function tryLocalReportInputs(
  range: ReportRangeFilter,
): Promise<{ inputs: ReportInputs; seededAt: string | null } | null> {
  if (!(await canReadReportsLocally())) return null;
  try {
    const health = await localReadHealth();
    const all = await loadLocalReportInputs();
    return { inputs: filterReportInputs(all, range), seededAt: health.seededAt };
  } catch {
    return null;
  }
}
