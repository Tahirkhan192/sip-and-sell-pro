/**
 * Embedded local database engine.
 *
 * Runs a real Postgres (PGlite / WASM) inside the app, on this computer.
 * The schema, every function and every trigger are the exact definitions that
 * used to run in the cloud, so all business logic (invoices, stock, COGS,
 * salaries, Digi Katha) behaves identically — just offline.
 *
 * Storage: IndexedDB-backed persistent data directory in the app's own
 * profile folder. Nothing ever leaves this machine.
 */

import type { PGlite } from "@electric-sql/pglite";
import type { Meta, FK } from "./postgrest";

const DATA_DIR = "idb://kdf-pos-local";
const SEED_BASE = "/seed";

export type Engine = {
  db: PGlite;
  meta: Meta;
  funcs: Record<string, { retset: boolean }>;
};

let enginePromise: Promise<Engine> | null = null;
let progressCb: ((msg: string, pct: number) => void) | null = null;

export function onInitProgress(cb: (msg: string, pct: number) => void) {
  progressCb = cb;
}
function report(msg: string, pct: number) {
  try {
    progressCb?.(msg, pct);
  } catch {
    /* ignore */
  }
}

export function getEngine(): Promise<Engine> {
  if (!enginePromise) enginePromise = init();
  return enginePromise;
}

async function init(): Promise<Engine> {
  if (typeof window === "undefined") throw new Error("Local database is only available in the app window");
  report("Starting local database…", 2);
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(DATA_DIR);
  await db.waitReady;
  await db.exec("SET TIME ZONE 'UTC';");

  const installed = await db.query<{ ok: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='_local_meta') AS ok",
  );
  if (!installed.rows[0]?.ok) {
    await installSchema(db);
    await seed(db);
  }

  const meta = await loadMeta(db);
  const funcs = await loadFuncs(db);
  report("Ready", 100);
  return { db, meta, funcs };
}

async function installSchema(db: PGlite) {
  report("Creating local database…", 5);
  const sql = await (await fetch(`${SEED_BASE}/schema.sql`)).text();
  await db.exec(sql);
  await db.exec(`CREATE TABLE IF NOT EXISTS public._local_meta (key text PRIMARY KEY, value text);
    INSERT INTO public._local_meta(key, value) VALUES ('installed_at', now()::text) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS auth.local_credentials (
      user_id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      password text NOT NULL,
      created_at timestamptz DEFAULT now()
    );`);
}

type SeedManifest = { order: string[]; counts: Record<string, number> };

