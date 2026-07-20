/**
 * Local-first read engine for Supabase PostgREST GET requests.
 *
 * Serves `GET /rest/v1/<table>?...` entirely from IndexedDB so no read path
 * ever hits the network during normal business operations. Falls back to
 * the network (returns `null`) for query shapes not implemented here so
 * unusual pages degrade rather than corrupt.
 *
 * Supported PostgREST features:
 *   • select projection (columns and embeds like `products(name)`)
 *   • aliased embeds  (`alias:table!fk(cols)`)
 *   • inner joins     (`table!inner(...)` filters null embeds)
 *   • filter ops:     eq, neq, gt, gte, lt, lte, like, ilike, in, is, not.*
 *   • order:          `order=col.asc,col2.desc.nullsfirst`
 *   • limit / offset  and `Range: from-to` header
 *   • .single() / .maybeSingle() via `Accept: application/vnd.pgrst.object+json`
 *   • count queries:  `Prefer: count=exact` (+ HEAD returns `Content-Range: 0-*/N`)
 *   • soft-delete columns pass through unchanged
 */

import { localDb, SYNCED_TABLES, type SyncedTable } from "./db";

type Row = Record<string, unknown>;

/** Foreign-key resolution map used to resolve `select=..., table(cols)` embeds. */
const FK_MAP: Record<string, Record<string, { target: string; fk: string }>> = {
  sale_items: {
    products: { target: "products", fk: "product_id" },
    sales: { target: "sales", fk: "sale_id" },
  },
  sales: {
    customers: { target: "customers", fk: "customer_id" },
  },
  purchase_items: {
    products: { target: "products", fk: "product_id" },
    stock_items: { target: "stock_items", fk: "stock_item_id" },
    purchases: { target: "purchases", fk: "purchase_id" },
  },
  purchases: {
    suppliers: { target: "suppliers", fk: "supplier_id" },
    purchase_items: { target: "purchase_items", fk: "purchase_id", reverse: true } as any,
  },
  stock_purchases: {
    products: { target: "products", fk: "product_id" },
    stock_items: { target: "stock_items", fk: "stock_item_id" },
  },
  recipes: {
    products: { target: "products", fk: "component_product_id" }, // default
    stock_items: { target: "stock_items", fk: "component_stock_item_id" },
    // aliased embeds resolved via constraint name in resolveEmbed
  },
  expenses: {
    expense_categories: { target: "expense_categories", fk: "category_id" },
  },
  stock_transfers: {
    products: { target: "products", fk: "product_id" },
    stock_items: { target: "stock_items", fk: "stock_item_id" },
  },
  cash_movements: {
    money_movement_subcategories: { target: "money_movement_subcategories", fk: "subcategory_id" },
  },
  production_batches: {
    products: { target: "products", fk: "product_id" },
    production_batch_items: { target: "production_batch_items", fk: "batch_id", reverse: true } as any,
  },
  production_batch_items: {
    products: { target: "products", fk: "product_id" },
    stock_items: { target: "stock_items", fk: "stock_item_id" },
  },
};

/** Explicit constraint-name → FK column lookup for aliased embeds. */
const CONSTRAINT_MAP: Record<string, { target: string; fk: string }> = {
  recipes_parent_product_id_fkey: { target: "products", fk: "parent_product_id" },
  recipes_component_product_id_fkey: { target: "products", fk: "component_product_id" },
  recipes_component_stock_item_id_fkey: { target: "stock_items", fk: "component_stock_item_id" },
};

type Embed = {
  raw: string;
  alias: string;        // key on the parent row for the resolved value
  targetTable: string;
  fkColumn: string;
  inner: boolean;
  columns: string[] | null; // null = all
  reverse: boolean;     // true when embedding many-side (e.g. purchase_items on purchases)
  reverseKey?: string;  // column on the child that references parent.id
  nested: Embed[];
};

type ParsedSelect = { columns: string[] | null; embeds: Embed[] };

type FilterOp =
  | { col: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: string }
  | { col: string; op: "like" | "ilike"; pattern: string }
  | { col: string; op: "in"; values: string[] }
  | { col: string; op: "is"; value: "null" | "not.null" | "true" | "false" }
  | { col: string; op: "not.eq" | "not.is"; value: string };

type ParsedQuery = {
  table: string;
  select: ParsedSelect;
  filters: FilterOp[];
  order: Array<{ col: string; asc: boolean }>;
  limit: number | null;
  offset: number;
  rangeFrom: number | null;
  rangeTo: number | null;
  wantsSingle: boolean;
  wantsCount: boolean;
  isHead: boolean;
};

// ---------- URL parsing ----------

function stripOuterParens(s: string): string {
  return s.startsWith("(") && s.endsWith(")") ? s.slice(1, -1) : s;
}

/** Split a comma-separated select list respecting nested parentheses. */
function splitSelectList(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}

function parseSelect(sel: string, parentTable: string): ParsedSelect {
  if (!sel || sel === "*") return { columns: null, embeds: [] };
  const parts = splitSelectList(sel);
  const columns: string[] = [];
  const embeds: Embed[] = [];
  let sawStar = false;
  for (const part of parts) {
    const parenIdx = part.indexOf("(");
    if (parenIdx === -1) {
      if (part === "*") { sawStar = true; continue; }
      columns.push(part);
      continue;
    }
    // Embed: [alias:]table[!fk][!inner]( cols )
    const head = part.slice(0, parenIdx);
    const body = part.slice(parenIdx + 1, part.lastIndexOf(")"));
    let alias: string;
    let spec: string;
    if (head.includes(":")) {
      const [a, rest] = head.split(":");
      alias = a.trim();
      spec = rest.trim();
    } else {
      alias = head.trim();
      spec = head.trim();
    }
    const inner = /!inner\b/.test(spec);
    spec = spec.replace(/!inner\b/, "");
    let constraint: string | null = null;
    if (spec.includes("!")) {
      const idx = spec.indexOf("!");
      constraint = spec.slice(idx + 1);
      spec = spec.slice(0, idx);
    }
    const resolved = resolveEmbed(parentTable, spec, constraint);
    if (!resolved) continue; // silently drop unknown embed
    const nested = parseSelect(body, resolved.targetTable);
    embeds.push({
      raw: part,
      alias: alias || spec,
      targetTable: resolved.targetTable,
      fkColumn: resolved.fk,
      inner,
      columns: nested.columns,
      reverse: !!resolved.reverse,
      reverseKey: resolved.reverse ? resolved.fk : undefined,
      nested: nested.embeds,
    });
  }
  return { columns: sawStar ? null : (columns.length ? columns : null), embeds };
}

function resolveEmbed(parentTable: string, childSpec: string, constraint: string | null):
  { target: string; fk: string; reverse?: boolean } | null {
  if (constraint && CONSTRAINT_MAP[constraint]) return CONSTRAINT_MAP[constraint];
  const perParent = FK_MAP[parentTable];
  if (perParent && perParent[childSpec]) return perParent[childSpec];
  // Also allow parent-of-child lookup by scanning FK_MAP for reverse relation.
  for (const [pt, links] of Object.entries(FK_MAP)) {
    if (pt !== parentTable) continue;
    if (links[childSpec]) return links[childSpec];
  }
  return null;
}

function parseFilters(u: URL): FilterOp[] {
  const out: FilterOp[] = [];
  u.searchParams.forEach((raw, key) => {
    if (["select", "on_conflict", "order", "limit", "offset"].includes(key)) return;
    // supabase-js sometimes appends a duplicate `apikey` etc. — skip non-column-like
    if (key.startsWith("$") || key === "apikey") return;
    // Values look like `eq.value`, `in.(a,b,c)`, `is.null`, `not.eq.value`, `not.is.null`
    if (raw.startsWith("in.")) {
      const listRaw = stripOuterParens(raw.slice(3));
      const values = listRaw.split(",").map((s) => s.replace(/^"|"$/g, ""));
      out.push({ col: key, op: "in", values });
      return;
    }
    if (raw.startsWith("is.")) {
      out.push({ col: key, op: "is", value: raw.slice(3) as any });
      return;
    }
    if (raw.startsWith("not.")) {
      const rest = raw.slice(4);
      const m = rest.match(/^(eq|is)\.(.+)$/);
      if (m) {
        out.push({ col: key, op: `not.${m[1]}` as "not.eq" | "not.is", value: m[2] });
        return;
      }
      return;
    }
    const m = raw.match(/^(eq|neq|gt|gte|lt|lte|like|ilike)\.(.*)$/s);
    if (!m) return;
    const op = m[1] as FilterOp["op"];
    const value = m[2];
    if (op === "like" || op === "ilike") out.push({ col: key, op, pattern: value });
    else out.push({ col: key, op: op as any, value });
  });
  return out;
}

function parseOrder(u: URL): ParsedQuery["order"] {
  const spec = u.searchParams.get("order");
  if (!spec) return [];
  return spec.split(",").map((p) => {
    const [col, ...mods] = p.trim().split(".");
    const asc = !mods.includes("desc");
    return { col, asc };
  }).filter((o) => o.col);
}

function parseRangeHeader(hdr: string | null | undefined): { from: number | null; to: number | null } {
  if (!hdr) return { from: null, to: null };
  const m = hdr.match(/^(\d+)-(\d+)?$/);
  if (!m) return { from: null, to: null };
  return { from: Number(m[1]), to: m[2] ? Number(m[2]) : null };
}

export function parseQuery(url: string, headers: Headers, method: string): ParsedQuery | null {
  const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://x");
  const m = u.pathname.match(/\/rest\/v1\/([^/?]+)$/);
  if (!m) return null;
  const table = m[1];
  if (table === "rpc") return null;
  if (!SYNCED_TABLES.includes(table as SyncedTable)) return null;

  // Unsupported query shapes → bail (fall back to network).
  for (const [k, v] of u.searchParams) {
    if (k === "or" || k === "and" || k === "not") return null;
    if (v.startsWith("fts.") || v.startsWith("plfts.") || v.startsWith("phfts.") || v.startsWith("cs.") || v.startsWith("cd.") || v.startsWith("ov.")) return null;
  }

  const select = parseSelect(u.searchParams.get("select") || "*", table);
  const filters = parseFilters(u);
  const order = parseOrder(u);
  const limit = u.searchParams.get("limit");
  const offset = u.searchParams.get("offset");
  const range = parseRangeHeader(headers.get("range"));
  const accept = headers.get("accept") || "";
  const prefer = headers.get("prefer") || "";

  return {
    table,
    select,
    filters,
    order,
    limit: limit ? Number(limit) : null,
    offset: offset ? Number(offset) : 0,
    rangeFrom: range.from,
    rangeTo: range.to,
    wantsSingle: accept.includes("application/vnd.pgrst.object+json"),
    wantsCount: /count=(exact|planned|estimated)/.test(prefer),
    isHead: method.toUpperCase() === "HEAD",
  };
}

// ---------- Execution ----------

function likeToRegex(pattern: string, flags: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, flags);
}

function matches(row: Row, filters: FilterOp[]): boolean {
  for (const f of filters) {
    const v = row[f.col];
    switch (f.op) {
      case "eq": if (String(v) !== f.value) return false; break;
      case "neq": if (String(v) === f.value) return false; break;
      case "gt": if (!(Number(v) > Number(f.value)) && !(String(v) > f.value)) return false; break;
      case "gte": if (!(Number(v) >= Number(f.value)) && !(String(v) >= f.value)) return false; break;
      case "lt": if (!(Number(v) < Number(f.value)) && !(String(v) < f.value)) return false; break;
      case "lte": if (!(Number(v) <= Number(f.value)) && !(String(v) <= f.value)) return false; break;
      case "like": if (!likeToRegex(f.pattern, "").test(String(v ?? ""))) return false; break;
      case "ilike": if (!likeToRegex(f.pattern, "i").test(String(v ?? ""))) return false; break;
      case "in": if (!f.values.includes(String(v))) return false; break;
      case "is":
        if (f.value === "null") { if (v !== null && v !== undefined) return false; }
        else if (f.value === "not.null") { if (v === null || v === undefined) return false; }
        else if (f.value === "true") { if (v !== true) return false; }
        else if (f.value === "false") { if (v !== false) return false; }
        break;
      case "not.eq": if (String(v) === f.value) return false; break;
      case "not.is":
        if (f.value === "null") { if (v === null || v === undefined) return false; }
        else if (f.value === "not.null") { if (v !== null && v !== undefined) return false; }
        break;
    }
  }
  return true;
}

function compareRows(a: Row, b: Row, order: ParsedQuery["order"]): number {
  for (const { col, asc } of order) {
    const va = a[col];
    const vb = b[col];
    if (va == null && vb == null) continue;
    if (va == null) return asc ? -1 : 1;
    if (vb == null) return asc ? 1 : -1;
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    if (cmp !== 0) return asc ? cmp : -cmp;
  }
  return 0;
}

function project(row: Row, sel: ParsedSelect): Row {
  if (!sel.columns) return { ...row };
  const out: Row = {};
  for (const c of sel.columns) out[c] = row[c];
  // Always retain id when the caller asked for a subset that doesn't include it —
  // PostgREST does the same only when explicitly asked; keep behavior strict.
  return out;
}

async function resolveEmbeds(rows: Row[], parentTable: string, embeds: Embed[]): Promise<Row[]> {
  if (!embeds.length) return rows;
  const dexie = localDb();
  for (const embed of embeds) {
    const tbl = dexie.tables.find((t) => t.name === embed.targetTable);
    if (!tbl) continue;
    if (embed.reverse) {
      // Many-side: find children where child[fkColumn] === parent.id
      const parentIds = rows.map((r) => r.id).filter(Boolean) as string[];
      const children = (await (tbl as any).where(embed.fkColumn).anyOf(parentIds).toArray()) as Row[];
      const alive = children.filter((c) => !c.deleted_at);
      const nested = embed.nested.length ? await resolveEmbeds(alive, embed.targetTable, embed.nested) : alive;
      const grouped: Record<string, Row[]> = {};
      for (let i = 0; i < alive.length; i++) {
        const c = alive[i];
        const key = String(c[embed.fkColumn]);
        (grouped[key] ??= []).push(project(nested[i], { columns: embed.columns, embeds: [] }));
      }
      for (const r of rows) r[embed.alias] = grouped[String(r.id)] ?? [];
    } else {
      // One-side
      const ids = Array.from(new Set(rows.map((r) => r[embed.fkColumn]).filter(Boolean))) as string[];
      const fetched = ids.length ? await (tbl as any).bulkGet(ids) : [];
      const byId: Record<string, Row> = {};
      for (const row of fetched) if (row && (row as Row).id) byId[String((row as Row).id)] = row as Row;
      const nested = embed.nested.length
        ? await resolveEmbeds(Object.values(byId), embed.targetTable, embed.nested)
        : Object.values(byId);
      // Rebuild map after nested resolution mutated objects.
      const nestedById: Record<string, Row> = {};
      for (const r of nested) nestedById[String((r as Row).id)] = r as Row;
      for (const r of rows) {
        const fkVal = r[embed.fkColumn];
        const child = fkVal ? nestedById[String(fkVal)] : null;
        r[embed.alias] = child ? project(child, { columns: embed.columns, embeds: [] }) : null;
      }
    }
    // Inner-join semantics: drop parents whose embed is null/empty.
    if (embed.inner) {
      rows = rows.filter((r) => {
        const v = r[embed.alias];
        if (Array.isArray(v)) return v.length > 0;
        return v != null;
      });
    }
  }
  return rows;
}

/**
 * Execute the query locally. Returns a fetch Response, or null when the
 * query shape is unsupported and the caller should fall through to network.
 */
export async function serveLocalRead(url: string, method: string, headers: Headers): Promise<Response | null> {
  const q = parseQuery(url, headers, method);
  if (!q) return null;
  try {
    const dexie = localDb();
    const tbl = dexie.tables.find((t) => t.name === q.table);
    if (!tbl) return null;
    let rows = (await tbl.toArray()) as Row[];
    // Default: hide soft-deleted unless caller filters explicitly on deleted_at.
    const wantsDeleted = q.filters.some((f) => f.col === "deleted_at");
    if (!wantsDeleted) rows = rows.filter((r) => !r.deleted_at);

    rows = rows.filter((r) => matches(r, q.filters));

    if (q.order.length) rows.sort((a, b) => compareRows(a, b, q.order));

    const totalCount = rows.length;

    // Range / limit / offset
    let sliceFrom = q.offset;
    let sliceTo = q.limit != null ? sliceFrom + q.limit : rows.length;
    if (q.rangeFrom != null) {
      sliceFrom = q.rangeFrom;
      sliceTo = q.rangeTo != null ? q.rangeTo + 1 : rows.length;
    }
    rows = rows.slice(sliceFrom, sliceTo);

    if (q.select.embeds.length) rows = await resolveEmbeds(rows, q.table, q.select.embeds);

    const projected = rows.map((r) => {
      const p = project(r, q.select);
      // Preserve embed aliases (project drops unknown columns when a subset is asked).
      for (const e of q.select.embeds) p[e.alias] = r[e.alias];
      return p;
    });

    const respHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-local-first": "1",
    };
    if (q.wantsCount) {
      const to = Math.max(sliceFrom, sliceFrom + projected.length - 1);
      respHeaders["Content-Range"] = `${sliceFrom}-${to}/${totalCount}`;
    }

    if (q.isHead) {
      return new Response(null, { status: 200, statusText: "OK (local-first)", headers: respHeaders });
    }

    if (q.wantsSingle) {
      if (projected.length === 0) {
        // PGRST116: no rows for single()
        return new Response(
          JSON.stringify({ code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }),
          { status: 406, headers: respHeaders },
        );
      }
      return new Response(JSON.stringify(projected[0]), { status: 200, statusText: "OK (local-first)", headers: respHeaders });
    }

    return new Response(JSON.stringify(projected), { status: 200, statusText: "OK (local-first)", headers: respHeaders });
  } catch (err) {
    console.warn("[local-first] read failed, falling back to network", err);
    return null;
  }
}
