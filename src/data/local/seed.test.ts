/**
 * PHASE 3 — cloud → local seed tests.
 *
 * The Supabase client is faked (no network, no real business data). The local
 * SQLite engine is the real one, running through the same typed protocol the
 * worker uses; in Node it honestly reports the memory fallback, so the seed is
 * invoked with `allowNonPersistent` only where the persistence guard itself is
 * not under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ---------------- fake cloud ---------------- */

type Row = Record<string, any>;
const cloud: Record<string, Row[]> = {};
let session: any = null;
let sessionError: any = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session }, error: sessionError }) },
    from(table: string) {
      const rows = () => (cloud[table] ?? []).slice();
      const builder: any = {
        _gt: null as any,
        _limit: 1000,
        _head: false,
        select(_cols: string, opts?: any) {
          if (opts?.head) {
            this._head = true;
            return Promise.resolve({ count: rows().length, error: null });
          }
          return this;
        },
        order(col: string) {
          this._order = col;
          return this;
        },
        limit(n: number) {
          this._limit = n;
          return this;
        },
        gt(_col: string, value: any) {
          this._gt = value;
          return this;
        },
        then(resolve: any, reject: any) {
          try {
            const pk = this._order ?? "id";
            let data = rows().sort((a, b) => (String(a[pk]) < String(b[pk]) ? -1 : 1));
            if (this._gt !== null) data = data.filter((r) => String(r[pk]) > String(this._gt));
            return Promise.resolve({ data: data.slice(0, this._limit), error: null }).then(
              resolve,
              reject,
            );
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      return builder;
    },
  },
}));

import { BACKUP_TABLES } from "@/data/backup/format";
import { closeEngine } from "./engine";
import { _resetForTests, mirrorStatus, verifyTable } from "./db";
import { seedCloudToLocal } from "./seed";
import { toSqliteValue, canonicalRow } from "./seed-format";

const iso = "2026-08-01T10:20:30.123Z";

