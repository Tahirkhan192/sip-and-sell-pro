/**
 * PHASE 7 — main-thread offline authentication facade.
 *
 * Rules this file enforces:
 *
 *   * The cloud is authoritative whenever it is reachable. Every online start
 *     re-reads the user and role from Lovable Cloud and reconciles the cached
 *     local identity with it (revocation included).
 *   * The device is only ever "authenticated offline" when a real enrolment
 *     plus a live, unexpired local session exists. The presence of SQLite data
 *     grants nothing.
 *   * No token, key or password crosses into SQLite — only a PBKDF2 hash of
 *     the unlock code the user chose, which lives in the worker.
 */

import { supabase } from "@/integrations/supabase/client";
import { requestLocalDb } from "@/data/local/db";
import type { AuthSnapshot } from "./auth-worker";
import type { AppRole, CloudIdentityState } from "./offline-identity";

export type { AuthSnapshot };

export type AccessState =
  | { mode: "online"; userId: string; email: string; role: AppRole; enrolled: boolean; snapshot: AuthSnapshot | null }
  | { mode: "offline"; userId: string; email: string; role: AppRole; snapshot: AuthSnapshot }
  | { mode: "signed-out"; reason: "no-session" | "not-enrolled" | "expired"; snapshot: AuthSnapshot | null };

export class LocalAuthError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LocalAuthError";
  }
}

function rethrow(err: unknown): never {
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  const code = name.startsWith("OfflineAuthError:") ? name.slice("OfflineAuthError:".length) : "UNKNOWN";
  throw new LocalAuthError(code, message);
}

async function auth(req: Parameters<typeof requestLocalDb>[0]): Promise<AuthSnapshot> {
  try {
    const res = (await requestLocalDb(req)) as { auth: AuthSnapshot };
    return res.auth;
  } catch (err) {
    return rethrow(err);
  }
}

/** Local snapshot only — never contacts the network. */
export function localAuthStatus(): Promise<AuthSnapshot> {
  return auth({ op: "authStatus" } as any);
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/** The role the cloud currently reports for a user. Defaults to the least privilege. */
export async function cloudRoleFor(userId: string): Promise<AppRole> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => String(r.role));
  return roles.includes("admin") ? "admin" : "staff";
}

/** Verified cloud identity, or null when signed out / unreachable. */
export async function cloudIdentity(): Promise<{ userId: string; email: string; role: AppRole } | null> {
  if (!isOnline()) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const role = await cloudRoleFor(data.user.id);
    return { userId: data.user.id, email: data.user.email ?? "", role };
  } catch {
    return null;
  }
}

/**
 * Decides how the app may run right now:
 * online cloud session → enrolled local session → offline session → signed out.
 */
export async function resolveAccess(): Promise<AccessState> {
  const cloud = await cloudIdentity();

  if (cloud) {
    let snapshot: AuthSnapshot | null = null;
    let enrolled = false;
    try {
      snapshot = await localAuthStatus();
      enrolled = Boolean(snapshot.identity && snapshot.identity.user_id === cloud.userId);
      if (enrolled) {
        snapshot = await auth({
          op: "authOnlineSession",
          userId: cloud.userId,
          email: cloud.email,
          role: cloud.role,
        } as any);
      }
    } catch {
      // Local storage problems must never block an online, cloud-verified user.
      enrolled = false;
    }
    return { mode: "online", ...cloud, enrolled, snapshot };
  }

  let snapshot: AuthSnapshot;
  try {
    snapshot = await localAuthStatus();
  } catch {
    return { mode: "signed-out", reason: "no-session", snapshot: null };
  }
  if (!snapshot.identity) return { mode: "signed-out", reason: "not-enrolled", snapshot };
  if (!snapshot.session) return { mode: "signed-out", reason: "expired", snapshot };
  return {
    mode: "offline",
    userId: snapshot.session.user_id,
    email: snapshot.identity.email,
    role: snapshot.session.role,
    snapshot,
  };
}

/** Enrols this installation. Requires a live, verified cloud session. */
export async function enrolThisDevice(unlockSecret: string): Promise<AuthSnapshot> {
  const cloud = await cloudIdentity();
  if (!cloud) {
    throw new LocalAuthError(
      "NOT_ENROLLED",
      "Device enrolment needs an online sign-in. Connect to the internet and sign in again.",
    );
  }
  return auth({
    op: "authEnrol",
    userId: cloud.userId,
    email: cloud.email,
    role: cloud.role,
    unlockSecret,
    online: true,
  } as any);
}

/** Offline sign-in with the device unlock code. */
export function unlockThisDevice(email: string, unlockSecret: string): Promise<AuthSnapshot> {
  return auth({ op: "authUnlock", email, unlockSecret } as any);
}

/** Applies what the cloud says about an enrolled user (role change / removal). */
export function reconcileWithCloud(userId: string, cloud: CloudIdentityState): Promise<AuthSnapshot> {
  return auth({ op: "authReconcile", userId, cloud } as any);
}

/**
 * Logout: local session first (so an offline re-entry is impossible without the
 * unlock code), then Supabase when reachable. Business data is never deleted.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await auth({ op: "authLogout" } as any);
  } catch {
    // a missing local database must not block the cloud sign-out
  }
  try {
    await supabase.auth.signOut();
  } catch {
    // offline: the cloud session expires on its own; local access is already gone
  }
}
