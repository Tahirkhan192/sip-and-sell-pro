/**
 * PHASE 10 — the machine-readable pre-cutover audit.
 *
 * Every data operation the application performs is listed here exactly once
 * and classified. There is deliberately no "unknown" member in the union: an
 * operation that has not been audited cannot be added to this file, and the
 * accompanying test fails if any table, RPC or screen is missing.
 *
 * Classification
 *   LOCAL       — served entirely from SQLite; no network involved.
 *   LOCAL+SYNC  — written to SQLite in one transaction (audit + outbox) and
 *                 uploaded to Lovable Cloud later by the sync engine.
 *   CLOUD       — normally cloud, with a local mirror available for offline
 *                 reads/reporting only (the cloud stays authoritative).
 *   CLOUD-ONLY  — requires Internet; there is no safe local equivalent.
 */

import {
  ENTITY_CLASSIFICATION,
  type EntityClass,
} from "./entity-classification";
import type { TableName } from "./types";

export type OperationClass = "LOCAL" | "LOCAL+SYNC" | "CLOUD" | "CLOUD-ONLY";

export type OperationKind =
  | "read"
  | "insert"
  | "update"
  | "delete"
  | "rpc"
  | "report"
  | "calculation"
  | "auth"
  | "settings"
  | "backup"
  | "sync";

export type OperationAudit = {
  /** Stable identifier, e.g. "products.read" or "rpc.save_sale". */
  id: string;
  kind: OperationKind;
  entity: string;
  classification: OperationClass;
  /** Why it is classified this way. Required for every entry. */
  reason: string;
};

function readClass(c: EntityClass): OperationClass {
  if (c.read === "local") return "LOCAL";
  if (c.read === "local-report") return "CLOUD";
  return "CLOUD-ONLY";
}

function writeClass(c: EntityClass): OperationClass {
  return c.write === "local" ? "LOCAL+SYNC" : "CLOUD-ONLY";
}

const tableOperations: OperationAudit[] = (
  Object.entries(ENTITY_CLASSIFICATION) as [TableName, EntityClass][]
).flatMap(([table, c]) => [
  {
    id: `${table}.read`,
    kind: "read" as const,
    entity: table,
    classification: readClass(c),
    reason:
      c.read === "local"
        ? "Mirrored and health-gated: served from SQLite, cloud fallback when the gate fails."
        : c.read === "local-report"
          ? "Mirrored for offline reporting only; the cloud copy stays authoritative."
          : c.reason,
  },
  ...(["insert", "update", "delete"] as const).map((kind) => ({
    id: `${table}.${kind}`,
    kind,
    entity: table,
    classification: writeClass(c),
    reason: c.reason,
  })),
]);

