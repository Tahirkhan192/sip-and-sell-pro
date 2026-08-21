/**
 * Local (SQLite) implementation of `DataRepository` — SKELETON ONLY.
 *
 * Deliberately unimplemented. It exists so the future offline conversion is a
 * drop-in replacement performed in Visual Studio, not a rewrite:
 *
 *   setRepository(new LocalRepository(await openLocalDb()))
 *
 * Rules this implementation must follow when it is completed:
 *   - Preserve every existing ID and foreign key exactly (no regeneration).
 *   - Reproduce cloud semantics exactly; no new calculations, no data repair.
 *   - Every cloud RPC gets a TypeScript/SQLite twin with identical output.
 *   - No automatic two-way sync. Cloud never overwrites local, local never
 *     overwrites cloud. Any transfer is a deliberate, manual operation.
 */

import type { LocalDb } from "@/data/local/db";
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

function notReady(what: string): never {
  throw new Error(
    `LocalRepository.${what}() is not implemented yet. The application still runs on the cloud repository.`,
  );
}

export class LocalRepository implements DataRepository {
  readonly kind = "local" as const;

  constructor(private readonly db: LocalDb) {}

  list<T = Row>(_table: TableName, _options?: SelectOptions): Promise<T[]> {
    return notReady("list");
  }
  getById<T = Row>(_table: TableName, _id: string | number, _columns?: string): Promise<T | null> {
    return notReady("getById");
  }
  findOne<T = Row>(_table: TableName, _options?: SelectOptions): Promise<T | null> {
    return notReady("findOne");
  }
  count(_table: TableName, _filter?: Filter): Promise<number> {
    return notReady("count");
  }
  insert<T = Row>(_table: TableName, _values: Row | Row[]): Promise<T[]> {
    return notReady("insert");
  }
  update<T = Row>(_table: TableName, _values: Row, _filter: Filter): Promise<T[]> {
    return notReady("update");
  }
  upsert<T = Row>(_table: TableName, _values: Row | Row[], _onConflict?: string): Promise<T[]> {
    return notReady("upsert");
  }
  remove(_table: TableName, _filter: Filter): Promise<void> {
    return notReady("remove");
  }
  rpc<T = any>(_fn: string, _args?: Record<string, any>): Promise<T> {
    return notReady("rpc");
  }
}
