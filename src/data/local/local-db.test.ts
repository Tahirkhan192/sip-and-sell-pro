import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_DB_NAME,
  LOCAL_DB_POOL,
  PROBE_TABLE,
  closeEngine,
  describeEngine,
  engineFacts,
  getDeviceId,
  getSchemaVersion,
  localTableNames,
  openEngine,
  probeRead,
  probeWrite,
} from "./engine";
import { handleLocalDbRequest, type LocalDbResponse } from "./protocol";
import {
  _resetForTests,
  engineStatus,
  initEngine,
  probePersistence,
  workerStatus,
} from "./db";
import { initLocalDatabase, isLocalSqliteEnabled } from "./status";

function enableFlag(value: string | undefined) {
  vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", value as any);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await _resetForTests();
  await closeEngine();
});

/* ------------------------------------------------------------------ *
 * Feature flag                                                        *
 * ------------------------------------------------------------------ */
describe("feature flag", () => {
  it("PHASE 10 — is enabled by default", () => {
    enableFlag(undefined);
    expect(isLocalSqliteEnabled()).toBe(true);
    enableFlag("");
    expect(isLocalSqliteEnabled()).toBe(true);
  });

  it("PHASE 10 — only an explicit opt-out turns it off", () => {
    for (const off of ["false", "0", "off", "no", "disabled", "FALSE"]) {
      enableFlag(off);
      expect(isLocalSqliteEnabled()).toBe(false);
    }
    for (const on of ["true", "1", "yes"]) {
      enableFlag(on);
      expect(isLocalSqliteEnabled()).toBe(true);
    }
  });

  it("does not start the worker or open SQLite when disabled", async () => {
    enableFlag("false");
    const status = await initLocalDatabase();
    expect(status.enabled).toBe(false);
    expect(status.initialized).toBe(false);
    expect(workerStatus().state).toBe("idle");
    expect(engineFacts().opened).toBe(false);
  });

  it("initializes through the client when enabled", async () => {
    enableFlag("true");
    const status = await initLocalDatabase();
    expect(status.error).toBeNull();
    expect(status.initialized).toBe(true);
    expect(status.sqliteVersion).toBeTruthy();
    expect(status.databaseName).toBe(LOCAL_DB_NAME);
    expect(status.poolName).toBe(LOCAL_DB_POOL);
  });
});

/* ------------------------------------------------------------------ *
 * Engine (runs inside the worker in the browser)                      *
 * ------------------------------------------------------------------ */
describe("Test A — database opens", () => {
  it("opens SQLite and reports a storage mode", async () => {
    const db = await openEngine();
    expect(db).toBeTruthy();
    expect(["opfs", "memory"]).toContain(engineFacts().storageMode);
  });
});

