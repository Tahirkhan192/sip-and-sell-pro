/**
 * PHASE 8 — local backup (main thread).
 *
 *   LOCAL SQLITE → consistent snapshot → validated BackupFile → (Drive)
 *
 * The backup comes from the LOCAL database, never from Supabase. The existing
 * cloud export (`export.ts`) is untouched and stays available for what it was
 * built for; the two are distinguished by `source: "local" | "cloud"` and the
 * UI labels them separately.
 */

import {
  BACKUP_FORMAT_VERSION,
  RLS_LIMITED_TABLES,
  assertNoCredentials,
  computeChecksum,
  isSchemaCompatible,
  type BackupFile,
  type BackupPayload,
  type LocalBackupFile,
} from "./format";
import type { LocalBackupState, LocalSnapshot, RestoreOutcome } from "./local-snapshot";
import { requestLocalDb, LOCAL_SCHEMA_VERSION } from "../local/db";
import { validateBackup } from "./restore";

export class LocalBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalBackupError";
  }
}

export const APP_NAME = "Khyber Delicious Food POS" as const;
export const MASTER_BASE = "7 August 4:15 PM — Fixed stock engine & POS Bugs" as const;

function appVersion(): string | null {
  return (import.meta as any).env?.VITE_APP_VERSION ?? null;
}

/** Who this backup belongs to — id/email only, never a token. */
export type BackupIdentity = { userId: string; email: string | null };

/**
 * Takes a consistent snapshot of the local database and packages it as a
 * verified BackupFile. Throws instead of returning an unverified file.
 */
export async function createLocalBackup(identity?: BackupIdentity): Promise<LocalBackupFile> {
  const { snapshot } = (await requestLocalDb({ op: "backupSnapshot" })) as {
    snapshot: LocalSnapshot;
  };
  return buildLocalBackup(snapshot, identity);
}

/** Pure packaging step — separated so tests can drive it from a raw snapshot. */
export async function buildLocalBackup(
  snapshot: LocalSnapshot,
  identity?: BackupIdentity,
): Promise<LocalBackupFile> {
  const notes: string[] = [
    "Source: local SQLite database (authoritative operational store for migrated operations).",
    "Device-local internals (identity, sessions, outbox, diagnostics) are deliberately excluded.",
  ];
  if (Object.keys(snapshot.redactedFields).length) {
    notes.push(
      `Redacted secret fields: ${Object.entries(snapshot.redactedFields)
        .map(([t, f]) => `${t}.${f.join(", ")}`)
        .join("; ")}.`,
    );
  }

  const payload: BackupPayload = {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: APP_NAME,
    masterBase: MASTER_BASE,
    createdAt: snapshot.takenAt,
    source: "local",
    complete: true,
    meta: {
      authUserId: identity?.userId ?? "",
      authEmail: identity?.email ?? null,
      appVersion: appVersion(),
      redactedFields: snapshot.redactedFields,
      rlsLimitedTables: [...RLS_LIMITED_TABLES],
      notes,
    },
    rowCountByTable: snapshot.rowCountByTable,
    tables: snapshot.tables,
    totals: { tables: snapshot.tables.length, rows: snapshot.totalRows },
    schemaVersion: snapshot.schemaVersion,
    deviceId: snapshot.deviceId,
  };

  // Nothing credential-shaped may ever be hashed into a backup, let alone
  // uploaded. This runs before the checksum so a leak cannot be "verified".
  assertNoCredentials(payload);

  const checksum = await computeChecksum(payload);
  const file = { ...payload, integrity: { algorithm: "SHA-256" as const, checksum } };

  const validation = await validateBackup(file);
  if (!validation.ok) {
    throw new LocalBackupError(`Backup failed verification: ${validation.errors.join(" ")}`);
  }
  return file as LocalBackupFile;
}

export type BackupCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Everything a restore must prove BEFORE any row is touched: recognisable
 * file, supported format, verified checksum, compatible schema, table counts,
 * primary-key uniqueness and referential integrity (the last three come from
 * the shared v2 validator).
 */
