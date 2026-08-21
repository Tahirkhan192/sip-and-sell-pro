/**
 * PostgREST-compatible query translator.
 *
 * Turns the query shapes the app already uses (`from(...).select(...).eq(...)`,
 * embedded resources, `!inner`, ordering, ranges, counts) into plain SQL that
 * runs against the embedded local Postgres (PGlite).
 *
 * The goal is byte-for-byte behavioural parity with the cloud Data API so no
 * screen, report or calculation had to change.
 */

export type FK = {
  name: string;
  srcTable: string;
  srcCols: string[];
  tgtTable: string;
  tgtCols: string[];
};

export type Meta = {
  fks: FK[];
  pks: Record<string, string[]>;
};

export type Filter =
  | { kind: "cmp"; col: string; op: string; value: unknown; negate?: boolean }
  | { kind: "or"; col: string; raw: string };

export type OrderSpec = { col: string; ascending: boolean; nullsFirst?: boolean };

export type SelectQuery = {
  table: string;
  select: string;
  filters: Filter[];
  order: OrderSpec[];
  limit?: number;
  offset?: number;
  count?: "exact" | "planned" | "estimated";
  head?: boolean;
};

type Field = { name: string; alias?: string };
type Embed = { rel: string; alias?: string; hint?: string; inner: boolean; tree: Tree };
type Tree = { fields: Field[]; embeds: Embed[]; star: boolean };

