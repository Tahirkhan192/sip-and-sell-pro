import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isLocalSqliteEnabled } from "@/data/local/status";
import {
  getSeedStatus,
  seedCloudToLocal,
  type SeedProgress,
  type SeedReport,
} from "@/data/local/seed";

/**
 * Phase 3 diagnostics: copies cloud data into the local SQLite mirror and
 * verifies it. One-way only (Supabase → local). The application keeps reading
 * and writing Supabase; nothing here changes any cloud record.
 */
export function CloudSeedCard() {
  const [state, setState] = useState<Awaited<ReturnType<typeof getSeedStatus>> | null>(null);
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [report, setReport] = useState<SeedReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    getSeedStatus()
      .then(setState)
      .catch(() => {});

  useEffect(() => {
    if (isLocalSqliteEnabled()) void refresh();
  }, []);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setReport(null);
    try {
      const result = await seedCloudToLocal({ onProgress: setProgress });
      setReport(result);
      if (result.status === "verified") toast.success("Local database seeded and verified");
      else if (result.status === "blocked") toast.message(result.reason ?? "Seed not performed");
      else toast.error(result.reason ?? "Seed failed");
      await refresh();
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const meta = state?.meta ?? null;
  const seedStatus = !state?.enabled
    ? "Disabled"
    : busy
      ? "Seeding…"
      : meta?.status === "verified"
        ? "Verified"
        : report?.status === "failed"
          ? "Failed"
          : (state?.localRows ?? 0) > 0
            ? "Local database not empty"
            : "Never seeded";

  const rows: [string, string][] = [
    ["Seed status", seedStatus],
    ["Last seed", meta?.seededAt ? new Date(meta.seededAt).toLocaleString() : "—"],
    ["Source", meta?.source ?? "—"],
    ["Tables seeded", meta ? String(meta.tables) : "—"],
    ["Rows seeded", meta ? meta.rows.toLocaleString() : "—"],
    ["Local rows", (state?.localRows ?? 0).toLocaleString()],
    ["Verification", meta?.verification ?? "—"],
    ["Digest", meta?.overallDigest ? `${meta.overallDigest.slice(0, 16)}…` : "—"],
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Cloud seed (diagnostics)</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Copies your cloud data into the local database one way only, then verifies every
              table by row count, ID and checksum. Cloud data is only read — never changed — and
              the app continues to use the cloud as its live data source.
            </p>
          </div>
          <Button variant="outline" onClick={run} disabled={busy || !isLocalSqliteEnabled()}>
            {busy ? "Seeding…" : "Seed Cloud Data to Local Database"}
          </Button>
        </div>

        {!isLocalSqliteEnabled() && (
          <p className="text-xs text-muted-foreground">
            Disabled — set VITE_ENABLE_LOCAL_SQLITE=true to enable the local database.
          </p>
        )}

        {progress && (
          <div className="rounded-md border p-3 text-xs space-y-1">
            <div className="font-medium">Seeding local database…</div>
            <div>{progress.message}</div>
            {progress.table && (
              <div>
                Table {progress.tableIndex} of {progress.totalTables} — fetched{" "}
                {progress.fetched.toLocaleString()}, inserted {progress.inserted.toLocaleString()}
              </div>
            )}
            <div>Overall rows: {progress.rowsTotal.toLocaleString()}</div>
          </div>
        )}

        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right break-all">{v}</span>
            </div>
          ))}
        </div>

        {report && report.status !== "verified" && (
          <p className="text-xs text-destructive">{report.reason}</p>
        )}
        {report?.notes.map((n) => (
          <p key={n} className="text-xs text-amber-600">
            {n}
          </p>
        ))}

        {report && report.tables.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">Table</th>
                  <th className="p-2 text-right">Cloud</th>
                  <th className="p-2 text-right">Seeded</th>
                  <th className="p-2 text-right">Local</th>
                  <th className="p-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.tables.map((t) => (
                  <tr key={t.table} className="border-t">
                    <td className="p-2">
                      {t.table}
                      {t.rlsLimited && <span className="text-amber-600"> (RLS-limited)</span>}
                    </td>
                    <td className="p-2 text-right">{t.cloudCount.toLocaleString()}</td>
                    <td className="p-2 text-right">{t.seededCount.toLocaleString()}</td>
                    <td className="p-2 text-right">{t.localCount.toLocaleString()}</td>
                    <td
                      className={`p-2 text-right ${t.status === "PASS" ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {t.status}
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

export default CloudSeedCard;
