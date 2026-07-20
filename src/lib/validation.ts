/**
 * Shared input validators. Throws ValidationError with a friendly message so
 * callers can surface it to the user via toast without crashing.
 */
import { logger } from "./logger";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireNonEmpty(value: unknown, field: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) {
    const err = new ValidationError(`${field} is required`);
    logger.warn("validation", err.message);
    throw err;
  }
  return s;
}

export function requirePositive(value: unknown, field: string, allowZero = false): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || (allowZero ? n < 0 : n <= 0)) {
    const err = new ValidationError(`${field} must be a valid ${allowZero ? "non-negative" : "positive"} number`);
    logger.warn("validation", err.message, { value });
    throw err;
  }
  return n;
}

export function requireNonNegative(value: unknown, field: string): number {
  return requirePositive(value, field, true);
}

export function clampNonNegative(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}
