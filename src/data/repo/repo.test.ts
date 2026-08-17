/**
 * PHASE 4 — LocalRepository, health gate, repository selection and
 * cloud/local parity.
 *
 * The Supabase client is faked (no network, no real business data). The local
 * SQLite engine is the real one, seeded through the real Phase 3 seed. In Node
 * there is no OPFS, so the health gate honestly reports "not persistent"; the
 * tests that need a healthy mirror stub only that single fact and leave every
 * other check real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- fake cloud ---------------- */

type Row = Record<string, any>;
const cloud: Record<string, Row[]> = {};
let session: any = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    from(table: string) {
      const base = () => (cloud[table] ?? []).slice();
      const b: any = {
        _filters: [] as ((r: Row) => boolean)[],
        _order: [] as { c: string; asc: boolean }[],
        _limit: null as number | null,
        _range: null as [number, number] | null,
        _gt: null as any,
        _head: false,
        _single: false,
        select(_c?: string, opts?: any) {
          if (opts?.head) {
            this._head = true;
            return Promise.resolve({ count: this._rows().length, error: null });
          }
          this._columns = _c;
          return this;
        },
        eq(c: string, v: any) {
          this._filters.push((r: Row) => r[c] === v);
          return this;
        },
        neq(c: string, v: any) {
          this._filters.push((r: Row) => r[c] !== v);
          return this;
        },
        gte(c: string, v: any) {
          this._filters.push((r: Row) => r[c] >= v);
          return this;
        },
        lte(c: string, v: any) {
          this._filters.push((r: Row) => r[c] <= v);
          return this;
        },
        in(c: string, vs: any[]) {
          this._filters.push((r: Row) => vs.includes(r[c]));
          return this;
        },
        is(c: string, v: any) {
          this._filters.push((r: Row) => (v === null ? r[c] === null : r[c] === v));
          return this;
        },
        not(c: string, _op: string, _v: any) {
          this._filters.push((r: Row) => r[c] !== null);
          return this;
        },
        order(c: string, opts?: any) {
          this._order.push({ c, asc: opts?.ascending ?? true });
          return this;
        },
        limit(n: number) {
          this._limit = n;
          return this;
        },
        gt(_c: string, v: any) {
          this._gt = v;
          return this;
        },
        range(from: number, to: number) {
          this._range = [from, to];
          return this._resolve();
        },
        maybeSingle() {
          this._single = true;
          return this._resolve();
        },
        _rows() {
          let rows = base().filter((r) => this._filters.every((f: any) => f(r)));
          for (const o of [...this._order].reverse()) {
            rows.sort((a, b) => {
              const x = a[o.c];
              const y = b[o.c];
              if (x === y) return 0;
              // Postgres: NULLS LAST on ASC, NULLS FIRST on DESC.
              if (x === null) return o.asc ? 1 : -1;
              if (y === null) return o.asc ? -1 : 1;
              const cx = typeof x === "string" ? x.toLowerCase() : x;
              const cy = typeof y === "string" ? y.toLowerCase() : y;
              const cmp = cx < cy ? -1 : cx > cy ? 1 : 0;
              return o.asc ? cmp : -cmp;
            });
          }
          if (this._gt !== null) {
            const pk = this._order[0]?.c ?? "id";
            rows = rows.filter((r) => String(r[pk]) > String(this._gt));
          }
          return rows;
        },
        _project(rows: Row[]) {
          const cols: string | undefined = this._columns;
          if (!cols || cols.trim() === "*") return rows;
          const list = cols.split(",").map((c: string) => c.trim());
          return rows.map((r) => Object.fromEntries(list.map((c: string) => [c, r[c]])));
        },
        _resolve() {
          let rows = this._project(this._rows());
          if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
          if (this._limit !== null) rows = rows.slice(0, this._limit);
          if (this._single) return Promise.resolve({ data: rows[0] ?? null, error: null });
          return Promise.resolve({ data: rows, error: null });
        },
        then(res: any, rej: any) {
          return this._resolve().then(res, rej);
        },
      };
      return b;
    },
  },
}));

