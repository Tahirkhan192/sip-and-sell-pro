/**
 * Minimal IndexedDB helper used ONLY by the read-cache layer (Step 2 of the
 * offline foundation). Stores serialized React-Query results per query key.
 *
 * Non-invasive: never imported by business logic. When offline the cache is
 * used to seed queries; when online the cache is written silently in the
 * background and the UI still shows fresh cloud data.
 */

const DB_NAME = "kdf-pos-read-cache";
const DB_VERSION = 1;
const STORE = "queries";

type Entry = { key: string; data: unknown; updated_at: number };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function idbGet(key: string): Promise<unknown | undefined> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Entry | undefined)?.data);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const entry: Entry = { key, data, updated_at: Date.now() };
      const req = tx.objectStore(STORE).put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    /* silent — cache is best-effort */
  }
}
