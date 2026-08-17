/**
 * PHASE 7 — worker-side offline authentication operations.
 *
 * This module runs INSIDE the SQLite worker (and in-process during tests).
 * It is the only bridge between the main thread and the Phase 5L identity
 * tables, and it deliberately exposes a tiny, non-generic surface:
 *
 *   * no raw SQL is reachable from the main thread;
 *   * no salt, iteration count or password hash ever leaves the worker
 *     (`SafeIdentity` is the only identity shape that crosses the boundary);
 *   * enrolment still requires the caller to prove it just verified a real
 *     Lovable Cloud session (`online: true` with the cloud user id/email/role).
 */

import { getDeviceId, type LocalDb } from "@/data/local/engine";
import {
  IDENTITY_TABLE,
  SESSION_TABLE,
  OfflineAuthError,
  currentSession,
  endSession,
  ensureOfflineAuthSchema,
  enrolIdentity,
  offlineCan,
  readIdentity,
  readIdentityByEmail,
  reconcileIdentity,
  startSession,
  unlockOffline,
  type AppRole,
  type CloudIdentityState,
  type IdentityRow,
  type SessionRow,
} from "./offline-identity";

/** Revision of the local authentication schema exposed to the app. */
export const AUTH_SCHEMA_VERSION = 1;

/** Identity fields safe to hand to the main thread — never salt/hash. */
export type SafeIdentity = {
  user_id: string;
  email: string;
  role: AppRole;
  enrolled_at: string;
  last_online_verification: string;
  offline_grace_days: number;
  revoked_at: string | null;
  failed_attempts: number;
};

export type AuthSnapshot = {
  deviceId: string;
  schemaVersion: number;
  identity: SafeIdentity | null;
  session: SessionRow | null;
  can: { read: boolean; write: boolean; admin: boolean };
};

export type AuthRequest =
  | { op: "authStatus" }
  | {
      op: "authEnrol";
      userId: string;
      email: string;
      role: AppRole;
      unlockSecret: string;
      online: boolean;
      iterations?: number;
    }
  | { op: "authUnlock"; email: string; unlockSecret: string }
  | { op: "authOnlineSession"; userId: string; email: string; role: AppRole }
  | { op: "authLogout" }
  | { op: "authReconcile"; userId: string; cloud: CloudIdentityState };

export type AuthResult = { auth: AuthSnapshot };

function safeIdentity(row: IdentityRow | null): SafeIdentity | null {
  if (!row) return null;
  return {
    user_id: row.user_id,
    email: row.email,
    role: row.role,
    enrolled_at: row.enrolled_at,
    last_online_verification: row.last_online_at,
    offline_grace_days: row.offline_grace_days,
    revoked_at: row.revoked_at,
    failed_attempts: row.failed_attempts,
  };
}

/** The one identity this installation is enrolled for (most recent wins). */
function enrolledIdentity(db: LocalDb): IdentityRow | null {
  const rows = db.selectObjects(
    `SELECT * FROM ${IDENTITY_TABLE} ORDER BY enrolled_at DESC LIMIT 1`,
  ) as any[];
  return (rows[0] as IdentityRow) ?? null;
}

function snapshot(db: LocalDb, at = new Date()): AuthSnapshot {
  const deviceId = getDeviceId(db);
  const session = currentSession(db, deviceId, at);
  const identity = session ? readIdentity(db, session.user_id) : enrolledIdentity(db);
  return {
    deviceId,
    schemaVersion: AUTH_SCHEMA_VERSION,
    identity: safeIdentity(identity),
    session,
    can: {
      read: offlineCan(session, "read"),
      write: offlineCan(session, "write"),
      admin: offlineCan(session, "admin"),
    },
  };
}

/** Ends every live session on this device. Business data is never touched. */
function endDeviceSessions(db: LocalDb, at = new Date()): void {
  const deviceId = getDeviceId(db);
  const rows = db.selectValues(
    `SELECT id FROM ${SESSION_TABLE} WHERE device_id = ? AND revoked_at IS NULL`,
    [deviceId],
  ) as string[];
  for (const id of rows) endSession(db, String(id), at);
}

export async function handleAuthRequest(db: LocalDb, req: AuthRequest): Promise<AuthResult> {
  ensureOfflineAuthSchema(db);
  const deviceId = getDeviceId(db);
  const at = new Date();

  switch (req.op) {
    case "authStatus":
      return { auth: snapshot(db, at) };

    case "authEnrol": {
      await enrolIdentity(db, {
        userId: req.userId,
        email: req.email,
        role: req.role,
        unlockSecret: req.unlockSecret,
        online: req.online,
        iterations: req.iterations,
        at,
      });
      endDeviceSessions(db, at);
      startSession(db, { userId: req.userId, role: req.role, deviceId, origin: "online", at });
      return { auth: snapshot(db, at) };
    }

    case "authUnlock": {
      await unlockOffline(db, {
        email: req.email,
        unlockSecret: req.unlockSecret,
        deviceId,
        at,
      });
      return { auth: snapshot(db, at) };
    }

    case "authOnlineSession": {
      // Only an already-enrolled identity gets a local session. A live cloud
      // session alone must never create offline access material.
      const identity = readIdentity(db, req.userId) ?? readIdentityByEmail(db, req.email);
      if (!identity || identity.user_id !== req.userId) {
        throw new OfflineAuthError(
          "NOT_ENROLLED",
          "This device is not enrolled for offline use by that account.",
        );
      }
      reconcileIdentity(db, req.userId, { exists: true, email: req.email, role: req.role }, at);
      endDeviceSessions(db, at);
      startSession(db, { userId: req.userId, role: req.role, deviceId, origin: "online", at });
      return { auth: snapshot(db, at) };
    }

    case "authLogout": {
      endDeviceSessions(db, at);
      return { auth: snapshot(db, at) };
    }

    case "authReconcile": {
      reconcileIdentity(db, req.userId, req.cloud, at);
      if (!req.cloud.exists) endDeviceSessions(db, at);
      return { auth: snapshot(db, at) };
    }
  }
}