function uuid(prefix: string, n: number) {
  return `${prefix}${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function seedFakeCloud({ saleItems = 1200 } = {}) {
  for (const t of BACKUP_TABLES) cloud[t] = [];
  cloud["products"] = [
    {
      id: uuid("aaaa", 1),
      name: "Chai",
      category: "Drinks",
      sale_price: 120.5,
      cost_price: 40,
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
    },
  ];
  cloud["sales"] = [
    {
      id: uuid("bbbb", 1),
      invoice_no: "INV-1",
      sale_date: iso,
      grand_total: 500,
      created_by: null,
      created_at: iso,
      customer_name: null,
      status: "completed",
      delivery_charges: 0,
      payment_method: "cash",
      deleted_at: "2026-08-02T00:00:00.000Z",
      cash_paid: 500,
      online_paid: 0,
      order_type: "walkin",
      delivery_boy: null,
      katha: false,
      customer_id: null,
      customer_phone: null,
      whatsapp_status: null,
      whatsapp_sent_at: null,
      discount_type: "none",
      discount_value: 0,
      discount_amount: 0,
      delivery_address: null,
      hidden: false,
      staff_id: null,
    },
  ];
  cloud["sale_items"] = Array.from({ length: saleItems }, (_, i) => ({
    id: uuid("cccc", i + 1),
    sale_id: uuid("bbbb", 1),
    product_id: uuid("aaaa", 1),
    quantity: 2,
    price: 120.5,
    total: 241,
    unit: "pcs",
  }));
  cloud["recipes"] = [
    {
      id: uuid("dddd", 1),
      parent_product_id: uuid("aaaa", 1),
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
  cloud["settings"] = [
    {
      id: 1,
      allow_negative_stock: false,
      updated_at: iso,
      whatsapp_token: "super-secret-token",
      whatsapp_phone_id: null,
      whatsapp_business_id: null,
      whatsapp_country_code: "92",
      whatsapp_auto_send: false,
      timezone: "Asia/Karachi",
      business_day_start_time: "08:00:00",
      business_month_start_day: 1,
      pin_locks: { stock: true, reports: false },
      staff_invoice_color: "#ff0000",
    },
  ];
  cloud["audit_log"] = [
    {
      id: uuid("eeee", 1),
      user_id: null,
      action: "seed-test",
      entity: null,
      entity_id: null,
      details: { nested: { b: 1, a: [1, 2] } },
      created_at: iso,
    },
  ];
}

beforeEach(async () => {
  vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", "true");
  session = {
    access_token: "token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "owner@example.com" },
  };
  sessionError = null;
  seedFakeCloud();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await _resetForTests();
  await closeEngine();
  for (const k of Object.keys(cloud)) delete cloud[k];
});

const run = () => seedCloudToLocal({ allowNonPersistent: true });

/* ------------------------------------------------------------------ */
describe("seed guards", () => {
  it("requires the feature flag", async () => {
    vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", "false");
    const r = await run();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/disabled/i);
  });

  it("requires an authenticated session", async () => {
    session = null;
    const r = await run();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/not signed in/i);
  });

  it("rejects an expired session", async () => {
    session = { ...session, expires_at: Math.floor(Date.now() / 1000) - 60 };
    const r = await run();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/expired/i);
  });

  it("refuses to seed into non-persistent storage by default", async () => {
    const r = await seedCloudToLocal();
    expect(r.status).toBe("blocked");
    expect(r.reason).toMatch(/persistent OPFS/i);
  });

  it("fails when every cloud table is empty (unauthorised-looking result)", async () => {
    for (const t of BACKUP_TABLES) cloud[t] = [];
    const r = await run();
    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/came back empty/i);
    expect((await mirrorStatus()).totalRows).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
describe("successful seed", () => {
  it("copies every backup table in dependency order and verifies it", async () => {
    const seen: string[] = [];
    const report = await seedCloudToLocal({
      allowNonPersistent: true,
      onProgress: (p) => {
        if (p.phase === "seeding" && p.table && seen.at(-1) !== p.table) seen.push(p.table);
      },
    });
    expect(report.status).toBe("verified");
    expect(report.tables.map((t) => t.table)).toEqual(BACKUP_TABLES);
    expect(seen).toEqual(BACKUP_TABLES);
    expect(report.tables.every((t) => t.status === "PASS")).toBe(true);
  });

  it("verifies counts exactly (cloud === seeded === local)", async () => {
    const report = await run();
    const si = report.tables.find((t) => t.table === "sale_items")!;
    expect(si.cloudCount).toBe(1200);
    expect(si.seededCount).toBe(1200);
    expect(si.localCount).toBe(1200);
    expect(report.totals.cloudRows).toBe(report.totals.localRows);
  });

  it("pages past the 1000-row limit with keyset pagination", async () => {
    seedFakeCloud({ saleItems: 2345 });
    const report = await run();
    expect(report.tables.find((t) => t.table === "sale_items")!.localCount).toBe(2345);
  });

  it("matches primary keys and table digests", async () => {
    const report = await run();
    for (const t of report.tables) {
      expect(t.missingLocal).toEqual([]);
      expect(t.unexpectedLocal).toEqual([]);
      expect(t.duplicateLocal).toEqual([]);
      expect(t.localDigest).toBe(t.cloudDigest);
    }
    expect(report.overallDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves UUIDs, timestamps, numerics, booleans, nulls, JSON, arrays and soft deletes", async () => {
    await run();
    const sales = await verifyTable("sales", "id");
    expect(sales.primaryKeys).toEqual([uuid("bbbb", 1)]);

    const digestOf = async (table: string) => (await verifyTable(table, "id")).digest;
    expect(await digestOf("recipes")).toMatch(/^[0-9a-f]{64}$/);

    // Values, read back through the same canonical serializer used for cloud rows.
    const { mirrorColumns } = await import("./db");
    const cols = (await mirrorColumns("sales")).map((c) => c.name);
    const expectedSale: Record<string, unknown> = {};
    for (const c of cols) expectedSale[c] = toSqliteValue(cloud["sales"][0][c], undefined);
    // booleans → 0/1, null stays null, timestamps verbatim
    expect(expectedSale.katha).toBe(0);
    expect(expectedSale.hidden).toBe(0);
    expect(expectedSale.customer_id).toBeNull();
    expect(expectedSale.deleted_at).toBe("2026-08-02T00:00:00.000Z");
    expect(canonicalRow(cols, expectedSale)).toContain('"invoice_no":"INV-1"');

    // arrays / json become canonical JSON text
    expect(toSqliteValue(["walkin", "delivery"])).toBe('["walkin","delivery"]');
    expect(toSqliteValue({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    // numeric-as-string is stored as a number in REAL columns, never rounded
    expect(toSqliteValue("120.55", "REAL")).toBe(120.55);
  });

  it("redacts the WhatsApp token instead of copying it locally", async () => {
    await run();
    const { mirrorColumns } = await import("./db");
    expect((await mirrorColumns("settings")).some((c) => c.name === "whatsapp_token")).toBe(true);
    const settings = await verifyTable("settings", "id");
    expect(settings.count).toBe(1);
    expect(settings.primaryKeys).toEqual([1]);
  });

  it("writes seed metadata without any credential material", async () => {
    const report = await run();
    const meta = report.meta!;
    expect(meta.status).toBe("verified");
    expect(meta.source).toBe("supabase");
    expect(meta.authUserId).toBe("user-1");
    expect(meta.tables).toBe(BACKUP_TABLES.length);
    expect(meta.rows).toBe(report.totals.localRows);
    expect(meta.verification).toBe("passed");
    expect(JSON.stringify(meta)).not.toContain("token");
    const stored = (await mirrorStatus()).seedMeta;
    expect(stored?.overallDigest).toBe(meta.overallDigest);
  });

  it("reports RLS-limited tables instead of claiming a complete copy", async () => {
    const report = await run();
    expect(report.rlsLimitedTables).toContain("user_roles");
    expect(report.tables.find((t) => t.table === "user_roles")!.rlsLimited).toBe(true);
    expect(report.notes.join(" ")).toMatch(/row-level security/i);
  });
});

/* ------------------------------------------------------------------ */
describe("idempotency and transaction safety", () => {
  it("refuses a second seed when local operational data exists", async () => {
    expect((await run()).status).toBe("verified");
    const second = await run();
    expect(second.status).toBe("blocked");
    expect(second.reason).toMatch(/already contains operational data/i);
    expect(second.notes.join(" ")).toMatch(/Local rows/);
    // the first seed is untouched
    expect((await verifyTable("sale_items", "id")).count).toBe(1200);
  });

  it("rolls back completely when a child row has no parent (foreign keys enforced)", async () => {
    cloud["sale_items"][0].product_id = uuid("ffff", 9); // no such product
    const r = await run();
    expect(r.status).toBe("failed");
    const status = await mirrorStatus();
    expect(status.totalRows).toBe(0);
    expect(status.transactionOpen).toBe(false);
    expect(status.seedMeta).toBeNull();
  });

  it("rolls back when a cloud count does not match the rows received", async () => {
    const original = cloud["sale_items"];
    let call = 0;
    Object.defineProperty(cloud, "sale_items", {
      configurable: true,
      get() {
        call++;
        // shrink the table after it was fetched → count drift
        return call > 3 ? original.slice(0, 5) : original;
      },
    });
    const r = await run();
    expect(r.status).toBe("failed");
    expect((await mirrorStatus()).totalRows).toBe(0);
  });

  it("commits only after every table verified", async () => {
    const report = await run();
    expect(report.status).toBe("verified");
    const status = await mirrorStatus();
    expect(status.transactionOpen).toBe(false);
    expect(status.totalRows).toBe(report.totals.localRows);
    expect(status.counts["sales"]).toBe(1);
    expect(status.counts["sale_items"]).toBe(1200);
  });
});
