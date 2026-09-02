/**
 * Google Drive continuous sync.
 *
 * The database on this computer is always the one the app reads and writes.
 * In the background the app keeps one snapshot file on Google Drive in step:
 *
 *   - when the app opens it pulls the Drive snapshot if it is newer,
 *   - afterwards it pushes the local data hourly whenever it changed.
 *
 * Losing the internet never blocks anything — the app just keeps working and
 * syncs again the next time Drive answers.
 */

import { useEffect, useRef, useState } from "react";
import { exportFullBackup } from "@/data/backup/export";
import { applyBackup } from "@/data/backup/apply";
import { validateBackup } from "@/data/backup/restore";
import type { BackupFile } from "@/data/backup/format";

export const SYNC_INTERVAL_MS = 60 * 60 * 1000;
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

/* ---------- the Google Drive account connected on this computer ---------- */

const TOKEN_KEY = "kdf.driveAccountToken.v1";
const DEVICE_KEY = "kdf.driveDeviceId.v1";

/** A permanent, meaningless id for this computer. */
export function driveDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** The sealed account code saved on this computer (never the Google key itself). */
export function readDriveToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

function writeDriveToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  writeSyncState({ lastHash: undefined, lastError: undefined });
}

/** True when a Google Drive account has been connected on this computer. */
export function isDriveConnected(): boolean {
  return Boolean(readDriveToken());
}

/**
 * Opens the Google window, waits for the account owner to allow access and
 * saves the connection on this computer.
 */
export async function connectDriveAccount(): Promise<void> {
  // Ask for the Google address FIRST, then open the window straight on it.
  // Opening a blank window and redirecting it is what Google refuses to load
  // ("accounts.google.com is blocked").
  const start = await fetch(`/api/drive-connect?start=1&device=${encodeURIComponent(driveDeviceId())}`);
  const body = (await start.json().catch(() => ({}))) as { authorizationUrl?: string; error?: string };
  if (!start.ok || !body.authorizationUrl) throw new Error(body.error ?? "Could not open the Google window.");

  const popup = window.open(body.authorizationUrl, "kdf-google-drive", "width=520,height=680,noopener=no");
  if (!popup) {
    // Pop-ups blocked — finish in this same window instead of failing.
    window.location.href = body.authorizationUrl;
    return;
  }

  const code = await new Promise<string>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const type = (event.data as { type?: string })?.type;
      if (type !== "driveConnectComplete" && type !== "driveConnectFailed") return;
      cleanup();
      const received = (event.data as { code?: string })?.code;
      if (type === "driveConnectComplete" && received) resolve(received);
      else reject(new Error("The Google window closed without connecting."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("The Google window was closed before finishing."));
      }
    }, 500);
  });

  const done = await fetch("/api/drive-connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const result = (await done.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!done.ok || !result.token) throw new Error(result.error ?? "Could not save the Google account.");
  writeDriveToken(result.token);
}

/** Finishes a connection that came back in this same window (pop-up blocked). */
export async function finishDriveConnect(code: string): Promise<void> {
  const done = await fetch("/api/drive-connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const result = (await done.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!done.ok || !result.token) throw new Error(result.error ?? "Could not save the Google account.");
  writeDriveToken(result.token);
}

/** Signs the connected Google Drive account out of this computer. */
export async function disconnectDriveAccount(): Promise<void> {
  const token = readDriveToken();
  writeDriveToken("");
  if (!token) return;
  await fetch("/api/drive-connect?forget=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

function driveHeaders(extra: Record<string, string> = {}) {
  const token = readDriveToken();
  return token ? { ...extra, "x-kdf-drive-token": token } : extra;
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



let pushInFlight: Promise<{ pushed: boolean; reason?: string }> | null = null;

/** Uploads the whole local database to Drive. Skipped when nothing changed. */
export async function pushToDrive(force = false): Promise<{ pushed: boolean; reason?: string }> {
  if (pushInFlight) return pushInFlight;
  pushInFlight = (async () => {
    const backup = await exportFullBackup();
    const payload = JSON.stringify(backup);
    // createdAt changes on every export; exclude it when deciding whether the
    // database itself changed.
    const digest = hash(JSON.stringify({ ...backup, createdAt: "" }));
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
  })();
  try {
    return await pushInFlight;
  } finally {
    pushInFlight = null;
  }
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
 * Background sync: one pull when the app opens, then a push every hour
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
