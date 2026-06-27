// Business day rolls over at 08:00 Asia/Karachi (PKT = UTC+5), so 08:00 PKT = 03:00 UTC.
// All "today/yesterday/this month" comparisons in reports use this logic.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const ROLLOVER_HOUR_PKT = 8;

function pktNow(now: Date = new Date()): Date {
  // Returns a Date whose UTC fields equal the wall-clock in PKT.
  return new Date(now.getTime() + PKT_OFFSET_MS);
}

/** YYYY-MM-DD of the current business day (rolls over at 08:00 PKT). */
export function businessToday(now: Date = new Date()): string {
  const pkt = pktNow(now);
  if (pkt.getUTCHours() < ROLLOVER_HOUR_PKT) {
    pkt.setUTCDate(pkt.getUTCDate() - 1);
  }
  return pkt.toISOString().slice(0, 10);
}

/** UTC ISO timestamp marking the start (inclusive) of business day `d` (YYYY-MM-DD). */
export function businessDayStartUTC(d: string): string {
  // 08:00 PKT == 03:00 UTC of the same calendar day
  return `${d}T03:00:00.000Z`;
}

/** UTC ISO timestamp marking the end (exclusive) of business day `d`. */
export function businessDayEndUTC(d: string): string {
  const next = new Date(`${d}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T03:00:00.000Z`;
}

export type Preset = "today" | "yesterday" | "week" | "month" | "lastMonth" | "custom";

export interface RangeResult {
  from: string;        // business YYYY-MM-DD inclusive
  to: string;          // business YYYY-MM-DD inclusive
  startUTC: string;    // for sales/timestamptz queries
  endExclusiveUTC: string;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function startOfBusinessMonth(d: string): string {
  return `${d.slice(0, 7)}-01`;
}
export function endOfBusinessMonth(d: string): string {
  const start = new Date(`${d.slice(0, 7)}-01T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return start.toISOString().slice(0, 10);
}

export function buildRange(preset: Preset, customFrom?: string, customTo?: string): RangeResult {
  const today = businessToday();
  let from = today, to = today;
  switch (preset) {
    case "today": break;
    case "yesterday": from = to = addDays(today, -1); break;
    case "week": {
      const t = new Date(`${today}T00:00:00.000Z`);
      const dow = t.getUTCDay(); // 0=Sun
      const back = dow === 0 ? 6 : dow - 1;
      from = addDays(today, -back);
      break;
    }
    case "month": from = startOfBusinessMonth(today); break;
    case "lastMonth": {
      const t = new Date(`${startOfBusinessMonth(today)}T00:00:00.000Z`);
      t.setUTCMonth(t.getUTCMonth() - 1);
      from = t.toISOString().slice(0, 10);
      to = endOfBusinessMonth(from);
      break;
    }
    case "custom":
      from = customFrom ?? today;
      to = customTo ?? today;
      break;
  }
  return { from, to, startUTC: businessDayStartUTC(from), endExclusiveUTC: businessDayEndUTC(to) };
}
