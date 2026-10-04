/**
 * Imports a backup snapshot into the database on this computer.
 *
 * Every table is upserted on its ORIGINAL primary key, in dependency order,
 * so importing the same snapshot any number of times always leaves exactly
 * one copy of each record.
 */

import { supabase } from "@/integrations/supabase/client";
import { withRestoreMode } from "@/lib/local-db/engine";
import { BACKUP_TABLES, primaryKeyOf, type BackupFile } from "./format";

const CHUNK = 300;

export type ApplyProgress = { table: string; index: number; total: number; rows: number };

export async function applyBackup(
  backup: BackupFile,
  onProgress?: (p: ApplyProgress) => void,
  only?: readonly string[],
): Promise<{ rows: number }> {
  const order = new Map(BACKUP_TABLES.map((t, i) => [t, i]));
  const keep = only ? new Set(only) : null;
  const tables = [...backup.tables]
    .filter((t) => !keep || keep.has(t.table))
    .sort((a, b) => (order.get(a.table) ?? 999) - (order.get(b.table) ?? 999));

  // Restored rows already carry their money movements and stock effects, so the
  // database rules are held back while they land — otherwise every purchase and
  // sale would get a second money movement dated today.
  return withRestoreMode(async () => {
    let rows = 0;
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const pk = t.primaryKey ?? primaryKeyOf(t.table);
      onProgress?.({ table: t.table, index: i, total: tables.length, rows: 0 });
      for (let from = 0; from < (t.rows?.length ?? 0); from += CHUNK) {
        const slice = t.rows.slice(from, from + CHUNK);
        if (t.table === "sales") await resolveInvoiceCollisions(slice);
        const { error } = await (supabase as any).from(t.table).upsert(slice, { onConflict: pk });
        if (error) throw new Error(`${t.table}: ${error.message}`);
        rows += slice.length;
        onProgress?.({ table: t.table, index: i, total: tables.length, rows: from + slice.length });
      }
    }
    return { rows };
  });
}

/**
 * A bill on this device may use the same invoice number as a different bill in
 * the backup (e.g. made here before restoring). Keep BOTH: the local bill gets
 * a "-L" suffix so the backup's bill can land with its original number.
 */
async function resolveInvoiceCollisions(slice: any[]) {
  const nos = slice.map((r) => r?.invoice_no).filter(Boolean);
  if (!nos.length) return;
  const { data, error } = await (supabase as any)
    .from("sales")
    .select("id, invoice_no")
    .in("invoice_no", nos);
  if (error || !data?.length) return;
  const idByNo = new Map(slice.map((r) => [r.invoice_no, r.id]));
  for (const row of data) {
    if (idByNo.get(row.invoice_no) === row.id) continue;
    let suffix = "-L";
    for (let n = 2; n < 50; n++) {
      const candidate = `${row.invoice_no}${suffix}`;
      const { error: e } = await (supabase as any)
        .from("sales")
        .update({ invoice_no: candidate })
        .eq("id", row.id);
      if (!e) break;
      suffix = `-L${n}`;
    }
  }
}

