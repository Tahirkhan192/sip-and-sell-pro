/**
 * The app's own data folder on this computer (e.g. D:\Khyber Delicious Food Data).
 *
 * The app always runs from the database inside this computer. In addition, a
 * complete, always-current copy of every record is written into a folder the
 * owner picks once. Nothing here touches the internet — it works fully offline.
 *
 *   khyber-data.json           the live copy, rewritten a few seconds after any change
 *   khyber-data-previous.json  the copy from before the last write
 *
 * The same file can be read back ("Restore from data folder"), and a Google
 * Drive snapshot dropped into that folder is accepted too — both use the same
 * format.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { exportFullBackup } from "@/data/backup/export";
import { validateBackup } from "@/data/backup/restore";
import type { BackupFile } from "@/data/backup/format";

export const DATA_FILE = "khyber-data.json";
export const PREVIOUS_FILE = "khyber-data-previous.json";
const TEMP_FILE = "khyber-data.writing.json";

const STATE_KEY = "kdf.dataFolder.v1";
const IDB_NAME = "kdf-data-folder";
const IDB_STORE = "handles";
const IDB_KEY = "folder";

/** Rewritten at most this often, and at least this often while the app is open. */
const SAVE_DEBOUNCE_MS = 5_000;
const SAVE_INTERVAL_MS = 2 * 60 * 1000;

export type DataFolderState = {
  name?: string;
  lastSaveAt?: string;
  bytes?: number;
  rows?: number;
  lastError?: string;
  lastHash?: string;
};

export function supportsDataFolder(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

export function readFolderState(): DataFolderState {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) ?? "{}") as DataFolderState;
  } catch {
    return {};
  }
}

export function writeFolderState(patch: Partial<DataFolderState>): DataFolderState {
  const next = { ...readFolderState(), ...patch };
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("kdf-data-folder", { detail: next }));
  return next;
}

/* ---------------- remembering the chosen folder between visits ---------------- */

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(value: unknown): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value as any, IDB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<any | undefined> {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbClear(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).delete(IDB_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* nothing to forget */
  }
}

/* ---------------- choosing the folder and keeping permission ---------------- */

/** The folder handle saved on this computer, without asking for anything. */
export async function savedFolder(): Promise<any | null> {
  const handle = await idbGet();
  return handle ?? null;
}

/** "granted" when the app may write right now, "prompt" when Chrome must ask again. */
export async function folderPermission(handle: any): Promise<"granted" | "prompt" | "denied"> {
  if (!handle?.queryPermission) return "granted";
  return (await handle.queryPermission({ mode: "readwrite" })) as any;
}

