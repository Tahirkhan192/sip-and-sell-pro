/**
 * PHASE 6 — the single, explicit classification of EVERY table.
 *
 * Rule the rest of the data layer depends on: a table is never local merely
 * because a mirror table for it exists. Each entity is classified from the
 * *audited cloud semantics*, and the read/write gates in `health.ts` are
 * derived from this file so the gates and the documentation cannot drift.
 *
 * read
 *   "local"        — served from SQLite whenever the health gate passes.
 *   "local-report" — mirrored and used only by the offline reporting inputs
 *                    (`src/data/reads/report-inputs.ts`), which read locally
 *                    ONLY while the browser is offline, because the rows are
 *                    still written cloud-side and the mirror can lag.
 *   "cloud"        — always read from the cloud.
 *
 * write
 *   "local" — routed through the SQLite mutation + outbox pipeline.
 *   "cloud" — must stay on Supabase; `reason` states the exact blocker.
 */

import type { TableName } from "./types";

export type ReadMode = "local" | "local-report" | "cloud";
export type WriteMode = "local" | "cloud";

export type EntityClass = {
  read: ReadMode;
  write: WriteMode;
  /** Why the write side is where it is. Required for every cloud write. */
  reason: string;
};

const MASTER = "Master/reference data: no cloud trigger, RPC or derived column.";

export const ENTITY_CLASSIFICATION: Record<TableName, EntityClass> = {
  /* ---------------- master / reference: local read + local write --------- */
  branches: { read: "local", write: "local", reason: MASTER },
  categories: { read: "local", write: "local", reason: MASTER },
  customers: { read: "local", write: "local", reason: MASTER },
  employees: { read: "local", write: "local", reason: MASTER },
  expense_categories: { read: "local", write: "local", reason: MASTER },
  money_movement_subcategories: { read: "local", write: "local", reason: MASTER },
  products: { read: "local", write: "local", reason: MASTER },
  recipes: { read: "local", write: "local", reason: MASTER },
  settings: { read: "local", write: "local", reason: MASTER },
  staff: { read: "local", write: "local", reason: MASTER },
  stock_items: { read: "local", write: "local", reason: MASTER },
  suppliers: { read: "local", write: "local", reason: MASTER },

  /* ---------------- transactional: local read + local write (audited) ---- */
  expenses: {
    read: "local",
    write: "local",
    reason:
      "PHASE 5E — plain expenses only. Stock-transfer expenses (is_stock_transfer) " +
      "stay cloud-only: stock_to_expense_transfer / update_stock_transfer_expense / " +
      "delete_stock_transfer_expense also move stock.",
  },
  stock_adjustments: {
    read: "local",
    write: "local",
    reason: "PHASE 5H — append-only ledger row, no cloud trigger; stock is recomputed client-side.",
  },

  /* ---------------- transactional: local read + cloud write -------------- */
  purchases: {
    read: "local",
    write: "cloud",
    reason:
      "BLOCKER — fn_purchase_cash_movement and fn_purchase_item_apply generate " +
      "cash_movements / stock_purchases rows with server-side UUIDs and business dates. " +
      "Needs the Phase 8 idempotent server procedure before offline writes are safe.",
  },
  purchase_items: {
    read: "local",
    write: "cloud",
    reason: "BLOCKER — written by the purchase triggers (see `purchases`).",
  },
  stock_purchases: {
    read: "local",
    write: "cloud",
    reason: "BLOCKER — derived ledger produced by fn_purchase_item_apply.",
  },

  /* ---------------- mirrored for reporting only -------------------------- */
  sales: {
    read: "local-report",
    write: "cloud",
    reason:
      "BLOCKER — invoice_no comes from a Postgres sequence, save_sale/update_sale run " +
      "stock, cash-movement, customer and staff-katha side effects, and auth.uid() is " +
      "required. Offline allocation risks invoice collisions (Phase 8 hard stop).",
  },
  sale_items: { read: "local-report", write: "cloud", reason: "BLOCKER — written by save_sale (see `sales`)." },
  production_batches: {
    read: "local-report",
    write: "cloud",
    reason: "BLOCKER — save_production / delete_production_batch consume components and cost them server-side.",
  },
  production_batch_items: {
    read: "local-report",
    write: "cloud",
    reason: "BLOCKER — written by save_production.",
  },
  stock_transfers: {
    read: "local-report",
    write: "cloud",
    reason: "BLOCKER — save_stock_transfer moves stock and fn_stock_transfer_reverse reverses it on delete.",
  },
  delivery_expenses: {
    read: "local-report",
    write: "cloud",
    reason: "Not audited for offline writes yet; reporting reads only.",
  },
  monthly_stock_overrides: {
    read: "local-report",
    write: "cloud",
    reason: "Valuation override consumed by the report engine; writes not audited yet.",
  },
  stock_opening_snapshots: {
    read: "local-report",
    write: "cloud",
    reason: "BLOCKER — written by set_opening_stock_for_period / set_opening_stock_from_current.",
  },
  staff_attendance: {
    read: "local-report",
    write: "cloud",
    reason: "Feeds staff_salary_summary; salary semantics not ported yet.",
  },

  /* ---------------- cloud-only ------------------------------------------- */
  cash_movements: {
    read: "cloud",
    write: "cloud",
    reason: "BLOCKER — created by sale/purchase/staff-payment triggers; a local copy could duplicate cash.",
  },
  daily_closings: {
    read: "cloud",
    write: "cloud",
    reason: "BLOCKER — daily_closing_summary is a security-definer RPC over cloud-authoritative rows.",
  },
  katha_opening: {
    read: "cloud",
    write: "cloud",
    reason: "BLOCKER — consumed by digi_katha_summary (security definer).",
  },
  staff_payments: {
    read: "cloud",
    write: "cloud",
    reason: "BLOCKER — staff_pay / staff_payment_delete create cash movements and recompute katha.",
  },
  staff_month_carry: {
    read: "cloud",
    write: "cloud",
    reason: "BLOCKER — derived by staff_salary_summary.",
  },
  audit_log: { read: "cloud", write: "cloud", reason: "Server-side audit trail." },
  user_roles: { read: "cloud", write: "cloud", reason: "Authorization data; RLS + has_role must stay authoritative." },
};

const entries = Object.entries(ENTITY_CLASSIFICATION) as [TableName, EntityClass][];

/** Tables whose ordinary READ path may be served from SQLite. */
export const LOCAL_READ_TABLE_SET: TableName[] = entries
  .filter(([, c]) => c.read === "local")
  .map(([t]) => t)
  .sort();

/** Tables mirrored for the offline reporting inputs only. */
export const REPORT_ONLY_TABLE_SET: TableName[] = entries
  .filter(([, c]) => c.read === "local-report")
  .map(([t]) => t)
  .sort();

/** Tables whose WRITE path may be served by the local mutation pipeline. */
export const LOCAL_WRITE_TABLE_SET: TableName[] = entries
  .filter(([, c]) => c.write === "local")
  .map(([t]) => t)
  .sort();

/** Tables that must keep using Supabase for writes, with the documented blocker. */
export const CLOUD_WRITE_BLOCKERS: { table: TableName; reason: string }[] = entries
  .filter(([, c]) => c.write === "cloud")
  .map(([table, c]) => ({ table, reason: c.reason }))
  .sort((a, b) => a.table.localeCompare(b.table));

export function classifyEntity(table: TableName): EntityClass {
  return ENTITY_CLASSIFICATION[table];
}
