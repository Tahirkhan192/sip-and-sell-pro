/**
 * PHASE 5L — offline auth foundation, against real SQLite.
 *
 * Every safety property of the design is asserted here: no plaintext secret,
 * no token storage, enrolment only while online, wrong code rejected, lockout,
 * expiry of the offline grace window, session expiry, logout invalidation,
 * revocation on reconcile, and roles that only ever narrow.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeEngine, openEngine, type LocalDb } from "../local/engine";
import {
  IDENTITY_TABLE,
  OfflineAuthError,
  SESSION_TABLE,
  assertNoSecrets,
  currentSession,
  endSession,
  ensureOfflineAuthSchema,
  enrolIdentity,
  graceExpired,
  offlineCan,
  readIdentity,
  reconcileIdentity,
  unlockOffline,
} from "./offline-identity";

let db: LocalDb;
const DEVICE = "device-5l";
const PIN = "4821-secret";
const ITER = 1_000; // keep tests fast; production uses 210k

beforeAll(async () => {
  db = await openEngine();
  ensureOfflineAuthSchema(db);
});

afterAll(async () => {
  await closeEngine();
});

async function enrol(userId: string, email: string, role: any = "staff", at = new Date("2026-03-01T08:00:00Z")) {
  return enrolIdentity(db, {
    userId,
    email,
    role,
    unlockSecret: PIN,
    online: true,
    iterations: ITER,
    at,
  });
}

describe("Phase 5L — offline identity", () => {
  it("refuses to enrol a device that is not online", async () => {
    await expect(
      enrolIdentity(db, {
        userId: "u-off",
        email: "off@example.com",
        role: "staff",
        unlockSecret: PIN,
        online: false,
        iterations: ITER,
      }),
    ).rejects.toBeInstanceOf(OfflineAuthError);
    expect(readIdentity(db, "u-off")).toBeNull();
  });

  it("never stores the unlock code in any column", async () => {
    await enrol("u1", "one@example.com");
    const row = readIdentity(db, "u1")!;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(PIN);
    expect(row.secret_hash).toHaveLength(64);
    expect(row.salt.length).toBeGreaterThan(16);
  });

  it("rejects anything that looks like a token, key or password material", () => {
    expect(() => assertNoSecrets("eyJhbGciOiJIUzI1NiJ9.abc")).toThrow(OfflineAuthError);
    expect(() => assertNoSecrets("sb_secret_abc123")).toThrow(OfflineAuthError);
    expect(() => assertNoSecrets({ refresh_token: "x" })).toThrow(OfflineAuthError);
    expect(() => assertNoSecrets("1234")).not.toThrow();
  });

  it("unlocks offline with the right code and issues a session", async () => {
    await enrol("u2", "two@example.com");
    const session = await unlockOffline(db, {
      email: "two@example.com",
      unlockSecret: PIN,
      deviceId: DEVICE,
      at: new Date("2026-03-02T08:00:00Z"),
    });
    expect(session.origin).toBe("offline");
    expect(session.role).toBe("staff");
    expect(currentSession(db, DEVICE, new Date("2026-03-02T09:00:00Z"))!.id).toBe(session.id);
  });

  it("rejects the wrong unlock code and counts the attempt", async () => {
    await enrol("u3", "three@example.com");
    await expect(
      unlockOffline(db, {
        email: "three@example.com",
        unlockSecret: "wrong",
        deviceId: DEVICE,
        at: new Date("2026-03-02T08:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "BAD_CREDENTIAL" });
    expect(readIdentity(db, "u3")!.failed_attempts).toBe(1);
  });

  it("locks the device out after too many failed attempts", async () => {
    await enrol("u4", "four@example.com");
    db.exec({
      sql: `UPDATE ${IDENTITY_TABLE} SET failed_attempts = 10 WHERE user_id = ?`,
      bind: ["u4"],
    } as any);
    await expect(
      unlockOffline(db, {
        email: "four@example.com",
        unlockSecret: PIN,
        deviceId: DEVICE,
        at: new Date("2026-03-02T08:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "LOCKED_OUT" });
  });

  it("stops offline access once the grace window has passed", async () => {
    const identity = await enrol("u5", "five@example.com");
    expect(graceExpired(identity, new Date("2026-03-10T08:00:00Z"))).toBe(false);
    expect(graceExpired(identity, new Date("2026-04-10T08:00:00Z"))).toBe(true);
    await expect(
      unlockOffline(db, {
        email: "five@example.com",
        unlockSecret: PIN,
        deviceId: DEVICE,
        at: new Date("2026-04-10T08:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "GRACE_EXPIRED" });
  });

  it("logout invalidates the local session immediately", async () => {
    await enrol("u6", "six@example.com");
    const s = await unlockOffline(db, {
      email: "six@example.com",
      unlockSecret: PIN,
      deviceId: "device-logout",
      at: new Date("2026-03-02T08:00:00Z"),
    });
    endSession(db, s.id, new Date("2026-03-02T08:30:00Z"));
    expect(currentSession(db, "device-logout", new Date("2026-03-02T09:00:00Z"))).toBeNull();
  });

  it("an expired session is never returned as current", async () => {
    await enrol("u7", "seven@example.com");
    const s = await unlockOffline(db, {
      email: "seven@example.com",
      unlockSecret: PIN,
      deviceId: "device-expiry",
      at: new Date("2026-03-02T08:00:00Z"),
    });
    expect(currentSession(db, "device-expiry", new Date("2026-03-02T19:00:00Z"))!.id).toBe(s.id);
    expect(currentSession(db, "device-expiry", new Date("2026-03-03T09:00:00Z"))).toBeNull();
  });

  it("reconcile revokes an account the cloud no longer has, and kills its sessions", async () => {
    await enrol("u8", "eight@example.com");
    await unlockOffline(db, {
      email: "eight@example.com",
      unlockSecret: PIN,
      deviceId: "device-revoke",
      at: new Date("2026-03-02T08:00:00Z"),
    });
    reconcileIdentity(db, "u8", { exists: false }, new Date("2026-03-03T08:00:00Z"));
    expect(readIdentity(db, "u8")!.revoked_at).not.toBeNull();
    expect(currentSession(db, "device-revoke", new Date("2026-03-02T09:00:00Z"))).toBeNull();
    await expect(
      unlockOffline(db, {
        email: "eight@example.com",
        unlockSecret: PIN,
        deviceId: "device-revoke",
        at: new Date("2026-03-03T09:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "REVOKED" });
  });

  it("reconcile applies the cloud role and restarts the grace window", async () => {
    await enrol("u9", "nine@example.com", "admin");
    const updated = reconcileIdentity(
      db,
      "u9",
      { exists: true, email: "nine@example.com", role: "staff" },
      new Date("2026-03-20T08:00:00Z"),
    )!;
    expect(updated.role).toBe("staff");
    expect(updated.last_online_at).toBe("2026-03-20T08:00:00.000Z");
    const session = await unlockOffline(db, {
      email: "nine@example.com",
      unlockSecret: PIN,
      deviceId: "device-role",
      at: new Date("2026-03-21T08:00:00Z"),
    });
    expect(session.role).toBe("staff");
    expect(offlineCan(session, "admin")).toBe(false);
    expect(offlineCan(session, "write")).toBe(true);
    expect(offlineCan(null, "read")).toBe(false);
  });

  it("stores no session token — only ids, role, timestamps and origin", () => {
    const cols = (db.selectObjects(`PRAGMA table_info(${SESSION_TABLE})`) as any[]).map((c) =>
      String(c.name),
    );
    expect(cols).toEqual([
      "id",
      "user_id",
      "role",
      "device_id",
      "created_at",
      "expires_at",
      "revoked_at",
      "origin",
    ]);
  });
});
