/**
 * PHASE 5A — local transaction + business-logic foundation tests.
 *
 * These run in Node (vitest), so the SQLite worker is not available. Every
 * test therefore targets the pure foundation (ids, timestamps, business-date
 * parity, metadata/redaction/hashing, error classification, flag gating,
 * calculation-parity harness) plus the guarantee that with default flags NO
 * local write path can execute.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import { compareCalculation, compareRowSets, compareValues } from "@/data/repo/calc-parity";
import { READ_ONLY_MESSAGE, LocalRepository } from "@/data/repo/local-repository";
import {
  businessToday,
  endOfBusinessMonth,
  setBusinessConfig,
  startOfBusinessMonth,
} from "@/lib/business-date";

import {
  BUSINESS_WRITES_ENABLED,
  assertBusinessWritesEnabled,
  assertLocalWritesEnabled,
  isLocalWritesEnabled,
} from "./flags";
import {
  LOCAL_MUTATION_ERROR_CODES,
  LocalMutationError,
  classifyLocalError,
  friendlyMessage,
} from "./errors";
import { newMutationId, newUuid } from "./ids";
import {
  buildMutationMetadata,
  canonicalPayload,
  isForbiddenKey,
  metadataToEventRow,
  payloadHash,
  redactPayload,
  REDACTED,
} from "./metadata";
import {
  localBusinessDate,
  localBusinessMonthEnd,
  localBusinessMonthStart,
} from "./business-date";
import { businessStamp } from "./timestamps";
import { MUTATION_OPERATIONS, MUTATION_STATUSES, EVENT_TABLE, TEST_TABLE } from "./schema";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe("Phase 5A — UUID generation", () => {
  it("produces RFC 4122 v4 UUIDs", () => {
    expect(newUuid()).toMatch(UUID_V4);
  });

  it("never repeats across many generations", () => {
    const set = new Set(Array.from({ length: 5000 }, () => newUuid()));
    expect(set.size).toBe(5000);
  });

  it("generates distinct mutation ids", () => {
    expect(newMutationId()).not.toBe(newMutationId());
    expect(newMutationId()).toMatch(UUID_V4);
  });
});

describe("Phase 5A — business timestamps", () => {
  it("stamps UTC in ISO form", () => {
    const stamp = businessStamp(new Date("2026-02-03T04:05:06.000Z"));
    expect(stamp.utc).toBe("2026-02-03T04:05:06.000Z");
  });

  it("exposes a business date and a business time", () => {
    const stamp = businessStamp(new Date("2026-02-03T04:05:06.000Z"));
    expect(stamp.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stamp.businessTime).toMatch(/^\d{2}:\d{2}(:\d{2})?$/);
  });

  it("is monotonic for increasing instants", () => {
    const a = businessStamp(new Date("2026-02-03T04:05:06.000Z"));
    const b = businessStamp(new Date("2026-02-03T04:05:07.000Z"));
    expect(a.utc < b.utc).toBe(true);
  });
});

describe("Phase 5A — business-date parity with the cloud rules", () => {
  // The authoritative module holds one shared config; the local layer reads
  // the same one, which is exactly the property under test.
  beforeAll(() => {
    setBusinessConfig({ timezone: "UTC", startHour: 8, startMinute: 0, monthStartDay: 1 });
  });

  it("matches the authoritative helper before the rollover hour", () => {
    const at = new Date("2026-02-03T03:00:00.000Z");
    expect(localBusinessDate(at)).toBe(businessToday(at));
    expect(localBusinessDate(at)).toBe("2026-02-02");
  });

  it("matches the authoritative helper after the rollover hour", () => {
    const at = new Date("2026-02-03T18:00:00.000Z");
    expect(localBusinessDate(at)).toBe(businessToday(at));
    expect(localBusinessDate(at)).toBe("2026-02-03");
  });

  it("rolls a pre-rollover instant back to the previous day", () => {
    const before = localBusinessDate(new Date("2026-02-03T03:00:00.000Z"));
    const after = localBusinessDate(new Date("2026-02-03T18:00:00.000Z"));
    expect(before < after).toBe(true);
  });

  it("matches the authoritative business-month range", () => {
    const d = localBusinessDate(new Date("2026-02-15T12:00:00.000Z"));
    expect(localBusinessMonthStart(d)).toBe(startOfBusinessMonth(d));
    expect(localBusinessMonthEnd(d)).toBe(endOfBusinessMonth(d));
  });

  it("honours a non-default month start day identically to the cloud helper", () => {
    setBusinessConfig({ monthStartDay: 5 });
    const d = "2026-02-03";
    expect(localBusinessMonthStart(d)).toBe(startOfBusinessMonth(d));
    expect(localBusinessMonthStart(d)).toBe("2026-01-05");
    setBusinessConfig({ monthStartDay: 1 });
  });
});

describe("Phase 5A — mutation metadata", () => {
  const base = {
    deviceId: "device-1",
    entityType: "local_test",
    entityId: "entity-1",
    operation: "insert" as const,
    payload: { a: 1, b: 2 },
  };

  it("captures device, entity, operation and schema version", async () => {
    const m = await buildMutationMetadata(base);
    expect(m.deviceId).toBe("device-1");
    expect(m.entityType).toBe("local_test");
    expect(m.entityId).toBe("entity-1");
    expect(m.operation).toBe("insert");
    expect(m.schemaVersion).toBeGreaterThan(0);
  });

  it("captures UTC, business date and business time", async () => {
    const m = await buildMutationMetadata({ ...base, at: new Date("2026-02-03T18:00:00.000Z") });
    expect(m.createdAt).toBe("2026-02-03T18:00:00.000Z");
    expect(m.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.businessTime).toMatch(/^\d{2}:\d{2}/);
  });

  it("defaults to the isolated local_test status", async () => {
    const m = await buildMutationMetadata(base);
    expect(m.status).toBe("local_test");
    expect(MUTATION_STATUSES).toContain(m.status);
    expect(MUTATION_OPERATIONS).toContain(m.operation);
  });

  it("maps cleanly onto the stored event row", async () => {
    const row = metadataToEventRow(await buildMutationMetadata(base));
    expect(Object.keys(row).sort()).toEqual(
      [
        "business_date",
        "business_time",
        "created_at",
        "device_id",
        "entity_id",
        "entity_type",
        "mutation_id",
        "operation",
        "payload_hash",
        "schema_version",
        "status",
      ].sort(),
    );
  });

  it("uses internal, underscore-prefixed table names only", () => {
    expect(TEST_TABLE.startsWith("_local_")).toBe(true);
    expect(EVENT_TABLE.startsWith("_local_")).toBe(true);
  });
});

describe("Phase 5A — payload integrity and credential safety", () => {
  it("hashes the same logical payload identically regardless of key order", async () => {
    expect(await payloadHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      await payloadHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("produces a different hash for different data", async () => {
    expect(await payloadHash({ a: 1 })).not.toBe(await payloadHash({ a: 2 }));
  });

  it("redacts credential-like keys, including nested and in arrays", () => {
    const out: any = redactPayload({
      name: "ok",
      password: "hunter2",
      nested: { api_key: "k", deep: [{ access_token: "t", fine: 1 }] },
    });
    expect(out.name).toBe("ok");
    expect(out.password).toBe(REDACTED);
    expect(out.nested.api_key).toBe(REDACTED);
    expect(out.nested.deep[0].access_token).toBe(REDACTED);
    expect(out.nested.deep[0].fine).toBe(1);
  });

  it("recognises the credential key patterns", () => {
    for (const k of ["password", "secret", "apiKey", "jwt", "authorization", "session_id"]) {
      expect(isForbiddenKey(k)).toBe(true);
    }
    expect(isForbiddenKey("quantity")).toBe(false);
  });

  it("never serializes a redacted secret's value", () => {
    expect(canonicalPayload({ token: "abc123" })).not.toContain("abc123");
  });

  it("hashes redacted payloads consistently", async () => {
    expect(await payloadHash({ token: "one", n: 1 })).toBe(
      await payloadHash({ token: "two", n: 1 }),
    );
  });
});

describe("Phase 5A — error classification", () => {
  it("keeps the code of a LocalMutationError", () => {
    expect(classifyLocalError(new LocalMutationError("NOT_PERSISTENT", "x"))).toBe("NOT_PERSISTENT");
  });

  it("classifies SQLite lock errors", () => {
    expect(classifyLocalError(new Error("SQLITE_BUSY: database is locked"))).toBe("DATABASE_LOCKED");
  });

  it("falls back to UNKNOWN rather than leaking raw SQL text", () => {
    expect(classifyLocalError(new Error("near \"SELECT\": syntax error"))).toBe("UNKNOWN");
  });

  it("has a friendly message for every code", () => {
    for (const code of LOCAL_MUTATION_ERROR_CODES) {
      expect(friendlyMessage(code).length).toBeGreaterThan(0);
    }
  });

  it("marks errors as rolled back by default", () => {
    expect(new LocalMutationError("TRANSACTION_FAILED", "x").rolledBack).toBe(true);
  });
});

describe("Phase 5A — safety gates (default flags)", () => {
  it("PHASE 10 — keeps local writes enabled by default", () => {
    expect(isLocalWritesEnabled()).toBe(true);
  });

  it("refuses to start the mutation engine when explicitly opted out", () => {
    vi.stubEnv("VITE_ENABLE_LOCAL_WRITES", "false");
    expect(isLocalWritesEnabled()).toBe(false);
    expect(() => assertLocalWritesEnabled()).toThrow(LocalMutationError);
    vi.unstubAllEnvs();
  });

  it("blocks real business mutations even if the flags were on", () => {
    expect(BUSINESS_WRITES_ENABLED).toBe(false);
    expect(() => assertBusinessWritesEnabled()).toThrow(/Phase 5B/);
  });

  it("keeps LocalRepository read-only and points at Phase 5B", () => {
    const repo = new LocalRepository();
    expect(READ_ONLY_MESSAGE).toMatch(/read-only/i);
    expect(() => repo.insert("products" as any, {} as any)).toThrow(READ_ONLY_MESSAGE);
    expect(() => repo.update("products" as any, {} as any, {} as any)).toThrow(/Phase 5B/);
    expect(() => repo.remove("products" as any, {} as any)).toThrow(/Phase 5B/);
  });
});

describe("Phase 5A — cloud/local calculation parity harness", () => {
  it("reports identical values as equal", () => {
    expect(compareValues({ total: 10, rows: [1, 2] }, { total: 10, rows: [1, 2] }).equal).toBe(true);
  });

  it("ignores property order", () => {
    expect(compareValues({ a: 1, b: 2 }, { b: 2, a: 1 }).equal).toBe(true);
  });

  it("flags a numeric drift with its path", () => {
    const p = compareValues({ profit: { net: 100 } }, { profit: { net: 99 } });
    expect(p.equal).toBe(false);
    expect(p.differingFields[0].path).toBe("profit.net");
  });

  it("tolerates float noise within epsilon", () => {
    expect(compareValues({ v: 0.1 + 0.2 }, { v: 0.3 }, { epsilon: 1e-9 }).equal).toBe(true);
  });

  it("reports missing and unexpected fields", () => {
    const p = compareValues({ a: 1, b: 2 }, { a: 1, c: 3 });
    expect(p.missingFields).toEqual(["b"]);
    expect(p.unexpectedFields).toEqual(["c"]);
  });

  it("compares computed row sets by key", () => {
    const cloud = [{ id: "1", qty: 2 }, { id: "2", qty: 5 }];
    expect(compareRowSets(cloud, [...cloud].reverse()).equal).toBe(true);
    const bad = compareRowSets(cloud, [{ id: "1", qty: 2 }]);
    expect(bad.equal).toBe(false);
    expect(bad.missingRows).toEqual(["2"]);
  });

  it("does not throw when one side fails, it reports", async () => {
    const report = await compareCalculation(
      "total-sales",
      () => ({ total: 1 }),
      () => {
        throw new Error("no local calculation yet");
      },
    );
    expect(report.ok).toBe(false);
    expect(report.notes.join(" ")).toMatch(/local calculation failed/);
  });
});