export async function checkRestorable(
  input: unknown,
  localSchema = LOCAL_SCHEMA_VERSION,
): Promise<BackupCheck> {
  const backup = input as BackupFile | null;
  if (!backup || typeof backup !== "object") {
    return { ok: false, errors: ["File is not a recognised backup."], warnings: [] };
  }

  const validation = await validateBackup(backup);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (backup.source === "local") {
    if (typeof backup.schemaVersion !== "number") {
      errors.push("Local backup has no schema version — refusing to restore.");
    } else if (!isSchemaCompatible(backup.schemaVersion, localSchema)) {
      errors.push(
        `Incompatible schema: backup was taken at schema v${backup.schemaVersion}, this app runs v${localSchema}.`,
      );
    }
    if (typeof backup.deviceId !== "string" || backup.deviceId.length === 0) {
      errors.push("Local backup has no device id — refusing to restore.");
    }
  } else {
    warnings.push(
      "This is a cloud export, not a local snapshot. It can be restored, but it reflects the cloud database at export time.",
    );
  }

  try {
    assertNoCredentials(backup);
  } catch (e: any) {
    errors.push(e?.message ?? "Backup contains credential-shaped data.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export type LocalRestoreResult = RestoreOutcome & {
  /** Counts read back from SQLite after the transaction committed. */
  postCounts: Record<string, number>;
  checksum: string;
  createdAt: string;
  source: BackupFile["source"];
};

/**
 * Verify → restore transactionally → verify again.
 *
 * A healthy local database is never destroyed first: `restoreLocal` deletes and
 * re-inserts inside ONE transaction that only commits after every check passes.
 */
export async function restoreLocalBackup(input: unknown): Promise<LocalRestoreResult> {
  const check = await checkRestorable(input);
  if (!check.ok) throw new LocalBackupError(check.errors.join(" "));
  const backup = input as BackupFile;

  const { restore } = (await requestLocalDb({
    op: "backupRestore",
    tables: backup.tables,
  })) as { restore: RestoreOutcome };

  const { tableCounts } = (await requestLocalDb({ op: "backupCounts" })) as {
    tableCounts: Record<string, number>;
  };
  for (const [table, expected] of Object.entries(backup.rowCountByTable)) {
    if (tableCounts[table] !== expected) {
      throw new LocalBackupError(
        `Post-restore verification failed: ${table} holds ${tableCounts[table]} rows, expected ${expected}.`,
      );
    }
  }

  await writeLocalBackupState({
    lastRestoreAt: new Date().toISOString(),
    lastError: null,
  });

  return {
    ...restore,
    postCounts: tableCounts,
    checksum: backup.integrity.checksum,
    createdAt: backup.createdAt,
    source: backup.source,
  };
}

/* ------------------------------------------------------------------ *
 * Bookkeeping                                                         *
 * ------------------------------------------------------------------ */

export async function readLocalBackupState(): Promise<LocalBackupState> {
  return ((await requestLocalDb({ op: "backupStateRead" })) as { backupState: LocalBackupState })
    .backupState;
}

export async function writeLocalBackupState(
  patch: Partial<LocalBackupState>,
): Promise<LocalBackupState> {
  return (
    (await requestLocalDb({ op: "backupStateWrite", patch })) as { backupState: LocalBackupState }
  ).backupState;
}

/**
 * Called by the write pipeline after a successful local transaction: it marks
 * the database as "changed since the last backup". The scheduler only uploads
 * when this is set, so an idle café never burns Drive quota.
 */
export async function markLocalChange(at = new Date()): Promise<void> {
  try {
    const state = await readLocalBackupState();
    if (state.dirtySince) return;
    await writeLocalBackupState({ dirtySince: at.toISOString() });
  } catch {
    // Bookkeeping must never break a business write.
  }
}

/** File name used both for Drive and for a manual download. */
export function backupFileName(backup: BackupFile): string {
  const stamp = backup.createdAt.replace(/[:.]/g, "-");
  return `kdf-pos-${backup.source}-backup-${stamp}.json`;
}

/** Manual "download a copy" — the same verified file the uploader sends. */
export function downloadLocalBackup(backup: BackupFile): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(backup);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
