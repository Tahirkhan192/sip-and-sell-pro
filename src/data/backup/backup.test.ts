import { describe, expect, it, beforeEach, vi } from "vitest";

// ---- in-memory fake of the Supabase client -------------------------------
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let session: any = null;
let countOverride: Record<string, { before?: number; after?: number }> = {};
const countCalls: Record<string, number> = {};

function tableRows(table: string) {
  return [...(db[table] ?? [])].sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
}

function makeQuery(table: string) {
  const state: { head: boolean; count: boolean; gt: any; limit: number } = {
    head: false,
    count: false,
    gt: null,
    limit: 1000,
  };
  const q: any = {
    select(_cols: string, opts?: any) {
      if (opts?.head) state.head = true;
      if (opts?.count) state.count = true;
      return q;
    },
    order() {
      return q;
    },
    limit(n: number) {
      state.limit = n;
      return q;
    },
    gt(_col: string, value: any) {
      state.gt = value;
      return q;
    },
    then(resolve: any) {
      if (state.head) {
        countCalls[table] = (countCalls[table] ?? 0) + 1;
        const o = countOverride[table];
        const isFirst = countCalls[table] === 1;
        const override = isFirst ? o?.before : o?.after;
        return resolve({
          count: override ?? tableRows(table).length,
          error: null,
        });
      }
      let rows = tableRows(table);
      if (state.gt !== null) rows = rows.filter((r) => r.id > state.gt);
      return resolve({ data: rows.slice(0, state.limit), error: null });
    },
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    auth: { getSession: async () => ({ data: { session }, error: null }) },
  },
}));

import { BACKUP_TABLES, computeChecksum, payloadOf, primaryKeyOf } from "./format";
import { exportFullBackup } from "./export";
import { validateBackup } from "./restore";

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function seed(counts: Partial<Record<string, number>>) {
  for (const t of BACKUP_TABLES) db[t] = [];
  for (const [t, n] of Object.entries(counts)) {
    const pk = primaryKeyOf(t as any);
    db[t] = Array.from({ length: n as number }, (_, i) => ({ [pk]: uuid(i + 1), value: i }));
  }
}

beforeEach(() => {
  session = { access_token: "t", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } };
  countOverride = {};
  for (const k of Object.keys(countCalls)) delete countCalls[k];
  seed({ sales: 3 });
});

describe("authentication safety", () => {
  it("fails with no session", async () => {
    session = null;
    await expect(exportFullBackup()).rejects.toThrow(/not authenticated/i);
  });

  it("fails with an expired session", async () => {
    session.expires_at = Math.floor(Date.now() / 1000) - 10;
    await expect(exportFullBackup()).rejects.toThrow(/not authenticated/i);
  });

  it("fails when every table is empty (RLS-filtered)", async () => {
    seed({});
    await expect(exportFullBackup()).rejects.toThrow(/every table came back empty/i);
  });
});

describe("keyset pagination", () => {
  it.each([0, 1, 1000, 1001, 2500])("exports %i rows without duplicates or gaps", async (n) => {
    seed({ sales: Math.max(n, 1), sale_items: n });
    const backup = await exportFullBackup();
    const t = backup.tables.find((x) => x.table === "sale_items")!;
    expect(t.exportedCount).toBe(n);
    expect(new Set(t.rows.map((r) => r.id)).size).toBe(n);
    expect(t.rows.map((r) => r.value)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("handles a large sale_items table", async () => {
    seed({ sales: 1, sale_items: 14363 });
    const backup = await exportFullBackup();
    const t = backup.tables.find((x) => x.table === "sale_items")!;
    expect(t.exportedCount).toBe(14363);
    expect(new Set(t.rows.map((r) => r.id)).size).toBe(14363);
  });

  it("accepts legitimately empty tables", async () => {
    const backup = await exportFullBackup();
    const t = backup.tables.find((x) => x.table === "expenses")!;
    expect([t.countBefore, t.exportedCount, t.countAfter]).toEqual([0, 0, 0]);
    expect((await validateBackup(backup)).ok).toBe(true);
  });
});

describe("count consistency", () => {
  it("passes when nothing changes", async () => {
    const backup = await exportFullBackup();
    expect(backup.complete).toBe(true);
  });

  it("fails when countBefore != exportedCount", async () => {
    countOverride = { sales: { before: 4 } };
    await expect(exportFullBackup()).rejects.toThrow(/sales changed during export/);
  });

  it("fails when exportedCount != countAfter", async () => {
    countOverride = { sales: { after: 5 } };
    await expect(exportFullBackup()).rejects.toThrow(/sales changed during export/);
  });
});

describe("integrity", () => {
  it("valid checksum passes", async () => {
    const backup = await exportFullBackup();
    const result = await validateBackup(backup);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("modified row fails", async () => {
    const backup = await exportFullBackup();
    backup.tables.find((t) => t.table === "sales")!.rows[0].value = 999;
    expect((await validateBackup(backup)).errors.join(" ")).toMatch(/Checksum mismatch/);
  });

  it("modified metadata fails", async () => {
    const backup = await exportFullBackup();
    backup.meta.authUserId = "someone-else";
    expect((await validateBackup(backup)).errors.join(" ")).toMatch(/Checksum mismatch/);
  });

  it("modified row count fails", async () => {
    const backup = await exportFullBackup();
    backup.rowCountByTable.sales = 99;
    const errs = (await validateBackup(backup)).errors.join(" ");
    expect(errs).toMatch(/digest mismatch/);
  });

  it("checksum is deterministic and excludes itself", async () => {
    const backup = await exportFullBackup();
    expect(await computeChecksum(payloadOf(backup))).toBe(backup.integrity.checksum);
  });

  it("rejects unsupported format versions", async () => {
    const backup = await exportFullBackup();
    (backup as any).formatVersion = 1;
    expect((await validateBackup(backup)).errors.join(" ")).toMatch(/Unsupported backup format/);
  });
});

describe("primary keys", () => {
  it("duplicate primary key fails", async () => {
    const backup = await exportFullBackup();
    const t = backup.tables.find((x) => x.table === "sales")!;
    t.rows[1].id = t.rows[0].id;
    expect((await validateBackup(backup)).errors.join(" ")).toMatch(/duplicate primary key/);
  });

  it("null primary key fails", async () => {
    const backup = await exportFullBackup();
    backup.tables.find((x) => x.table === "sales")!.rows[0].id = null;
    expect((await validateBackup(backup)).errors.join(" ")).toMatch(/has no id/);
  });
});

describe("user_roles + secrets", () => {
  it("flags the user_roles RLS limitation and the authenticated user", async () => {
    const backup = await exportFullBackup();
    expect(backup.meta.rlsLimitedTables).toContain("user_roles");
    expect(backup.meta.authUserId).toBe("u1");
    const warnings = (await validateBackup(backup)).warnings.join(" ");
    expect(warnings).toMatch(/user_roles/);
  });

  it("redacts whatsapp secrets while preserving the rest of settings", async () => {
    db.settings = [{ id: 1, whatsapp_token: "SECRET", whatsapp_phone_id: "123", timezone: "Asia/Karachi" }];
    const backup = await exportFullBackup();
    const row = backup.tables.find((t) => t.table === "settings")!.rows[0];
    expect(row.whatsapp_token).toBe("__REDACTED__");
    expect(row.timezone).toBe("Asia/Karachi");
    expect(backup.meta.redactedFields.settings).toContain("whatsapp_token");
  });

  it("does not store any session token", async () => {
    const backup = await exportFullBackup();
    expect(JSON.stringify(backup)).not.toContain("access_token");
  });
});
