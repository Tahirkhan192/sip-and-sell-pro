/**
 * Settings → Google Drive account.
 *
 * Shows which Google account holds the shared data file and lets the owner
 * point THIS computer at a different Google Drive account. The choice is
 * stored on this computer only, so every laptop can use its own account.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserCog, RefreshCw } from "lucide-react";
import { driveAccount, readDriveAccountKey, writeDriveAccountKey, type DriveAccount } from "@/lib/drive-sync";

export function DriveAccountCard() {
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      setAccount(await driveAccount());
    } catch {
      setAccount({ connected: false, reason: "Google Drive is unreachable" });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    setKey(readDriveAccountKey());
  }, []);

  function save(next: string) {
    writeDriveAccountKey(next);
    setKey(next);
    setOpen(false);
    void load();
    toast.success(next ? "This computer now uses the other Google Drive account" : "Back to the default account");
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <Label className="text-base">Google Drive Account</Label>
          <p className="text-xs text-muted-foreground mt-1">
            The account that keeps the shared data file. Every computer can use its own account — the choice
            below applies to this computer only.
          </p>
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            Account:{" "}
            {account
              ? account.connected
                ? (account.email ?? account.name ?? "connected")
                : (account.reason ?? "not connected")
              : "checking…"}
          </div>
          <div>Using: {readDriveAccountKey() ? "this computer's own account" : "the app's default account"}</div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-2" /> Check
          </Button>
          {readDriveAccountKey() && (
            <Button variant="outline" onClick={() => save("")} disabled={busy}>
              Use default account
            </Button>
          )}
          <Button onClick={() => setOpen(true)} disabled={busy}>
            <UserCog className="h-4 w-4 mr-2" /> Change account
          </Button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Google Drive account</DialogTitle>
              <DialogDescription>
                Paste the Google Drive access code for the account you want this computer to use. Leave it empty
                to go back to the default account.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="drive-key">Google Drive access code</Label>
              <Input
                id="drive-key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste the access code"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Saved on this computer only. It is never shown to anyone else and never leaves this machine
                except to reach Google Drive.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => save(key)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
