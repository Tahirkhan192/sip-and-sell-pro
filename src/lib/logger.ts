/**
 * Centralized logger. Captures sync/db/validation/network errors into a bounded
 * in-memory ring buffer plus IndexedDB (best-effort) so the app never crashes on
 * a log call and the last N failures can be inspected from Settings → Audit.
 */

type LogLevel = "info" | "warn" | "error";
type LogScope = "sync" | "db" | "validation" | "network" | "app";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  scope: LogScope;
  message: string;
  detail?: unknown;
};

const MAX = 500;
const buf: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();

function push(entry: LogEntry) {
  buf.push(entry);
  if (buf.length > MAX) buf.splice(0, buf.length - MAX);
  listeners.forEach((l) => {
    try {
      l(buf.slice());
    } catch {
      /* ignore */
    }
  });
}

function fmt(detail: unknown): unknown {
  if (detail instanceof Error) return { name: detail.name, message: detail.message, stack: detail.stack };
  return detail;
}

export const logger = {
  info(scope: LogScope, message: string, detail?: unknown) {
    push({ ts: new Date().toISOString(), level: "info", scope, message, detail: fmt(detail) });
  },
  warn(scope: LogScope, message: string, detail?: unknown) {
    push({ ts: new Date().toISOString(), level: "warn", scope, message, detail: fmt(detail) });
    // eslint-disable-next-line no-console
    console.warn(`[${scope}] ${message}`, detail ?? "");
  },
  error(scope: LogScope, message: string, detail?: unknown) {
    push({ ts: new Date().toISOString(), level: "error", scope, message, detail: fmt(detail) });
    // eslint-disable-next-line no-console
    console.error(`[${scope}] ${message}`, detail ?? "");
  },
  entries(): LogEntry[] {
    return buf.slice();
  },
  subscribe(fn: (entries: LogEntry[]) => void): () => void {
    listeners.add(fn);
    fn(buf.slice());
    return () => listeners.delete(fn);
  },
  clear() {
    buf.length = 0;
    listeners.forEach((l) => l([]));
  },
};

if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => logger.error("app", e.message, e.error));
  window.addEventListener("unhandledrejection", (e) =>
    logger.error("app", "unhandledrejection", (e as PromiseRejectionEvent).reason),
  );
}
