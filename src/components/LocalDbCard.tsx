import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  emptyStatus,
  getLocalDbStatus,
  initLocalDatabase,
  isLocalSqliteEnabled,
  type LocalDbStatus,
} from "@/data/local/status";

/**
 * Diagnostics only. Initializing the local database here does NOT import
 * cloud data, modify any production table, start synchronization, restore a
 * backup, or change where the application reads and writes its data.
 */
export function LocalDbCard() {
  const [status, setStatus] = useState<LocalDbStatus>(() => emptyStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLocalDbStatus().then(setStatus).catch(() => {});
  }, []);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await initLocalDatabase();
      setStatus(next);
      if (next.error) toast.error(`Local database: ${next.error}`);
      else if (!next.enabled) toast.message("Local database is disabled by feature flag.");
      else toast.success("Local database initialized and verified");
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [
    ["Feature flag", status.enabled ? "Enabled" : "Disabled"],
    ["State", status.initialized ? "Initialized" : "Not initialized"],
    ["Storage", status.storage === "opfs" ? "OPFS (persistent)" : status.storage === "memory" ? "Memory (not persistent)" : "—"],
    ["Database", status.databaseName],
    ["SQLite version", status.sqliteVersion ?? "—"],
    ["Schema version", status.initialized ? `${status.schemaVersion} (expected ${status.expectedSchemaVersion})` : "—"],
    ["Device ID", status.deviceId || "—"],
    ["Tables", status.initialized ? String(status.tableCount) : "—"],
    ["Local rows", status.initialized ? status.totalRows.toLocaleString() : "—"],
    ["Last initialized", status.lastInitializedAt ? new Date(status.lastInitializedAt).toLocaleString() : "—"],
  ];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Local database (diagnostics)</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Verifies the offline SQLite/OPFS storage engine. Diagnostic only — it does not copy
              cloud data, change any record, or affect how the app reads and writes today.
            </p>
          </div>
          <Button variant="outline" onClick={run} disabled={busy || !isLocalSqliteEnabled()}>
            {busy ? "Checking…" : "Initialize / Verify Local Database"}
          </Button>
        </div>

        {!isLocalSqliteEnabled() && (
          <p className="text-xs text-muted-foreground">
            Disabled — set VITE_ENABLE_LOCAL_SQLITE=true to enable local storage diagnostics.
          </p>
        )}

        {status.error && <p className="text-xs text-destructive">{status.error}</p>}

        <div className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-dashed py-1">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right break-all">{v}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
