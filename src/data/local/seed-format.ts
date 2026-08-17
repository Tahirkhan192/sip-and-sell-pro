/**
 * Shared value/digest helpers for the Phase 3 cloud → local seed.
 *
 * Both sides of the verification use the SAME functions:
 *   * the main thread coerces cloud rows before binding them, and hashes what
 *     it sent;
 *   * the worker reads the rows back out of SQLite and hashes what it stored.
 *
 * Only a matching digest proves the local mirror really is the cloud data.
 *
 * Deliberately dependency-free apart from the canonical serializer that Backup
 * v2 already uses, so this module is safe to import inside the SQLite worker.
 */

import { canonicalStringify } from "@/data/backup/format";

export { canonicalStringify };

/** SQLite storage classes we bind. */
export type SqliteValue = string | number | null;

/**
 * Convert a cloud (PostgREST/JSON) value into the value that is bound to the
 * mirror column. No rounding, no timezone conversion, no id regeneration:
 *
 *   null/undefined → NULL
 *   boolean        → 1 / 0            (INTEGER columns)
 *   number         → number verbatim
 *   string         → string verbatim  (uuid, date, timestamptz, time, text)
 *   object/array   → canonical JSON text (jsonb, text[])
 */
export function toSqliteValue(value: unknown, declType?: string): SqliteValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    // Postgres `numeric` can arrive as a string; the mirror column is REAL.
    if (declType === "REAL" && value !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
    if (declType === "INTEGER" && /^-?\d+$/.test(value)) return Number(value);
    return value;
  }
  return canonicalStringify(value);
}

/**
 * Deterministic serialization of one stored row: only the mirrored columns,
 * always in the same (schema) order, values exactly as stored.
 */
export function canonicalRow(columns: string[], row: Record<string, unknown>): string {
  const obj: Record<string, unknown> = {};
  for (const c of columns) obj[c] = row[c] ?? null;
  return canonicalStringify(obj);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 over a list of canonical row strings (already ordered by pk). */
export async function digestRows(lines: string[]): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable — cannot verify the seed.");
  const bytes = new TextEncoder().encode(lines.join("\n"));
  return toHex(await subtle.digest("SHA-256", bytes));
}

/** Stable pk ordering used on both sides (string comparison, like SQLite TEXT). */
export function comparePk(a: SqliteValue, b: SqliteValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