export async function requestFolderPermission(handle: any): Promise<boolean> {
  if (!handle?.requestPermission) return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Opens the Windows folder picker and remembers what the owner chose. */
export async function chooseDataFolder(): Promise<string> {
  if (!supportsDataFolder()) throw new Error("This browser cannot open a folder. Use Google Chrome or Edge on a computer.");
  const handle = await (window as any).showDirectoryPicker({ id: "kdf-data", mode: "readwrite", startIn: "documents" });
  const ok = await requestFolderPermission(handle);
  if (!ok) throw new Error("Permission to write into that folder was not given.");
  await idbPut(handle);
  writeFolderState({ name: handle.name, lastError: undefined, lastHash: undefined });
  return handle.name as string;
}

export async function forgetDataFolder(): Promise<void> {
  await idbClear();
  localStorage.removeItem(STATE_KEY);
  window.dispatchEvent(new CustomEvent("kdf-data-folder", { detail: {} }));
}

/** Re-asks Chrome for access to the folder already chosen. */
export async function reauthorizeDataFolder(): Promise<boolean> {
  const handle = await savedFolder();
  if (!handle) return false;
  const ok = await requestFolderPermission(handle);
  if (ok) writeFolderState({ lastError: undefined });
  return ok;
}

/* ---------------- writing and reading the data file ---------------- */

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

async function readFileText(dir: any, name: string): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function writeFileText(dir: any, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

let saveInFlight: Promise<{ saved: boolean; reason?: string }> | null = null;

/**
 * Writes the complete data file into the chosen folder.
 * Skipped when nothing changed since the last write (unless forced).
 */
export async function saveToDataFolder(force = false): Promise<{ saved: boolean; reason?: string }> {
  if (saveInFlight) return saveInFlight;
  saveInFlight = (async () => {
    const dir = await savedFolder();
    if (!dir) return { saved: false, reason: "No folder chosen" };
    if ((await folderPermission(dir)) !== "granted") {
      writeFolderState({ lastError: "Chrome needs permission for the folder again." });
      return { saved: false, reason: "Permission needed" };
    }

    const backup = await exportFullBackup();
    const payload = JSON.stringify(backup);
    // createdAt changes on every export — ignore it when deciding if data changed.
    const digest = hashText(JSON.stringify({ ...backup, createdAt: "" }));
    if (!force && readFolderState().lastHash === digest) return { saved: false, reason: "No changes" };

    try {
      // Write to a temporary name first, keep the old copy, then put the new
      // one in place — a power cut can never leave a half-written data file.
      await writeFileText(dir, TEMP_FILE, payload);
      const current = await readFileText(dir, DATA_FILE);
      if (current) await writeFileText(dir, PREVIOUS_FILE, current);
      await writeFileText(dir, DATA_FILE, payload);
      try {
        await dir.removeEntry(TEMP_FILE);
      } catch {
        /* leftover temp file is harmless */
      }
    } catch (e: any) {
      writeFolderState({ lastError: e?.message ?? "Could not write into the folder." });
      throw e;
    }

    writeFolderState({
      name: dir.name,
      lastSaveAt: new Date().toISOString(),
      bytes: payload.length,
      rows: backup.totals?.rows,
      lastHash: digest,
      lastError: undefined,
    });
    return { saved: true };
  })();
  try {
    return await saveInFlight;
  } finally {
    saveInFlight = null;
  }
}

/** Reads the data file back out of the folder (used by Restore). */
export async function readDataFolderBackup(): Promise<BackupFile> {
  const dir = await savedFolder();
  if (!dir) throw new Error("No data folder has been chosen yet.");
  if ((await folderPermission(dir)) !== "granted") {
    const ok = await requestFolderPermission(dir);
    if (!ok) throw new Error("Permission to read that folder was not given.");
  }
  const text = await readFileText(dir, DATA_FILE);
  if (!text) throw new Error(`No ${DATA_FILE} found in the data folder.`);
  const parsed = JSON.parse(text);
  const check = validateBackup(parsed);
  if (!check.ok) throw new Error(check.errors[0] ?? "The file in the data folder is not a valid backup.");
  return parsed as BackupFile;
}

/* ---------------- automatic saving while the app is open ---------------- */

/**
 * Keeps the data file in the chosen folder current: a few seconds after any
 * entry is saved, every two minutes as a safety net, and once when the app is
 * closed. Entirely offline.
 */
export function useDataFolderAutoSave() {
  const qc = useQueryClient();
  const [state, setState] = useState<DataFolderState>(() => readFolderState());
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onChange = (e: Event) => setState((e as CustomEvent<DataFolderState>).detail);
    window.addEventListener("kdf-data-folder", onChange);
    return () => window.removeEventListener("kdf-data-folder", onChange);
  }, []);

  useEffect(() => {
    if (!supportsDataFolder()) return;
    let stopped = false;

    const run = () => {
      if (stopped) return;
      void saveToDataFolder().catch(() => undefined);
    };

    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(run, SAVE_DEBOUNCE_MS);
    };

    // Any saved entry (sale, purchase, expense, movement, settings…) goes
    // through a mutation, so this covers every entry screen at once.
    const unsubscribe = qc.getMutationCache().subscribe((event: any) => {
      if (event?.mutation?.state?.status === "success") schedule();
    });

    const interval = window.setInterval(run, SAVE_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") run();
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      stopped = true;
      unsubscribe();
      if (timer.current) window.clearTimeout(timer.current);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [qc]);

  return state;
}
