/**
 * PHASE 5A — local business-date access.
 *
 * `src/lib/business-date.ts` is AUTHORITATIVE. Nothing here re-derives the
 * rollover, timezone or business-month rules: every function below delegates
 * to that module so the local layer can never drift from the semantics the
 * cloud-backed application already uses.
 *
 * The only thing this file adds is a local-only entry point (no Supabase
 * `now()`, no network) plus the wiring that keeps the shared config in sync
 * with the saved business settings.
 */

import {
  businessDateOf as libBusinessDateOf,
  businessDayEndUTC as libBusinessDayEndUTC,
  businessDayStartUTC as libBusinessDayStartUTC,
  businessToday as libBusinessToday,
  endOfBusinessMonth as libEndOfBusinessMonth,
  getBusinessConfig,
  partsInTZ,
  startOfBusinessMonth as libStartOfBusinessMonth,
  type BusinessConfig,
} from "@/lib/business-date";

export type { BusinessConfig };
export { getBusinessConfig };

/** Business date ('YYYY-MM-DD') of an instant, computed entirely offline. */
export function localBusinessDate(at: Date | string = new Date()): string {
  return typeof at === "string" ? libBusinessDateOf(at) : libBusinessToday(at);
}

/** Business date of "now". */
export function localBusinessToday(now: Date = new Date()): string {
  return libBusinessToday(now);
}

/** Wall-clock business time ('HH:MM:SS') in the configured timezone. */
export function localBusinessTime(at: Date = new Date()): string {
  const p = partsInTZ(at, getBusinessConfig().timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function localBusinessDayStartUTC(date: string): string {
  return libBusinessDayStartUTC(date);
}

export function localBusinessDayEndUTC(date: string): string {
  return libBusinessDayEndUTC(date);
}

export function localBusinessMonthStart(date: string): string {
  return libStartOfBusinessMonth(date);
}

export function localBusinessMonthEnd(date: string): string {
  return libEndOfBusinessMonth(date);
}
