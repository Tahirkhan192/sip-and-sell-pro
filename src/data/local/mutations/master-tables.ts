/**
 * PHASE 5B — master/reference data classification and column contracts.
 *
 * This module is the ONLY place that says which tables may be written locally
 * and, for each of them, exactly which columns a local mutation may touch and
 * what a legal value looks like. It is imported by BOTH sides:
 *
 *   * the main thread (procedures) — to build and validate a row, and
 *   * the SQLite worker (engine-mutations) — to re-validate before binding.
 *
 * Consequences of that split:
 *   * it contains no browser-only, React or Supabase imports,
 *   * a malformed step can never reach SQLite even if the main thread is
 *     bypassed, and
 *   * a table that is not listed here simply has no local write path at all.
 *
 * Classification rule used throughout Phase 5B:
 *   SAFE_LOCAL  → master/reference data with no money, no stock movement and
 *                 no cloud trigger/stored-procedure behaviour behind it.
 *   CLOUD_ONLY  → anything transactional (sales, purchases, expenses, cash
 *                 movements, stock movements, production, staff payments,
 *                 attendance, closings, snapshots, audit, roles). Those keep
 *                 going to Lovable Cloud, unchanged.
 *
 * Derived columns (current_stock on products, katha_balance on staff, customer
 * balances, WAC prices…) are deliberately NOT writable: they are produced by
 * the inventory/report engines and by cloud procedures, and a local write must
 * never invent one.
 */

import type { SqliteValue } from "../seed-format";

/* ------------------------------------------------------------------ *
 * Classification                                                      *
 * ------------------------------------------------------------------ */

export const MASTER_TABLES = [
  "branches",
  "categories",
  "customers",
  "employees",
  "expense_categories",
  /**
   * PHASE 5E — plain business expenses only. The stock-transfer flavour
   * (`is_stock_transfer = 1`) is produced by the cloud procedures
   * `stock_to_expense_transfer` / `update_stock_transfer_expense` /
   * `delete_stock_transfer_expense`, which also move product and stock-item
   * quantities. Those rows are never created, edited or deleted locally —
   * see `EXPENSE_ROW_GUARD` and the routing in `src/data/writes/expenses.ts`.
   */
  "expenses",
  "money_movement_subcategories",
  "products",
  "recipes",
  "settings",
  "staff",
  "stock_items",
  "suppliers",
] as const;

export type MasterTable = (typeof MASTER_TABLES)[number];

/** Transactional tables that must never be mutated locally in Phase 5B. */
export const CLOUD_ONLY_TABLES = [
  "audit_log",
  "cash_movements",
  "daily_closings",
  "delivery_expenses",
  "katha_opening",
  "monthly_stock_overrides",
  "production_batch_items",
  "production_batches",
  "purchase_items",
  "purchases",
  "sale_items",
  "sales",
  "staff_attendance",
  "staff_month_carry",
  "staff_payments",
  "stock_adjustments",
  "stock_opening_snapshots",
  "stock_purchases",
  "stock_transfers",
  "user_roles",
] as const;

export type TableClassification = "SAFE_LOCAL" | "CLOUD_ONLY";

export function classifyTable(table: string): TableClassification {
  return (MASTER_TABLES as readonly string[]).includes(table) ? "SAFE_LOCAL" : "CLOUD_ONLY";
}

export function isMasterTable(table: string): table is MasterTable {
  return classifyTable(table) === "SAFE_LOCAL";
}

/* ------------------------------------------------------------------ *
 * Column contracts                                                    *
 * ------------------------------------------------------------------ */

export type ColumnKind = "text" | "number" | "integer" | "boolean" | "json" | "uuid";

export type ColumnSpec = {
  kind: ColumnKind;
  /** May the stored value be NULL? Mirrors the cloud NOT NULL constraints. */
  nullable?: boolean;
  /** Writable by a local master-data mutation. */
  writable?: boolean;
  /** Only settable at insert time (never updated locally). */
  insertOnly?: boolean;
  /** Required in an insert payload (no sensible default exists). */
  required?: boolean;
  /** Value used at insert time when the caller omits the column. */
  insertDefault?: SqliteValue;
  /** Closed value set, mirroring a cloud CHECK constraint. */
  oneOf?: readonly string[];
  /** Numeric bounds, mirroring cloud CHECK constraints. */
  min?: number;
  max?: number;
  /** For json array columns: the permitted member values. */
  members?: readonly string[];
};

