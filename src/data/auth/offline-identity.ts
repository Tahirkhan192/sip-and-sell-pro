/**
 * PHASE 5L — OFFLINE AUTH / ROLE / SESSION FOUNDATION.
 *
 * What this is
 * ------------
 * The identity layer a device needs to keep working when the network is gone,
 * built so it can never become a way *around* Lovable Cloud authorization:
 *
 *   * ENROLMENT IS ONLINE-ONLY. A device can only be enrolled while a real
 *     Supabase session exists; the caller passes the verified user id, email
 *     and roles it just read from the cloud. Nothing here can mint an identity
 *     on its own.
 *   * NO PASSWORDS, NO TOKENS. The only credential material stored is a
 *     PBKDF2-SHA-256 hash of a device unlock PIN/passphrase with a random
 *     per-identity salt. Access tokens, refresh tokens, Supabase keys and
 *     passwords are never accepted, never stored, and `assertNoSecrets`
 *     rejects any payload that smells like one.
 *   * OFFLINE ACCESS IS TIME-LIMITED. Every identity carries
 *     `offline_grace_days`. Once that many days have passed since the last
 *     successful ONLINE verification, offline unlock stops working until the
 *     device gets back online. Expired credentials cannot silently grant
 *     unlimited access.
 *   * ROLES ARE A CACHE, NEVER AN UPGRADE. The cached role is the role the
 *     cloud reported at the last reconcile, and it is only ever used to
 *     *restrict* the offline UI. While online, RLS remains the sole authority.
 *   * REVOCATION RECONCILES. `reconcileIdentity` applies what the cloud says:
 *     a deleted/disabled user revokes the identity and kills its sessions; a
 *     changed role overwrites the cached one.
 *   * LOGOUT INVALIDATES LOCALLY. `endSession` marks the session revoked in
 *     SQLite; a revoked or expired session is never returned as current.
 *
 * What this is NOT (yet)
 * ----------------------
 * It does not replace the Supabase route gate. The gate change requires
 * main-thread access to these tables (a worker protocol op that does not exist
 * yet) and is deliberately left for the wiring step; `isOfflineAuthEnabled()`
 * is the flag that will guard it.
 */

import type { LocalDb } from "@/data/local/engine";

export const IDENTITY_TABLE = "_local_identities";
export const SESSION_TABLE = "_local_sessions";