import { BACKUP_TABLES } from "@/data/backup/format";
import { closeEngine } from "@/data/local/engine";
import * as dbModule from "@/data/local/db";
import { _resetForTests } from "@/data/local/db";
import { seedCloudToLocal } from "@/data/local/seed";
import { CloudRepository } from "./cloud-repository";
import { LocalRepository, READ_ONLY_MESSAGE } from "./local-repository";
import * as health from "./health";
import { LOCAL_READ_TABLES, canReadLocally, localReadHealth, resetLocalReadHealth } from "./health";
import { readRepo, repo, resetRepository, writeRepo } from "./index";
import { compareTable, compareTables } from "./parity";

const iso = "2026-08-01T10:20:30.123Z";
const uid = (p: string, n: number) => `${p}${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function product(n: number, over: Row = {}): Row {
  return {
    id: uid("aaaa", n),
    name: `Product ${n}`,
    category: "Drinks",
    sale_price: 120.5,
    cost_price: 40.25,
    active: true,
    created_at: iso,
    opening_stock: 0,
    current_stock: 12.75,
    minimum_stock: 0,
    deleted_at: null,
    unit: "pcs",
    selling_method: "unit",
    allow_negative_stock: false,
    track_stock: true,
    last_sold_at: null,
    avg_price_override: null,
    auto_calc: true,
    ...over,
  };
}

function fillCloud() {
  for (const t of BACKUP_TABLES) cloud[t] = [];
  cloud["settings"] = [
    {
      id: 1,
      allow_negative_stock: false,
      updated_at: iso,
      whatsapp_token: null,
      whatsapp_phone_id: null,
      whatsapp_business_id: null,
      whatsapp_country_code: "92",
      whatsapp_auto_send: null,
      timezone: "Asia/Karachi",
      business_day_start_time: "08:00:00",
      business_month_start_day: 1,
      pin_locks: { stock: true, reports: false },
      staff_invoice_color: "#DBEAFE",
    },
  ];
  cloud["categories"] = [
    {
      id: uid("cccc", 1),
      name: "Drinks",
      sort_order: 1,
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
      description: null,
      color: "#fff",
      icon: null,
      active: true,
    },
    {
      id: uid("cccc", 2),
      name: "bakery",
      sort_order: 2,
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
      description: "Buns",
      color: null,
      icon: null,
      active: false,
    },
    {
      id: uid("cccc", 3),
      name: "Removed",
      sort_order: 3,
      created_at: iso,
      updated_at: iso,
      deleted_at: iso,
      description: null,
      color: null,
      icon: null,
      active: true,
    },
  ];
  cloud["suppliers"] = [
    {
      id: uid("dddd", 1),
      name: "Metro",
      phone: null,
      address: null,
      balance: 0,
      notes: null,
      deleted_at: null,
      created_at: iso,
    },
  ];
  cloud["expense_categories"] = [
    {
      id: uid("eeee", 1),
      name: "Fuel",
      active: true,
      sort_order: 1,
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    },
  ];
  cloud["products"] = [product(1), product(2, { name: "apple pie", active: false, avg_price_override: 9.5 })];
  cloud["recipes"] = [
    {
      id: uid("ffff", 1),
      parent_product_id: uid("aaaa", 1),
      component_product_id: null,
      quantity: 1.5,
      unit: "kg",
      deleted_at: null,
      created_at: iso,
      updated_at: iso,
      component_stock_item_id: null,
      applies_to: ["walkin", "delivery"],
    },
  ];
}

async function seed() {
  return seedCloudToLocal({ allowNonPersistent: true });
}

/** Makes the health gate see a persistent OPFS engine without faking anything else. */
function pretendPersistent() {
  const real = dbModule.engineStatus;
  vi.spyOn(dbModule, "engineStatus").mockImplementation(async () => ({
    ...(await real()),
    persistent: true,
    storage: "opfs" as const,
  }));
}

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", "true");
  session = {
    access_token: "t",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "owner@example.com" },
  };
  fillCloud();
  resetLocalReadHealth();
  resetRepository();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetLocalReadHealth();
  await _resetForTests();
  await closeEngine();
  for (const k of Object.keys(cloud)) delete cloud[k];
});

/* ------------------------------------------------------------------ */
describe("LocalRepository reads", () => {
  beforeEach(async () => {
    expect((await seed()).status).toBe("verified");
  });

  it("opens and lists seeded rows with cloud shapes", async () => {
    const rows = await new LocalRepository().list("products", {
      filter: { is: { deleted_at: null } },
      order: [{ column: "name" }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("apple pie"); // case-insensitive, like the cloud collation
    expect(rows[0].active).toBe(false); // boolean restored from 0/1
    expect(rows[0].avg_price_override).toBe(9.5);
    expect(rows[1].track_stock).toBe(true);
    expect(rows[1].deleted_at).toBeNull();
    expect(rows[1].created_at).toBe(iso); // raw timestamp string, never a Date
  });

  it("parses json and array columns back to cloud values", async () => {
    const recipe = await new LocalRepository().findOne("recipes", {});
    expect(recipe!.applies_to).toEqual(["walkin", "delivery"]);
    const settings = await new LocalRepository().getById("settings", 1);
    expect(settings!.pin_locks).toEqual({ stock: true, reports: false });
    expect(settings!.whatsapp_auto_send).toBeNull(); // nullable boolean stays null
  });

  it("getById returns the right row and null for a miss", async () => {
    const local = new LocalRepository();
    expect((await local.getById("products", uid("aaaa", 2)))!.name).toBe("apple pie");
    expect(await local.getById("products", uid("aaaa", 99))).toBeNull();
  });

  it("findOne honours filters and ordering", async () => {
    const row = await new LocalRepository().findOne("categories", {
      filter: { is: { deleted_at: null }, eq: { active: true } },
      order: [{ column: "sort_order" }],
    });
    expect(row!.name).toBe("Drinks");
  });

  it("count matches the filter", async () => {
    const local = new LocalRepository();
    expect(await local.count("categories")).toBe(3);
    expect(await local.count("categories", { is: { deleted_at: null } })).toBe(2);
    expect(await local.count("categories", { eq: { active: true }, is: { deleted_at: null } })).toBe(1);
    expect(await local.count("products", { in: { id: [uid("aaaa", 1)] } })).toBe(1);
  });

  it("supports column projection and limits", async () => {
    const rows = await new LocalRepository().list("suppliers", {
      columns: "id, name",
      limit: 1,
      order: [{ column: "name" }],
    });
    expect(rows).toEqual([{ id: uid("dddd", 1), name: "Metro" }]);
  });

  it("rejects unknown tables and columns instead of guessing", async () => {
    const local = new LocalRepository();
    await expect(local.list("products", { columns: "id, nope" })).rejects.toThrow(/Unknown column/);
    await expect(local.list("products", { columns: "id, sales(*)" })).rejects.toThrow(
      /not supported locally/,
    );
  });
});

/* ------------------------------------------------------------------ */
describe("read-only guarantee", () => {
  it("every mutation throws a clear Phase 4 error", async () => {
    const local = new LocalRepository();
    const calls: [string, () => unknown][] = [
      ["insert", () => local.insert("products", { id: "x" })],
      ["update", () => local.update("products", { name: "x" }, { eq: { id: "x" } })],
      ["upsert", () => local.upsert("products", { id: "x" })],
      ["remove", () => local.remove("products", { eq: { id: "x" } })],
      ["rpc", () => local.rpc("save_sale", {})],
    ];
    for (const [name, call] of calls) {
      // Rejected or thrown, both are acceptable — it must never silently write.
      await expect(
        (async () => call())(),
        name,
      ).rejects.toThrow(READ_ONLY_MESSAGE);
    }
  });

  it("writeRepo() and repo() stay on the cloud repository", () => {
    expect(writeRepo().kind).toBe("cloud");
    expect(repo().kind).toBe("cloud");
  });
});

/* ------------------------------------------------------------------ */
describe("health gate and repository selection", () => {
  it("feature flag disabled → cloud", async () => {
    vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", "false");
    resetLocalReadHealth();
    const h = await localReadHealth(true);
    expect(h.usable).toBe(false);
    expect(h.reason).toMatch(/VITE_ENABLE_LOCAL_SQLITE/);
    expect((await readRepo("categories")).kind).toBe("cloud");
  });

  it("unseeded database → cloud", async () => {
    pretendPersistent();
    const h = await localReadHealth(true);
    expect(h.usable).toBe(false);
    expect(h.reason).toMatch(/No Phase 3 seed/);
    expect((await readRepo("categories")).kind).toBe("cloud");
  });

  it("non-persistent SQLite → cloud even after a seed", async () => {
    await seed();
    const h = await localReadHealth(true);
    expect(h.usable).toBe(false);
    expect(h.reason).toMatch(/not persistent/i);
    expect((await readRepo("categories")).kind).toBe("cloud");
  });

  it("valid seed + persistent storage → local for converted reads", async () => {
    await seed();
    pretendPersistent();
    const h = await localReadHealth(true);
    expect(h.usable).toBe(true);
    expect(h.checks).toMatchObject({
      flagEnabled: true,
      workerRunning: true,
      persistent: true,
      schemaCurrent: true,
      seedPresent: true,
      seedVerified: true,
      notInvalidated: true,
    });
    expect((await readRepo("categories")).kind).toBe("local");
    expect((await readRepo("products")).kind).toBe("local");
  });

  it("an empty local table never masks cloud data", async () => {
    await seed();
    pretendPersistent();
    await localReadHealth(true);
    // `customers` was not part of the fixture, so nothing was seeded for it.
    expect(await canReadLocally("customers")).toBe(false);
    expect((await readRepo("customers")).kind).toBe("cloud");
  });

  it("unconverted tables stay on the cloud repository", async () => {
    await seed();
    pretendPersistent();
    await localReadHealth(true);
    for (const t of ["sales", "sale_items", "cash_movements", "purchases"] as const) {
      expect(LOCAL_READ_TABLES).not.toContain(t);
      expect((await readRepo(t)).kind).toBe("cloud");
    }
  });

  it("invalidation immediately forces cloud reads", async () => {
    await seed();
    pretendPersistent();
    expect((await localReadHealth(true)).usable).toBe(true);
    health.invalidateLocalReads("manual");
    expect((await readRepo("categories")).kind).toBe("cloud");
  });

  it("degrades to cloud when the health check itself throws", async () => {
    const spy = vi.spyOn(health, "canReadLocally").mockRejectedValue(new Error("boom"));
    expect((await readRepo("categories")).kind).toBe("cloud");
    spy.mockRestore();
  });
});

/* ------------------------------------------------------------------ */
describe("cloud/local parity", () => {
  const opts = {
    filter: { is: { deleted_at: null } },
    order: [{ column: "name" as const }],
  };

  beforeEach(async () => {
    expect((await seed()).status).toBe("verified");
  });

  it("passes on the seeded fixtures for every locally-readable table", async () => {
    // `recipes` has no name column, so it gets its own ordering.
    const tables = LOCAL_READ_TABLES.filter((t) => (cloud[t] ?? []).length > 0 && t !== "settings");
    const { ok, results } = await compareTables(tables, (t) =>
      t === "recipes" ? { filter: opts.filter, order: [{ column: "id" }] } : opts,
    );
    for (const r of results) {
      expect(r.notes, `${r.table}: ${r.notes.join(" ")}`).toEqual([]);
      expect(r.cloudCount).toBe(r.localCount);
      expect(r.orderMatches).toBe(true);
    }
    expect(ok).toBe(true);
  });

  it("compares raw timestamp strings, not Date objects", async () => {
    const r = await compareTable("products", opts);
    expect(r.ok).toBe(true);
    const local = await new LocalRepository().list("products", opts);
    expect(typeof local[0].created_at).toBe("string");
  });

  it("detects a missing local id", async () => {
    cloud["categories"].push({
      ...cloud["categories"][0],
      id: uid("cccc", 9),
      name: "Only in cloud",
    });
    const r = await compareTable("categories", opts);
    expect(r.ok).toBe(false);
    expect(r.missingLocal).toEqual([uid("cccc", 9)]);
    expect(r.notes.join(" ")).toMatch(/missing locally/);
  });

  it("detects an unexpected local id", async () => {
    cloud["categories"] = cloud["categories"].filter((c) => c.id !== uid("cccc", 1));
    const r = await compareTable("categories", opts);
    expect(r.ok).toBe(false);
    expect(r.unexpectedLocal).toEqual([uid("cccc", 1)]);
  });

  it("detects a differing field value", async () => {
    cloud["products"][0].sale_price = 999.99;
    const r = await compareTable("products", opts);
    expect(r.ok).toBe(false);
    expect(r.fieldDiffs).toHaveLength(1);
    expect(r.fieldDiffs[0]).toMatchObject({
      id: uid("aaaa", 1),
      column: "sale_price",
      cloud: 999.99,
      local: 120.5,
    });
  });

  it("detects duplicate ids on either side", async () => {
    cloud["categories"].push({ ...cloud["categories"][0] });
    const r = await compareTable("categories", opts);
    expect(r.ok).toBe(false);
    expect(r.duplicateCloud).toEqual([uid("cccc", 1)]);
  });

  it("reports ordering differences when an order was requested", async () => {
    const cloudRepo = new CloudRepository();
    const rowsCloud = await cloudRepo.list("categories", opts);
    const rowsLocal = await new LocalRepository().list("categories", opts);
    expect(rowsLocal.map((r) => r.name)).toEqual(rowsCloud.map((r) => r.name));
    expect(rowsLocal.map((r) => r.name)).toEqual(["bakery", "Drinks"]);
  });
});

/* ------------------------------------------------------------------ */
describe("offline reference reads", () => {
  it("converted reads still work when the network is gone", async () => {
    await seed();
    pretendPersistent();
    await localReadHealth(true);

    const { listCategories, listSuppliers, listExpenseCategories, readSettingsColumns } =
      await import("@/data/reads/reference");

    const before = await listCategories({ activeOnly: true });

    // Simulate a dead network: every cloud call now throws.
    const { supabase } = await import("@/integrations/supabase/client");
    const spy = vi.spyOn(supabase as any, "from").mockImplementation(() => {
      throw new Error("Network request failed");
    });

    expect(await listCategories({ activeOnly: true })).toEqual(before);
    expect((await listSuppliers()).map((s) => s.name)).toEqual(["Metro"]);
    expect((await listExpenseCategories({ activeOnly: true })).map((c) => c.name)).toEqual(["Fuel"]);
    expect((await readSettingsColumns<any>("pin_locks"))!.pin_locks).toEqual({
      stock: true,
      reports: false,
    });

    // An unconverted table still needs the network, and says so.
    const { CloudRepository: CR } = await import("./cloud-repository");
    await expect(new CR().list("sales")).rejects.toThrow(/Network request failed/);
    spy.mockRestore();
  });

  it("without a healthy local mirror the same reads go to the cloud", async () => {
    const { listCategories } = await import("@/data/reads/reference");
    const rows = await listCategories({ activeOnly: true });
    expect(rows.map((r) => r.name)).toEqual(["Drinks"]);
    expect((await readRepo("categories")).kind).toBe("cloud");
  });
});
