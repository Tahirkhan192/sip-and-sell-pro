/**
 * PHASE 5D — conflict detection for master-data synchronization.
 *
 * WHAT VERSION INFORMATION ACTUALLY EXISTS
 * ----------------------------------------
 * The cloud schema has no row version counter and no per-row sync metadata.
 * The only version-ish columns are `updated_at` (present on products,
 * stock_items, recipes, staff, settings, expense_categories, categories,
 * money_movement_subcategories) and, for tables without it (customers,
 * suppliers, employees, branches), nothing at all.
 *
 * So detection uses the strongest signal available, in this order:
 *   1. `updated_at` — if the cloud value differs from the base snapshot taken
 *      when the local mutation was made, the cloud row moved on → conflict.
 *   2. field comparison — for tables with no `updated_at`, every column this
 *      mutation is about to change is compared against the base snapshot. If
 *      the cloud already differs on any of them, someone else changed it →
 *      conflict.
 *   3. no base snapshot at all (an outbox record written before the row was
 *      known locally) → conflict, because "unknown" must never be treated as
 *      "safe to overwrite".
 *
 * A conflict NEVER overwrites and NEVER deletes: both the local payload and
 * the cloud row are preserved on the outbox record.
 *
 * DOCUMENTED LIMITATION (unresolved in Phase 5D)
 * ----------------------------------------------
 * `updated_at` is written by the client/trigger, not by a monotonic version
 * column, so two devices that write within the same millisecond can produce
 * identical timestamps and the second write would be accepted rather than
 * flagged. Closing that gap needs a real row-version or a server-side
 * conditional update (e.g. `UPDATE ... WHERE updated_at = <base>` returning
 * the affected count), which is deliberately out of scope for this phase.
 */

export type ConflictDecision =
  | { conflict: false }
  | { conflict: true; reason: string; columns: string[] };

/**
 * Normalizes a value so a SQLite-shaped local value and a Postgres/PostgREST
 * value compare equal when they mean the same thing (booleans stored as 0/1,
 * numerics returned as strings, JSON stored as text, etc.).
 */
export function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true") return "1";
    if (trimmed === "false") return "0";
    const n = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(n)) return String(n);
    // A JSON string and the same JSON value must normalize identically.
    if (/^[[{]/.test(trimmed)) {
      try {
        return JSON.stringify(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return JSON.stringify(value);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return normalizeValue(a) === normalizeValue(b);
}

/** Parses the JSON snapshot stored on the outbox record. */
export function parseSnapshot(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Decides whether the cloud row moved on since the local mutation was based
 * on it.
 *
 * @param cloudRow    the row currently in Lovable Cloud (null = missing)
 * @param base        the pre-mutation snapshot captured locally
 * @param changed     the columns this mutation writes
 */
export function detectConflict(
  cloudRow: Record<string, unknown> | null,
  base: Record<string, unknown> | null,
  changed: string[],
): ConflictDecision {
  if (!cloudRow) {
    return {
      conflict: true,
      reason: "The cloud row no longer exists, so this change cannot be applied safely.",
      columns: [],
    };
  }
  if (!base) {
    return {
      conflict: true,
      reason:
        "No local baseline was recorded for this change, so the cloud row cannot be verified.",
      columns: [],
    };
  }

  if ("updated_at" in base && base.updated_at !== null && base.updated_at !== undefined) {
    if (!sameValue(base.updated_at, cloudRow.updated_at)) {
      return {
        conflict: true,
        reason: "The cloud record was modified after this change was made offline.",
        columns: ["updated_at"],
      };
    }
    return { conflict: false };
  }

  // No version column on this table: compare the columns we are about to write.
  const drifted = changed.filter(
    (column) => column in base && !sameValue(base[column], cloudRow[column]),
  );
  if (drifted.length > 0) {
    return {
      conflict: true,
      reason: `The cloud record already has different values for: ${drifted.join(", ")}.`,
      columns: drifted,
    };
  }
  return { conflict: false };
}

/** Everything a future resolution UI needs — both versions, never destroyed. */
export function conflictDetails(input: {
  reason: string;
  columns: string[];
  local: Record<string, unknown>;
  base: Record<string, unknown> | null;
  cloud: Record<string, unknown> | null;
  detectedAt: string;
}) {
  return {
    reason: input.reason,
    columns: input.columns,
    localPayload: input.local,
    localBaseline: input.base,
    cloudRow: input.cloud,
    detectedAt: input.detectedAt,
  };
}

/* ------------------------------------------------------------------ *
 * PHASE 9 — tombstones and conditional updates                        *
 * ------------------------------------------------------------------ */

/**
 * True when a row is soft-deleted in the cloud. Every synchronized master
 * table uses `deleted_at`; a row without the column can never be tombstoned.
 */
export function isTombstoned(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  const value = row.deleted_at;
  return value !== null && value !== undefined && String(value) !== "";
}

/**
 * Builds the WHERE guard for a conditional cloud update from the baseline.
 * `updated_at` is used where the table has it; tables without it fall back to
 * the field comparison already performed by `detectConflict`.
 */
export function updateGuard(
  base: Record<string, unknown> | null,
): { column: string; value: unknown } | null {
  if (!base) return null;
  if (!("updated_at" in base)) return null;
  const value = base.updated_at;
  if (value === undefined) return null;
  return { column: "updated_at", value };
}
