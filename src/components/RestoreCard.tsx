/**
 * Restore from a backup file kept on this computer.
 *
 * Accepts the app's own exported backup file and the Google Drive snapshot —
 * both use the same format. The file is checked before anything is written,
 * and every record is matched on its original ID, so restoring the same file
 * twice never creates a second copy of anything. The restored data lands in
 * this computer's own data folder, exactly where daily entries are saved.
 */

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { validateBackup } from "@/data/backup/restore";
import { applyBackup } from "@/data/backup/apply";
import type { BackupFile, BackupValidation } from "@/data/backup/format";
import { DATA_FILE, readDataFolderBackup, supportsDataFolder } from "@/lib/data-folder";

export function RestoreCard() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [check, setCheck] = useState<BackupValidation | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFile(null); setCheck(null); setStatus(""); setDone(null);
    setFileName(f.name);
    try {
      const parsed = JSON.parse(await f.text());
      const result = validateBackup(parsed);
      setCheck(result);
      if (result.ok) setFile(parsed as BackupFile);
      else toast.error("This file cannot be restored — see the problems listed.");
    } catch {
      setCheck({ ok: false, errors: ["The file is not readable JSON."], warnings: [], counts: {} });
      toast.error("The file could not be read");
    }
  }

  async function pickFromFolder() {
    setFile(null); setCheck(null); setStatus(""); setDone(null);
    try {
      const parsed = await readDataFolderBackup();
      setFileName(`${DATA_FILE} (data folder)`);
      setCheck(validateBackup(parsed));
      setFile(parsed);
    } catch (e: any) {
      setFileName("");
      setCheck({ ok: false, errors: [e?.message ?? "Could not read the data folder."], warnings: [], counts: {} });
      toast.error(e?.message ?? "Could not read the data folder");
    }
  }

  async function restore() {
    if (!file) return;
    if (!confirm("Restore this backup into the data on this computer? Existing records with the same ID are updated, nothing is duplicated.")) return;
    setBusy(true); setDone(null);
    try {
      const res = await applyBackup(file, (p) =>
        setStatus(`${p.index + 1}/${p.total} — ${p.table} (${p.rows} rows)`),
      );
      setDone(res.rows);
      setStatus("");
      toast.success(`Restored ${res.rows.toLocaleString()} records`);
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const rows = check ? Object.entries(check.counts) : [];
  const totalRows = rows.reduce((s, [, n]) => s + n, 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Restore from backup file</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Load a backup file from this computer — the file from "Export full backup" or the
              Google Drive snapshot. It is checked first, then imported into this computer's own
              data folder. Records keep their original IDs, so restoring the same file again
              never creates duplicates.
            </p>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} type="file" accept=".json,application/json" className="hidden" onChange={pick} />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose file
            </Button>
            <Button onClick={restore} disabled={!file || busy}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </div>
        </div>

        {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
        {done !== null && (
          <p className="text-xs text-emerald-600">
            Restore finished — {done.toLocaleString()} records written. Reopen the app to see everything refreshed.
          </p>
        )}

        {check && check.errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1">
            <p className="text-xs font-medium text-destructive">This file was not accepted:</p>
            {check.errors.slice(0, 8).map((m) => (
              <p key={m} className="text-xs text-destructive">• {m}</p>
            ))}
          </div>
        )}

        {check && check.ok && check.warnings.length > 0 && (
          <div className="rounded-md border p-3 space-y-1">
            <p className="text-xs font-medium">Notes:</p>
            {check.warnings.slice(0, 8).map((m) => (
              <p key={m} className="text-xs text-muted-foreground">• {m}</p>
            ))}
          </div>
        )}

        {check && check.ok && rows.length > 0 && (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Table</th>
                  <th className="text-right p-2">Records in file</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([t, n]) => (
                  <tr key={t} className="border-t">
                    <td className="p-2">{t}</td>
                    <td className="p-2 text-right tabular-nums">{n.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="p-2">Total</td>
                  <td className="p-2 text-right tabular-nums">{totalRows.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
