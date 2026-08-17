/**
 * PHASE 8 — Local backup & Google Drive recovery.
 *
 * This card manages the LOCAL SQLite backup: the operational database the app
 * actually runs on offline. The other backup card exports the cloud database
 * and is deliberately kept separate so the two are never confused.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  createLocalBackup,
  downloadLocalBackup,
  readLocalBackupState,
  restoreLocalBackup,
  checkRestorable,
} from "@/data/backup/local-backup";
import { decodeBackup } from "@/data/backup/transport";
import { createDriveClient, type DriveClient } from "@/data/backup/drive";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getClientId,
  googleTokenProvider,
  isDriveConfigured,
  setClientId,
  wasConnected,
} from "@/data/backup/google-auth";
import {
  DEFAULT_KEEP,
  maybeRunBackup,
  startDriveBackupScheduler,
  driveBackupState,
  subscribeDriveBackup,
  type SchedulerState,
} from "@/data/backup/drive-backup";
import { listCandidates, restoreFromDrive, type BackupCandidate } from "@/data/backup/drive-restore";
import type { LocalBackupState } from "@/data/backup/local-snapshot";

const KEEP_KEY = "kdf.drive.keep";

function readKeep(): number {
  if (typeof localStorage === "undefined") return DEFAULT_KEEP;
  const n = Number(localStorage.getItem(KEEP_KEY));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_KEEP;
}

export function LocalBackupCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalBackupState | null>(null);
  const [sched, setSched] = useState<SchedulerState>(driveBackupState());
  const [clientId, setClientIdState] = useState(getClientId());
  const [connected, setConnected] = useState(wasConnected());
  const [keep, setKeep] = useState(readKeep());
  const [candidates, setCandidates] = useState<BackupCandidate[] | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const client: DriveClient = useRef(
    createDriveClient({ getToken: googleTokenProvider }),
  ).current;

  const refresh = useCallback(async () => {
    try {
      setLocal(await readLocalBackupState());
    } catch {
      setLocal(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeDriveBackup(setSched);
  }, [refresh]);

  useEffect(() => {
    if (!connected || !isDriveConfigured()) return;
    return startDriveBackupScheduler({ client, keep });
  }, [client, connected, keep]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      const message = e?.message ?? String(e);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const backupNow = () =>
    guard("backup", async () => {
      const result = await maybeRunBackup({ client, keep }, "manual");
      if (result.status === "uploaded") {
        toast.success(`Backed up ${result.rows?.toLocaleString()} rows to Google Drive`);
      } else if (result.status === "failed") {
        throw new Error(result.error ?? result.reason);
      } else {
        toast.info(`Backup skipped — ${result.reason}`);
      }
    });

  const downloadNow = () =>
    guard("download", async () => {
      const backup = await createLocalBackup();
      downloadLocalBackup(backup);
      toast.success(`Saved ${backup.totals.rows.toLocaleString()} rows to a local file`);
    });

  const loadCandidates = () =>
    guard("list", async () => {
      setCandidates(listCandidates(await client.list()));
    });

  const restoreLatest = () =>
    guard("restore", async () => {
      if (!window.confirm("Replace the local database with the latest verified backup?")) return;
      const result = await restoreFromDrive(client);
      toast.success(
        `Restored ${result.restored.rows.toLocaleString()} rows from ${result.from.createdAt}`,
      );
    });

  const restoreFromFile = (file: File) =>
    guard("restore", async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const backup = await decodeBackup(bytes);
      const check = await checkRestorable(backup);
      if (!check.ok) throw new Error(check.errors.join(" "));
      if (!window.confirm("Replace the local database with this backup file?")) return;
      const result = await restoreLocalBackup(backup);
      toast.success(`Restored ${result.rows.toLocaleString()} rows`);
    });

  const connect = () =>
    guard("connect", async () => {
      setClientId(clientId);
      await connectGoogleDrive();
      setConnected(true);
      toast.success("Google Drive connected");
    });

  const lastBackup = local?.lastBackupAt ? new Date(local.lastBackupAt).toLocaleString() : "never";
  const pending = Boolean(local?.dirtySince);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Local database backup</h3>
            <p className="text-sm text-muted-foreground">
              Hourly encrypted-in-transit snapshot of the offline database, stored in a private
              Google Drive app folder no other app can read.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {connected ? (
              <Badge variant="secondary">Drive connected</Badge>
            ) : (
              <Badge variant="outline">Drive not connected</Badge>
            )}
            {pending && <Badge variant="outline">Changes pending backup</Badge>}
          </div>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            Last backup: <span className="font-medium">{lastBackup}</span>
          </div>
          <div>
            Rows: <span className="font-medium">{local?.lastRows?.toLocaleString() ?? "—"}</span>
          </div>
          <div className="truncate">
            Checksum: <span className="font-mono text-xs">{local?.lastChecksum?.slice(0, 16) ?? "—"}</span>
          </div>
          <div>
            Keeping the {keep} most recent verified backups
          </div>
        </div>

        {!isDriveConfigured() && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="drive-client">Google OAuth client ID</Label>
              <Input
                id="drive-client"
                value={clientId}
                placeholder="xxxxxxxx.apps.googleusercontent.com"
                onChange={(e) => setClientIdState(e.target.value)}
              />
            </div>
            <Button onClick={connect} disabled={!clientId || busy !== null}>
              Connect Google Drive
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          {isDriveConfigured() && !connected && (
            <Button onClick={connect} disabled={busy !== null}>
              Connect Google Drive
            </Button>
          )}
          <Button onClick={backupNow} disabled={!connected || busy !== null}>
            {busy === "backup" ? "Backing up…" : "Back up now"}
          </Button>
          <Button variant="outline" onClick={downloadNow} disabled={busy !== null}>
            Download a copy
          </Button>
          <Button variant="outline" onClick={loadCandidates} disabled={!connected || busy !== null}>
            View backups
          </Button>
          <Button variant="outline" onClick={restoreLatest} disabled={!connected || busy !== null}>
            Restore latest
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
            Restore from file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.gz,application/json,application/gzip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void restoreFromFile(f);
            }}
          />
          <div className="space-y-1">
            <Label htmlFor="drive-keep" className="text-xs">Backups to keep</Label>
            <Input
              id="drive-keep"
              type="number"
              min={1}
              className="w-24"
              value={keep}
              onChange={(e) => {
                const n = Math.max(1, Number(e.target.value) || DEFAULT_KEEP);
                setKeep(n);
                localStorage.setItem(KEEP_KEY, String(n));
              }}
            />
          </div>
          {connected && (
            <Button
              variant="ghost"
              onClick={() => {
                disconnectGoogleDrive();
                setConnected(false);
              }}
            >
              Disconnect
            </Button>
          )}
        </div>

        {(error || sched.lastError) && (
          <p className="text-sm text-destructive">{error || sched.lastError}</p>
        )}

        {candidates && (
          <div className="rounded border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left">Created</th>
                  <th className="p-2 text-right">Rows</th>
                  <th className="p-2 text-left">Schema</th>
                  <th className="p-2 text-left">Device</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-muted-foreground">
                      No backups yet.
                    </td>
                  </tr>
                )}
                {candidates.map((c) => (
                  <tr key={c.file.id} className="border-t">
                    <td className="p-2">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="p-2 text-right">{c.rowCount.toLocaleString()}</td>
                    <td className="p-2">v{c.schemaVersion}</td>
                    <td className="p-2 font-mono text-xs">{c.deviceId.slice(0, 8)}</td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          guard("restore", async () => {
                            if (!window.confirm("Restore this backup over the local database?")) return;
                            const r = await restoreFromDrive(client, c.file.id);
                            toast.success(`Restored ${r.restored.rows.toLocaleString()} rows`);
                          })
                        }
                      >
                        Restore
                      </Button>
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

export default LocalBackupCard;
