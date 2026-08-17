import { afterEach, describe, expect, it, vi } from "vitest";

import { _resetForTests, getDeviceId, getSchemaVersion, localDbFacts, openLocalDb } from "./db";
import {
  describeLocalDb,
  initLocalDatabase,
  isLocalSqliteEnabled,
  localTableNames,
} from "./status";

function enableFlag(value: string | undefined) {
  vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", value as any);
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await _resetForTests();
});

describe("feature flag", () => {
  it("is disabled by default", () => {
    enableFlag(undefined);
    expect(isLocalSqliteEnabled()).toBe(false);
  });

  it("is disabled for any value other than 'true'", () => {
    enableFlag("false");
    expect(isLocalSqliteEnabled()).toBe(false);
    enableFlag("1");
    expect(isLocalSqliteEnabled()).toBe(false);
  });

  it("does not open or use the local database when disabled", async () => {
    enableFlag("false");
    const status = await initLocalDatabase();
    expect(status.enabled).toBe(false);
    expect(status.initialized).toBe(false);
    expect(localDbFacts().opened).toBe(false);
  });

  it("initializes when enabled", async () => {
    enableFlag("true");
    const status = await initLocalDatabase();
    expect(status.error).toBeNull();
    expect(status.initialized).toBe(true);
    expect(status.sqliteVersion).toBeTruthy();
  });
});

describe("Test A — database opens", () => {
  it("opens SQLite and reports a storage mode", async () => {
    const db = await openLocalDb();
    expect(db).toBeTruthy();
    expect(["opfs", "memory"]).toContain(localDbFacts().storageMode);
  });
});

describe("Test B — schema", () => {
  it("creates the expected application tables", async () => {
    const db = await openLocalDb();
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
    expect(getSchemaVersion(db)).toBe(2);
    expect(getDeviceId(db)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("Test C — persistence", () => {
  it("keeps rows across close/reopen when OPFS-backed, and reports memory mode otherwise", async () => {
    const db = await openLocalDb();
    const persistent = localDbFacts().storageMode === "opfs";
    db.exec("CREATE TABLE IF NOT EXISTS _persistence_probe (id TEXT PRIMARY KEY)");
    db.exec({ sql: "INSERT OR REPLACE INTO _persistence_probe(id) VALUES ('probe-1')" });

    await _resetForTests();
    const reopened = await openLocalDb();

    const exists = (reopened.selectValues(
      "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_persistence_probe'",
    ) as number[])[0];

    if (persistent) {
      expect(exists).toBe(1);
      const rows = reopened.selectValues("SELECT id FROM _persistence_probe") as string[];
      expect(rows).toContain("probe-1");
      reopened.exec("DROP TABLE _persistence_probe");
    } else {
      // Memory fallback: explicitly non-persistent, and reported as such.
      expect(describeLocalDb(reopened).persistent).toBe(false);
      expect(exists).toBe(0);
    }
  });
});

describe("Test D — idempotent initialization", () => {
  it("returns the same instance and does not duplicate schema or metadata", async () => {
    enableFlag("true");
    const a = await openLocalDb();
    const b = await openLocalDb();
    await initLocalDatabase();
    await initLocalDatabase();
    const c = await openLocalDb();

    expect(a).toBe(b);
    expect(b).toBe(c);

    const deviceRows = c.selectValues("SELECT COUNT(*) FROM _meta WHERE key='device_id'") as number[];
    const versionRows = c.selectValues("SELECT COUNT(*) FROM _meta WHERE key='schema_version'") as number[];
    const migrations = c.selectValues("SELECT COUNT(*) FROM _schema_migrations") as number[];
    expect(deviceRows[0]).toBe(1);
    expect(versionRows[0]).toBe(1);
    expect(migrations[0]).toBe(2); // schema.sql records revisions 1 and 2

    const tables = localTableNames(c);
    expect(new Set(tables).size).toBe(tables.length);
  });
});

describe("Test E — foreign keys", () => {
  it("enforces foreign keys as declared by schema.sql", async () => {
    const db = await openLocalDb();
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
    const db = await openLocalDb();
    const status = describeLocalDb(db);
    expect(status.persistent).toBe(status.storage === "opfs");
    expect(status.tableCount).toBeGreaterThan(10);
  });
});

describe("diagnostics safety", () => {
  it("does not write business rows", async () => {
    const db = await openLocalDb();
    const before = describeLocalDb(db).totalRows;
    await initLocalDatabase();
    await initLocalDatabase();
    expect(describeLocalDb(db).totalRows).toBe(before);
  });

  it("leaves the application repository on the cloud implementation", async () => {
    const { repo, CloudRepository } = await import("@/data/repo");
    await initLocalDatabase();
    expect(repo()).toBeInstanceOf(CloudRepository);
  });
});
