/**
 * Settings → Google Drive. Shows sync status and allows a manual send/get,
 * on top of the automatic background sync.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { CloudUpload, CloudDownload, RefreshCw, PackageSearch } from "lucide-react";
import {
  driveStatus,
  pullFromDrive,
  pushToDrive,
  restoreCatalogFromDrive,
  readSyncState,
  writeSyncState,
  type DriveStatus,
  type SyncState,
} from "@/lib/drive-sync";

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export function DriveSyncCard() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [state, setState] = useState<SyncState>(() => readSyncState());
  const [busy, setBusy] = useState<"" | "push" | "pull" | "catalog">("");

  useEffect(() => {
    driveStatus().then(setStatus).catch(() => setStatus({ connected: false, reason: "Drive unreachable" }));
    const onChange = (e: Event) => setState((e as CustomEvent<SyncState>).detail);
    window.addEventListener("kdf-drive-sync", onChange);
    return () => window.removeEventListener("kdf-drive-sync", onChange);
  }, []);

  async function run(kind: "push" | "pull" | "catalog") {
    setBusy(kind);
    try {
      if (kind === "push") {
        const r = await pushToDrive(true);
        toast.success(r.pushed ? "Data sent to Google Drive" : "Already up to date");
      } else if (kind === "catalog") {
        const r = await restoreCatalogFromDrive();
        toast.success(
          r.restored
            ? `Products and lists restored (${r.rows} records). Your sales and purchases were not changed.`
            : r.reason ?? "Nothing to restore",
        );
        window.location.reload();
      } else {
        const r = await pullFromDrive();
        toast.success(r.pulled ? `Loaded ${r.rows} records from Google Drive` : r.reason ?? "Nothing to load");
        window.location.reload();
      }
      setStatus(await driveStatus());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google Drive sync failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-base">Google Drive Sync</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Your data always lives on this computer. In the background it is copied to one file on Google
              Drive every few minutes, so other computers and the Android viewer see the same data.
            </p>
          </div>
          <Switch
            checked={state.enabled !== false}
            onCheckedChange={(v) => setState(writeSyncState({ enabled: v }))}
            aria-label="Automatic Google Drive sync"
          />
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>Drive connection: {status ? (status.connected ? "Connected" : status.reason ?? "Not connected") : "Checking…"}</div>
          <div>File on Drive: {status?.file ? new Date(status.file.modifiedTime).toLocaleString() : "not created yet"}</div>
          <div>Last sent: {when(state.lastPushAt)}</div>
          <div>Last received: {when(state.lastPullAt)}</div>
          {state.lastError && <div className="text-destructive sm:col-span-2">Last error: {state.lastError}</div>}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => driveStatus().then(setStatus)} disabled={!!busy}>
            <RefreshCw className="h-4 w-4 mr-2" /> Check
          </Button>
          <Button variant="outline" onClick={() => run("pull")} disabled={!!busy}>
            <CloudDownload className="h-4 w-4 mr-2" /> {busy === "pull" ? "Loading…" : "Get data from Drive"}
          </Button>
          <Button onClick={() => run("push")} disabled={!!busy}>
            <CloudUpload className="h-4 w-4 mr-2" /> {busy === "push" ? "Sending…" : "Send data to Drive"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
