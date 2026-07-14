// Business day rollover, timezone, and month start day are all configurable
// via Settings → Business Settings. Defaults preserve the previous behavior
// (Asia/Karachi, 08:00 rollover, month starts on the 6th).

export type BusinessConfig = {
  timezone: string;             // IANA tz, e.g. "Asia/Karachi"
  startHour: number;            // 0-23
  startMinute: number;          // 0-59
  monthStartDay: number;        // 1-28
};

let CONFIG: BusinessConfig = {
  timezone: "Asia/Karachi",
  startHour: 8,
  startMinute: 0,
  monthStartDay: 6,
};

const listeners = new Set<() => void>();

export function getBusinessConfig(): BusinessConfig { return CONFIG; }
export function subscribeBusinessConfig(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function setBusinessConfig(next: Partial<BusinessConfig>) {
  CONFIG = { ...CONFIG, ...next };
  listeners.forEach((f) => f());
}

/** Parse a "HH:MM" or "HH:MM:SS" string into {hour, minute}. */
export function parseTimeString(s: string | null | undefined): { hour: number; minute: number } {
  if (!s) return { hour: 8, minute: 0 };
  const parts = s.split(":");
  return { hour: Number(parts[0] ?? 8) || 0, minute: Number(parts[1] ?? 0) || 0 };
}

/** Get wall-clock parts (Y/M/D/h/m/s) of `now` in the configured timezone. */
export function partsInTZ(now: Date = new Date(), tz: string = CONFIG.timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** YYYY-MM-DD of the current business day (rolls over at configured time in configured TZ). */
export function businessToday(now: Date = new Date()): string {
  const p = partsInTZ(now);
  let y = p.year, m = p.month, d = p.day;
  const beforeRollover = p.hour < CONFIG.startHour || (p.hour === CONFIG.startHour && p.minute < CONFIG.startMinute);
  if (beforeRollover) {
    // step one calendar day back
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - 1);
    y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Business date for an arbitrary instant. */
export function businessDateOf(ts: Date | string): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return businessToday(d);
}

/** UTC ISO timestamp marking the start (inclusive) of business day `d` (YYYY-MM-DD). */
export function businessDayStartUTC(d: string): string {
  // The moment that is `startHour:startMinute` local time on day `d` in tz.
  return tzWallClockToUTC(d, CONFIG.startHour, CONFIG.startMinute, CONFIG.timezone);
}
/** UTC ISO timestamp marking the end (exclusive) of business day `d`. */
export function businessDayEndUTC(d: string): string {
  const next = addDays(d, 1);
  return businessDayStartUTC(next);
}

/** Convert a local wall-clock time (Y-M-D H:M in tz) to a UTC ISO string. */
function tzWallClockToUTC(dateStr: string, hour: number, minute: number, tz: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  // Iterate: guess UTC then adjust by offset
  let guess = Date.UTC(y, mo - 1, d, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const p = partsInTZ(new Date(guess), tz);
    const localMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const targetMs = Date.UTC(y, mo - 1, d, hour, minute, 0);
    const diff = targetMs - localMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

export type Preset = "today" | "yesterday" | "week" | "month" | "lastMonth" | "custom";

export interface RangeResult {
  from: string;
  to: string;
  startUTC: string;
  endExclusiveUTC: string;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// Business month runs from configured `monthStartDay` through the day before that day next month.
export function startOfBusinessMonth(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  const startDay = CONFIG.monthStartDay;
  let year = y, month = m;
  if (day < startDay) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
}

export function endOfBusinessMonth(d: string): string {
  const s = startOfBusinessMonth(d);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  // day before next start day
  const t = new Date(Date.UTC(ny, nm - 1, CONFIG.monthStartDay));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

export function buildRange(preset: Preset, customFrom?: string, customTo?: string): RangeResult {
  const today = businessToday();
  let from = today, to = today;
  switch (preset) {
    case "today": break;
    case "yesterday": from = to = addDays(today, -1); break;
    case "week": {
      const t = new Date(`${today}T00:00:00.000Z`);
      const dow = t.getUTCDay();
      const back = dow === 0 ? 6 : dow - 1;
      from = addDays(today, -back);
      break;
    }
    case "month": {
      from = startOfBusinessMonth(today);
      to = endOfBusinessMonth(today);
      break;
    }
    case "lastMonth": {
      const s = startOfBusinessMonth(today);
      const y = Number(s.slice(0, 4));
      const m = Number(s.slice(5, 7));
      let py = y, pm = m - 1;
      if (pm < 1) { pm = 12; py -= 1; }
      from = `${py}-${String(pm).padStart(2, "0")}-${String(CONFIG.monthStartDay).padStart(2, "0")}`;
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

/** Format a Date/ISO in the configured timezone. */
export function formatInTZ(ts: Date | string, opts: Intl.DateTimeFormatOptions): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return new Intl.DateTimeFormat("en-GB", { timeZone: CONFIG.timezone, ...opts }).format(d);
}

export function formatBusinessDate(ts: Date | string): string {
  return formatInTZ(ts, { day: "2-digit", month: "2-digit", year: "numeric" });
}
export function formatBusinessTime(ts: Date | string): string {
  return formatInTZ(ts, { hour: "2-digit", minute: "2-digit", hour12: true });
}
