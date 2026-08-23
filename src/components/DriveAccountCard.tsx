/**
 * Settings → Google Drive account.
 *
 * One button opens a Google window where the owner picks the Google account
 * used for backup and restore. The account is remembered on this computer only.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CloudUpload, CloudDownload, LogOut, RefreshCw, Link2 } from "lucide-react";
import {
  connectDriveAccount,
  disconnectDriveAccount,
  driveAccount,
  driveStatus,
  isDriveConnected,
  pullFromDrive,
  pushToDrive,
  type DriveAccount,
  type DriveStatus,
} from "@/lib/drive-sync";

export function DriveAccountCard() {
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState<"" | "connect" | "check" | "backup" | "restore">("");

  const load = useCallback(async () => {
    const has = isDriveConnected();
    setConnected(has);
    if (!has) {
      setAccount(null);
      setStatus(null);
      return;
    }
    setAccount(await driveAccount().catch(() => ({ connected: false, reason: "Google Drive is unreachable" })));
    setStatus(await driveStatus().catch(() => ({ connected: false, reason: "Google Drive is unreachable" })));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(kind: "connect" | "check" | "backup" | "restore") {
    setBusy(kind);
    try {
      if (kind === "connect") {
        await connectDriveAccount();
        toast.success("Google Drive account connected");
      } else if (kind === "backup") {
        await pushToDrive(true);
        toast.success("Backup saved to Google Drive");
      } else if (kind === "restore") {
        const res = await pullFromDrive();
        toast.success(res.pulled ? `Restored ${res.rows ?? 0} records from Google Drive` : (res.reason ?? "Nothing to restore"));
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google Drive action failed");
    } finally {
      setBusy("");
    }
  }

  async function forget() {
    setBusy("connect");
    try {
      await disconnectDriveAccount();
      toast.success("Google Drive account removed from this computer");
      await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">Google Drive Account (backup &amp; restore)</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Your data always stays on this computer. Connect a Google account here to also keep one backup
            file on its Google Drive, and to restore that backup on another computer.
          </p>
        </div>

        {connected ? (
          <>
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                Account:{" "}
                {account
                  ? account.connected
                    ? (account.email ?? account.name ?? "connected")
                    : (account.reason ?? "not reachable")
                  : "checking…"}
              </div>
              <div>
                Backup file:{" "}
                {status?.file ? new Date(status.file.modifiedTime).toLocaleString() : "not created yet"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => void run("check")} disabled={!!busy}>
                <RefreshCw className="h-4 w-4 mr-2" /> Check
              </Button>
              <Button variant="outline" onClick={() => void run("restore")} disabled={!!busy}>
                <CloudDownload className="h-4 w-4 mr-2" /> {busy === "restore" ? "Restoring…" : "Restore from Drive"}
              </Button>
              <Button onClick={() => void run("backup")} disabled={!!busy}>
                <CloudUpload className="h-4 w-4 mr-2" /> {busy === "backup" ? "Saving…" : "Back up now"}
              </Button>
              <Button variant="ghost" onClick={() => void forget()} disabled={!!busy}>
                <LogOut className="h-4 w-4 mr-2" /> Remove account
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">No Google Drive account is connected on this computer.</p>
            <Button onClick={() => void run("connect")} disabled={!!busy}>
              <Link2 className="h-4 w-4 mr-2" /> {busy === "connect" ? "Opening Google…" : "Add Google Drive account"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
