/**
 * PHASE 5A — local write feature gate.
 *
 * Two independent switches, both default OFF:
 *   VITE_ENABLE_LOCAL_SQLITE  — may the local database open at all (Phase 2).
 *   VITE_ENABLE_LOCAL_WRITES  — may the local mutation engine run at all.
 *
 * Even with BOTH set to "true", real business mutations stay disabled in this
 * phase: `assertBusinessWritesEnabled()` always throws. The flag only unlocks
 * the isolated Phase 5A test infrastructure.
 */

import { isLocalSqliteEnabled } from "../status";
import { LocalMutationError } from "./errors";

function readFlag(name: string): string | undefined {
  const fromVite = (import.meta as any).env?.[name];
  const fromNode = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const v = fromVite ?? fromNode;
  return v === undefined || v === null ? undefined : String(v);
}

/** Build-time flag. Exactly "true" enables the local mutation engine. */
export function isLocalWritesEnabled(): boolean {
  return readFlag("VITE_ENABLE_LOCAL_WRITES") === "true";
}

/**
 * Phase 5B will flip this. Until then, no production business mutation may be
 * served locally, regardless of the feature flags.
 */
export const BUSINESS_WRITES_ENABLED = false;

export const BUSINESS_WRITES_MESSAGE =
  "Local business writes are not enabled until Phase 5B.";

/** Throws unless the isolated Phase 5A mutation engine may run. */
export function assertLocalWritesEnabled(): void {
  if (!isLocalSqliteEnabled()) {
    throw new LocalMutationError(
      "LOCAL_SQLITE_DISABLED",
      "The local database is disabled (VITE_ENABLE_LOCAL_SQLITE is not \"true\").",
    );
  }
  if (!isLocalWritesEnabled()) {
    throw new LocalMutationError(
      "LOCAL_WRITES_DISABLED",
      "Local writes are disabled (VITE_ENABLE_LOCAL_WRITES is not \"true\").",
    );
  }
}

/**
 * Guard for every real business mutation path. Always throws in Phase 5A —
 * there is no silent fallback to a cloud write, the caller must keep using
 * the cloud repository explicitly.
 */
export function assertBusinessWritesEnabled(): never {
  throw new LocalMutationError("BUSINESS_WRITES_DISABLED", BUSINESS_WRITES_MESSAGE);
}

export { isLocalSqliteEnabled };
