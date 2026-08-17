/**
 * PHASE 5D — sync protocol + conflict rules.
 *
 * These prove the guarantees that matter with real records (no SQLite needed
 * here; the transactional side is covered by the SQLite suite):
 *   * replaying the same operation never creates a duplicate,
 *   * a cloud row that moved on is never overwritten,
 *   * transactional tables are refused outright.
 */

import { describe, expect, it, vi } from "vitest";
import type { OutboxRow } from "@/data/local/mutations/outbox-schema";
import { applyOutboxRecord, decodePayload, type CloudGateway } from "./sync-protocol";
import { detectConflict } from "./conflicts";

function record(patch: Partial<OutboxRow>): OutboxRow {
  return {
    id: "outbox-1",
    device_id: "device-1",
    operation_id: "op-1",
    entity: "categories",
    entity_id: "11111111-1111-4111-8111-111111111111",
    operation_type: "insert",
    payload: JSON.stringify({ name: "Drinks", active: 1, sort_order: 2 }),
    base_snapshot: null,
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
    business_date: "2026-01-01",
    status: "pending",
    attempt_count: 0,
    last_error: null,
    next_retry_at: null,
    schema_version: 1,
    synced_at: null,
    conflict_details: null,
    ...patch,
  };
}

function gateway(row: Record<string, unknown> | null) {
  const insertRow = vi.fn(async () => undefined);
  const updateRow = vi.fn(async () => 1);
  const g: CloudGateway = {
    fetchRow: async () => row,
    insertRow,
    updateRow,
  };
  return { g, insertRow, updateRow };
}

describe("payload decoding", () => {
  it("restores booleans and JSON from their SQLite storage form", () => {
    const decoded = decodePayload(
      "products",
      JSON.stringify({ name: "Tea", active: 1, track_stock: 0, sale_price: 120 }),
    );
    expect(decoded).toMatchObject({ name: "Tea", active: true, track_stock: false, sale_price: 120 });
  });
});

describe("insert idempotency", () => {
  it("inserts once, preserving the locally minted id", async () => {
    const { g, insertRow } = gateway(null);
    const res = await applyOutboxRecord(record({}), g);
    expect(res.outcome).toBe("synced");
    expect(insertRow).toHaveBeenCalledTimes(1);
    expect((insertRow.mock.calls[0] as any)[1].id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("treats a replay of an identical row as already synced", async () => {
    const { g, insertRow } = gateway({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Drinks",
      active: true,
      sort_order: 2,
    });
    const res = await applyOutboxRecord(record({}), g);
    expect(res.outcome).toBe("synced");
    expect(insertRow).not.toHaveBeenCalled();
  });

  it("never overwrites a different cloud row that already owns the id", async () => {
    const { g, insertRow } = gateway({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Snacks",
      active: true,
      sort_order: 9,
    });
    const res = await applyOutboxRecord(record({}), g);
    expect(res.outcome).toBe("conflict");
    expect(insertRow).not.toHaveBeenCalled();
  });
});

describe("update conflict handling", () => {
  const base = { id: "c1", name: "Drinks", updated_at: "2026-01-01T09:00:00Z" };

  it("applies when the cloud row is untouched since the local change", async () => {
    const { g, updateRow } = gateway({ ...base });
    const res = await applyOutboxRecord(
      record({
        operation_type: "update",
        entity_id: "c1",
        payload: JSON.stringify({ name: "Cold Drinks" }),
        base_snapshot: JSON.stringify(base),
      }),
      g,
    );
    expect(res.outcome).toBe("synced");
    expect(updateRow).toHaveBeenCalledWith("categories", "id", "c1", { name: "Cold Drinks" });
  });

  it("keeps both versions when the cloud row changed meanwhile", async () => {
    const { g, updateRow } = gateway({
      ...base,
      name: "Beverages",
      updated_at: "2026-01-01T11:00:00Z",
    });
    const res = await applyOutboxRecord(
      record({
        operation_type: "update",
        entity_id: "c1",
        payload: JSON.stringify({ name: "Cold Drinks" }),
        base_snapshot: JSON.stringify(base),
      }),
      g,
    );
    expect(res.outcome).toBe("conflict");
    expect(updateRow).not.toHaveBeenCalled();
    if (res.outcome === "conflict") {
      expect(res.details.localPayload).toEqual({ name: "Cold Drinks" });
      expect((res.details.cloudRow as any).name).toBe("Beverages");
    }
  });

  it("is idempotent when the cloud already holds the same values", async () => {
    const { g, updateRow } = gateway({
      ...base,
      name: "Cold Drinks",
      updated_at: "2026-01-01T11:00:00Z",
    });
    const res = await applyOutboxRecord(
      record({
        operation_type: "update",
        entity_id: "c1",
        payload: JSON.stringify({ name: "Cold Drinks" }),
        base_snapshot: JSON.stringify(base),
      }),
      g,
    );
    expect(res.outcome).toBe("synced");
    expect(updateRow).not.toHaveBeenCalled();
  });

  it("flags a missing cloud row instead of recreating it", async () => {
    const { g } = gateway(null);
    const res = await applyOutboxRecord(
      record({
        operation_type: "delete",
        entity_id: "c1",
        payload: JSON.stringify({ deleted_at: "2026-01-01T12:00:00Z" }),
        base_snapshot: JSON.stringify(base),
      }),
      g,
    );
    expect(res.outcome).toBe("conflict");
  });
});

describe("tables without updated_at", () => {
  it("compares the changed fields instead", () => {
    const clean = detectConflict({ id: "x", name: "Ali", phone: "1" }, { id: "x", name: "Ali" }, [
      "name",
    ]);
    expect(clean.conflict).toBe(false);

    const dirty = detectConflict({ id: "x", name: "Bilal" }, { id: "x", name: "Ali" }, ["name"]);
    expect(dirty.conflict).toBe(true);
  });

  it("refuses to guess when no baseline was captured", () => {
    expect(detectConflict({ id: "x" }, null, ["name"]).conflict).toBe(true);
  });
});

describe("scope", () => {
  it("refuses transactional entities outright", async () => {
    const { g } = gateway(null);
    await expect(applyOutboxRecord(record({ entity: "sales" }), g)).rejects.toThrow(
      /must never be synchronized/i,
    );
  });
});