/** Cloud stored procedures. None of them has a local twin yet. */
const RPC_OPERATIONS: { name: string; reason: string }[] = [
  { name: "save_sale", reason: "Allocates invoice_no from a Postgres sequence and runs stock/cash/katha side effects." },
  { name: "update_sale", reason: "Re-runs the full sale side-effect chain server-side." },
  { name: "update_pending_sale", reason: "Same side-effect chain as save_sale." },
  { name: "update_sale_payment", reason: "Rewrites linked cash movements and katha balances." },
  { name: "restore_sale_stock", reason: "Server-side stock restoration for deleted invoices." },
  { name: "save_production", reason: "Consumes recipe components and costs the batch server-side." },
  { name: "delete_production_batch", reason: "Reverses a production batch server-side." },
  { name: "save_stock_transfer", reason: "Moves stock between categories server-side." },
  { name: "stock_to_expense_transfer", reason: "Creates an expense AND moves stock in one server transaction." },
  { name: "update_stock_transfer_expense", reason: "Adjusts the expense and the stock it moved." },
  { name: "delete_stock_transfer_expense", reason: "Reverses the expense and the stock it moved." },
  { name: "rebuild_item_remaining", reason: "Security-definer recompute over cloud-authoritative ledgers." },
  { name: "recompute_product_wac", reason: "Weighted-average cost recompute over cloud purchase history." },
  { name: "recompute_stock_item_wac", reason: "Weighted-average cost recompute over cloud purchase history." },
  { name: "recompute_staff_katha", reason: "Derives staff katha from cloud sales and payments." },
  { name: "staff_pay", reason: "Creates a cash movement and recomputes katha." },
  { name: "staff_payment_delete", reason: "Reverses a payment and its cash movement." },
  { name: "staff_salary_summary", reason: "Server-side salary aggregation with carry-forward." },
  { name: "digi_katha_summary", reason: "Security-definer aggregate over cash movements." },
  { name: "daily_closing_summary", reason: "Security-definer aggregate over cloud-authoritative rows." },
  { name: "monthly_financial_summary", reason: "Server-side monthly aggregate." },
  { name: "category_monthly_report", reason: "Server-side category aggregate." },
  { name: "dashboard_category_cards", reason: "Server-side dashboard aggregate." },
  { name: "set_opening_stock_for_period", reason: "Writes opening snapshots server-side." },
  { name: "set_opening_stock_from_current", reason: "Writes opening snapshots server-side." },
  { name: "mark_whatsapp_status", reason: "WhatsApp delivery needs the network anyway." },
  { name: "business_date", reason: "Business-date helper; the client mirror in business-date.ts is used offline." },
  { name: "get_business_config", reason: "Config read; the local settings mirror is used offline." },
  { name: "has_role", reason: "Authorization must stay server-authoritative." },
];

const rpcOperations: OperationAudit[] = RPC_OPERATIONS.map((r) => ({
  id: `rpc.${r.name}`,
  kind: "rpc" as const,
  entity: r.name,
  classification: "CLOUD-ONLY" as const,
  reason: r.reason,
}));

const platformOperations: OperationAudit[] = [
  {
    id: "auth.sign-in",
    kind: "auth",
    entity: "authentication",
    classification: "CLOUD-ONLY",
    reason: "The first sign-in and every role change must be verified by Lovable Cloud.",
  },
  {
    id: "auth.offline-unlock",
    kind: "auth",
    entity: "authentication",
    classification: "LOCAL",
    reason: "Phase 7 device enrolment: PBKDF2 unlock against the local identity, no network.",
  },
  {
    id: "auth.role-check",
    kind: "auth",
    entity: "user_roles",
    classification: "CLOUD-ONLY",
    reason: "Roles are re-read and reconciled online; offline uses the last reconciled role.",
  },
  {
    id: "settings.business-config",
    kind: "settings",
    entity: "settings",
    classification: "LOCAL",
    reason: "Timezone, business-day start and month start are read from the local settings mirror.",
  },
  {
    id: "calculation.inventory-engine",
    kind: "calculation",
    entity: "inventory-engine",
    classification: "LOCAL",
    reason: "Computed client-side from mirrored ledgers; identical formula online and offline.",
  },
  {
    id: "calculation.report-engine",
    kind: "calculation",
    entity: "report-engine",
    classification: "LOCAL",
    reason: "Computed client-side; inputs come from the mirror while offline.",
  },
  {
    id: "report.reports-page",
    kind: "report",
    entity: "reports",
    classification: "CLOUD",
    reason: "Reads live cloud rows when online, mirrored rows when offline; totals may lag until sync.",
  },
  {
    id: "backup.local-snapshot",
    kind: "backup",
    entity: "backup",
    classification: "LOCAL",
    reason: "Snapshot is taken from the local SQLite database inside the worker.",
  },
  {
    id: "backup.google-drive",
    kind: "backup",
    entity: "backup",
    classification: "CLOUD-ONLY",
    reason: "Hourly appDataFolder upload; failures are surfaced in the backup card.",
  },
  {
    id: "sync.outbox-upload",
    kind: "sync",
    entity: "outbox",
    classification: "CLOUD-ONLY",
    reason: "Uploading queued local mutations requires Internet; queueing does not.",
  },
];

export const OPERATION_AUDIT: OperationAudit[] = [
  ...tableOperations,
  ...rpcOperations,
  ...platformOperations,
];