export type MasterTableSpec = {
  /** Primary key column. */
  pk: string;
  pkKind: "uuid" | "integer";
  /** May rows be created locally? (`settings` is a single fixed row.) */
  allowInsert: boolean;
  /** May rows be hard-deleted locally? The app soft-deletes instead. */
  allowHardDelete: boolean;
  /** Does the table carry `deleted_at` (soft delete / restore semantics)? */
  softDelete: boolean;
  /** Does the table carry `updated_at` that a local write must refresh? */
  touchUpdatedAt: boolean;
  /** Unique constraints copied from the cloud schema (case-insensitive text). */
  unique: readonly (readonly string[])[];
  /**
   * Row-level gate. An existing row whose `column` does not equal `equals` may
   * not be updated or deleted locally, whatever the payload says. Used to keep
   * cloud-owned rows (stock-transfer expenses) out of the local write path.
   */
  rowGuard?: { column: string; equals: SqliteValue; message: string };
  columns: Record<string, ColumnSpec>;
};

const CREATED_AT: ColumnSpec = { kind: "text", writable: false };
const UPDATED_AT: ColumnSpec = { kind: "text", writable: false };
const DELETED_AT: ColumnSpec = { kind: "text", nullable: true, writable: true };

export const MASTER_TABLE_SPECS: Record<MasterTable, MasterTableSpec> = {
  branches: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      address: { kind: "text", nullable: true, writable: true, insertDefault: null },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  categories: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [["name"]],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      sort_order: { kind: "integer", writable: true, insertDefault: 0 },
      description: { kind: "text", nullable: true, writable: true, insertDefault: null },
      color: { kind: "text", nullable: true, writable: true, insertDefault: null },
      icon: { kind: "text", nullable: true, writable: true, insertDefault: null },
      active: { kind: "boolean", writable: true, insertDefault: 1 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  expense_categories: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [["name"]],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      active: { kind: "boolean", writable: true, insertDefault: 1 },
      sort_order: { kind: "integer", writable: true, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  /**
   * PHASE 5E — general business expenses.
   *
   * Audited before being added here: the cloud `expenses` table has NO
   * triggers, and nothing else in the schema reacts to an expense row. A plain
   * expense is pure bookkeeping — the reports read it, no cash movement, stock
   * quantity or balance is derived from it. That is what makes it safe to
   * write locally.
   *
   * Everything that is NOT pure bookkeeping stays cloud-only and is expressed
   * as a non-writable column below: `is_stock_transfer` and the four `source_*`
   * columns belong to the stock-transfer procedures, and `payment_method`
   * deliberately does not accept `stock_transfer`.
   */
  expenses: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    rowGuard: {
      column: "is_stock_transfer",
      equals: 0,
      message:
        "stock-transfer expenses are managed by the cloud stock procedures and cannot be changed locally.",
    },
    columns: {
      id: { kind: "uuid", writable: false },
      date: { kind: "text", writable: true, required: true },
      category: { kind: "text", writable: true, required: true },
      amount: { kind: "number", writable: true, required: true, min: 0 },
      description: { kind: "text", nullable: true, writable: true, insertDefault: null },
      payment_method: {
        kind: "text",
        writable: true,
        insertDefault: "cash",
        oneOf: ["cash", "online"],
      },
      payment_status: {
        kind: "text",
        writable: true,
        insertDefault: "paid",
        oneOf: ["paid", "unpaid", "katha"],
      },
      paid_amount: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      paid_at: { kind: "text", nullable: true, writable: true, insertDefault: null },
      payment_source: {
        kind: "text",
        writable: true,
        insertDefault: "cash",
        oneOf: ["cash", "online"],
      },
      supplier: { kind: "text", nullable: true, writable: true, insertDefault: null },
      notes: { kind: "text", nullable: true, writable: true, insertDefault: null },
      /** Stock-transfer provenance — owned by the cloud procedures only. */
      is_stock_transfer: { kind: "boolean", writable: false, insertDefault: 0 },
      source_product_id: { kind: "uuid", nullable: true, writable: false, insertDefault: null },
      source_stock_item_id: { kind: "uuid", nullable: true, writable: false, insertDefault: null },
      source_quantity: { kind: "number", nullable: true, writable: false, insertDefault: null },
      source_unit_cost: { kind: "number", nullable: true, writable: false, insertDefault: null },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  money_movement_subcategories: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [["category", "name"]],
    columns: {
      id: { kind: "uuid", writable: false },
      category: {
        kind: "text",
        writable: true,
        required: true,
        oneOf: ["Expense", "Owner", "Customer", "Other"],
      },
      name: { kind: "text", writable: true, required: true },
      active: { kind: "boolean", writable: true, insertDefault: 1 },
      sort_order: { kind: "integer", writable: true, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  suppliers: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      phone: { kind: "text", nullable: true, writable: true, insertDefault: null },
      address: { kind: "text", nullable: true, writable: true, insertDefault: null },
      notes: { kind: "text", nullable: true, writable: true, insertDefault: null },
      /** Derived from purchases/payments — never written by a master mutation. */
      balance: { kind: "number", writable: false, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  customers: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      phone: { kind: "text", nullable: true, writable: true, insertDefault: null },
      address: { kind: "text", nullable: true, writable: true, insertDefault: null },
      notes: { kind: "text", nullable: true, writable: true, insertDefault: null },
      /** All of these are sales-derived. */
      balance: { kind: "number", writable: false, insertDefault: 0 },
      last_visit: { kind: "text", nullable: true, writable: false, insertDefault: null },
      total_orders: { kind: "integer", writable: false, insertDefault: 0 },
      total_purchases: { kind: "number", writable: false, insertDefault: 0 },
      outstanding_balance: { kind: "number", writable: false, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  employees: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      role: { kind: "text", nullable: true, writable: true, insertDefault: null },
      phone: { kind: "text", nullable: true, writable: true, insertDefault: null },
      salary: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      joined_on: { kind: "text", nullable: true, writable: true, insertDefault: null },
      active: { kind: "boolean", writable: true, insertDefault: 1 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  staff: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      father_name: { kind: "text", nullable: true, writable: true, insertDefault: null },
      phone: { kind: "text", nullable: true, writable: true, insertDefault: null },
      cnic: { kind: "text", nullable: true, writable: true, insertDefault: null },
      joining_date: { kind: "text", writable: true, required: true },
      monthly_salary: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      status: { kind: "text", writable: true, insertDefault: "active", oneOf: ["active", "inactive"] },
      notes: { kind: "text", nullable: true, writable: true, insertDefault: null },
      opening_katha: { kind: "number", writable: true, insertDefault: 0 },
      /**
       * Katha balance is recomputed from katha sales and staff payments by the
       * cloud procedure `recompute_staff_katha`. A local master mutation may
       * only seed it once, at insert, exactly like the existing screen does.
       */
      katha_balance: { kind: "number", writable: true, insertOnly: true, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  products: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: false,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      category: { kind: "text", writable: true, required: true },
      sale_price: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      cost_price: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      opening_stock: { kind: "number", writable: true, insertDefault: 0 },
      minimum_stock: { kind: "number", writable: true, insertDefault: 0 },
      active: { kind: "boolean", writable: true, insertDefault: 1 },
      unit: { kind: "text", writable: true, insertDefault: "pcs", oneOf: ["pcs", "kg", "ltr"] },
      selling_method: {
        kind: "text",
        writable: true,
        insertDefault: "fixed",
        oneOf: ["fixed", "weight"],
      },
      allow_negative_stock: { kind: "boolean", writable: true, insertDefault: 0 },
      track_stock: { kind: "boolean", writable: true, insertDefault: 1 },
      auto_calc: { kind: "boolean", writable: true, insertDefault: 0 },
      avg_price_override: { kind: "number", nullable: true, writable: true, insertDefault: null },
      /** Calculated by the inventory engine — never written from a form. */
      current_stock: { kind: "number", writable: false, insertDefault: 0 },
      last_sold_at: { kind: "text", nullable: true, writable: false, insertDefault: null },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
    },
  },

  stock_items: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      name: { kind: "text", writable: true, required: true },
      category: { kind: "text", writable: true, required: true },
      unit: { kind: "text", writable: true, insertDefault: "pcs" },
      opening_stock: { kind: "number", writable: true, insertDefault: 0 },
      minimum_stock: { kind: "number", writable: true, insertDefault: 0 },
      purchase_price: { kind: "number", writable: true, insertDefault: 0, min: 0 },
      supplier_id: { kind: "uuid", nullable: true, writable: true, insertDefault: null },
      purchase_date: { kind: "text", nullable: true, writable: true, insertDefault: null },
      notes: { kind: "text", nullable: true, writable: true, insertDefault: null },
      auto_calc: { kind: "boolean", writable: true, insertDefault: 0 },
      avg_price_override: { kind: "number", nullable: true, writable: true, insertDefault: null },
      /** Calculated by the inventory engine. */
      current_stock: { kind: "number", writable: false, insertDefault: 0 },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  recipes: {
    pk: "id",
    pkKind: "uuid",
    allowInsert: true,
    allowHardDelete: false,
    softDelete: true,
    touchUpdatedAt: true,
    unique: [],
    columns: {
      id: { kind: "uuid", writable: false },
      parent_product_id: { kind: "uuid", writable: true, required: true },
      component_product_id: { kind: "uuid", nullable: true, writable: true, insertDefault: null },
      component_stock_item_id: {
        kind: "uuid",
        nullable: true,
        writable: true,
        insertDefault: null,
      },
      quantity: { kind: "number", writable: true, required: true, min: 0 },
      unit: { kind: "text", writable: true, insertDefault: "pcs" },
      applies_to: {
        kind: "json",
        writable: true,
        insertDefault: '["walk_in","take_away","delivery"]',
        members: ["walk_in", "take_away", "delivery"],
      },
      deleted_at: DELETED_AT,
      created_at: CREATED_AT,
      updated_at: UPDATED_AT,
    },
  },

  settings: {
    pk: "id",
    pkKind: "integer",
    /** Exactly one row (id = 1) exists; it is never created or deleted locally. */
    allowInsert: false,
    allowHardDelete: false,
    softDelete: false,
    touchUpdatedAt: true,
    unique: [],
    columns: {
      id: { kind: "integer", writable: false },
      allow_negative_stock: { kind: "boolean", writable: true },
      timezone: { kind: "text", writable: true },
      business_day_start_time: { kind: "text", writable: true },
      business_month_start_day: { kind: "integer", writable: true, min: 1, max: 28 },
      pin_locks: { kind: "json", writable: true },
      staff_invoice_color: { kind: "text", writable: true },
      whatsapp_country_code: { kind: "text", nullable: true, writable: true },
      whatsapp_auto_send: { kind: "boolean", nullable: true, writable: true },
      /** Credentials: never written, read or hashed by the local path. */
      whatsapp_token: { kind: "text", nullable: true, writable: false },
      whatsapp_phone_id: { kind: "text", nullable: true, writable: false },
      whatsapp_business_id: { kind: "text", nullable: true, writable: false },
      updated_at: UPDATED_AT,
    },
  },
};

/* ------------------------------------------------------------------ *
 * Value encoding + validation (shared by both threads)                *
 * ------------------------------------------------------------------ */

export class MasterDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterDataError";
  }
}

function fail(message: string): never {
  throw new MasterDataError(`Invalid local mutation: ${message}`);
}

export function tableSpec(table: string): MasterTableSpec {
  if (!isMasterTable(table)) {
    fail(`table "${table}" is not writable locally (classification: CLOUD_ONLY).`);
  }
  return MASTER_TABLE_SPECS[table];
}

export function columnSpec(table: MasterTable, column: string): ColumnSpec {
  const spec = tableSpec(table).columns[column];
  if (!spec) fail(`column "${column}" does not exist on "${table}".`);
  return spec;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converts one caller value into the exact storage representation the Phase-3
 * seed uses (booleans as 0/1, json/arrays as canonical JSON text, everything
 * else verbatim), validating it against the column contract on the way.
 */
export function encodeColumnValue(
  table: MasterTable,
  column: string,
  value: unknown,
): SqliteValue {
  const spec = columnSpec(table, column);
  const label = `${table}.${column}`;

  if (value === undefined || value === null) {
    if (!spec.nullable) fail(`${label} must not be null.`);
    return null;
  }

  switch (spec.kind) {
    case "uuid": {
      if (typeof value !== "string" || !UUID_RE.test(value)) fail(`${label} must be a uuid.`);
      return value;
    }
    case "text": {
      if (typeof value !== "string") fail(`${label} must be text.`);
      const v = value;
      if (spec.oneOf && !spec.oneOf.includes(v)) {
        fail(`${label} must be one of ${spec.oneOf.join(", ")}.`);
      }
      if (v.trim() === "" && spec.required) fail(`${label} must not be empty.`);
      return v;
    }
    case "number":
    case "integer": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) fail(`${label} must be a finite number.`);
      if (spec.kind === "integer" && !Number.isInteger(n)) fail(`${label} must be an integer.`);
      if (spec.min !== undefined && n < spec.min) fail(`${label} must be >= ${spec.min}.`);
      if (spec.max !== undefined && n > spec.max) fail(`${label} must be <= ${spec.max}.`);
      return n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value ? 1 : 0;
      if (value === 0 || value === 1) return value;
      fail(`${label} must be a boolean.`);
      return 0;
    }
    case "json": {
      // Already-canonical JSON text passes straight through after a parse check.
      const parsed = typeof value === "string" ? safeParse(value, label) : value;
      if (spec.members) {
        if (!Array.isArray(parsed) || parsed.length === 0) {
          fail(`${label} must be a non-empty array.`);
        }
        for (const m of parsed as unknown[]) {
          if (typeof m !== "string" || !spec.members.includes(m)) {
            fail(`${label} contains an unsupported value.`);
          }
        }
      }
      return JSON.stringify(parsed);
    }
    default:
      return fail(`${label} has an unsupported column kind.`);
  }
}

function safeParse(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return fail(`${label} must be valid JSON.`);
  }
}

/** Rejects a column that a local master mutation may not write. */
export function assertWritable(table: MasterTable, column: string, mode: "insert" | "update"): void {
  const spec = columnSpec(table, column);
  if (!spec.writable) fail(`${table}.${column} is derived and cannot be written locally.`);
  if (mode === "update" && spec.insertOnly) {
    fail(`${table}.${column} can only be set when the row is created.`);
  }
}

/** Cross-column rules that mirror the cloud CHECK constraints. */
export function assertRowInvariants(
  table: MasterTable,
  row: Record<string, SqliteValue>,
  mode: "insert" | "update",
): void {
  if (table === "expenses") return assertExpenseInvariants(row, mode);
  if (table !== "recipes") return;
  const hasProduct = row.component_product_id !== undefined && row.component_product_id !== null;
  const hasStock =
    row.component_stock_item_id !== undefined && row.component_stock_item_id !== null;
  if (mode === "insert" || "component_product_id" in row || "component_stock_item_id" in row) {
    if (hasProduct === hasStock) {
      fail("a recipe line needs exactly one component (product OR stock item).");
    }
  }
  if (row.quantity !== undefined && Number(row.quantity) <= 0) {
    fail("recipes.quantity must be greater than 0.");
  }
  if (
    hasProduct &&
    row.parent_product_id !== undefined &&
    row.parent_product_id === row.component_product_id
  ) {
    fail("a product cannot be its own component.");
  }
}

/**
 * PHASE 5E — expense rules the cloud enforces through CHECK constraints and
 * the screen enforces through its payload. Kept in one place so the worker
 * re-checks exactly what the main thread checked.
 */
function assertExpenseInvariants(
  row: Record<string, SqliteValue>,
  mode: "insert" | "update",
): void {
  if (row.is_stock_transfer !== undefined && Number(row.is_stock_transfer) !== 0) {
    fail("a stock-transfer expense cannot be created or edited locally.");
  }
  for (const column of [
    "source_product_id",
    "source_stock_item_id",
    "source_quantity",
    "source_unit_cost",
  ]) {
    if (row[column] !== undefined && row[column] !== null) {
      fail(`expenses.${column} belongs to the cloud stock-transfer procedures.`);
    }
  }
  if (mode === "insert" && (row.amount === undefined || Number(row.amount) <= 0)) {
    fail("expenses.amount must be greater than 0.");
  }
  if (mode === "update" && row.amount !== undefined && Number(row.amount) <= 0) {
    fail("expenses.amount must be greater than 0.");
  }
  // `paid_amount` mirrors the screen: the full amount when paid, else nothing.
  if (row.payment_status !== undefined && row.paid_amount !== undefined) {
    const expected = row.payment_status === "paid" ? Number(row.amount ?? row.paid_amount) : 0;
    if (row.amount !== undefined && Number(row.paid_amount) !== expected) {
      fail("expenses.paid_amount must equal the amount when paid, and 0 otherwise.");
    }
    if (row.payment_status !== "paid" && Number(row.paid_amount) !== 0) {
      fail("expenses.paid_amount must be 0 unless the expense is paid.");
    }
  }
}
