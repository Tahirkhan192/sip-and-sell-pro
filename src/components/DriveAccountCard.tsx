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
import {
  driveAccount,
  driveHasSnapshot,
  driveInvitedAccounts,
  driveStatus,
  inviteDriveAccount,
  pullFromDrive,
  readDriveAccountKey,
  switchDriveAccount,
  type DriveAccount,
  type DrivePerson,
} from "@/lib/drive-sync";

export function DriveAccountCard() {
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  /** Access code waiting for a "which copy do we keep?" answer. */
  const [choice, setChoice] = useState<string | null>(null);
  /* ---- invite a Gmail address to the shared backup file ---- */
  const [gmail, setGmail] = useState("");
  const [people, setPeople] = useState<DrivePerson[]>([]);
  const [inviting, setInviting] = useState(false);
  const [found, setFound] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      setAccount(await driveAccount());
      setPeople(await driveInvitedAccounts().catch(() => []));
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

  async function save(next: string, keep: "push" | "pull" = "push") {
    setBusy(true);
    try {
      const res = await switchDriveAccount(next, keep);
      setKey(next);
      setOpen(false);
      setChoice(null);
      toast.success(
        res.mode === "pull"
          ? "Loaded that account's data and uploaded the combined copy back"
          : next
            ? "Switched account — your data was uploaded to it"
            : "Back to the default account — your data was uploaded to it",
      );
      void load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not switch account");
    } finally {
      setBusy(false);
    }
  }

  /** Asks what to keep when the other account already has data. */
  async function beginSave(next: string) {
    setBusy(true);
    try {
      if (await driveHasSnapshot(next)) {
        setChoice(next);
        return;
      }
    } catch {
      /* treat as empty */
    } finally {
      setBusy(false);
    }
    await save(next, "push");
  }

  /** Emails an access request to a Gmail address. */
  async function invite() {
    const address = gmail.trim();
    if (!address) return;
    setInviting(true);
    try {
      await inviteDriveAccount(address);
      toast.success(`Request sent to ${address} — ask them to open the email and accept.`);
      setGmail("");
      setPeople(await driveInvitedAccounts().catch(() => []));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setInviting(false);
    }
  }

  /** Looks on Google Drive for the shared backup file. */
  async function findBackup() {
    setInviting(true);
    setFound(null);
    try {
      const status = await driveStatus();
      if (!status.connected) {
        setFound(status.reason ?? "Google Drive is not reachable right now.");
        return;
      }
      setFound(
        status.file
          ? `Backup file found — last updated ${new Date(status.file.modifiedTime).toLocaleString()}`
          : "No backup file found on this account yet.",
      );
    } catch (err) {
      setFound(err instanceof Error ? err.message : "Could not search Google Drive");
    } finally {
      setInviting(false);
    }
  }

  /** Brings the backup file found on Drive into this computer. */
  async function loadBackup() {
    setInviting(true);
    try {
      const res = await pullFromDrive();
      toast.success(res.pulled ? `Loaded ${res.rows ?? 0} records from Google Drive` : (res.reason ?? "Nothing to load"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the backup file");
    } finally {
      setInviting(false);
    }
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
            <Button variant="outline" onClick={() => void beginSave("")} disabled={busy}>
              Use default account
            </Button>
          )}
          <Button onClick={() => setOpen(true)} disabled={busy}>
            <UserCog className="h-4 w-4 mr-2" /> Change account
          </Button>
        </div>

        {/* Simple Gmail flow: type an address, Google asks the owner to allow it,
            then the app looks for the backup file on Drive. */}
        <div className="rounded-md border p-3 space-y-3">
          <div>
            <Label className="text-sm">Add a Gmail account</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Type the Gmail address that should reach this data. Google sends that person a request — once
              they allow it, use “Find backup file” to pick up the data from Drive.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="email"
              value={gmail}
              onChange={(e) => setGmail(e.target.value)}
              placeholder="name@gmail.com"
              autoComplete="off"
            />
            <Button onClick={() => void invite()} disabled={inviting || !gmail.trim()}>
              <Mail className="h-4 w-4 mr-2" /> Send request
            </Button>
          </div>

          {people.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Already allowed: {people.map((p) => p.emailAddress).filter(Boolean).join(", ")}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void findBackup()} disabled={inviting}>
              <Search className="h-4 w-4 mr-2" /> Find backup file
            </Button>
            <Button variant="outline" size="sm" onClick={() => void loadBackup()} disabled={inviting}>
              <Download className="h-4 w-4 mr-2" /> Load backup into this computer
            </Button>
          </div>
          {found && <div className="text-xs text-muted-foreground">{found}</div>}
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
              <Button onClick={() => void beginSave(key)} disabled={busy}>
                {busy ? "Working…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={choice !== null} onOpenChange={(o) => !o && setChoice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>That account already has data</DialogTitle>
              <DialogDescription>
                Nothing on this computer is deleted either way. Choose which copy should be the shared one.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setChoice(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => void save(choice ?? "", "pull")} disabled={busy}>
                Load that account's data here
              </Button>
              <Button onClick={() => void save(choice ?? "", "push")} disabled={busy}>
                Upload my data to this account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
