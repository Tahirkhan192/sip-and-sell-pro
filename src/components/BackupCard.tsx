import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { exportFullBackup, downloadBackup, verificationReport } from "@/data/backup/export";
import type { BackupFile } from "@/data/backup/format";

export function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<ReturnType<typeof verificationReport>>([]);
  const [backup, setBackup] = useState<BackupFile | null>(null);

  const run = async () => {
    setBusy(true);
    setReport([]);
    setBackup(null);
    try {
      const file = await exportFullBackup((p) =>
        setStatus(`${p.index + 1}/${p.total} — ${p.table} (${p.rows} rows)`),
      );
      setBackup(file);
      setReport(verificationReport(file));
      setStatus(`${file.totals.rows.toLocaleString()} rows across ${file.totals.tables} tables`);
      if (file.complete) {
        downloadBackup(file);
        toast.success("Backup exported and verified");
      } else {
        toast.error("Export incomplete — counts did not match. File not downloaded.");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Export failed");
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Full data backup</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Read-only export of every record from every table — complete history, original IDs
              and relationships preserved, no 1,000-row limit. Downloads a JSON backup file that
              the future offline (Windows) app can restore without duplicating anything.
            </p>
          </div>
          <Button onClick={run} disabled={busy}>
            {busy ? "Exporting…" : "Export full backup"}
          </Button>
        </div>

        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {report.length > 0 && (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Table</th>
                  <th className="text-right p-2">In database</th>
                  <th className="text-right p-2">Exported</th>
                  <th className="text-right p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.table} className="border-t">
                    <td className="p-2">{r.table}</td>
                    <td className="p-2 text-right tabular-nums">{r.inDatabase.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{r.exported.toLocaleString()}</td>
                    <td className={`p-2 text-right ${r.ok ? "text-emerald-600" : "text-destructive"}`}>
                      {r.ok ? "OK" : "Truncated"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {backup && !backup.complete && (
          <Button variant="outline" size="sm" onClick={() => downloadBackup(backup)}>
            Download anyway
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