async function seed(db: PGlite) {
  report("Loading your data…", 10);
  const manifest: SeedManifest = await (await fetch(`${SEED_BASE}/manifest.json`)).json();
  const files: Record<string, Record<string, unknown>[]> = {};
  let loaded = 0;
  for (const table of manifest.order) {
    const res = await fetch(`${SEED_BASE}/${table}.jsonl`);
    const text = res.ok ? await res.text() : "";
    files[table] = text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    loaded++;
    report(`Loading your data… (${table})`, 10 + Math.round((loaded / manifest.order.length) * 20));
  }

  // Recreate the user accounts referenced by historical rows so foreign keys hold.
  const userIds = new Set<string>();
  for (const rows of Object.values(files))
    for (const row of rows)
      for (const key of ["created_by", "user_id", "updated_by"])
        if (typeof row[key] === "string" && /^[0-9a-f-]{36}$/i.test(row[key] as string)) userIds.add(row[key] as string);

  await db.exec("BEGIN; SET LOCAL session_replication_role = replica;");
  try {
    for (const id of userIds) {
      await db.query("INSERT INTO auth.users(id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    }
    let done = 0;
    for (const table of manifest.order) {
      const rows = files[table];
      if (rows.length) await insertRows(db, table, rows);
      done++;
      report(`Restoring ${table}…`, 30 + Math.round((done / manifest.order.length) * 65));
    }
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }

  // Verify every table restored completely — never report success on a partial load.
  for (const table of manifest.order) {
    const expected = manifest.counts[table] ?? 0;
    const got = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM public."${table}"`);
    if ((got.rows[0]?.c ?? 0) < expected) {
      throw new Error(`Restore incomplete for ${table}: expected ${expected}, got ${got.rows[0]?.c}`);
    }
  }
  await db.exec("SELECT setval(pg_get_serial_sequence('public.sales','id'), 1, false) WHERE false;");
}

async function arrayColumns(db: PGlite, table: string): Promise<Set<string>> {
  const res = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND data_type = 'ARRAY'`,
    [table],
  );
  return new Set(res.rows.map((r) => r.column_name));
}

async function insertRows(db: PGlite, table: string, rows: Record<string, unknown>[]) {
  const arrays = await arrayColumns(db, table);
  const cols = Object.keys(rows[0]);
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const values = chunk
      .map((row) => {
        const ph = cols.map((c) => {
          const v = row[c];
          // Real Postgres arrays (text[], uuid[]…) must stay arrays; JSON columns are serialized.
          params.push(v !== null && typeof v === "object" && !arrays.has(c) ? JSON.stringify(v) : v);
          return `$${params.length}`;
        });
        return `(${ph.join(", ")})`;
      })
      .join(", ");
    await db.query(`INSERT INTO public."${table}" (${quoted}) VALUES ${values} ON CONFLICT DO NOTHING`, params);
  }
}

async function loadMeta(db: PGlite): Promise<Meta> {
  const fkRes = await db.query<{
    name: string;
    src_table: string;
    src_cols: string[];
    tgt_table: string;
    tgt_cols: string[];
  }>(`
    SELECT c.conname AS name,
           sr.relname AS src_table,
           (SELECT array_agg(a.attname ORDER BY x.ord) FROM unnest(c.conkey) WITH ORDINALITY x(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS src_cols,
           tr.relname AS tgt_table,
           (SELECT array_agg(a.attname ORDER BY x.ord) FROM unnest(c.confkey) WITH ORDINALITY x(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = x.attnum) AS tgt_cols
    FROM pg_constraint c
    JOIN pg_class sr ON sr.oid = c.conrelid
    JOIN pg_class tr ON tr.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = sr.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'`);

  const fks: FK[] = fkRes.rows.map((r) => ({
    name: r.name,
    srcTable: r.src_table,
    srcCols: r.src_cols,
    tgtTable: r.tgt_table,
    tgtCols: r.tgt_cols,
  }));

  const pkRes = await db.query<{ tbl: string; cols: string[] }>(`
    SELECT sr.relname AS tbl,
           (SELECT array_agg(a.attname ORDER BY x.ord) FROM unnest(c.conkey) WITH ORDINALITY x(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols
    FROM pg_constraint c
    JOIN pg_class sr ON sr.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = sr.relnamespace
    WHERE c.contype = 'p' AND n.nspname = 'public'`);
  const pks: Record<string, string[]> = {};
  for (const r of pkRes.rows) pks[r.tbl] = r.cols;

  const colRes = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'ARRAY'`,
  );
  const arrayCols: Record<string, Record<string, true>> = {};
  for (const r of colRes.rows) (arrayCols[r.table_name] ??= {})[r.column_name] = true;

  return { fks, pks, arrayCols };
}

async function loadFuncs(db: PGlite): Promise<Record<string, { retset: boolean }>> {
  const res = await db.query<{ name: string; retset: boolean }>(
    `SELECT p.proname AS name, p.proretset AS retset
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'`,
  );
  const out: Record<string, { retset: boolean }> = {};
  for (const r of res.rows) out[r.name] = { retset: r.retset };
  return out;
}

const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?)?$/;

/** Makes local Postgres output look exactly like the cloud Data API output. */
export function normalize<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (typeof value === "string") {
    if (TS_RE.test(value)) {
      const iso = new Date(value.replace(" ", "T") + (/[+-]\d{2}/.test(value.slice(-6)) ? "" : "Z")).toISOString();
      return iso as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => normalize(v)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalize(v);
    return out as unknown as T;
  }
  return value;
}

/** Resets the local database (used by restore-from-backup). */
export async function resetEngine() {
  enginePromise = null;
}