export function operationsByClass(): Record<OperationClass, OperationAudit[]> {
  const out: Record<OperationClass, OperationAudit[]> = {
    LOCAL: [],
    "LOCAL+SYNC": [],
    CLOUD: [],
    "CLOUD-ONLY": [],
  };
  for (const op of OPERATION_AUDIT) out[op.classification].push(op);
  return out;
}

/* ------------------------------------------------------------------ *
 * Offline capability matrix — one entry per screen.
 * ------------------------------------------------------------------ */

export type OfflineCapability = "fully-offline" | "partially-offline" | "cloud-only";

export type ScreenCapability = {
  path: string;
  label: string;
  capability: OfflineCapability;
  /** Features on that screen that stop working without Internet. */
  cloudOnly: string[];
};

export const SCREEN_CAPABILITY: ScreenCapability[] = [
  { path: "/", label: "Dashboard", capability: "partially-offline", cloudOnly: ["Live cloud totals refresh"] },
  { path: "/pos", label: "POS / New Invoice", capability: "cloud-only", cloudOnly: ["Saving an invoice (save_sale allocates the invoice number)", "Money movement created with a sale"] },
  { path: "/sales", label: "Sales history", capability: "partially-offline", cloudOnly: ["Editing, completing or deleting an invoice", "WhatsApp sending"] },
  { path: "/products", label: "Products", capability: "fully-offline", cloudOnly: [] },
  { path: "/stock-items", label: "Stock items", capability: "fully-offline", cloudOnly: [] },
  { path: "/categories", label: "Categories", capability: "fully-offline", cloudOnly: [] },
  { path: "/customers", label: "Customers", capability: "fully-offline", cloudOnly: [] },
  { path: "/recipes", label: "Recipes / connections", capability: "fully-offline", cloudOnly: [] },
  { path: "/expenses", label: "Expenses", capability: "partially-offline", cloudOnly: ["Stock-transfer expenses (they also move stock)"] },
  { path: "/purchases", label: "Purchases", capability: "cloud-only", cloudOnly: ["Saving a purchase (server triggers create cash movements and stock rows)"] },
  { path: "/stock", label: "Stock report", capability: "partially-offline", cloudOnly: ["Opening-stock snapshot rebuild"] },
  { path: "/stock-transfer", label: "Stock transfer", capability: "cloud-only", cloudOnly: ["Every transfer moves stock server-side"] },
  { path: "/production", label: "Production", capability: "cloud-only", cloudOnly: ["Batches consume and cost components server-side"] },
  { path: "/cash-movements", label: "Money movement", capability: "cloud-only", cloudOnly: ["Cash movements are cloud-authoritative"] },
  { path: "/daily-closing", label: "Daily closing", capability: "cloud-only", cloudOnly: ["daily_closing_summary is a server aggregate"] },
  { path: "/digi-katha-closing", label: "Digi Katha closing", capability: "cloud-only", cloudOnly: ["digi_katha_summary is a server aggregate"] },
  { path: "/staff", label: "Staff", capability: "partially-offline", cloudOnly: ["Salary payments, advances and attendance"] },
  { path: "/delivery-expenses", label: "Delivery expenses", capability: "cloud-only", cloudOnly: ["Writes are not audited for offline yet"] },
  { path: "/delivery-report", label: "Delivery report", capability: "partially-offline", cloudOnly: ["Live refresh"] },
  { path: "/reports", label: "Reports", capability: "partially-offline", cloudOnly: ["Server aggregates (monthly financial summary, category report)"] },
  { path: "/settings", label: "Settings", capability: "partially-offline", cloudOnly: ["Google Drive backup", "Cloud re-seed", "Duplicate invoice repair"] },
];

/** Share of screens that keep working with no Internet at all. */
export function offlineReadinessPercent(): number {
  const weight = (c: OfflineCapability) =>
    c === "fully-offline" ? 1 : c === "partially-offline" ? 0.5 : 0;
  const total = SCREEN_CAPABILITY.reduce((s, x) => s + weight(x.capability), 0);
  return Math.round((total / SCREEN_CAPABILITY.length) * 100);
}
