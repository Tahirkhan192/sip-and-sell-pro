/**
 * PHASE 4 — read-only query builder for the `cloud_*` mirror tables
 * (worker side).
 *
 * This is the ONLY place that turns a declarative `SelectSpec` into SQL, and
 * it runs inside the SQLite worker. There is deliberately no generic
 * `execute(sql)` operation anywhere in the protocol, so application code can
 * never send raw SQL to the local database.
 *
 * Safety rules
 *   * every value is bound as a parameter — never interpolated;
 *   * every table and column name is validated against the live schema
 *     (`PRAGMA table_info`) before it is quoted into the statement;
 *   * SELECT only. No INSERT/UPDATE/DELETE path exists in this module.
 *
 * Ordering fidelity: PostgREST/Postgres sorts NULLs LAST on ASC and FIRST on
 * DESC, whereas SQLite does the opposite, so the null ordering is written out
 * explicitly. Text columns are compared case-insensitively, which matches the
 * cloud database's `en_US.UTF-8` collation far more closely than SQLite's
 * default byte order.
 */

import type { LocalDb } from "./engine";
import { mirrorColumns, mirrorTable } from "./mirror";
import type { SqliteValue } from "./seed-format";

export type LocalFilter = {
  eq?: Record<string, SqliteValue | boolean>;
  neq?: Record<string, SqliteValue | boolean>;
  gte?: Record<string, SqliteValue>;
  lte?: Record<string, SqliteValue>;
  in?: Record<string, (SqliteValue | boolean)[]>;
  is?: Record<string, null | "not">;
};

export type LocalOrder = { column: string; ascending?: boolean };

export type SelectSpec = {
  /** Cloud table name, e.g. "products" (the mirror prefix is added here). */
  table: string;
  columns?: string[];
  filter?: LocalFilter;
  order?: LocalOrder[];
  limit?: number;
  offset?: number;
};

function schemaColumns(db: LocalDb, table: string): string[] {
  const cols = mirrorColumns(db, table).map((c) => c.name);
  if (cols.length === 0) {
    throw new Error(`Local table "${mirrorTable(table)}" does not exist.`);
  }
  return cols;
}

function quoteColumn(known: string[], column: string, table: string): string {
  if (!known.includes(column)) {
    throw new Error(`Unknown column "${column}" on local table "${mirrorTable(table)}".`);
  }
  return `"${column}"`;
}

/** Booleans are stored as 0/1 in the mirror, so bound filter values match. */
function bindValue(v: SqliteValue | boolean): SqliteValue {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function buildWhere(
  known: string[],
  table: string,
  filter: LocalFilter | undefined,
): { sql: string; params: SqliteValue[] } {
  const clauses: string[] = [];
  const params: SqliteValue[] = [];
  if (!filter) return { sql: "", params };

  const simple: [keyof LocalFilter, string][] = [
    ["eq", "="],
    ["neq", "!="],
    ["gte", ">="],
    ["lte", "<="],
  ];
  for (const [key, op] of simple) {
    for (const [col, value] of Object.entries((filter[key] ?? {}) as Record<string, any>)) {
      const c = quoteColumn(known, col, table);
      if (value === null) {
        // Mirror PostgREST: `eq.null` matches nothing; `neq.null` matches nothing either.
        clauses.push(op === "=" ? `${c} IS NULL` : `${c} IS NOT NULL`);
        continue;
      }
      clauses.push(`${c} ${op} ?`);
      params.push(bindValue(value));
    }
  }
  for (const [col, values] of Object.entries(filter.in ?? {})) {
    const c = quoteColumn(known, col, table);
    if (values.length === 0) {
      clauses.push("0 = 1");
      continue;
    }
    clauses.push(`${c} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values.map(bindValue));
  }
  for (const [col, mode] of Object.entries(filter.is ?? {})) {
    const c = quoteColumn(known, col, table);
    clauses.push(mode === "not" ? `${c} IS NOT NULL` : `${c} IS NULL`);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

function buildOrder(db: LocalDb, table: string, order: LocalOrder[] | undefined): string {
  if (!order || order.length === 0) return "";
  const meta = mirrorColumns(db, table);
  const known = meta.map((c) => c.name);
  const parts: string[] = [];
  for (const o of order) {
    const c = quoteColumn(known, o.column, table);
    const isText = meta.find((m) => m.name === o.column)?.declType === "TEXT";
    const expr = isText ? `${c} COLLATE NOCASE` : c;
    if (o.ascending === false) {
      // Postgres DESC → NULLs first.
      parts.push(`${c} IS NOT NULL`, `${expr} DESC`);
    } else {
      // Postgres ASC → NULLs last.
      parts.push(`${c} IS NULL`, `${expr} ASC`);
    }
  }
  return ` ORDER BY ${parts.join(", ")}`;
}

/** Runs a validated, fully parameterized SELECT and returns raw stored rows. */
export function runSelect(db: LocalDb, spec: SelectSpec): Record<string, SqliteValue>[] {
  const known = schemaColumns(db, spec.table);
  const projection =
    spec.columns && spec.columns.length > 0
      ? spec.columns.map((c) => quoteColumn(known, c, spec.table)).join(", ")
      : "*";
  const where = buildWhere(known, spec.table, spec.filter);
  let sql = `SELECT ${projection} FROM "${mirrorTable(spec.table)}"${where.sql}`;
  sql += buildOrder(db, spec.table, spec.order);
  const params = [...where.params];
  if (typeof spec.limit === "number") {
    sql += " LIMIT ?";
    params.push(spec.limit);
    if (typeof spec.offset === "number" && spec.offset > 0) {
      sql += " OFFSET ?";
      params.push(spec.offset);
    }
  } else if (typeof spec.offset === "number" && spec.offset > 0) {
    sql += " LIMIT -1 OFFSET ?";
    params.push(spec.offset);
  }
  // sqlite-wasm rejects a bind argument on a statement with no placeholders.
  return (params.length
    ? db.selectObjects(sql, params as any[])
    : db.selectObjects(sql)) as Record<string, SqliteValue>[];
}

/** Counts matching rows without transferring them. */
export function runCount(db: LocalDb, table: string, filter?: LocalFilter): number {
  const known = schemaColumns(db, table);
  const where = buildWhere(known, table, filter);
  const sql = `SELECT COUNT(*) FROM "${mirrorTable(table)}"${where.sql}`;
  const v = (where.params.length
    ? db.selectValues(sql, where.params as any[])
    : db.selectValues(sql)) as number[];
  return Number(v[0] ?? 0);
}
