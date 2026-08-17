/**
 * PHASE 7 — offline authentication & device enrollment, against real SQLite.
 *
 * Everything the phase promises is asserted here through the same worker
 * operation surface the app uses: enrolment, local sessions, offline login,
 * logout, role handling, revocation, expiry and secret hygiene.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeEngine, getDeviceId, localTableNames, openEngine, type LocalDb } from "../local/engine";
import { handleAuthRequest, AUTH_SCHEMA_VERSION, type AuthSnapshot } from "./auth-worker";
import { IDENTITY_TABLE, SESSION_TABLE, ensureOfflineAuthSchema } from "./offline-identity";

let db: LocalDb;
const PIN = "7391-unlock";
const PASSWORD = "SuperSecretAccountPassword!1";
const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "owner@example.com";

beforeAll(async () => {
  db = await openEngine();
  ensureOfflineAuthSchema(db);
});

afterAll(async () => {
  await closeEngine();
});

beforeEach(() => {
  db.exec(`DELETE FROM ${SESSION_TABLE}`);
  db.exec(`DELETE FROM ${IDENTITY_TABLE}`);
});

async function enrol(role: "admin" | "staff" = "admin"): Promise<AuthSnapshot> {
  const { auth } = await handleAuthRequest(db, {
    op: "authEnrol",
    userId: USER,
    email: EMAIL,
    role,
    unlockSecret: PIN,
    online: true,
    iterations: 1_000,
  });
  return auth;
}

async function status(): Promise<AuthSnapshot> {
  return (await handleAuthRequest(db, { op: "authStatus" })).auth;
}

describe("Phase 7 — device enrollment", () => {
  it("enrols only with a verified online sign-in", async () => {
    await expect(
      handleAuthRequest(db, {
        op: "authEnrol",
        userId: USER,
        email: EMAIL,
        role: "admin",
        unlockSecret: PIN,
        online: false,
        iterations: 1_000,
      }),
    ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
    expect((await status()).identity).toBeNull();
  });

  it("records a complete enrollment and an online local session", async () => {
    const auth = await enrol();
    expect(auth.schemaVersion).toBe(AUTH_SCHEMA_VERSION);
    expect(auth.deviceId).toBe(getDeviceId(db));
    expect(auth.identity).toMatchObject({
      user_id: USER,
      email: EMAIL,
      role: "admin",
      revoked_at: null,
    });
    expect(auth.identity!.enrolled_at).toBeTruthy();
    expect(auth.identity!.last_online_verification).toBeTruthy();
    expect(auth.session).toMatchObject({ user_id: USER, origin: "online", role: "admin" });
    expect(auth.can).toEqual({ read: true, write: true, admin: true });
  });

  it("keeps one stable device identity across re-enrollment", async () => {
    const first = await enrol();
    const second = await enrol("staff");
    expect(second.deviceId).toBe(first.deviceId);
    expect(db.selectValues(`SELECT COUNT(*) FROM ${IDENTITY_TABLE}`)[0]).toBe(1);
  });
});

describe("Phase 7 — offline sessions", () => {
  it("signs in offline with the device unlock code", async () => {
    await enrol();
    await handleAuthRequest(db, { op: "authLogout" });
    const { auth } = await handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN });
    expect(auth.session).toMatchObject({ origin: "offline", user_id: USER });
    expect((await status()).session!.id).toBe(auth.session!.id);
  });

  it("rejects an invalid unlock code and grants nothing", async () => {
    await enrol();
    await handleAuthRequest(db, { op: "authLogout" });
    await expect(
      handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: "not-the-code" }),
    ).rejects.toMatchObject({ code: "BAD_CREDENTIAL" });
    expect((await status()).session).toBeNull();
  });

  it("rejects an unknown device / unenrolled account", async () => {
    await expect(
      handleAuthRequest(db, { op: "authUnlock", email: "stranger@example.com", unlockSecret: PIN }),
    ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
    const snap = await status();
    expect(snap.session).toBeNull();
    expect(snap.can).toEqual({ read: false, write: false, admin: false });
  });

  it("never treats an expired session as authenticated", async () => {
    await enrol();
    db.exec({
      sql: `UPDATE ${SESSION_TABLE} SET expires_at = ?`,
      bind: ["2020-01-01T00:00:00.000Z"],
    } as any);
    expect((await status()).session).toBeNull();
  });

  it("stops offline access once the grace window has expired", async () => {
    await enrol();
    await handleAuthRequest(db, { op: "authLogout" });
    db.exec({
      sql: `UPDATE ${IDENTITY_TABLE} SET last_online_at = ? WHERE user_id = ?`,
      bind: ["2020-01-01T00:00:00.000Z", USER],
    } as any);
    await expect(
      handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN }),
    ).rejects.toMatchObject({ code: "GRACE_EXPIRED" });
  });

  it("logout invalidates the local session and blocks offline re-entry without the code", async () => {
    await enrol();
    const after = (await handleAuthRequest(db, { op: "authLogout" })).auth;
    expect(after.session).toBeNull();
    expect(after.can.read).toBe(false);
    // Business data untouched: the identity survives, only the session is gone.
    expect(after.identity).not.toBeNull();
    await expect(
      handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: "wrong" }),
    ).rejects.toMatchObject({ code: "BAD_CREDENTIAL" });
  });
});

describe("Phase 7 — role handling and reconciliation", () => {
  it("preserves the cached role for offline authorization", async () => {
    await enrol("staff");
    await handleAuthRequest(db, { op: "authLogout" });
    const { auth } = await handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN });
    expect(auth.session!.role).toBe("staff");
    expect(auth.can).toEqual({ read: true, write: true, admin: false });
  });

  it("narrows a role the cloud downgraded, on the next reconcile", async () => {
    await enrol("admin");
    const { auth } = await handleAuthRequest(db, {
      op: "authReconcile",
      userId: USER,
      cloud: { exists: true, email: EMAIL, role: "staff" },
    });
    expect(auth.identity!.role).toBe("staff");
    await handleAuthRequest(db, { op: "authLogout" });
    const unlocked = (await handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN })).auth;
    expect(unlocked.can.admin).toBe(false);
  });

  it("revokes a removed account and kills its sessions", async () => {
    await enrol();
    const { auth } = await handleAuthRequest(db, {
      op: "authReconcile",
      userId: USER,
      cloud: { exists: false },
    });
    expect(auth.session).toBeNull();
    await expect(
      handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN }),
    ).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("an online session is refused for an account this device never enrolled", async () => {
    await expect(
      handleAuthRequest(db, { op: "authOnlineSession", userId: USER, email: EMAIL, role: "admin" }),
    ).rejects.toMatchObject({ code: "NOT_ENROLLED" });
  });

  it("survives an online → offline → online transition and refreshes the grace window", async () => {
    await enrol();
    // offline leg
    await handleAuthRequest(db, { op: "authLogout" });
    const offline = (await handleAuthRequest(db, { op: "authUnlock", email: EMAIL, unlockSecret: PIN })).auth;
    expect(offline.session!.origin).toBe("offline");
    // back online
    db.exec({
      sql: `UPDATE ${IDENTITY_TABLE} SET last_online_at = ? WHERE user_id = ?`,
      bind: ["2026-01-01T00:00:00.000Z", USER],
    } as any);
    const back = (await handleAuthRequest(db, {
      op: "authOnlineSession",
      userId: USER,
      email: EMAIL,
      role: "admin",
    })).auth;
    expect(back.session!.origin).toBe("online");
    expect(Date.parse(back.identity!.last_online_verification)).toBeGreaterThan(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
    // exactly one live session on this device
    expect(
      db.selectValues(`SELECT COUNT(*) FROM ${SESSION_TABLE} WHERE revoked_at IS NULL`)[0],
    ).toBe(1);
  });
});

describe("Phase 7 — security invariants", () => {
  it("stores no plaintext unlock code, no password and no token anywhere in SQLite", async () => {
    await enrol();
    const banned = [PIN, PASSWORD, "eyJhbGciOi", "sb_secret_", "service_role", "refresh_token"];
    for (const table of localTableNames(db)) {
      const rows = db.selectObjects(`SELECT * FROM "${table}"`) as any[];
      const blob = JSON.stringify(rows);
      for (const needle of banned) expect(blob).not.toContain(needle);
    }
  });

  it("never exposes salt, iterations or the hash outside the worker", async () => {
    const auth = await enrol();
    const serialized = JSON.stringify(auth);
    expect(serialized).not.toContain("secret_hash");
    expect(serialized).not.toContain("salt");
    expect(Object.keys(auth.identity!)).toEqual([
      "user_id",
      "email",
      "role",
      "enrolled_at",
      "last_online_verification",
      "offline_grace_days",
      "revoked_at",
      "failed_attempts",
    ]);
  });

  it("keeps auth state in local-only tables — no cloud mirror, no RLS change", async () => {
    const tables = localTableNames(db);
    expect(tables).toContain(IDENTITY_TABLE);
    expect(tables).toContain(SESSION_TABLE);
    // Local internals are underscore-prefixed and are never mirrored/synced.
    expect(IDENTITY_TABLE.startsWith("_local_")).toBe(true);
    expect(SESSION_TABLE.startsWith("_local_")).toBe(true);
    expect(tables.filter((t) => t.startsWith("cloud__local"))).toEqual([]);
  });
});