export const OFFLINE_AUTH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ${IDENTITY_TABLE} (
  user_id            TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL,
  salt               TEXT NOT NULL,
  iterations         INTEGER NOT NULL,
  secret_hash        TEXT NOT NULL,
  enrolled_at        TEXT NOT NULL,
  last_online_at     TEXT NOT NULL,
  offline_grace_days INTEGER NOT NULL,
  revoked_at         TEXT,
  failed_attempts    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  role         TEXT NOT NULL,
  device_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  origin       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_sessions_user
  ON ${SESSION_TABLE}(user_id, expires_at);
`;

export type AppRole = "admin" | "staff";

export type IdentityRow = {
  user_id: string;
  email: string;
  role: AppRole;
  salt: string;
  iterations: number;
  secret_hash: string;
  enrolled_at: string;
  last_online_at: string;
  offline_grace_days: number;
  revoked_at: string | null;
  failed_attempts: number;
};

export type SessionRow = {
  id: string;
  user_id: string;
  role: AppRole;
  device_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  origin: "online" | "offline";
};

export class OfflineAuthError extends Error {
  constructor(
    readonly code:
      | "NOT_ENROLLED"
      | "REVOKED"
      | "GRACE_EXPIRED"
      | "BAD_CREDENTIAL"
      | "LOCKED_OUT"
      | "SECRET_REJECTED"
      | "OFFLINE_AUTH_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "OfflineAuthError";
  }
}

/** Feature flag. Off by default: the Supabase gate is untouched until it is on. */
export function isOfflineAuthEnabled(): boolean {
  try {
    return String((import.meta as any)?.env?.VITE_ENABLE_OFFLINE_AUTH ?? "") === "true";
  } catch {
    return false;
  }
}

export const DEFAULT_ITERATIONS = 210_000;
export const DEFAULT_GRACE_DAYS = 14;
export const SESSION_HOURS = 12;
export const MAX_FAILED_ATTEMPTS = 10;

/**
 * Anything that looks like a real credential is refused outright, so a caller
 * cannot "helpfully" hand us a token to cache.
 */
export function assertNoSecrets(value: unknown, label = "value"): void {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  if (!text) return;
  const banned = [
    /^eyJ[A-Za-z0-9_-]+\./, // JWT
    /\bsb_secret_/i,
    /\bsb_publishable_/i,
    /service_role/i,
    /refresh_token/i,
    /access_token/i,
    /supabase.*key/i,
  ];
  if (banned.some((re) => re.test(text))) {
    throw new OfflineAuthError(
      "SECRET_REJECTED",
      `Refusing to store ${label}: it looks like a token, key or password material.`,
    );
  }
}

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSalt(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PBKDF2-SHA-256. The unlock secret itself is never stored anywhere. */
export async function derive(
  secret: string,
  salt: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    key,
    256,
  );
  return bytesToHex(bits);
}

/** Constant-time-ish comparison of two hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Storage (SQLite)                                                     *
 * ------------------------------------------------------------------ */

export function ensureOfflineAuthSchema(db: LocalDb): void {
  db.exec(OFFLINE_AUTH_SCHEMA_SQL);
}

export function readIdentity(db: LocalDb, userId: string): IdentityRow | null {
  const rows = db.selectObjects(`SELECT * FROM ${IDENTITY_TABLE} WHERE user_id = ?`, [userId] as any[]) as any[];
  return (rows[0] as IdentityRow) ?? null;
}

export function readIdentityByEmail(db: LocalDb, email: string): IdentityRow | null {
  const rows = db.selectObjects(`SELECT * FROM ${IDENTITY_TABLE} WHERE lower(email) = lower(?)`, [email] as any[]) as any[];
  return (rows[0] as IdentityRow) ?? null;
}

export function readSession(db: LocalDb, id: string): SessionRow | null {
  const rows = db.selectObjects(`SELECT * FROM ${SESSION_TABLE} WHERE id = ?`, [id] as any[]) as any[];
  return (rows[0] as SessionRow) ?? null;
}

/* ------------------------------------------------------------------ *
 * Operations                                                           *
 * ------------------------------------------------------------------ */

export type EnrolInput = {
  /** Verified ONLINE: the id/email/role the cloud just returned. */
  userId: string;
  email: string;
  role: AppRole;
  /** Device unlock PIN or passphrase chosen by the user. Never stored. */
  unlockSecret: string;
  online: boolean;
  graceDays?: number;
  iterations?: number;
  at?: Date;
};

/**
 * Enrols (or re-enrols) this device for one cloud user. Online only.
 */
export async function enrolIdentity(db: LocalDb, input: EnrolInput): Promise<IdentityRow> {
  if (!input.online) {
    throw new OfflineAuthError(
      "NOT_ENROLLED",
      "Device enrolment requires an online sign-in with Lovable Cloud.",
    );
  }
  if (!input.userId || !input.email) {
    throw new OfflineAuthError("NOT_ENROLLED", "Enrolment needs the signed-in user id and email.");
  }
  if (!input.unlockSecret || input.unlockSecret.length < 4) {
    throw new OfflineAuthError("BAD_CREDENTIAL", "Choose an unlock code of at least 4 characters.");
  }
  assertNoSecrets(input.unlockSecret, "the unlock code");

  const at = input.at ?? new Date();
  const salt = randomSalt();
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const secret_hash = await derive(input.unlockSecret, salt, iterations);
  const row: IdentityRow = {
    user_id: input.userId,
    email: input.email,
    role: input.role,
    salt,
    iterations,
    secret_hash,
    enrolled_at: at.toISOString(),
    last_online_at: at.toISOString(),
    offline_grace_days: input.graceDays ?? DEFAULT_GRACE_DAYS,
    revoked_at: null,
    failed_attempts: 0,
  };
  db.exec({
    sql: `INSERT OR REPLACE INTO ${IDENTITY_TABLE}
      (user_id,email,role,salt,iterations,secret_hash,enrolled_at,last_online_at,offline_grace_days,revoked_at,failed_attempts)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,0)`,
    bind: [
      row.user_id,
      row.email,
      row.role,
      row.salt,
      row.iterations,
      row.secret_hash,
      row.enrolled_at,
      row.last_online_at,
      row.offline_grace_days,
    ],
  } as any);
  return row;
}

export function graceExpired(identity: IdentityRow, at: Date): boolean {
  const last = Date.parse(identity.last_online_at);
  if (!Number.isFinite(last)) return true;
  const days = (at.getTime() - last) / 86_400_000;
  return days > identity.offline_grace_days;
}

/**
 * Offline unlock. Returns a local session ONLY when the identity is enrolled,
 * not revoked, inside its offline grace window, not locked out, and the
 * unlock code matches the stored PBKDF2 digest.
 */
export async function unlockOffline(
  db: LocalDb,
  args: { email: string; unlockSecret: string; deviceId: string; at?: Date },
): Promise<SessionRow> {
  const at = args.at ?? new Date();
  const identity = readIdentityByEmail(db, args.email);
  if (!identity) {
    throw new OfflineAuthError("NOT_ENROLLED", "This device has not been enrolled for that user.");
  }
  if (identity.revoked_at) {
    throw new OfflineAuthError("REVOKED", "Offline access for this account was revoked.");
  }
  if (identity.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    throw new OfflineAuthError(
      "LOCKED_OUT",
      "Too many failed unlock attempts. Sign in online to unlock this device again.",
    );
  }
  if (graceExpired(identity, at)) {
    throw new OfflineAuthError(
      "GRACE_EXPIRED",
      "Offline access has expired. Connect to the internet and sign in again.",
    );
  }
  const digest = await derive(args.unlockSecret, identity.salt, identity.iterations);
  if (!digestsEqual(digest, identity.secret_hash)) {
    db.exec({
      sql: `UPDATE ${IDENTITY_TABLE} SET failed_attempts = failed_attempts + 1 WHERE user_id = ?`,
      bind: [identity.user_id],
    } as any);
    throw new OfflineAuthError("BAD_CREDENTIAL", "That unlock code is not correct.");
  }
  db.exec({
    sql: `UPDATE ${IDENTITY_TABLE} SET failed_attempts = 0 WHERE user_id = ?`,
    bind: [identity.user_id],
  } as any);
  return startSession(db, {
    userId: identity.user_id,
    role: identity.role,
    deviceId: args.deviceId,
    origin: "offline",
    at,
  });
}

export function startSession(
  db: LocalDb,
  args: {
    userId: string;
    role: AppRole;
    deviceId: string;
    origin: "online" | "offline";
    at?: Date;
    hours?: number;
  },
): SessionRow {
  const at = args.at ?? new Date();
  const expires = new Date(at.getTime() + (args.hours ?? SESSION_HOURS) * 3_600_000);
  const row: SessionRow = {
    id: globalThis.crypto.randomUUID(),
    user_id: args.userId,
    role: args.role,
    device_id: args.deviceId,
    created_at: at.toISOString(),
    expires_at: expires.toISOString(),
    revoked_at: null,
    origin: args.origin,
  };
  db.exec({
    sql: `INSERT INTO ${SESSION_TABLE}
      (id,user_id,role,device_id,created_at,expires_at,revoked_at,origin)
      VALUES (?,?,?,?,?,?,NULL,?)`,
    bind: [row.id, row.user_id, row.role, row.device_id, row.created_at, row.expires_at, row.origin],
  } as any);
  return row;
}

/** The live session for this device, or null. Expired/revoked never counts. */
export function currentSession(db: LocalDb, deviceId: string, at = new Date()): SessionRow | null {
  const rows = db.selectObjects(`SELECT * FROM ${SESSION_TABLE}
          WHERE device_id = ? AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at DESC LIMIT 1`, [deviceId, at.toISOString()] as any[]) as any[];
  return (rows[0] as SessionRow) ?? null;
}

/** Logout. The session is invalidated locally and immediately. */
export function endSession(db: LocalDb, sessionId: string, at = new Date()): void {
  db.exec({
    sql: `UPDATE ${SESSION_TABLE} SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
    bind: [at.toISOString(), sessionId],
  } as any);
}

