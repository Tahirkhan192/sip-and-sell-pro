/**
 * PHASE 5A — cloud vs local CALCULATION parity harness (infrastructure only).
 *
 * `parity.ts` (Phase 4) compares stored rows between the cloud and the local
 * mirror. This module compares *computed results* — a report total, a summary
 * object, a list of computed rows — so that when local business calculations
 * eventually exist, they can be proven identical to the cloud ones.
 *
 * No business logic is ported here and none of the cloud RPCs are reproduced.
 * Comparison is value-based and uses the same canonical serializer as the
 * backup/mutation integrity code, so property order never matters.
 */

import { canonicalStringify } from "@/data/backup/format";

export type FieldDiff = { path: string; cloud: unknown; local: unknown };

export type ValueParity = {
  equal: boolean;
  missingFields: string[];
  unexpectedFields: string[];
  differingFields: FieldDiff[];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** Numbers within `epsilon` compare equal (float noise, not a real drift). */
function numbersEqual(a: number, b: number, epsilon: number): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  return Math.abs(a - b) <= epsilon;
}

function walk(
  cloud: unknown,
  local: unknown,
  path: string,
  epsilon: number,
  out: ValueParity,
): void {
  if (typeof cloud === "number" && typeof local === "number") {
    if (!numbersEqual(cloud, local, epsilon)) out.differingFields.push({ path, cloud, local });
    return;
  }
  if (Array.isArray(cloud) || Array.isArray(local)) {
    const a = Array.isArray(cloud) ? cloud : [];
    const b = Array.isArray(local) ? local : [];
    if (!Array.isArray(cloud) || !Array.isArray(local) || a.length !== b.length) {
      out.differingFields.push({ path, cloud, local });
      return;
    }
    a.forEach((item, i) => walk(item, b[i], `${path}[${i}]`, epsilon, out));
    return;
  }
  if (isPlainObject(cloud) && isPlainObject(local)) {
    for (const key of Object.keys(cloud)) {
      const p = path ? `${path}.${key}` : key;
      if (!(key in local)) {
        out.missingFields.push(p);
        continue;
      }
      walk(cloud[key], local[key], p, epsilon, out);
    }
    for (const key of Object.keys(local)) {
      if (!(key in cloud)) out.unexpectedFields.push(path ? `${path}.${key}` : key);
    }
    return;
  }
  if (canonicalStringify(cloud) !== canonicalStringify(local)) {
    out.differingFields.push({ path, cloud, local });
  }
}

/**
 * Compares one cloud result against one local result.
 * `epsilon` tolerates floating-point noise on money/quantity totals.
 */
export function compareValues(
  cloud: unknown,
  local: unknown,
  opts: { epsilon?: number } = {},
): ValueParity {
  const out: ValueParity = {
    equal: false,
    missingFields: [],
    unexpectedFields: [],
    differingFields: [],
  };
  walk(cloud, local, "", opts.epsilon ?? 0, out);
  out.equal =
    out.missingFields.length === 0 &&
    out.unexpectedFields.length === 0 &&
    out.differingFields.length === 0;
  return out;
}

export type RowSetParity = {
  equal: boolean;
  missingRows: string[];
  unexpectedRows: string[];
  duplicateCloud: string[];
  duplicateLocal: string[];
  rowDiffs: { key: string; parity: ValueParity }[];
};

/** Compares two computed row sets keyed by `key` (default "id"). */
export function compareRowSets(
  cloudRows: Record<string, unknown>[],
  localRows: Record<string, unknown>[],
  opts: { key?: string; epsilon?: number } = {},
): RowSetParity {
  const key = opts.key ?? "id";
  const index = (rows: Record<string, unknown>[]) => {
    const map = new Map<string, Record<string, unknown>>();
    const dupes: string[] = [];
    for (const r of rows) {
      const k = String(r?.[key]);
      if (map.has(k)) dupes.push(k);
      else map.set(k, r);
    }
    return { map, dupes };
  };
  const c = index(cloudRows);
  const l = index(localRows);

  const missingRows = [...c.map.keys()].filter((k) => !l.map.has(k));
  const unexpectedRows = [...l.map.keys()].filter((k) => !c.map.has(k));
  const rowDiffs: RowSetParity["rowDiffs"] = [];
  for (const [k, cloudRow] of c.map) {
    const localRow = l.map.get(k);
    if (!localRow) continue;
    const parity = compareValues(cloudRow, localRow, { epsilon: opts.epsilon });
    if (!parity.equal) rowDiffs.push({ key: k, parity });
  }

  return {
    equal:
      missingRows.length === 0 &&
      unexpectedRows.length === 0 &&
      rowDiffs.length === 0 &&
      c.dupes.length === 0 &&
      l.dupes.length === 0,
    missingRows,
    unexpectedRows,
    duplicateCloud: c.dupes,
    duplicateLocal: l.dupes,
    rowDiffs,
  };
}

export type CalcParityReport<T = unknown> = {
  name: string;
  ok: boolean;
  cloud: T;
  local: T;
  parity: ValueParity;
  notes: string[];
  checkedAt: string;
};

/**
 * Runs a cloud calculation and its local counterpart and reports the
 * difference. Never throws on a mismatch — a mismatch is a report.
 */
export async function compareCalculation<T>(
  name: string,
  runCloud: () => Promise<T> | T,
  runLocal: () => Promise<T> | T,
  opts: { epsilon?: number } = {},
): Promise<CalcParityReport<T>> {
  const notes: string[] = [];
  let cloud: any = null;
  let local: any = null;
  try {
    cloud = await runCloud();
  } catch (e: any) {
    notes.push(`cloud calculation failed: ${e?.message ?? e}`);
  }
  try {
    local = await runLocal();
  } catch (e: any) {
    notes.push(`local calculation failed: ${e?.message ?? e}`);
  }
  const parity = compareValues(cloud, local, opts);
  if (!parity.equal) {
    if (parity.missingFields.length) notes.push(`missing locally: ${parity.missingFields.join(", ")}`);
    if (parity.unexpectedFields.length)
      notes.push(`unexpected locally: ${parity.unexpectedFields.join(", ")}`);
    for (const d of parity.differingFields.slice(0, 10)) {
      notes.push(`${d.path || "(value)"}: cloud=${JSON.stringify(d.cloud)} local=${JSON.stringify(d.local)}`);
    }
  }
  return {
    name,
    ok: parity.equal && notes.length === 0,
    cloud,
    local,
    parity,
    notes,
    checkedAt: new Date().toISOString(),
  };
}
