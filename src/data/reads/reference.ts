/**
 * PHASE 4F — reference/master-data reads through the repository.
 *
 * Each function below asks `readRepo(table)` which store to use. That returns
 * the local SQLite mirror ONLY when the Phase 3 seed is verified, persistent,
 * current and non-empty for that table; otherwise it returns the cloud
 * repository and behaviour is byte-for-byte what it was before.
 *
 * These are READS ONLY. Every create/update/delete in the application still
 * goes straight to Lovable Cloud through its existing code path — nothing here
 * queues, buffers or mutates anything.
 *
 * Reads that cannot be reproduced faithfully offline (text search with
 * `ilike`/`or`, per-column null-ordering overrides, embedded PostgREST
 * selects, RPCs) are deliberately NOT routed here; they stay on the cloud and
 * are listed as Phase 4 limitations.
 */

import { readRepo } from "@/data/repo";
import type { Row, SelectOptions, TableName } from "@/data/repo";

async function read<T = Row>(table: TableName, options: SelectOptions): Promise<T[]> {
  const r = await readRepo(table);
  return r.list<T>(table, options);
}

async function readOne<T = Row>(table: TableName, options: SelectOptions): Promise<T | null> {
  const r = await readRepo(table);
  return r.findOne<T>(table, options);
}

const LIVE = { is: { deleted_at: null } } as const;

/* ---------------- categories ---------------- */

export type CategoryRecord = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export function listCategories(opts: { activeOnly?: boolean } = {}): Promise<CategoryRecord[]> {
  return read<CategoryRecord>("categories", {
    filter: opts.activeOnly ? { ...LIVE, eq: { active: true } } : { ...LIVE },
    order: [{ column: "sort_order" }, { column: "name" }],
  });
}

/* ---------------- expense categories ---------------- */

export type ExpenseCategoryRecord = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export function listExpenseCategories(
  opts: { activeOnly?: boolean } = {},
): Promise<ExpenseCategoryRecord[]> {
  return read<ExpenseCategoryRecord>("expense_categories", {
    columns: "id, name, active, sort_order",
    filter: opts.activeOnly ? { ...LIVE, eq: { active: true } } : { ...LIVE },
    order: [{ column: "sort_order" }, { column: "name" }],
  });
}

/* ---------------- suppliers ---------------- */

export type SupplierOption = { id: string; name: string };

export function listSuppliers(): Promise<SupplierOption[]> {
  return read<SupplierOption>("suppliers", {
    columns: "id, name",
    filter: { ...LIVE },
    order: [{ column: "name" }],
  });
}

/* ---------------- branches / employees / money movement subcategories ---------------- */

export function listBranches(): Promise<Row[]> {
  return read("branches", { filter: { ...LIVE }, order: [{ column: "name" }] });
}

export function listEmployees(opts: { activeOnly?: boolean } = {}): Promise<Row[]> {
  return read("employees", {
    filter: opts.activeOnly ? { ...LIVE, eq: { active: true } } : { ...LIVE },
    order: [{ column: "name" }],
  });
}

export function listMoneyMovementSubcategories(
  opts: { category?: string; activeOnly?: boolean } = {},
): Promise<Row[]> {
  const filter: any = { ...LIVE, eq: {} as Record<string, unknown> };
  if (opts.category) filter.eq.category = opts.category;
  if (opts.activeOnly) filter.eq.active = true;
  return read("money_movement_subcategories", {
    filter,
    order: [{ column: "sort_order" }, { column: "name" }],
  });
}

/* ---------------- settings ---------------- */

export function readSettingsColumns<T = Row>(columns: string): Promise<T | null> {
  return readOne<T>("settings", { columns, filter: { eq: { id: 1 } } });
}
