/**
 * PHASE 8 — restore from Google Drive, including the new-device flow.
 *
 *   authenticate → list backups → pick the newest VALID compatible one →
 *   verify checksum, format, schema, counts, PK uniqueness, FK integrity →
 *   transactional restore into SQLite → post-restore verification → commit.
 *
 * A candidate is only accepted after it has been downloaded and fully
 * verified; a corrupt newest file is skipped in favour of the next one down
 * rather than aborting recovery.
 */

import { decodeBackup } from "./transport";
import { checkRestorable, restoreLocalBackup, type LocalRestoreResult } from "./local-backup";
import { isBackupFile, sortNewestFirst, type DriveClient, type DriveFile } from "./drive";
import type { BackupFile } from "./format";

export type BackupCandidate = {
  file: DriveFile;
  createdAt: string;
  rowCount: number;
  deviceId: string;
  schemaVersion: string;
  checksum: string;
};

export function listCandidates(files: DriveFile[]): BackupCandidate[] {
  return sortNewestFirst(files.filter(isBackupFile)).map((file) => ({
    file,
    createdAt: file.appProperties?.createdAt ?? file.createdTime ?? "",
    rowCount: Number(file.appProperties?.rowCount ?? 0),
    deviceId: file.appProperties?.deviceId ?? "",
    schemaVersion: file.appProperties?.schemaVersion ?? "",
    checksum: file.appProperties?.checksum ?? "",
  }));
}

export type ValidatedBackup = { candidate: BackupCandidate; backup: BackupFile };

export type SelectionResult = {
  chosen: ValidatedBackup | null;
  /** Why each rejected candidate was skipped — surfaced in the UI. */
  rejected: { candidate: BackupCandidate; reason: string }[];
};

/** Downloads candidates newest-first and returns the first fully valid one. */
export async function selectLatestValidBackup(
  client: DriveClient,
  candidates: BackupCandidate[],
): Promise<SelectionResult> {
  const rejected: SelectionResult["rejected"] = [];
  for (const candidate of candidates) {
    try {
      const bytes = await client.download(candidate.file.id);
      const backup = await decodeBackup(bytes);
      if (candidate.checksum && backup.integrity?.checksum !== candidate.checksum) {
        rejected.push({ candidate, reason: "Checksum does not match the recorded value." });
        continue;
      }
      const check = await checkRestorable(backup);
      if (!check.ok) {
        rejected.push({ candidate, reason: check.errors.join(" ") });
        continue;
      }
      return { chosen: { candidate, backup }, rejected };
    } catch (e: any) {
      rejected.push({ candidate, reason: e?.message ?? String(e) });
    }
  }
  return { chosen: null, rejected };
}

export type DriveRestoreResult = {
  restored: LocalRestoreResult;
  from: BackupCandidate;
  skipped: SelectionResult["rejected"];
};

export class DriveRestoreError extends Error {
  skipped: SelectionResult["rejected"];
  constructor(message: string, skipped: SelectionResult["rejected"] = []) {
    super(message);
    this.name = "DriveRestoreError";
    this.skipped = skipped;
  }
}

/**
 * Full recovery path. `fileId` restores one specific backup; otherwise the
 * newest valid compatible backup wins.
 */
export async function restoreFromDrive(
  client: DriveClient,
  fileId?: string,
): Promise<DriveRestoreResult> {
  const files = await client.list();
  let candidates = listCandidates(files);
  if (fileId) candidates = candidates.filter((c) => c.file.id === fileId);
  if (candidates.length === 0) {
    throw new DriveRestoreError("No backups were found in this Google account.");
  }

  const { chosen, rejected } = await selectLatestValidBackup(client, candidates);
  if (!chosen) {
    throw new DriveRestoreError(
      `No valid backup could be used. ${rejected.map((r) => r.reason).join(" ")}`.trim(),
      rejected,
    );
  }

  // Only now is the local database touched — and only inside one transaction
  // that rolls back completely if any verification fails.
  const restored = await restoreLocalBackup(chosen.backup);
  return { restored, from: chosen.candidate, skipped: rejected };
}
