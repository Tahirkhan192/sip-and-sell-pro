import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { exportFullBackup, downloadBackup, verificationReport } from "@/data/backup/export";
import { validateBackup } from "@/data/backup/restore";
import type { BackupFile } from "@/data/backup/format";

export function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<ReturnType<typeof verificationReport>>([]);
  const [backup, setBackup] = useState<BackupFile | null>(null);
  const running = useRef(false);

  const run = async () => {
    if (running.current) return; // no duplicate simultaneous exports
    running.current = true;
    setBusy(true);
    setReport([]);
    setBackup(null);
    setError("");
    setWarnings([]);
    try {
      const file = await exportFullBackup((p) =>
        setStatus(`${p.index + 1}/${p.total} — ${p.table} (${p.rows} rows)`),
      );
      const validation = await validateBackup(file);
      setReport(verificationReport(file));
      setWarnings(validation.warnings);

      if (!validation.ok) {
        setBackup(null);
        setError(validation.errors.join(" "));
        setStatus("");
        toast.error("Backup failed verification — file not downloaded.");
        return;
      }

      setBackup(file);
      setStatus(`${file.totals.rows.toLocaleString()} rows across ${file.totals.tables} tables`);
      downloadBackup(file);
      toast.success("Backup exported and verified");
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
      setStatus("");
      toast.error(e?.message ?? "Export failed");
    } finally {
      running.current = false;
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
              and relationships preserved, no 1,000-row limit. The file is verified (row counts
              before/after plus a SHA-256 checksum) before it is offered for download.
            </p>
          </div>
          <Button onClick={run} disabled={busy}>
            {busy ? "Exporting…" : "Export full backup"}
          </Button>
        </div>

        {status && <p className="text-xs text-muted-foreground">{status}</p>}

        {error && (
          <p className="text-xs text-destructive">
            {error} <span className="text-muted-foreground">You can retry the export.</span>
          </p>
        )}

        {backup && (
          <div className="text-xs space-y-1">
            <p className="text-emerald-600">Verified — checksum and row counts match.</p>
            <p className="text-muted-foreground">
              {backup.totals.tables} tables · {backup.totals.rows.toLocaleString()} rows ·{" "}
              {new Date(backup.createdAt).toLocaleString()}
            </p>
            <p className="text-muted-foreground">
              User: {backup.meta.authEmail ?? backup.meta.authUserId}
            </p>
            <p className="text-muted-foreground break-all">
              SHA-256: {backup.integrity.checksum}
            </p>
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="text-xs text-amber-600 list-disc pl-4 space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {report.length > 0 && (
          <div className="border rounded-md overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Table</th>
                  <th className="text-right p-2">Before</th>
                  <th className="text-right p-2">Exported</th>
                  <th className="text-right p-2">After</th>
                  <th className="text-right p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.map((r) => (
                  <tr key={r.table} className="border-t">
                    <td className="p-2">{r.table}</td>
                    <td className="p-2 text-right tabular-nums">{r.inDatabase.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{r.exported.toLocaleString()}</td>
                    <td className="p-2 text-right tabular-nums">{r.after.toLocaleString()}</td>
                    <td className={`p-2 text-right ${r.ok ? "text-emerald-600" : "text-destructive"}`}>
                      {r.ok ? "OK" : "Mismatch"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
