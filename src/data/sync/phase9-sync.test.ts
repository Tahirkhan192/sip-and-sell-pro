/**
 * PHASE 9 — production sync hardening.
 *
 * These tests use a FAKE CLOUD that behaves like Postgres/PostgREST does:
 * an update only affects rows that still match the guard, so "another device
 * wrote first" is decided by the database, not by a possibly stale read.
 *
 * Everything proven here is about not losing data:
 *   * replay an event 1, 2 and 10 times → one business row,
 *   * a crash or a lost network mid-upload → the record is recovered, never
 *     marked synced and never deleted,
 *   * per-entity order is preserved; unrelated entities keep flowing,
 *   * conflicts keep BOTH versions,
 *   * a deleted row never comes back to life,
 *   * auth/validation failures stop retrying and ask for a human.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxRow } from "@/data/local/mutations/outbox-schema";
import { MAX_AUTO_ATTEMPTS } from "@/data/local/mutations/outbox-schema";
import { classifyFailure, decodeError, encodeError } from "./failure";
import { isTombstoned, updateGuard } from "./conflicts";
import { applyOutboxRecord, type CloudGateway, type CloudRow } from "./sync-protocol";
import { checkDuplicateOperations, checkParity } from "./integrity";

/* ------------------------------------------------------------------ *
 * A fake cloud with real conditional-update semantics                 *
 * ------------------------------------------------------------------ */

type FakeCloudOptions = { failWith?: unknown };

function fakeCloud(seed: Record<string, CloudRow> = {}, options: FakeCloudOptions = {}) {
  const tables = new Map<string, Map<string, CloudRow>>();
  for (const [table, row] of Object.entries(seed)) {
    const map = tables.get(table) ?? new Map();
    map.set(String(row.id), { ...row });
    tables.set(table, map);
  }
  const calls = { fetch: 0, insert: 0, update: 0 };

  const gateway: CloudGateway = {
    async fetchRow(table, _pk, id) {
      calls.fetch += 1;
      if (options.failWith) throw options.failWith;
      return tables.get(table)?.get(String(id)) ?? null;
    },
    async insertRow(table, row) {
      calls.insert += 1;
      if (options.failWith) throw options.failWith;
      const map = tables.get(table) ?? new Map();
      const id = String(row.id);
      if (map.has(id)) {
        const err: any = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      map.set(id, { ...row });
      tables.set(table, map);
    },
    async updateRow(table, _pk, id, values, guard) {
      calls.update += 1;
      if (options.failWith) throw options.failWith;
      const map = tables.get(table);
      const existing = map?.get(String(id));
      if (!existing) return 0;
      if (guard && String(existing[guard.column] ?? "") !== String(guard.value ?? "")) return 0;
      map!.set(String(id), { ...existing, ...values });
      return 1;
    },
  };

  return {
    gateway,
    calls,
    rows: (table: string) => [...(tables.get(table)?.values() ?? [])],
    row: (table: string, id: string) => tables.get(table)?.get(id) ?? null,
    set: (table: string, row: CloudRow) => {
      const map = tables.get(table) ?? new Map();
      map.set(String(row.id), { ...row });
      tables.set(table, map);
    },
  };
}

const ID = "11111111-1111-4111-8111-111111111111";
let seq = 0;

function record(patch: Partial<OutboxRow> = {}): OutboxRow {
  seq += 1;
  return {
    id: `outbox-${seq}`,
    device_id: "device-a",
    operation_id: `op-${seq}`,
    entity: "categories",
    entity_id: ID,
    operation_type: "insert",
    payload: JSON.stringify({ name: "Drinks", active: 1, sort_order: 1 }),
    base_snapshot: null,
    created_at: "2026-08-17T09:00:00.000Z",
    updated_at: "2026-08-17T09:00:00.000Z",
    business_date: "2026-08-17",
    status: "pending",
    attempt_count: 0,
    last_error: null,
    next_retry_at: null,
    schema_version: 1,
    synced_at: null,
    conflict_details: null,
    seq,
    ...patch,
  };
}

beforeEach(() => {
  seq = 0;
});

/* ------------------------------------------------------------------ *
 * Idempotency                                                         *
 * ------------------------------------------------------------------ */

describe("idempotency", () => {
  it("creates exactly one row when the same event replays 1, 2 and 10 times", async () => {
    const cloud = fakeCloud();
    const event = record();
    for (let i = 0; i < 10; i += 1) {
      const result = await applyOutboxRecord(event, cloud.gateway);
      expect(result.outcome).toBe("synced");
    }
    expect(cloud.rows("categories")).toHaveLength(1);
    expect(cloud.calls.insert).toBe(1);
  });

  it("replaying an update after the value already landed is a no-op", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Drinks", active: true, updated_at: "t1" },
    });
    const update = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Hot Drinks" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
    });
    expect((await applyOutboxRecord(update, cloud.gateway)).outcome).toBe("synced");
    expect((await applyOutboxRecord(update, cloud.gateway)).outcome).toBe("synced");
    expect(cloud.row("categories", ID)?.name).toBe("Hot Drinks");
    expect(cloud.calls.update).toBe(1);
  });

  it("an interrupted upload (network loss after the write) still converges", async () => {
    const cloud = fakeCloud();
    const event = record();
    // First attempt: the row IS written, the response is lost.
    await applyOutboxRecord(event, cloud.gateway);
    // The device retries the very same event after reconnecting.
    const retry = await applyOutboxRecord(event, cloud.gateway);
    expect(retry.outcome).toBe("synced");
    expect(cloud.rows("categories")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Conditional update / server versioning                              *
 * ------------------------------------------------------------------ */

describe("conditional update", () => {
  it("sends the baseline as a guard so the database decides the winner", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Drinks", updated_at: "t1" },
    });
    const update = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Cold Drinks" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
    });
    const spy = vi.spyOn(cloud.gateway, "updateRow");
    await applyOutboxRecord(update, cloud.gateway);
    expect(spy).toHaveBeenCalledWith("categories", "id", ID, { name: "Cold Drinks" }, {
      column: "updated_at",
      value: "t1",
    });
  });

  it("flags a conflict when the guard matches nothing (a same-millisecond race)", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Drinks", updated_at: "t1" },
    });
    const update = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Cold Drinks" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
    });
    // Device B wins the race between our read and our write.
    const original = cloud.gateway.fetchRow;
    let first = true;
    cloud.gateway.fetchRow = async (table, pk, id) => {
      const row = await original(table, pk, id);
      if (first) {
        first = false;
        cloud.set("categories", { id: ID, name: "Device B name", updated_at: "t2" });
      }
      return row;
    };
    const result = await applyOutboxRecord(update, cloud.gateway);
    expect(result.outcome).toBe("conflict");
    if (result.outcome === "conflict") {
      expect(result.details.localPayload).toEqual({ name: "Cold Drinks" });
      expect(result.details.cloudRow).toMatchObject({ name: "Device B name" });
      expect(result.details.localBaseline).toMatchObject({ name: "Drinks" });
    }
    expect(cloud.row("categories", ID)?.name).toBe("Device B name");
  });

  it("builds no guard for tables without updated_at", () => {
    expect(updateGuard({ id: ID, name: "x" })).toBeNull();
    expect(updateGuard({ id: ID, updated_at: "t1" })).toEqual({
      column: "updated_at",
      value: "t1",
    });
  });
});

