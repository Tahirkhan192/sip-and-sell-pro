/**
 * Settings → Data folder on this computer.
 *
 * Lets the owner pick a folder (for example D:\Khyber Delicious Food Data)
 * where the app keeps a complete, always-current copy of all data. Offline.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  chooseDataFolder,
  forgetDataFolder,
  folderPermission,
  readFolderState,
  reauthorizeDataFolder,
  savedFolder,
  saveToDataFolder,
  supportsDataFolder,
  type DataFolderState,
} from "@/lib/data-folder";

function when(iso?: string) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

export function DataFolderCard() {
  const [state, setState] = useState<DataFolderState>({});
  const [supported, setSupported] = useState(true);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(supportsDataFolder());
    setState(readFolderState());
    const onChange = (e: Event) => setState((e as CustomEvent<DataFolderState>).detail);
    window.addEventListener("kdf-data-folder", onChange);
    void (async () => {
      const dir = await savedFolder();
      if (dir) setNeedsPermission((await folderPermission(dir)) !== "granted");
    })();
    return () => window.removeEventListener("kdf-data-folder", onChange);
  }, []);

  async function choose() {
    setBusy(true);
    try {
      const name = await chooseDataFolder();
      setNeedsPermission(false);
      toast.success(`Data folder set to "${name}"`);
      await saveToDataFolder(true);
      toast.success("All data written into the folder");
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e?.message ?? "Could not set the folder");
    } finally {
      setBusy(false);
    }
  }

  async function saveNow() {
    setBusy(true);
    try {
      const res = await saveToDataFolder(true);
      if (res.saved) toast.success("Data saved into the folder");
      else toast.message(res.reason ?? "Nothing to save");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not write into the folder");
    } finally {
      setBusy(false);
    }
  }

  async function allowAgain() {
    setBusy(true);
    try {
      const ok = await reauthorizeDataFolder();
      setNeedsPermission(!ok);
      if (ok) toast.success("Folder access restored");
      else toast.error("Permission was not given");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (!confirm("Stop saving a copy into this folder? Your data stays in the app.")) return;
    await forgetDataFolder();
    setState({});
    toast.success("Folder forgotten");
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Label className="text-base">Data folder on this computer</Label>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Choose a folder — for example <code>D:\Khyber Delicious Food Data</code>. Every entry
              you make is written there within a few seconds, with no internet needed. If this
              computer is ever reset, everything can be restored from that folder.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={choose} disabled={busy || !supported}>
              {state.name ? "Change folder" : "Choose data folder"}
            </Button>
            <Button onClick={saveNow} disabled={busy || !supported || !state.name}>
              Save now
            </Button>
          </div>
        </div>

        {!supported && (
          <p className="text-xs text-destructive">
            This browser cannot open a folder on the computer. Use Google Chrome or Microsoft Edge
            on a Windows computer.
          </p>
        )}

        {supported && state.name && (
          <div className="grid gap-2 sm:grid-cols-3 text-xs">
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Folder</div>
              <div className="font-medium break-words">{state.name}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-muted-foreground">Last saved</div>
              <div className="font-medium">{when(state.lastSaveAt)}</div>
            </div>
            <div className="rounded border p-3">
              <div className="text-muted-foreground">In the file</div>
              <div className="font-medium">
                {(state.rows ?? 0).toLocaleString()} records
                {state.bytes ? ` · ${(state.bytes / 1_048_576).toFixed(1)} MB` : ""}
              </div>
            </div>
          </div>
        )}

        {needsPermission && (
          <div className="flex items-center justify-between gap-3 rounded border p-3">
            <p className="text-xs">Chrome needs your permission for the folder again.</p>
            <Button size="sm" variant="outline" onClick={allowAgain} disabled={busy}>
              Allow again
            </Button>
          </div>
        )}

        {state.lastError && <p className="text-xs text-destructive">{state.lastError}</p>}

        {state.name && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={forget} disabled={busy}>
              Forget folder
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
