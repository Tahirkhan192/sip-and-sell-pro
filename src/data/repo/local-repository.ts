/**
 * Local (SQLite) implementation of `DataRepository` — PHASE 4: READ-ONLY.
 *
 * What this does
 *   * `list`, `getById`, `findOne` and `count` read the verified `cloud_*`
 *     mirror tables produced by the Phase 3 seed, through the typed worker
 *     protocol. No raw SQL crosses the main-thread boundary and every value
 *     is bound as a parameter.
 *   * Rows come back in the cloud's shape: booleans restored from 0/1, json
 *     and array columns parsed, everything else verbatim — same ids, same
 *     timestamps, same nulls, same soft-delete markers, same numbers.
 *
 * What this deliberately does NOT do
 *   * No writes. Every mutation throws; nothing is queued, no outbox exists,
 *     and no conflict resolution is attempted. Business writes stay on the
 *     cloud repository, which remains authoritative.
 *   * No local RPCs. The cloud stored procedures have no local twin yet.
 */

import { hydrateRows } from "@/data/local/column-types";
import { localCount, localSelect } from "@/data/local/db";
import type { LocalFilter, LocalOrder } from "@/data/local/db";
import type { DataRepository, Filter, Row, SelectOptions, TableName } from "./types";

/** Cloud RPCs that need a local twin before the offline switch-over. */
export const REQUIRED_LOCAL_PROCEDURES = [
  "save_sale",
  "update_sale",
  "update_pending_sale",
  "update_sale_payment",
  "restore_sale_stock",
  "save_production",
  "delete_production_batch",
  "save_stock_transfer",
  "stock_to_expense_transfer",
  "update_stock_transfer_expense",
  "delete_stock_transfer_expense",
  "rebuild_item_remaining",
  "recompute_product_wac",
  "recompute_stock_item_wac",
  "recompute_staff_katha",
  "staff_pay",
  "staff_payment_delete",
  "staff_salary_summary",
  "digi_katha_summary",
  "daily_closing_summary",
  "monthly_financial_summary",
  "category_monthly_report",
  "dashboard_category_cards",
  "set_opening_stock_for_period",
  "set_opening_stock_from_current",
  "mark_whatsapp_status",
  "business_date",
  "get_business_config",
  "has_role",
] as const;

export const READ_ONLY_MESSAGE =
  "LocalRepository is read-only until Phase 5B (local business writes)";

function readOnly(what: string): never {
  throw new Error(
    `${READ_ONLY_MESSAGE}: ${what}() is not available locally. ` +
      `Business writes must go through the cloud repository. ` +
      `Phase 5A only adds the local transaction/audit foundation, not business mutations.`,
  );
}


/** `SelectOptions.columns` is a PostgREST projection string ("a,b,c"). */
function parseColumns(columns?: string): string[] | undefined {
  if (!columns || columns.trim() === "*") return undefined;
  const list = columns
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (list.some((c) => c.includes("(") || c.includes(":") || c === "*")) {
    // Embedded/renamed PostgREST selects have no faithful local equivalent.
    throw new Error(
      `${READ_ONLY_MESSAGE}: projection "${columns}" is not supported locally (Phase 4 limitation).`,
    );
  }
  return list;
}

function toLocalFilter(filter?: Filter): LocalFilter | undefined {
  if (!filter) return undefined;
  return {
    eq: filter.eq,
    neq: filter.neq,
    gte: filter.gte,
    lte: filter.lte,
    in: filter.in,
    is: filter.is,
  } as LocalFilter;
}

function toLocalOrder(options?: SelectOptions): LocalOrder[] | undefined {
  const order = options?.order;
  if (!order) return undefined;
  const list = Array.isArray(order) ? order : [order];
  return list.map((o) => ({ column: o.column, ascending: o.ascending ?? true }));
}

export class LocalRepository implements DataRepository {
  readonly kind = "local" as const;

  async list<T = Row>(table: TableName, options: SelectOptions = {}): Promise<T[]> {
    const rows = await localSelect({
      table,
      columns: parseColumns(options.columns),
      filter: toLocalFilter(options.filter),
      order: toLocalOrder(options),
      limit: options.limit,
    });
    return hydrateRows<T>(table, rows);
  }

  async getById<T = Row>(table: TableName, id: string | number, columns = "*"): Promise<T | null> {
    const rows = await localSelect({
      table,
      columns: parseColumns(columns),
      filter: { eq: { id } },
      limit: 1,
    });
    return rows.length ? hydrateRows<T>(table, rows)[0] : null;
  }

  async findOne<T = Row>(table: TableName, options: SelectOptions = {}): Promise<T | null> {
    const rows = await localSelect({
      table,
      columns: parseColumns(options.columns),
      filter: toLocalFilter(options.filter),
      order: toLocalOrder(options),
      limit: 1,
    });
    return rows.length ? hydrateRows<T>(table, rows)[0] : null;
  }

  async count(table: TableName, filter?: Filter): Promise<number> {
    return localCount(table, toLocalFilter(filter));
  }

  /* ---------------- mutations: explicitly unavailable ---------------- */

  insert<T = Row>(_table: TableName, _values: Row | Row[]): Promise<T[]> {
    return readOnly("insert");
  }
  update<T = Row>(_table: TableName, _values: Row, _filter: Filter): Promise<T[]> {
    return readOnly("update");
  }
  upsert<T = Row>(_table: TableName, _values: Row | Row[], _onConflict?: string): Promise<T[]> {
    return readOnly("upsert");
  }
  remove(_table: TableName, _filter: Filter): Promise<void> {
    return readOnly("remove");
  }
  rpc<T = any>(_fn: string, _args?: Record<string, any>): Promise<T> {
    return readOnly("rpc");
  }
}
