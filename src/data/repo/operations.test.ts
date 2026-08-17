import { describe, expect, it } from "vitest";

import { ENTITY_CLASSIFICATION } from "./entity-classification";
import {
  OPERATION_AUDIT,
  SCREEN_CAPABILITY,
  offlineReadinessPercent,
  operationsByClass,
  type OperationClass,
} from "./operations";

const CLASSES: OperationClass[] = ["LOCAL", "LOCAL+SYNC", "CLOUD", "CLOUD-ONLY"];

describe("PHASE 10 — pre-cutover operation audit", () => {
  it("classifies every operation and leaves no unknown category", () => {
    for (const op of OPERATION_AUDIT) {
      expect(CLASSES).toContain(op.classification);
      expect(op.reason.length).toBeGreaterThan(10);
      expect(op.id).toMatch(/\S/);
    }
  });

  it("has a unique id per operation", () => {
    const ids = OPERATION_AUDIT.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers read/insert/update/delete for every classified table", () => {
    for (const table of Object.keys(ENTITY_CLASSIFICATION)) {
      for (const kind of ["read", "insert", "update", "delete"]) {
        expect(OPERATION_AUDIT.some((o) => o.id === `${table}.${kind}`)).toBe(true);
      }
    }
  });

  it("never marks a cloud-write table as locally writable", () => {
    for (const [table, c] of Object.entries(ENTITY_CLASSIFICATION)) {
      const write = OPERATION_AUDIT.find((o) => o.id === `${table}.update`)!;
      expect(write.classification).toBe(c.write === "local" ? "LOCAL+SYNC" : "CLOUD-ONLY");
    }
  });

  it("groups operations without dropping any", () => {
    const grouped = operationsByClass();
    const total = CLASSES.reduce((s, c) => s + grouped[c].length, 0);
    expect(total).toBe(OPERATION_AUDIT.length);
  });
});

describe("PHASE 10 — offline capability matrix", () => {
  it("classifies every screen, with reasons for anything cloud-bound", () => {
    for (const screen of SCREEN_CAPABILITY) {
      expect(["fully-offline", "partially-offline", "cloud-only"]).toContain(screen.capability);
      if (screen.capability === "fully-offline") {
        expect(screen.cloudOnly).toHaveLength(0);
      } else {
        expect(screen.cloudOnly.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps POS and Purchases explicitly cloud-only", () => {
    for (const path of ["/pos", "/purchases"]) {
      expect(SCREEN_CAPABILITY.find((s) => s.path === path)!.capability).toBe("cloud-only");
    }
  });

  it("reports an honest, non-100% readiness figure", () => {
    const pct = offlineReadinessPercent();
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });
});