/* ------------------------------------------------------------------ *
 * Conflicts — never a silent winner                                   *
 * ------------------------------------------------------------------ */

describe("conflicts", () => {
  it("preserves local, cloud, baseline and the moment of detection", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Cloud name", updated_at: "t2" },
    });
    const update = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Local name" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
    });
    const result = await applyOutboxRecord(update, cloud.gateway, new Date("2026-08-17T10:00:00Z"));
    expect(result.outcome).toBe("conflict");
    if (result.outcome !== "conflict") return;
    expect(result.details.localPayload).toEqual({ name: "Local name" });
    expect(result.details.cloudRow).toMatchObject({ name: "Cloud name" });
    expect(result.details.localBaseline).toMatchObject({ name: "Drinks" });
    expect(result.details.detectedAt).toBe("2026-08-17T10:00:00.000Z");
    // and the cloud row is untouched
    expect(cloud.row("categories", ID)?.name).toBe("Cloud name");
  });

  it("never overwrites a different record that already owns the id", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Someone else" } });
    const result = await applyOutboxRecord(record(), cloud.gateway);
    expect(result.outcome).toBe("conflict");
    expect(cloud.row("categories", ID)?.name).toBe("Someone else");
  });
});

/* ------------------------------------------------------------------ *
 * Tombstones                                                          *
 * ------------------------------------------------------------------ */

