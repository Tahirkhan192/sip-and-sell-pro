/**
 * Google Drive continuous sync.
 *
 * The database on this computer is always the one the app reads and writes.
 * In the background the app keeps one snapshot file on Google Drive in step:
 *
 *   - when the app opens it pulls the Drive snapshot if it is newer,
 *   - afterwards it pushes the local data every few minutes whenever it changed.
 *
 * Losing the internet never blocks anything — the app just keeps working and
 * syncs again the next time Drive answers.
 */

import { useEffect, useRef, useState } from "react";
import { exportFullBackup } from "@/data/backup/export";
import { applyBackup } from "@/data/backup/apply";
import { validateBackup } from "@/data/backup/restore";
import type { BackupFile } from "@/data/backup/format";

export const SYNC_INTERVAL_MS = 3 * 60 * 1000;
const STATE_KEY = "kdf.driveSync.v1";

export type SyncState = {
  enabled: boolean;
  lastPushAt?: string;
  lastPullAt?: string;
  lastHash?: string;
  lastError?: string;
};

export function readSyncState(): SyncState {
  if (typeof window === "undefined") return { enabled: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as SyncState;
    return { ...saved, enabled: saved.enabled !== false };

  } catch {
    return { enabled: true };
  }
}

export function writeSyncState(patch: Partial<SyncState>) {
  const next = { ...readSyncState(), ...patch };
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kdf-drive-sync", { detail: next }));
  return next;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export type DriveStatus = {
  connected: boolean;
  reason?: string;
  custom?: boolean;
  file?: { id: string; modifiedTime: string } | null;
};

export type DriveAccount = {
  connected: boolean;
  custom?: boolean;
  email?: string | null;
  name?: string | null;
  reason?: string;
};

/* ---------- which Google account this computer uses ---------- */

const ACCOUNT_KEY = "kdf.driveAccountKey.v1";

/** The Drive account key saved on this computer, if the owner set one. */
export function readDriveAccountKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(ACCOUNT_KEY) ?? "";
}

/** Points this computer at another Google Drive account (empty = the default). */
export function writeDriveAccountKey(key: string) {
  const clean = key.trim();
  if (clean) localStorage.setItem(ACCOUNT_KEY, clean);
  else localStorage.removeItem(ACCOUNT_KEY);
  writeSyncState({ lastHash: undefined, lastError: undefined });
}

function driveHeaders(extra: Record<string, string> = {}) {
  const key = readDriveAccountKey();
  return key ? { ...extra, "x-kdf-drive-key": key } : extra;
}

export async function driveStatus(): Promise<DriveStatus> {
  const res = await fetch("/api/drive", { headers: driveHeaders() });
  if (!res.ok) return { connected: false, reason: `Drive check failed (${res.status})` };
  return (await res.json()) as DriveStatus;
}

/** Which Google account currently holds the data file. */
export async function driveAccount(): Promise<DriveAccount> {
  const res = await fetch("/api/drive?about=1", { headers: driveHeaders() });
  if (!res.ok) return { connected: false, reason: `Account check failed (${res.status})` };
  return (await res.json()) as DriveAccount;
}

/** Uploads the whole local database to Drive. Skipped when nothing changed. */
export async function pushToDrive(force = false): Promise<{ pushed: boolean; reason?: string }> {
  const backup = await exportFullBackup();
  const payload = JSON.stringify(backup);
  const digest = hash(payload);
  if (!force && readSyncState().lastHash === digest) return { pushed: false, reason: "No changes" };

  const res = await fetch("/api/drive", {
    method: "POST",
    headers: driveHeaders({ "content-type": "application/json" }),
    body: payload,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Upload failed (${res.status})`);
  }
  writeSyncState({ lastHash: digest, lastPushAt: new Date().toISOString(), lastError: undefined });
  return { pushed: true };
}

/** Downloads the Drive snapshot without importing it (used by the phone viewer). */
export async function fetchDriveSnapshot(): Promise<BackupFile | null> {
  const res = await fetch("/api/drive?download=1", { headers: driveHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error((await res.text()) || `Download failed (${res.status})`);
  const backup = (await res.json()) as BackupFile;
  const check = validateBackup(backup);
  if (!check.ok) throw new Error(check.errors[0] ?? "The Drive file is not a valid backup.");
  return backup;
}

/** Downloads the Drive snapshot and merges it into the local database. */
export async function pullFromDrive(
  onProgress?: (p: { table: string; index: number; total: number }) => void,
): Promise<{ pulled: boolean; rows?: number; reason?: string }> {
  const backup = await fetchDriveSnapshot();
  if (!backup) return { pulled: false, reason: "No data on Google Drive yet" };

  const { rows } = await applyBackup(backup, (p) =>
    onProgress?.({ table: p.table, index: p.index, total: p.total }),
  );
  writeSyncState({ lastPullAt: new Date().toISOString(), lastError: undefined });
  return { pulled: true, rows };
}


/**
 * Background sync: one pull when the app opens, then a push every few minutes
 * whenever the local data changed.
 */
export function useDriveAutoSync() {
  const started = useRef(false);
  const [state, setState] = useState<SyncState>(() => readSyncState());

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<SyncState>).detail);
    window.addEventListener("kdf-drive-sync", onChange);
    return () => window.removeEventListener("kdf-drive-sync", onChange);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let stopped = false;

    async function cycle(first: boolean) {
      if (stopped || !readSyncState().enabled) return;
      try {
        const status = await driveStatus();
        if (!status.connected) return;
        if (first) await pullFromDrive();
        await pushToDrive();
      } catch (err) {
        writeSyncState({ lastError: err instanceof Error ? err.message : String(err) });
      }
    }

    void cycle(true);
    const timer = window.setInterval(() => void cycle(false), SYNC_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
