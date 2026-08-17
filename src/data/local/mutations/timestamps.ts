/**
 * PHASE 5A — local business timestamps.
 *
 * Produces the UTC instant, the business date and the business wall-clock
 * time for a mutation without ever asking Supabase for `now()`. Business
 * semantics come from `src/lib/business-date.ts` (authoritative) which is fed
 * by the saved Business Settings (timezone, day start time, month start day).
 */

import { getBusinessConfig } from "@/lib/business-date";
import { localBusinessDate, localBusinessTime } from "./business-date";

export type BusinessStamp = {
  /** ISO 8601 UTC instant, e.g. "2026-08-17T03:15:22.481Z". */
  utc: string;
  /** Epoch milliseconds for the same instant. */
  epochMs: number;
  /** Business date this instant belongs to ('YYYY-MM-DD'). */
  businessDate: string;
  /** Wall-clock time in the configured timezone ('HH:MM:SS'). */
  businessTime: string;
  /** IANA timezone used ('Asia/Karachi' by default). */
  timezone: string;
  /** Configured rollover time ('HH:MM'). */
  dayStart: string;
  /** Configured business month start day. */
  monthStartDay: number;
};

/** Full business stamp for an instant (defaults to now). */
export function businessStamp(at: Date = new Date()): BusinessStamp {
  const cfg = getBusinessConfig();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    utc: at.toISOString(),
    epochMs: at.getTime(),
    businessDate: localBusinessDate(at),
    businessTime: localBusinessTime(at),
    timezone: cfg.timezone,
    dayStart: `${pad(cfg.startHour)}:${pad(cfg.startMinute)}`,
    monthStartDay: cfg.monthStartDay,
  };
}

/** ISO UTC "now" — the local replacement for a server-side now(). */
export function nowUtcIso(at: Date = new Date()): string {
  return at.toISOString();
}