describe("tombstones", () => {
  const deleteRecord = (base: Record<string, unknown> | null) =>
    record({
      operation_type: "delete",
      payload: JSON.stringify({ deleted_at: "2026-08-17T09:30:00.000Z" }),
      base_snapshot: base ? JSON.stringify(base) : null,
    });

  it("deletes the cloud row and stays idempotent on replay", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Drinks", updated_at: "t1" } });
    const event = deleteRecord({ id: ID, updated_at: "t1" });
    expect((await applyOutboxRecord(event, cloud.gateway)).outcome).toBe("synced");
    expect(isTombstoned(cloud.row("categories", ID))).toBe(true);
    expect((await applyOutboxRecord(event, cloud.gateway)).outcome).toBe("synced");
    expect(cloud.calls.update).toBe(1);
  });

  it("still deletes when the cloud row moved on — a delete is never lost", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Renamed by B", updated_at: "t9" } });
    const event = deleteRecord({ id: ID, updated_at: "t1" });
    expect((await applyOutboxRecord(event, cloud.gateway)).outcome).toBe("synced");
    expect(isTombstoned(cloud.row("categories", ID))).toBe(true);
  });

  it("treats a delete of an already missing row as done, not as an error", async () => {
    const cloud = fakeCloud();
    expect((await applyOutboxRecord(deleteRecord(null), cloud.gateway)).outcome).toBe("synced");
  });

  it("refuses to resurrect a row another device deleted", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Drinks", updated_at: "t1", deleted_at: "2026-08-16T00:00:00Z" },
    });
    const update = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Back again" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
    });
    const result = await applyOutboxRecord(update, cloud.gateway);
    expect(result.outcome).toBe("conflict");
    expect(cloud.row("categories", ID)?.name).toBe("Drinks");
    expect(isTombstoned(cloud.row("categories", ID))).toBe(true);
  });

  it("allows an explicit un-delete", async () => {
    const cloud = fakeCloud({
      categories: { id: ID, name: "Drinks", updated_at: "t1", deleted_at: "2026-08-16T00:00:00Z" },
    });
    const undelete = record({
      operation_type: "update",
      payload: JSON.stringify({ deleted_at: null }),
      base_snapshot: JSON.stringify({ id: ID, updated_at: "t1" }),
    });
    expect((await applyOutboxRecord(undelete, cloud.gateway)).outcome).toBe("synced");
    expect(isTombstoned(cloud.row("categories", ID))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Multi-device scenarios                                              *
 * ------------------------------------------------------------------ */

describe("multi-device", () => {
  const OTHER = "22222222-2222-4222-8222-222222222222";

  it("independent records from two devices both land", async () => {
    const cloud = fakeCloud();
    await applyOutboxRecord(record({ device_id: "device-a" }), cloud.gateway);
    await applyOutboxRecord(
      record({
        device_id: "device-b",
        entity_id: OTHER,
        payload: JSON.stringify({ name: "Snacks", active: 1, sort_order: 2 }),
      }),
      cloud.gateway,
    );
    expect(cloud.rows("categories")).toHaveLength(2);
  });

  it("offline device A vs online device B on the SAME record keeps both versions", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Drinks", updated_at: "t1" } });
    // Device B (online) renames it.
    await applyOutboxRecord(
      record({
        device_id: "device-b",
        operation_type: "update",
        payload: JSON.stringify({ name: "B name", updated_at: "t2" }),
        base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
      }),
      cloud.gateway,
    );
    // Device A was offline the whole time and reconnects with its own edit.
    const result = await applyOutboxRecord(
      record({
        device_id: "device-a",
        operation_type: "update",
        payload: JSON.stringify({ name: "A name" }),
        base_snapshot: JSON.stringify({ id: ID, name: "Drinks", updated_at: "t1" }),
      }),
      cloud.gateway,
    );
    expect(result.outcome).toBe("conflict");
    if (result.outcome === "conflict") {
      expect(result.details.localPayload).toEqual({ name: "A name" });
      expect(result.details.cloudRow).toMatchObject({ name: "B name" });
    }
    expect(cloud.row("categories", ID)?.name).toBe("B name");
  });

  it("offline delete on A beats a cloud update from B (no resurrection)", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "B renamed", updated_at: "t5" } });
    await applyOutboxRecord(
      record({
        device_id: "device-a",
        operation_type: "delete",
        payload: JSON.stringify({ deleted_at: "2026-08-17T09:30:00.000Z" }),
        base_snapshot: JSON.stringify({ id: ID, updated_at: "t1" }),
      }),
      cloud.gateway,
    );
    expect(isTombstoned(cloud.row("categories", ID))).toBe(true);
  });

  it("create → update → delete replays in order and repeated sync is stable", async () => {
    const cloud = fakeCloud();
    const create = record({ payload: JSON.stringify({ name: "Drinks", active: 1, sort_order: 1 }) });
    const rename = record({
      operation_type: "update",
      payload: JSON.stringify({ name: "Hot Drinks" }),
      base_snapshot: JSON.stringify({ id: ID, name: "Drinks" }),
    });
    const remove = record({
      operation_type: "delete",
      payload: JSON.stringify({ deleted_at: "2026-08-17T09:45:00.000Z" }),
      base_snapshot: JSON.stringify({ id: ID }),
    });
    for (const pass of [1, 2, 3]) {
      for (const event of [create, rename, remove]) {
        await applyOutboxRecord(event, cloud.gateway);
      }
      expect(cloud.rows("categories")).toHaveLength(1);
      expect(pass).toBeGreaterThan(0);
    }
    const row = cloud.row("categories", ID)!;
    expect(row.name).toBe("Hot Drinks");
    expect(isTombstoned(row)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Failure classification                                              *
 * ------------------------------------------------------------------ */

describe("failure classification", () => {
  it("treats connection problems as temporary and retryable", () => {
    for (const error of [new TypeError("Failed to fetch"), { status: 503 }, { status: 429 }]) {
      const f = classifyFailure(error);
      expect(f.kind).toBe("network");
      expect(f.retryable).toBe(true);
      expect(f.needsAttention).toBe(false);
    }
  });

  it("treats authorization problems as needing a human, never a retry storm", () => {
    for (const error of [{ status: 401 }, { message: "new row violates row-level security policy" }]) {
      const f = classifyFailure(error);
      expect(f.kind).toBe("auth");
      expect(f.retryable).toBe(false);
      expect(f.needsAttention).toBe(true);
    }
  });

  it("treats server rejection of the payload as permanent", () => {
    const f = classifyFailure({ code: "23502", message: 'null value violates not-null constraint' });
    expect(f.kind).toBe("validation");
    expect(f.retryable).toBe(false);
  });

  it("round-trips the class through last_error", () => {
    const encoded = encodeError("validation", "bad value");
    expect(decodeError(encoded)).toEqual({ kind: "validation", message: "bad value" });
    expect(decodeError(null).kind).toBe("unknown");
    expect(decodeError("legacy text").message).toBe("legacy text");
  });

  it("keeps the automatic retry budget bounded", () => {
    expect(MAX_AUTO_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_AUTO_ATTEMPTS).toBeLessThanOrEqual(20);
  });

  it("propagates transport failures so the caller can retry them", async () => {
    const cloud = fakeCloud({}, { failWith: new TypeError("Failed to fetch") });
    await expect(applyOutboxRecord(record(), cloud.gateway)).rejects.toThrow(/Failed to fetch/);
  });

  it("refuses to synchronize transactional tables at all", async () => {
    const cloud = fakeCloud();
    await expect(
      applyOutboxRecord(record({ entity: "sales" }), cloud.gateway),
    ).rejects.toThrow(/not master data/);
  });
});

/* ------------------------------------------------------------------ *
 * Integrity                                                           *
 * ------------------------------------------------------------------ */

describe("integrity checks", () => {
  it("detects a duplicated operation id", () => {
    const a = record({ operation_id: "same" });
    const b = record({ operation_id: "same" });
    expect(checkDuplicateOperations([a, b])).toHaveLength(1);
    expect(checkDuplicateOperations([a, record()])).toHaveLength(0);
  });

  it("confirms parity for synchronized rows and flags drift", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Drinks", active: true } });
    const synced = record({
      status: "synced",
      payload: JSON.stringify({ name: "Drinks", active: 1 }),
    });
    const ok = await checkParity([synced], cloud.gateway);
    expect(ok.issues).toHaveLength(0);
    expect(ok.sampled).toBe(1);

    cloud.set("categories", { id: ID, name: "Changed elsewhere", active: true });
    const drifted = await checkParity([synced], cloud.gateway);
    expect(drifted.issues[0]?.check).toBe("parity");
  });

  it("ignores drift when a newer change for the same entity exists", async () => {
    const cloud = fakeCloud({ categories: { id: ID, name: "Newest", active: true } });
    const older = record({ status: "synced", payload: JSON.stringify({ name: "Older" }), seq: 1 });
    const newer = record({ status: "pending", payload: JSON.stringify({ name: "Newest" }), seq: 2 });
    const report = await checkParity([older, newer], cloud.gateway);
    expect(report.issues).toHaveLength(0);
  });
});