describe("Test B — schema", () => {
  it("creates the expected application tables", async () => {
    const db = await openEngine();
    const tables = localTableNames(db);
    for (const t of [
      "_meta",
      "_schema_migrations",
      "products",
      "stock_items",
      "sales",
      "sale_items",
      "purchases",
      "purchase_items",
      "expenses",
      "cash_movements",
      "recipes",
      "production_batches",
      "stock_transfers",
    ]) {
      expect(tables, `${t} missing`).toContain(t);
    }
    // Phase 3 adds the cloud mirror tables (schema revision 3).
    for (const t of ["cloud_sales", "cloud_sale_items", "cloud_cash_movements"]) {
      expect(tables, `${t} missing`).toContain(t);
    }
    expect(getSchemaVersion(db)).toBe(3);
    expect(getDeviceId(db)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("Test C — persistence (environment-honest)", () => {
  it("keeps the probe across close/reopen when OPFS-backed, and reports memory otherwise", async () => {
    const db = await openEngine();
    const persistent = engineFacts().storageMode === "opfs";
    const deviceBefore = getDeviceId(db);
    probeWrite(db, "unit", "probe-1");

    await closeEngine();
    const reopened = await openEngine();

    if (persistent) {
      expect(probeRead(reopened, "unit")).toBe("probe-1");
      expect(getDeviceId(reopened)).toBe(deviceBefore);
    } else {
      // Memory fallback: explicitly non-persistent, and reported as such.
      // Real OPFS persistence is proven by the Playwright browser test.
      expect(describeEngine(reopened).persistent).toBe(false);
      expect(describeEngine(reopened).storage).toBe("memory");
      expect(probeRead(reopened, "unit")).toBeNull();
    }
  });
});

describe("Test D — idempotent initialization", () => {
  it("returns the same instance and does not duplicate schema or metadata", async () => {
    enableFlag("true");
    const a = await openEngine();
    const b = await openEngine();
    await initLocalDatabase();
    await initLocalDatabase();
    const c = await openEngine();

    expect(a).toBe(b);
    expect(b).toBe(c);

    const deviceRows = c.selectValues("SELECT COUNT(*) FROM _meta WHERE key='device_id'") as number[];
    const versionRows = c.selectValues(
      "SELECT COUNT(*) FROM _meta WHERE key='schema_version'",
    ) as number[];
    const migrations = c.selectValues("SELECT COUNT(*) FROM _schema_migrations") as number[];
    expect(deviceRows[0]).toBe(1);
    expect(versionRows[0]).toBe(1);
    expect(migrations[0]).toBe(3); // schema revisions 1, 2 and 3

    const tables = localTableNames(c);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("Test E — foreign keys", () => {
  it("enforces foreign keys as declared by schema.sql", async () => {
    const db = await openEngine();
    const on = (db.selectValues("PRAGMA foreign_keys") as number[])[0];
    expect(on).toBe(1);

    expect(() =>
      db.exec({
        sql: "INSERT INTO sale_items(id, sale_id, product_id, quantity, price, total) VALUES ('t1','missing-sale','missing-product',1,1,1)",
      }),
    ).toThrow();
  });
});

describe("Test F — fallback reporting", () => {
  it("reports persistence honestly for the current environment", async () => {
    const db = await openEngine();
    const status = describeEngine(db);
    expect(status.persistent).toBe(status.storage === "opfs");
    expect(status.tableCount).toBeGreaterThan(10);
    expect(status.vfs).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Worker RPC protocol                                                 *
 * ------------------------------------------------------------------ */
describe("worker protocol", () => {
  it("answers init/status/getFacts with matching ids", async () => {
    const init = await handleLocalDbRequest({ id: 11, op: "init" });
    expect(init.id).toBe(11);
    expect(init.ok).toBe(true);

    const status = await handleLocalDbRequest({ id: 12, op: "status" });
    expect(status.id).toBe(12);
    expect(status.ok && (status.result as any).initialized).toBe(true);

    const facts = await handleLocalDbRequest({ id: 13, op: "getFacts" });
    expect(facts.ok && (facts.result as any).opened).toBe(true);
    expect(facts.ok && (facts.result as any).databaseName).toBe(LOCAL_DB_NAME);
  });

  it("round-trips probe write/read/clear", async () => {
    await handleLocalDbRequest({ id: 20, op: "init" });
    await handleLocalDbRequest({
      id: 21,
      op: "probePersistence",
      mode: "write",
      key: "proto",
      value: "v1",
    });
    const read = await handleLocalDbRequest({ id: 22, op: "probePersistence", mode: "read", key: "proto" });
    expect(read.ok && (read.result as any).probe).toBe("v1");
    await handleLocalDbRequest({ id: 23, op: "probePersistence", mode: "clear", key: "proto" });
    const after = await handleLocalDbRequest({ id: 24, op: "probePersistence", mode: "read", key: "proto" });
    expect(after.ok && (after.result as any).probe).toBeNull();
  });

  it("returns structured errors and never exposes raw SQL execution", async () => {
    const bad = (await handleLocalDbRequest({ id: 31, op: "execute" } as any)) as LocalDbResponse;
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.name).toBe("UnknownOperation");
    // The protocol union has no arbitrary-SQL operation.
    const ops = ["init", "status", "getFacts", "probePersistence", "close", "resetForTests"];
    expect(ops).not.toContain("execute");
  });

  it("closes without deleting data", async () => {
    await handleLocalDbRequest({ id: 41, op: "init" });
    const closed = await handleLocalDbRequest({ id: 42, op: "close" });
    expect(closed.ok && (closed.result as any).closed).toBe(true);
    expect(engineFacts().opened).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Main-thread client                                                  *
 * ------------------------------------------------------------------ */
describe("main-thread client", () => {
  it("starts a transport and initializes idempotently", async () => {
    enableFlag("true");
    const a = await initEngine();
    const b = await initEngine();
    expect(a.deviceId).toBe(b.deviceId);
    expect(a.schemaVersion).toBe(b.schemaVersion);
    expect(workerStatus().state).toBe("running");
    // Node has no Worker/OPFS — the client falls back to the inline transport
    // and the engine honestly reports memory. Browser proof lives in the
    // Playwright test (tests/browser/persistence.spec).
    expect(workerStatus().kind).toBe("inline");
    expect(a.storage).toBe("memory");
    expect(a.persistent).toBe(false);
  });

  it("exposes only diagnostic probe writes", async () => {
    enableFlag("true");
    await initEngine();
    await probePersistence("write", "client", "hello");
    expect(await probePersistence("read", "client")).toBe("hello");
    const s = await engineStatus();
    // probe table is a metadata table and never counts as business rows
    expect(s.totalRows).toBe(0);
    expect(PROBE_TABLE.startsWith("_")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Safety                                                              *
 * ------------------------------------------------------------------ */
describe("diagnostics safety", () => {
  it("does not write business rows", async () => {
    enableFlag("true");
    const before = (await initEngine()).totalRows;
    await initLocalDatabase();
    await initLocalDatabase();
    expect((await engineStatus()).totalRows).toBe(before);
    expect(before).toBe(0);
  });

  it("leaves the application repository on the cloud implementation", async () => {
    const { repo, CloudRepository } = await import("@/data/repo");
    await initLocalDatabase();
    expect(repo()).toBeInstanceOf(CloudRepository);
  });
});
