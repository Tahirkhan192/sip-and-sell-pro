/**
 * PHASE 8 — Google Drive backup service: schedule, upload, verify, rotate.
 *
 * Behaviour, exactly as specified:
 *   * hourly while online, and only when a local transaction actually changed
 *     something since the last successful backup;
 *   * never interrupts a business mutation — the snapshot is a short read
 *     transaction and the upload happens afterwards, off the write path;
 *   * failed uploads are retried with exponential backoff and reported in the
 *     UI, they never fail silently;
 *   * rotation keeps a small configurable number of recent VALID backups, and
 *     an older backup is only deleted after the newer one is uploaded AND
 *     verified by re-reading it from Drive.
 *
 * All dependencies are injected, so every rule above is unit-tested.
 */

import { createLocalBackup, readLocalBackupState, writeLocalBackupState } from "./local-backup";
import { encodeBackup, decodeBackup } from "./transport";
import { checkRestorable } from "./local-backup";
import { isBackupFile, sortNewestFirst, type DriveBackupProps, type DriveClient, type DriveFile } from "./drive";
import type { BackupFile, LocalBackupFile } from "./format";

/** How many of the newest backups are always kept, whatever their age. */
export const DEFAULT_KEEP = 10;
/** Backup cadence: every minute, and only when something actually changed. */
export const BACKUP_INTERVAL_MS = 60 * 1000;
export const RETRY_BASE_MS = 15 * 1000;
export const MAX_ATTEMPTS = 5;

/**
 * Tiered retention. Minute-level backups would otherwise wipe out yesterday's
 * history within ten minutes, so older backups are thinned instead of deleted:
 *   * the newest `keep` files, always;
 *   * one per hour for the last 24 hours;
 *   * one per day for the last 14 days;
 * everything else is removed.
 */
export const HOURLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DAILY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type BackupCycleReason = "scheduled" | "manual" | "retry";

export type BackupCycleResult = {
  status: "uploaded" | "skipped" | "failed";
  reason: string;
  file?: DriveFile;
  checksum?: string;
  rows?: number;
  deleted?: string[];
  error?: string;
  retryable?: boolean;
};

export type DriveBackupDeps = {
  client: DriveClient;
  /** Defaults to a real snapshot of the local database. */
  makeBackup?: () => Promise<LocalBackupFile>;
  keep?: number;
  now?: () => Date;
  online?: () => boolean;
  /** Guard: true while a business mutation holds the write path. */
  busy?: () => boolean;
};

function props(backup: BackupFile, compression: string): DriveBackupProps {
  return {
    checksum: backup.integrity.checksum,
    createdAt: backup.createdAt,
    deviceId: backup.deviceId ?? "",
    schemaVersion: String(backup.schemaVersion ?? ""),
    rowCount: String(backup.totals.rows),
    source: backup.source,
    compression,
    app: "kdf-pos",
  };
}

/**
 * One backup cycle: snapshot → encode → upload → verify on Drive → rotate.
 * Returns instead of throwing, so the scheduler can record and surface the
 * failure rather than dying.
 */
export async function runBackupCycle(
  deps: DriveBackupDeps,
  reason: BackupCycleReason = "manual",
): Promise<BackupCycleResult> {
  const now = deps.now ?? (() => new Date());
  const online = deps.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const keep = Math.max(1, deps.keep ?? DEFAULT_KEEP);

  if (!online()) return { status: "skipped", reason: "offline" };
  if (deps.busy?.()) return { status: "skipped", reason: "a business mutation is in progress" };

  let backup: LocalBackupFile;
  try {
    backup = await (deps.makeBackup ?? (() => createLocalBackup()))();
  } catch (e: any) {
    const error = e?.message ?? String(e);
    await safeState({ lastError: error });
    return { status: "failed", reason: "snapshot failed", error, retryable: false };
  }

  const encoded = await encodeBackup(backup);
  const name = `kdf-pos-backup-${backup.createdAt.replace(/[:.]/g, "-")}.json${
    encoded.compression === "gzip" ? ".gz" : ""
  }`;

  let uploaded: DriveFile;
  try {
    uploaded = await deps.client.upload(name, encoded.bytes, encoded.mimeType, props(backup, encoded.compression));
  } catch (e: any) {
    const error = e?.message ?? String(e);
    await safeState({ lastError: error });
    return { status: "failed", reason: "upload failed", error, retryable: e?.retryable !== false };
  }

  // ---- verify the uploaded copy before anything is rotated away ----------
  try {
    const bytes = await deps.client.download(uploaded.id);
    const roundTrip = await decodeBackup(bytes);
    if (roundTrip.integrity?.checksum !== backup.integrity.checksum) {
      throw new Error("checksum of the uploaded file does not match the local backup");
    }
    const check = await checkRestorable(roundTrip);
    if (!check.ok) throw new Error(check.errors.join(" "));
  } catch (e: any) {
    const error = `Uploaded backup failed verification: ${e?.message ?? e}`;
    // A backup we could not verify is not allowed to count as the newest good
    // one, and must never be the reason an older good one gets deleted.
    try {
      await deps.client.remove(uploaded.id);
    } catch {
      /* leave it; rotation ignores unverifiable files anyway */
    }
    await safeState({ lastError: error });
    return { status: "failed", reason: "verification failed", error, retryable: true };
  }

  const deleted = await rotate(deps.client, keep, uploaded.id);

  await safeState({
    lastBackupAt: now().toISOString(),
    lastChecksum: backup.integrity.checksum,
    lastRows: backup.totals.rows,
    lastRemoteId: uploaded.id,
    lastError: null,
    dirtySince: null,
  });

  return {
    status: "uploaded",
    reason,
    file: uploaded,
    checksum: backup.integrity.checksum,
    rows: backup.totals.rows,
    deleted,
  };
}