export class Ctx {
  params: unknown[] = [];
  n = 0;
  push(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  alias() {
    return `t${this.n++}`;
  }
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Split on commas that are not inside parentheses. */
function splitTop(str: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseSelect(select: string): Tree {
  const tree: Tree = { fields: [], embeds: [], star: false };
  for (const partRaw of splitTop(select || "*")) {
    const part = partRaw.trim();
    const open = part.indexOf("(");
    if (open !== -1 && part.endsWith(")")) {
      const head = part.slice(0, open);
      const body = part.slice(open + 1, -1);
      let alias: string | undefined;
      let rest = head;
      const colon = head.indexOf(":");
      if (colon !== -1) {
        alias = head.slice(0, colon).trim();
        rest = head.slice(colon + 1).trim();
      }
      const bangs = rest.split("!").map((s) => s.trim());
      const rel = bangs[0];
      let inner = false;
      let hint: string | undefined;
      for (const b of bangs.slice(1)) {
        if (b === "inner") inner = true;
        else if (b === "left") inner = false;
        else hint = b;
      }
      tree.embeds.push({ rel, alias: alias ?? rel, hint, inner, tree: parseSelect(body) });
    } else if (part === "*") {
      tree.star = true;
    } else {
      const colon = part.indexOf(":");
      if (colon !== -1) tree.fields.push({ alias: part.slice(0, colon).trim(), name: part.slice(colon + 1).trim() });
      else tree.fields.push({ name: part });
    }
  }
  return tree;
}

type Rel = { table: string; cardinality: "one" | "many"; parentCol: string; childCol: string };

function resolveRel(meta: Meta, parent: string, embed: Embed): Rel {
  const rel = embed.rel;
  const hint = embed.hint;

  // 1. `alias:fk_column(...)` — relationship named by a FK column on the parent.
  const byCol = meta.fks.find((f) => f.srcTable === parent && f.srcCols[0] === rel);
  if (byCol) return { table: byCol.tgtTable, cardinality: "one", parentCol: byCol.srcCols[0], childCol: byCol.tgtCols[0] };

  // 2. hint is a constraint name or a FK column.
  if (hint) {
    const byName = meta.fks.find((f) => f.name === hint);
    if (byName) {
      if (byName.srcTable === parent)
        return { table: byName.tgtTable, cardinality: "one", parentCol: byName.srcCols[0], childCol: byName.tgtCols[0] };
      return { table: byName.srcTable, cardinality: "many", parentCol: byName.tgtCols[0], childCol: byName.srcCols[0] };
    }
    const hintCol = meta.fks.find((f) => f.srcTable === parent && f.tgtTable === rel && f.srcCols[0] === hint);
    if (hintCol)
      return { table: hintCol.tgtTable, cardinality: "one", parentCol: hintCol.srcCols[0], childCol: hintCol.tgtCols[0] };
    const childHint = meta.fks.find((f) => f.srcTable === rel && f.tgtTable === parent && f.srcCols[0] === hint);
    if (childHint)
      return { table: childHint.srcTable, cardinality: "many", parentCol: childHint.tgtCols[0], childCol: childHint.srcCols[0] };
  }

  // 3. parent -> target (many-to-one)
  const toParentTarget = meta.fks.filter((f) => f.srcTable === parent && f.tgtTable === rel);
  if (toParentTarget.length === 1) {
    const f = toParentTarget[0];
    return { table: f.tgtTable, cardinality: "one", parentCol: f.srcCols[0], childCol: f.tgtCols[0] };
  }

  // 4. target -> parent (one-to-many)
  const children = meta.fks.filter((f) => f.srcTable === rel && f.tgtTable === parent);
  if (children.length >= 1) {
    const f = children[0];
    return { table: f.srcTable, cardinality: "many", parentCol: f.tgtCols[0], childCol: f.srcCols[0] };
  }

  if (toParentTarget.length > 1) {
    const f = toParentTarget[0];
    return { table: f.tgtTable, cardinality: "one", parentCol: f.srcCols[0], childCol: f.tgtCols[0] };
  }

  throw new Error(`Could not resolve relationship "${parent}" -> "${rel}"`);
}

function cmpSql(ctx: Ctx, colExpr: string, op: string, value: unknown): string {
  switch (op) {
    case "eq":
      return value === null ? `${colExpr} IS NULL` : `${colExpr} = ${ctx.push(value)}`;
    case "neq":
      return value === null ? `${colExpr} IS NOT NULL` : `${colExpr} <> ${ctx.push(value)}`;
    case "gt":
      return `${colExpr} > ${ctx.push(value)}`;
    case "gte":
      return `${colExpr} >= ${ctx.push(value)}`;
    case "lt":
      return `${colExpr} < ${ctx.push(value)}`;
    case "lte":
      return `${colExpr} <= ${ctx.push(value)}`;
    case "like":
      return `${colExpr}::text LIKE ${ctx.push(value)}`;
    case "ilike":
      return `${colExpr}::text ILIKE ${ctx.push(value)}`;
    case "is":
      if (value === null || value === "null") return `${colExpr} IS NULL`;
      if (value === true || value === "true") return `${colExpr} IS TRUE`;
      if (value === false || value === "false") return `${colExpr} IS FALSE`;
      return `${colExpr} IS NOT DISTINCT FROM ${ctx.push(value)}`;
    case "in": {
      const list = (Array.isArray(value) ? value : [value]) as unknown[];
      if (list.length === 0) return "false";
      return `${colExpr} IN (${list.map((v) => ctx.push(v)).join(", ")})`;
    }
    case "cs":
      return `${colExpr} @> ${ctx.push(JSON.stringify(value))}::jsonb`;
    default:
      return `${colExpr} = ${ctx.push(value)}`;
  }
}

/** Parses one `col.op.value` term of an `.or(...)` string. */
function orTerm(ctx: Ctx, alias: string, term: string): string {
  const first = term.indexOf(".");
  const second = term.indexOf(".", first + 1);
  if (first === -1 || second === -1) return "true";
  const col = term.slice(0, first);
  const op = term.slice(first + 1, second);
  let raw: unknown = term.slice(second + 1);
  if (raw === "null") raw = null;
  else if (raw === "true") raw = true;
  else if (raw === "false") raw = false;
  return cmpSql(ctx, `${q(alias)}.${q(col)}`, op, raw);
}

function whereFor(ctx: Ctx, alias: string, filters: Filter[]): string[] {
  const out: string[] = [];
  for (const f of filters) {
    if (f.kind === "or") {
      const parts = splitTop(f.raw).map((t) => orTerm(ctx, alias, t));
      out.push(`(${parts.join(" OR ")})`);
    } else {
      const sql = cmpSql(ctx, `${q(alias)}.${q(f.col)}`, f.op, f.value);
      out.push(f.negate ? `NOT (${sql})` : sql);
    }
  }
  return out;
}

/** Splits filters into ones for this level and ones targeting an embed. */
function partition(filters: Filter[], embeds: Embed[]) {
  const own: Filter[] = [];
  const child = new Map<string, Filter[]>();
  for (const f of filters) {
    const dot = f.col.indexOf(".");
    if (dot > 0) {
      const head = f.col.slice(0, dot);
      const match = embeds.find((e) => e.alias === head || e.rel === head);
      if (match) {
        const key = match.alias ?? match.rel;
        const rest = { ...f, col: f.col.slice(dot + 1) } as Filter;
        child.set(key, [...(child.get(key) ?? []), rest]);
        continue;
      }
    }
    own.push(f);
  }
  return { own, child };
}

function renderLevel(
  ctx: Ctx,
  meta: Meta,
  table: string,
  alias: string,
  tree: Tree,
  filters: Filter[],
): { cols: string[]; where: string[] } {
  const { own, child } = partition(filters, tree.embeds);
  const cols: string[] = [];
  if (tree.star || (tree.fields.length === 0 && tree.embeds.length === 0)) cols.push(`${q(alias)}.*`);
  for (const f of tree.fields) cols.push(`${q(alias)}.${q(f.name)} AS ${q(f.alias ?? f.name)}`);

  const where = whereFor(ctx, alias, own);

  for (const e of tree.embeds) {
    const rel = resolveRel(meta, table, e);
    const sub = ctx.alias();
    const subFilters = child.get(e.alias ?? e.rel) ?? [];
    const inner = renderLevel(ctx, meta, rel.table, sub, e.tree, subFilters);
    const join =
      rel.cardinality === "one"
        ? `${q(sub)}.${q(rel.childCol)} = ${q(alias)}.${q(rel.parentCol)}`
        : `${q(sub)}.${q(rel.childCol)} = ${q(alias)}.${q(rel.parentCol)}`;
    const conds = [join, ...inner.where].join(" AND ");
    const body = `SELECT ${inner.cols.join(", ")} FROM ${q(rel.table)} ${q(sub)} WHERE ${conds}`;
    if (rel.cardinality === "one") {
      cols.push(`(SELECT to_jsonb(s) FROM (${body} LIMIT 1) s) AS ${q(e.alias ?? e.rel)}`);
    } else {
      cols.push(`(SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) FROM (${body}) s) AS ${q(e.alias ?? e.rel)}`);
    }
    if (e.inner) where.push(`EXISTS (SELECT 1 FROM ${q(rel.table)} ${q(sub)} WHERE ${conds})`);
  }

  return { cols, where };
}

export function buildSelect(meta: Meta, qy: SelectQuery): { sql: string; params: unknown[]; countSql?: string } {
  const ctx = new Ctx();
  const root = ctx.alias();
  const tree = parseSelect(qy.select);
  const { cols, where } = renderLevel(ctx, meta, qy.table, root, tree, qy.filters);

  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const orderSql = qy.order.length
    ? ` ORDER BY ${qy.order
        .map(
          (o) =>
            `${q(root)}.${q(o.col)} ${o.ascending ? "ASC" : "DESC"} ${
              o.nullsFirst === undefined ? "" : o.nullsFirst ? "NULLS FIRST" : "NULLS LAST"
            }`.trim(),
        )
        .join(", ")}`
    : "";
  const limitSql = qy.limit === undefined ? "" : ` LIMIT ${Math.max(0, Math.floor(qy.limit))}`;
  const offsetSql = qy.offset ? ` OFFSET ${Math.max(0, Math.floor(qy.offset))}` : "";

  const sql = `SELECT ${cols.join(", ")} FROM ${q(qy.table)} ${q(root)}${whereSql}${orderSql}${limitSql}${offsetSql}`;
  const countSql = qy.count ? `SELECT count(*)::int AS c FROM ${q(qy.table)} ${q(root)}${whereSql}` : undefined;
  return { sql, params: ctx.params, countSql };
}

/** Builds the WHERE clause used by update/delete (no embeds). */
export function buildWhere(filters: Filter[], alias: string, ctx: Ctx): string {
  const parts = whereFor(ctx, alias, filters);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

export { q as quoteIdent };
