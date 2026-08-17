/**
 * PHASE 5A — local mutation errors and results.
 *
 * Raw SQLite errors never reach the UI: they are classified into a small,
 * stable set of codes with a human-readable message. Existing production
 * error handling is untouched — nothing in the app consumes these yet.
 */

export const LOCAL_MUTATION_ERROR_CODES = [
  /** VITE_ENABLE_LOCAL_WRITES is not "true". */
  "LOCAL_WRITES_DISABLED",
  /** VITE_ENABLE_LOCAL_SQLITE is not "true". */
  "LOCAL_SQLITE_DISABLED",
  /** Someone tried to mutate a real business table locally. */
  "BUSINESS_WRITES_DISABLED",
  /** The database is in the memory fallback — a write would be lost. */
  "NOT_PERSISTENT",
  /** Another tab/worker holds the OPFS pool, or SQLite reported a lock. */
  "DATABASE_LOCKED",
  /** The worker could not be started or crashed. */
  "WORKER_UNAVAILABLE",
  /** Step payload failed validation before touching SQLite. */
  "INVALID_MUTATION",
  /** A step failed; the transaction was rolled back. */
  "TRANSACTION_FAILED",
  /** Anything unclassified. */
  "UNKNOWN",
] as const;

export type LocalMutationErrorCode = (typeof LOCAL_MUTATION_ERROR_CODES)[number];

export class LocalMutationError extends Error {
  readonly code: LocalMutationErrorCode;
  readonly rolledBack: boolean;

  constructor(code: LocalMutationErrorCode, message: string, rolledBack = true) {
    super(message);
    this.name = "LocalMutationError";
    this.code = code;
    this.rolledBack = rolledBack;
  }
}

const LOCK_PATTERNS = [
  /sqlite_busy/i,
  /database is locked/i,
  /database table is locked/i,
  /cannot acquire/i,
  /sah pool/i,
  /already open/i,
];

/** Maps an unknown thrown value onto a stable error code. */
export function classifyLocalError(err: unknown): LocalMutationErrorCode {
  if (err instanceof LocalMutationError) return err.code;
  const msg = String((err as any)?.message ?? err ?? "");
  if (LOCK_PATTERNS.some((p) => p.test(msg))) return "DATABASE_LOCKED";
  if (/worker/i.test(msg)) return "WORKER_UNAVAILABLE";
  if (/invalid local mutation/i.test(msg)) return "INVALID_MUTATION";
  return "UNKNOWN";
}

/** A single-line, non-technical message safe to show in a UI. */
export function friendlyMessage(code: LocalMutationErrorCode): string {
  switch (code) {
    case "LOCAL_WRITES_DISABLED":
      return "Local writes are turned off.";
    case "LOCAL_SQLITE_DISABLED":
      return "The local database is turned off.";
    case "BUSINESS_WRITES_DISABLED":
      return "Local business writes are not enabled until Phase 5B.";
    case "NOT_PERSISTENT":
      return "The local database is not persistent on this device, so nothing was saved.";
    case "DATABASE_LOCKED":
      return "The local database is in use by another tab. Close the other tab and try again.";
    case "WORKER_UNAVAILABLE":
      return "The local database could not be started.";
    case "INVALID_MUTATION":
      return "The change could not be saved because it was incomplete.";
    case "TRANSACTION_FAILED":
      return "The change could not be saved and nothing was changed.";
    default:
      return "Something went wrong saving locally. Nothing was changed.";
  }
}

/* ------------------------------------------------------------------ *
 * Result envelope                                                     *
 * ------------------------------------------------------------------ */

export type LocalMutationSuccess = {
  ok: true;
  mutationId: string;
  entityId: string;
  entityType: string;
  operation: string;
  businessDate: string;
  businessTime: string;
  payloadHash: string;
  committedAt: string;
  deviceId: string;
};

export type LocalMutationFailure = {
  ok: false;
  mutationId: string;
  errorCode: LocalMutationErrorCode;
  message: string;
  rolledBack: boolean;
};

export type LocalMutationResult = LocalMutationSuccess | LocalMutationFailure;

export function failure(
  mutationId: string,
  code: LocalMutationErrorCode,
  message?: string,
  rolledBack = true,
): LocalMutationFailure {
  return {
    ok: false,
    mutationId,
    errorCode: code,
    message: message ?? friendlyMessage(code),
    rolledBack,
  };
}