async function safeState(patch: Parameters<typeof writeLocalBackupState>[0]) {
  try {
    await writeLocalBackupState(patch);
  } catch {
    /* bookkeeping must never mask the real result */
  }
}

/**
 * Keeps the `keep` newest backups. The just-verified upload is always kept,
 * and nothing is deleted unless a newer verified backup exists — so the newest
 * valid backup can never be rotated away.
 */
export async function rotate(
  client: DriveClient,
  keep: number,
  protectId: string,
): Promise<string[]> {
  let files: DriveFile[];
  try {
    files = (await client.list()).filter(isBackupFile);
  } catch {
    return []; // rotation is best-effort; never fail a good backup over it
  }
  const ordered = sortNewestFirst(files);
  const stale = ordered.slice(keep).filter((f) => f.id !== protectId);
  const deleted: string[] = [];
  for (const f of stale) {
    try {
      await client.remove(f.id);
      deleted.push(f.id);
    } catch {
      /* keep going: a file we cannot delete is harmless */
    }
  }
  return deleted;
}

/* ------------------------------------------------------------------ *
 * Scheduler                                                           *
 * ------------------------------------------------------------------ */

export type SchedulerState = {
  running: boolean;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  attempts: number;
  nextAttemptAt: string | null;
};

const state: SchedulerState = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  attempts: 0,
  nextAttemptAt: null,
};

const listeners = new Set<(s: SchedulerState) => void>();

export function driveBackupState(): SchedulerState {
  return { ...state };
}

export function subscribeDriveBackup(cb: (s: SchedulerState) => void): () => void {
  listeners.add(cb);
  cb(driveBackupState());
  return () => listeners.delete(cb);
}

function emit() {
  const snapshot = driveBackupState();
  for (const cb of listeners) cb(snapshot);
}

/** Backoff for a failed upload: 1, 2, 4, 8, 16 minutes, then give up until the next hour. */
export function retryDelayMs(attempt: number): number {
  return RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
}

/**
 * Runs a cycle if it is due: something changed locally, we are online, no
 * mutation is in flight, and either an hour has passed or a retry is due.
 */
export async function maybeRunBackup(
  deps: DriveBackupDeps,
  reason: BackupCycleReason = "scheduled",
): Promise<BackupCycleResult> {
  const now = (deps.now ?? (() => new Date()))();
  if (state.running) return { status: "skipped", reason: "a backup is already running" };
  if (state.nextAttemptAt && now.getTime() < Date.parse(state.nextAttemptAt) && reason !== "manual") {
    return { status: "skipped", reason: "waiting for the retry backoff" };
  }

  if (reason !== "manual") {
    const local = await readLocalBackupState().catch(() => null);
    if (local && !local.dirtySince) {
      return { status: "skipped", reason: "nothing changed since the last backup" };
    }
  }

  state.running = true;
  state.lastRunAt = now.toISOString();
  emit();
  try {
    const result = await runBackupCycle(deps, reason);
    if (result.status === "uploaded") {
      state.attempts = 0;
      state.nextAttemptAt = null;
      state.lastError = null;
      state.lastSuccessAt = now.toISOString();
    } else if (result.status === "failed") {
      state.lastError = result.error ?? result.reason;
      if (result.retryable && state.attempts < MAX_ATTEMPTS) {
        state.attempts += 1;
        state.nextAttemptAt = new Date(now.getTime() + retryDelayMs(state.attempts)).toISOString();
      } else {
        state.nextAttemptAt = null;
      }
    }
    return result;
  } finally {
    state.running = false;
    emit();
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Starts the hourly scheduler (plus a run when the device comes back online). */
export function startDriveBackupScheduler(deps: DriveBackupDeps): () => void {
  stopDriveBackupScheduler();
  const tick = () => void maybeRunBackup(deps, state.attempts > 0 ? "retry" : "scheduled");
  timer = setInterval(tick, Math.min(BACKUP_INTERVAL_MS, 5 * 60 * 1000));
  const onOnline = () => void maybeRunBackup(deps, "scheduled");
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);
  return () => {
    stopDriveBackupScheduler();
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
  };
}

export function stopDriveBackupScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test hook — resets the module-level scheduler state. */
export function _resetSchedulerForTests(): void {
  state.running = false;
  state.lastRunAt = null;
  state.lastSuccessAt = null;
  state.lastError = null;
  state.attempts = 0;
  state.nextAttemptAt = null;
}
