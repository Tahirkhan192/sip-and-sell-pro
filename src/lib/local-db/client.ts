/**
 * Offline drop-in replacement for the previous cloud client.
 *
 * Every call the app already makes — `from(...).select(...)`, `.rpc(...)`,
 * `.auth.*` — is served by the embedded local Postgres. The API surface is
 * identical, so no screen or calculation had to be rewritten.
 *
 * Nothing in this file talks to the internet.
 */

import { getEngine, normalize } from "./engine";
import { buildSelect, buildWhere, Ctx, quoteIdent as q, type Filter, type OrderSpec } from "./postgrest";

export type Result<T = any> = { data: T; error: { message: string; details?: string } | null; count: number | null; status: number };

function fail(err: unknown): { message: string; details?: string } {
  const message = err instanceof Error ? err.message : String(err);
  return { message, details: message };
}

class QueryBuilder implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private _order: OrderSpec[] = [];
  private _select = "*";
  private _limit?: number;
  private _offset?: number;
  private _count?: "exact" | "planned" | "estimated";
  private _head = false;
  private _single: "single" | "maybe" | null = null;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Record<string, unknown>[] = [];
  private onConflict?: string;
  private returning = false;

  constructor(private table: string) {}

  select(columns = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (this.mode === "select") {
      this._select = columns || "*";
      this._count = opts?.count;
      this._head = opts?.head ?? false;
    } else {
      this.returning = true;
      this._select = columns || "*";
    }
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict;
    return this;
  }
  update(patch: Record<string, unknown>) {
    this.mode = "update";
    this.payload = [patch];
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }

  private cmp(col: string, op: string, value: unknown, negate = false) {
    this.filters.push({ kind: "cmp", col, op, value, negate });
    return this;
  }
  eq(c: string, v: unknown) { return this.cmp(c, "eq", v); }
  neq(c: string, v: unknown) { return this.cmp(c, "neq", v); }
  gt(c: string, v: unknown) { return this.cmp(c, "gt", v); }
  gte(c: string, v: unknown) { return this.cmp(c, "gte", v); }
  lt(c: string, v: unknown) { return this.cmp(c, "lt", v); }
  lte(c: string, v: unknown) { return this.cmp(c, "lte", v); }
  like(c: string, v: unknown) { return this.cmp(c, "like", v); }
  ilike(c: string, v: unknown) { return this.cmp(c, "ilike", v); }
  is(c: string, v: unknown) { return this.cmp(c, "is", v); }
  in(c: string, v: unknown[]) { return this.cmp(c, "in", v); }
  contains(c: string, v: unknown) { return this.cmp(c, "cs", v); }
  filter(c: string, op: string, v: unknown) { return this.cmp(c, op, v); }
  not(c: string, op: string, v: unknown) { return this.cmp(c, op, v, true); }
  or(raw: string, opts?: { referencedTable?: string }) {
    this.filters.push({ kind: "or", col: opts?.referencedTable ?? "", raw });
    return this;
  }
  match(obj: Record<string, unknown>) {
    for (const [k, v] of Object.entries(obj)) this.cmp(k, "eq", v);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean; referencedTable?: string }) {
    if (!opts?.referencedTable)
      this._order.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  range(from: number, to: number) {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }
  single() {
    this._single = "single";
    return this;
  }
  maybeSingle() {
    this._single = "maybe";
    return this;
  }
  abortSignal() {
    return this;
  }

  private finish(rows: any[], count: number | null): Result {
    const data = normalize(rows);
    if (this._single === "single") {
      if (data.length !== 1)
        return { data: null, error: { message: `JSON object requested, multiple (or no) rows returned` }, count, status: 406 };
      return { data: data[0], error: null, count, status: 200 };
    }
    if (this._single === "maybe") return { data: data[0] ?? null, error: null, count, status: 200 };
    return { data, error: null, count, status: 200 };
  }

  private async run(): Promise<Result> {
    const { db, meta } = await getEngine();
    if (this.mode === "select") {
      const built = buildSelect(meta, {
        table: this.table,
        select: this._select,
        filters: this.filters,
        order: this._order,
        limit: this._limit,
        offset: this._offset,
        count: this._count,
        head: this._head,
      });
      let count: number | null = null;
      if (built.countSql) {
        const c = await db.query<{ c: number }>(built.countSql, built.params);
        count = Number(c.rows[0]?.c ?? 0);
      }
      if (this._head) return { data: null, error: null, count, status: 200 };
      const res = await db.query<any>(built.sql, built.params);
      return this.finish(res.rows, count);
    }

    if (this.mode === "insert" || this.mode === "upsert") {
      const cols = Array.from(new Set(this.payload.flatMap((r) => Object.keys(r))));
      const ctx = new Ctx();
      const values = this.payload
        .map((row) => `(${cols.map((c) => (row[c] === undefined ? "DEFAULT" : ctx.push(serialize(row[c], !!meta.arrayCols[this.table]?.[c])))).join(", ")})`)
        .join(", ");
      let sql = `INSERT INTO ${q(this.table)} (${cols.map(q).join(", ")}) VALUES ${values}`;
      if (this.mode === "upsert") {
        const target = (this.onConflict ?? (meta.pks[this.table] ?? ["id"]).join(",")).split(",").map((s) => s.trim());
        const updates = cols.filter((c) => !target.includes(c));
        sql += ` ON CONFLICT (${target.map(q).join(", ")}) DO ${
          updates.length ? `UPDATE SET ${updates.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")}` : "NOTHING"
        }`;
      }
      sql += " RETURNING *";
      const res = await db.query<any>(sql, ctx.params);
      return this.returning ? this.finish(res.rows, null) : { data: null, error: null, count: null, status: 201 };
    }

    if (this.mode === "update") {
      const ctx = new Ctx();
      const patch = this.payload[0] ?? {};
      const sets = Object.entries(patch).map(([k, v]) => `${q(k)} = ${ctx.push(serialize(v, !!meta.arrayCols[this.table]?.[k]))}`);
      if (!sets.length) return { data: [], error: null, count: null, status: 200 };
      const where = buildWhere(this.filters, this.table, ctx);
      const sql = `UPDATE ${q(this.table)} AS ${q(this.table)} SET ${sets.join(", ")}${where} RETURNING *`;
      const res = await db.query<any>(sql, ctx.params);
      return this.returning ? this.finish(res.rows, null) : { data: null, error: null, count: null, status: 200 };
    }

    const ctx = new Ctx();
    const where = buildWhere(this.filters, this.table, ctx);
    const sql = `DELETE FROM ${q(this.table)} AS ${q(this.table)}${where} RETURNING *`;
    const res = await db.query<any>(sql, ctx.params);
    return this.returning ? this.finish(res.rows, null) : { data: null, error: null, count: null, status: 200 };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run()
      .catch((err) => ({ data: null, error: fail(err), count: null, status: 500 }) as Result)
      .then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

function serialize(v: unknown, isArrayColumn = false) {
  if (v instanceof Date) return v.toISOString();
  // Postgres array columns take a real array; JSON/JSONB columns take text.
  if (isArrayColumn && Array.isArray(v)) return v;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

/* ------------------------------------------------------------------ auth */

const SESSION_KEY = "kdf-local-session";

type LocalUser = { id: string; email: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>; aud: string; created_at: string };
type LocalSession = { access_token: string; token_type: string; expires_at: number; user: LocalUser };

const listeners = new Set<(event: string, session: LocalSession | null) => void>();

function readSession(): LocalSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as LocalSession) : null;
  } catch {
    return null;
  }
}

async function writeSession(session: LocalSession | null) {
  if (typeof window === "undefined") return;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  const { db } = await getEngine();
  await db.query("DELETE FROM auth._session WHERE id = 1");
  if (session) await db.query("INSERT INTO auth._session(id, user_id) VALUES (1, $1)", [session.user.id]);
  for (const cb of listeners) cb(session ? "SIGNED_IN" : "SIGNED_OUT", session);
}

function makeSession(id: string, email: string): LocalSession {
  return {
    access_token: `local-${id}`,
    token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    user: { id, email, user_metadata: {}, app_metadata: { provider: "local" }, aud: "authenticated", created_at: new Date().toISOString() },
  };
}

async function ensureOwner(email: string, password: string) {
  const { db } = await getEngine();
  const existing = await db.query<{ user_id: string; email: string; password: string }>(
    "SELECT user_id, email, password FROM auth.local_credentials ORDER BY created_at LIMIT 1",
  );
  if (existing.rows.length === 0) {
    // First run on this computer: claim the existing owner account from the restored data.
    const owner = await db.query<{ id: string }>(
      `SELECT user_id AS id FROM public.user_roles ORDER BY created_at NULLS LAST LIMIT 1`,
    );
    const fallback = await db.query<{ id: string }>("SELECT id FROM auth.users LIMIT 1");
    const id = owner.rows[0]?.id ?? fallback.rows[0]?.id ?? crypto.randomUUID();
    await db.query("INSERT INTO auth.users(id, email) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email", [id, email]);
    await db.query("INSERT INTO auth.local_credentials(user_id, email, password) VALUES ($1, $2, $3)", [id, email, password]);
    return { id, email };
  }
  return null;
}

const auth = {
  async getSession() {
    return { data: { session: readSession() }, error: null };
  },
  async getUser() {
    const session = readSession();
    if (!session) return { data: { user: null }, error: { message: "Auth session missing!" } };
    return { data: { user: session.user }, error: null };
  },
  async getClaims() {
    const session = readSession();
    return { data: session ? { claims: { sub: session.user.id, email: session.user.email } } : null, error: null };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const created = await ensureOwner(email, password);
      const { db } = await getEngine();
      const row = created
        ? { user_id: created.id }
        : (
            await db.query<{ user_id: string }>(
              "SELECT user_id FROM auth.local_credentials WHERE lower(email) = lower($1) AND password = $2",
              [email, password],
            )
          ).rows[0];
      if (!row) return { data: { session: null, user: null }, error: { message: "Invalid login credentials" } };
      const session = makeSession(row.user_id, email);
      await writeSession(session);
      return { data: { session, user: session.user }, error: null };
    } catch (err) {
      return { data: { session: null, user: null }, error: fail(err) };
    }
  },
  async signUp({ email, password }: { email: string; password: string }) {
    try {
      const { db } = await getEngine();
      const created = await ensureOwner(email, password);
      let id = created?.id;
      if (!id) {
        const dup = await db.query<{ user_id: string }>("SELECT user_id FROM auth.local_credentials WHERE lower(email) = lower($1)", [email]);
        if (dup.rows.length) return { data: { session: null, user: null }, error: { message: "User already registered" } };
        id = crypto.randomUUID();
        await db.query("INSERT INTO auth.users(id, email) VALUES ($1, $2)", [id, email]);
        await db.query("INSERT INTO auth.local_credentials(user_id, email, password) VALUES ($1, $2, $3)", [id, email, password]);
      }
      const session = makeSession(id, email);
      await writeSession(session);
      return { data: { session, user: session.user }, error: null };
    } catch (err) {
      return { data: { session: null, user: null }, error: fail(err) };
    }
  },
  async signOut() {
    await writeSession(null);
    return { error: null };
  },
  onAuthStateChange(cb: (event: string, session: LocalSession | null) => void) {
    listeners.add(cb);
    setTimeout(() => cb("INITIAL_SESSION", readSession()), 0);
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
  },
};

/* ------------------------------------------------------------------ rpc */

async function rpc(fn: string, args?: Record<string, unknown>): Promise<Result> {
  try {
    const { db, funcs } = await getEngine();
    const ctx = new Ctx();
    const named = Object.entries(args ?? {}).map(([k, v]) => `${q(k)} => ${ctx.push(serialize(v))}`);
    const call = `${q(fn)}(${named.join(", ")})`;
    const retset = funcs[fn]?.retset ?? false;
    const sql = retset ? `SELECT * FROM ${call}` : `SELECT ${call} AS value`;
    const res = await db.query<any>(sql, ctx.params);
    if (retset) return { data: normalize(res.rows), error: null, count: null, status: 200 };
    const value = res.rows[0]?.value ?? null;
    return { data: normalize(value), error: null, count: null, status: 200 };
  } catch (err) {
    return { data: null, error: fail(err), count: null, status: 500 };
  }
}

class RpcBuilder implements PromiseLike<Result> {
  constructor(private fn: string, private args?: Record<string, unknown>) {}
  select() {
    return this;
  }
  single() {
    return this.then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })) as unknown as RpcBuilder;
  }
  maybeSingle() {
    return this.single();
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return rpc(this.fn, this.args).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

/* --------------------------------------------------------------- client */

export const supabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  rpc(fn: string, args?: Record<string, unknown>) {
    return new RpcBuilder(fn, args);
  },
  auth,
  /** Offline build: realtime, storage and edge functions are not used. */
  channel() {
    return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} } as any;
  },
  removeChannel() {},
  functions: { invoke: async () => ({ data: null, error: { message: "Not available offline" } }) },
  storage: { from: () => ({ upload: async () => ({ data: null, error: { message: "Not available offline" } }) }) },
} as any;

export default supabase;
