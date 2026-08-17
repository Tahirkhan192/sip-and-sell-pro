/**
 * PHASE 9 — failure classification for synchronization.
 *
 * The engine must treat "the Wi-Fi dropped" and "the server rejected this row"
 * very differently. A temporary failure retries with backoff; a permanent one
 * stops retrying immediately and waits for a human, so a rejected mutation can
 * never busy-loop against the network.
 *
 * Nothing here deletes or rewrites an outbox record — classification only
 * decides WHEN (or whether) the record is tried again.
 */

export type FailureKind =
  | "network" // transient: offline, timeout, 5xx, rate limit
  | "auth" // 401/403/JWT — needs sign-in, not a retry storm
  | "validation" // 400/422/constraint — the payload itself is wrong
  | "conflict" // handled by the conflict path, never as a failure
  | "permanent" // anything the server will keep rejecting
  | "unknown";

export type FailureClass = {
  kind: FailureKind;
  /** May the engine retry this automatically? */
  retryable: boolean;
  /** Does a human have to look at it before it can succeed? */
  needsAttention: boolean;
  message: string;
};

const NETWORK_HINTS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "timeout",
  "timed out",
  "econnreset",
  "socket hang up",
  "temporarily unavailable",
  "service unavailable",
  "too many requests",
];

const AUTH_HINTS = [
  "jwt",
  "unauthorized",
  "not authorized",
  "forbidden",
  "permission denied",
  "row-level security",
  "row level security",
  "invalid api key",
  "no api key",
];

const VALIDATION_HINTS = [
  "violates check constraint",
  "violates not-null",
  "violates foreign key",
  "invalid input syntax",
  "value too long",
  "could not be parsed",
  "is not readable",
];

function statusOf(error: unknown): number | null {
  const any = error as { status?: unknown; statusCode?: unknown; code?: unknown } | null;
  if (!any || typeof any !== "object") return null;
  for (const candidate of [any.status, any.statusCode]) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 100 && n <= 599) return n;
  }
  // PostgREST puts SQLSTATE in `code` (e.g. "23505"), not an HTTP status.
  return null;
}

function textOf(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  const any = error as Record<string, unknown>;
  return [any.message, any.details, any.hint, any.code]
    .filter((v) => typeof v === "string" && v)
    .join(" | ")
    .toString();
}

function sqlStateOf(error: unknown): string | null {
  const any = error as { code?: unknown } | null;
  if (!any || typeof any !== "object") return null;
  const code = typeof any.code === "string" ? any.code : null;
  return code && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/** Maps any thrown value onto a retry policy. Never throws. */
export function classifyFailure(error: unknown): FailureClass {
  const message = (textOf(error) || "The change could not be uploaded.").slice(0, 2000);
  const lower = message.toLowerCase();
  const status = statusOf(error);
  const sqlState = sqlStateOf(error);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "network", retryable: true, needsAttention: false, message };
  }

  if (status === 401 || status === 403 || AUTH_HINTS.some((h) => lower.includes(h))) {
    return { kind: "auth", retryable: false, needsAttention: true, message };
  }
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return { kind: "network", retryable: true, needsAttention: false, message };
  }
  if (NETWORK_HINTS.some((h) => lower.includes(h))) {
    return { kind: "network", retryable: true, needsAttention: false, message };
  }
  if (sqlState === "23505") {
    // Unique violation — the row is already there. Treated as permanent so the
    // conflict/idempotency path (not blind retrying) resolves it.
    return { kind: "conflict", retryable: false, needsAttention: true, message };
  }
  if (
    status === 400 ||
    status === 404 ||
    status === 409 ||
    status === 422 ||
    (sqlState !== null && sqlState.startsWith("23")) ||
    VALIDATION_HINTS.some((h) => lower.includes(h))
  ) {
    return { kind: "validation", retryable: false, needsAttention: true, message };
  }
  return { kind: "unknown", retryable: true, needsAttention: false, message };
}

/** Human-facing one-liner used in the Sync Status UI. */
export function describeFailure(kind: FailureKind): string {
  switch (kind) {
    case "network":
      return "Connection problem — will retry automatically.";
    case "auth":
      return "Sign-in required before this change can be uploaded.";
    case "validation":
      return "The server rejected this change — it needs to be corrected.";
    case "conflict":
      return "This record was changed elsewhere — choose which version to keep.";
    case "permanent":
      return "This change cannot be uploaded and needs attention.";
    default:
      return "Temporary problem — will retry automatically.";
  }
}

/** Encoded into `last_error` so the UI and later runs can read the class back. */
export function encodeError(kind: FailureKind, message: string): string {
  return `[${kind}] ${message}`.slice(0, 2000);
}

export function decodeError(raw: string | null): { kind: FailureKind; message: string } {
  if (!raw) return { kind: "unknown", message: "" };
  const match = /^\[(network|auth|validation|conflict|permanent|unknown)\]\s?([\s\S]*)$/.exec(raw);
  if (!match) return { kind: "unknown", message: raw };
  return { kind: match[1] as FailureKind, message: match[2] };
}
