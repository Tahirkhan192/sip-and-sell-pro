/**
 * Cloud (Lovable Cloud / Supabase) implementation of `DataRepository`.
 *
 * This is a *pass-through*. Every method builds the same query the screens
 * already build by hand today, so moving a screen onto the repository is a
 * mechanical refactor with no behavioural or numeric difference.
 *
 * Not imported by any route yet — the app still calls the client directly.
 */

import { supabase } from "@/integrations/supabase/client";
import type { DataRepository, Filter, Row, SelectOptions, TableName } from "./types";

const DEFAULT_PAGE = 1000;

function applyFilter(q: any, filter?: Filter) {
  if (!filter) return q;
  for (const [col, val] of Object.entries(filter.eq ?? {})) q = q.eq(col, val);
  for (const [col, val] of Object.entries(filter.neq ?? {})) q = q.neq(col, val);
  for (const [col, val] of Object.entries(filter.gte ?? {})) q = q.gte(col, val);
  for (const [col, val] of Object.entries(filter.lte ?? {})) q = q.lte(col, val);
  for (const [col, val] of Object.entries(filter.in ?? {})) q = q.in(col, val);
  for (const [col, val] of Object.entries(filter.is ?? {})) {
    q = val === "not" ? q.not(col, "is", null) : q.is(col, null);
  }
  return q;
}

function applyOrder(q: any, options?: SelectOptions) {
  const order = options?.order;
  if (!order) return q;
  const list = Array.isArray(order) ? order : [order];
  for (const o of list) q = q.order(o.column, { ascending: o.ascending ?? true });
  return q;
}

export class CloudRepository implements DataRepository {
  readonly kind = "cloud" as const;

  /** Paged so reports and history are never silently truncated at 1000 rows. */
  async list<T = Row>(table: TableName, options: SelectOptions = {}): Promise<T[]> {
    const page = options.pageSize ?? DEFAULT_PAGE;
    const out: T[] = [];
    for (let from = 0; ; from += page) {
      let q = (supabase as any).from(table).select(options.columns ?? "*");
      q = applyOrder(applyFilter(q, options.filter), options);
      const to = options.limit ? Math.min(from + page, options.limit) - 1 : from + page - 1;
      const { data, error } = await q.range(from, to);
      if (error) throw error;
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < to - from + 1) break;
      if (options.limit && out.length >= options.limit) break;
    }
    return options.limit ? out.slice(0, options.limit) : out;
  }

  async getById<T = Row>(table: TableName, id: string | number, columns = "*"): Promise<T | null> {
    const { data, error } = await (supabase as any)
      .from(table)
      .select(columns)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as T | null;
  }

  async findOne<T = Row>(table: TableName, options: SelectOptions = {}): Promise<T | null> {
    let q = (supabase as any).from(table).select(options.columns ?? "*");
    q = applyOrder(applyFilter(q, options.filter), options);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) throw error;
    return (data ?? null) as T | null;
  }

  async count(table: TableName, filter?: Filter): Promise<number> {
    let q = (supabase as any).from(table).select("id", { count: "exact", head: true });
    q = applyFilter(q, filter);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }

  async insert<T = Row>(table: TableName, values: Row | Row[]): Promise<T[]> {
    const { data, error } = await (supabase as any).from(table).insert(values).select();
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async update<T = Row>(table: TableName, values: Row, filter: Filter): Promise<T[]> {
    let q = (supabase as any).from(table).update(values);
    q = applyFilter(q, filter);
    const { data, error } = await q.select();
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async upsert<T = Row>(table: TableName, values: Row | Row[], onConflict?: string): Promise<T[]> {
    const { data, error } = await (supabase as any)
      .from(table)
      .upsert(values, onConflict ? { onConflict } : undefined)
      .select();
    if (error) throw error;
    return (data ?? []) as T[];
  }

  async remove(table: TableName, filter: Filter): Promise<void> {
    let q = (supabase as any).from(table).delete();
    q = applyFilter(q, filter);
    const { error } = await q;
    if (error) throw error;
  }

  async rpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<T> {
    const { data, error } = await (supabase as any).rpc(fn, args);
    if (error) throw error;
    return data as T;
  }
}