export function revokeIdentity(db: LocalDb, userId: string, at = new Date()): void {
  db.exec({
    sql: `UPDATE ${IDENTITY_TABLE} SET revoked_at = ? WHERE user_id = ?`,
    bind: [at.toISOString(), userId],
  } as any);
  db.exec({
    sql: `UPDATE ${SESSION_TABLE} SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    bind: [at.toISOString(), userId],
  } as any);
}

export type CloudIdentityState =
  | { exists: false }
  | { exists: true; email: string; role: AppRole };

/**
 * Applies what the cloud says about this user, next time the device is online.
 * Missing user → revoked. Changed role → the cached role is replaced (never
 * widened locally). Success → the offline grace window restarts.
 */
export function reconcileIdentity(
  db: LocalDb,
  userId: string,
  cloud: CloudIdentityState,
  at = new Date(),
): IdentityRow | null {
  const identity = readIdentity(db, userId);
  if (!identity) return null;
  if (!cloud.exists) {
    revokeIdentity(db, userId, at);
    return readIdentity(db, userId);
  }
  db.exec({
    sql: `UPDATE ${IDENTITY_TABLE}
          SET email = ?, role = ?, last_online_at = ?, revoked_at = NULL, failed_attempts = 0
          WHERE user_id = ?`,
    bind: [cloud.email, cloud.role, at.toISOString(), userId],
  } as any);
  return readIdentity(db, userId);
}

/** Offline capability of a cached role. Only ever narrows what the UI allows. */
export function offlineCan(session: SessionRow | null, capability: "read" | "write" | "admin"): boolean {
  if (!session) return false;
  if (capability === "read") return true;
  if (capability === "write") return session.role === "admin" || session.role === "staff";
  return session.role === "admin";
}
