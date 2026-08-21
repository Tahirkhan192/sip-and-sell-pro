/**
 * Imports a backup snapshot into the database on this computer.
 *
 * Every table is upserted on its ORIGINAL primary key, in dependency order,
 * so importing the same snapshot any number of times always leaves exactly
 * one copy of each record.
 */

import { supabase } from "@/integrations/supabase/client";
import { BACKUP_TABLES, primaryKeyOf, type BackupFile } from "./format";

const CHUNK = 300;

export type ApplyProgress = { table: string; index: number; total: number; rows: number };

export async function applyBackup(
  backup: BackupFile,
  onProgress?: (p: ApplyProgress) => void,
): Promise<{ rows: number }> {
  const order = new Map(BACKUP_TABLES.map((t, i) => [t, i]));
  const tables = [...backup.tables].sort(
    (a, b) => (order.get(a.table) ?? 999) - (order.get(b.table) ?? 999),
  );

  let rows = 0;
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const pk = t.primaryKey ?? primaryKeyOf(t.table);
    onProgress?.({ table: t.table, index: i, total: tables.length, rows: 0 });
    for (let from = 0; from < (t.rows?.length ?? 0); from += CHUNK) {
      const slice = t.rows.slice(from, from + CHUNK);
      const { error } = await (supabase as any).from(t.table).upsert(slice, { onConflict: pk });
      if (error) throw new Error(`${t.table}: ${error.message}`);
      rows += slice.length;
      onProgress?.({ table: t.table, index: i, total: tables.length, rows: from + slice.length });
    }
  }
  return { rows };
}
