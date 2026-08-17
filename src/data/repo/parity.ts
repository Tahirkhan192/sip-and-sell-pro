/**
 * PHASE 4G — cloud/local dual-read parity harness.
 *
 * Reads the same table through both repositories and compares the results as
 * canonical serialized rows. Timestamps are compared as raw strings — never
 * parsed into `Date` — so a timezone or precision difference cannot be hidden
 * by the comparison itself.
 *
 * This harness only REPORTS. It never writes, never repairs either side and
 * never decides which side is "right".
 */

import { canonicalStringify } from "@/data/backup/format";
import { primaryKeyOf } from "@/data/backup/format";
import { CloudRepository } from "./cloud-repository";
import { LocalRepository } from "./local-repository";
import type { DataRepository, Row, SelectOptions, TableName } from "./types";

export type FieldDiff = { id: string; column: string; cloud: unknown; local: unknown };

export type ParityResult = {
  table: TableName;
  ok: boolean;
  cloudCount: number;
  localCount: number;
  missingLocal: string[];
  unexpectedLocal: string[];
  duplicateLocal: string[];
  duplicateCloud: string[];
  fieldDiffs: FieldDiff[];
  orderChecked: boolean;
  orderMatches: boolean;
  notes: string[];
};

/** Canonical, order-independent representation of one row. */
export function canonicalRowOf(row: Row): string {
  const obj: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) obj[key] = row[key] ?? null;
  return canonicalStringify(obj);
}

function countBy(keys: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of keys) (seen.has(k) ? dupes : seen).add(k);
  return [...dupes].sort();
}

export async function compareTable(
  table: TableName,
  options: SelectOptions = {},
  repos: { cloud?: DataRepository; local?: DataRepository } = {},
): Promise<ParityResult> {
  const cloudRepo = repos.cloud ?? new CloudRepository();
  const localRepo = repos.local ?? new LocalRepository();
  const pk = primaryKeyOf(table);

  const [cloudRows, localRows] = await Promise.all([
    cloudRepo.list<Row>(table, options),
    localRepo.list<Row>(table, options),
  ]);

  const cloudIds = cloudRows.map((r) => String(r[pk]));
  const localIds = localRows.map((r) => String(r[pk]));
  const cloudById = new Map(cloudRows.map((r) => [String(r[pk]), r]));
  const localById = new Map(localRows.map((r) => [String(r[pk]), r]));

  const missingLocal = cloudIds.filter((id) => !localById.has(id)).sort();
  const unexpectedLocal = localIds.filter((id) => !cloudById.has(id)).sort();
  const duplicateLocal = countBy(localIds);
  const duplicateCloud = countBy(cloudIds);

  const fieldDiffs: FieldDiff[] = [];
  for (const [id, cloudRow] of cloudById) {
    const localRow = localById.get(id);
    if (!localRow) continue;
    if (canonicalRowOf(cloudRow) === canonicalRowOf(localRow)) continue;
    const columns = new Set([...Object.keys(cloudRow), ...Object.keys(localRow)]);
    for (const column of columns) {
      const a = cloudRow[column] ?? null;
      const b = localRow[column] ?? null;
      if (canonicalStringify(a) !== canonicalStringify(b)) {
        fieldDiffs.push({ id, column, cloud: a, local: b });
      }
    }
  }

  const orderChecked = Boolean(options.order);
  const orderMatches = orderChecked
    ? cloudIds.length === localIds.length && cloudIds.every((id, i) => id === localIds[i])
    : true;

  const notes: string[] = [];
  if (missingLocal.length) notes.push(`${missingLocal.length} row(s) missing locally.`);
  if (unexpectedLocal.length) notes.push(`${unexpectedLocal.length} unexpected local row(s).`);
  if (duplicateLocal.length) notes.push(`Duplicate local ids: ${duplicateLocal.join(", ")}.`);
  if (duplicateCloud.length) notes.push(`Duplicate cloud ids: ${duplicateCloud.join(", ")}.`);
  if (fieldDiffs.length) notes.push(`${fieldDiffs.length} differing field value(s).`);
  if (orderChecked && !orderMatches) notes.push("Row ordering differs between cloud and local.");

  return {
    table,
    ok:
      missingLocal.length === 0 &&
      unexpectedLocal.length === 0 &&
      duplicateLocal.length === 0 &&
      duplicateCloud.length === 0 &&
      fieldDiffs.length === 0 &&
      orderMatches &&
      cloudRows.length === localRows.length,
    cloudCount: cloudRows.length,
    localCount: localRows.length,
    missingLocal,
    unexpectedLocal,
    duplicateLocal,
    duplicateCloud,
    fieldDiffs,
    orderChecked,
    orderMatches,
    notes,
  };
}

/** Runs `compareTable` over several tables and reports each one separately. */
export async function compareTables(
  tables: TableName[],
  optionsFor: (t: TableName) => SelectOptions = () => ({}),
  repos?: { cloud?: DataRepository; local?: DataRepository },
): Promise<{ ok: boolean; results: ParityResult[] }> {
  const results: ParityResult[] = [];
  for (const t of tables) results.push(await compareTable(t, optionsFor(t), repos));
  return { ok: results.every((r) => r.ok), results };
}
