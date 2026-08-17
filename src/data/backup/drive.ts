/**
 * PHASE 8 — Google Drive `appDataFolder` client.
 *
 * appDataFolder is a per-application hidden folder: business backups never
 * appear among the owner's ordinary Drive files and no other app can read
 * them. The access token is supplied by a provider function and is held in
 * memory only — it is never written to SQLite, never put in a backup and never
 * logged.
 *
 * Everything here is expressed against an injectable `fetch`, so the whole
 * upload / list / download / rotate path is unit-testable without network.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/** Backup metadata stored as Drive `appProperties` (strings only, ≤124 chars). */
export type DriveBackupProps = {
  checksum: string;
  createdAt: string;
  deviceId: string;
  schemaVersion: string;
  rowCount: string;
  source: string;
  compression: string;
  app: string;
};

export type DriveFile = {
  id: string;
  name: string;
  createdTime?: string;
  size?: string;
  appProperties?: Partial<DriveBackupProps>;
};

export type TokenProvider = () => Promise<string>;

export class DriveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DriveError";
    this.status = status;
  }
  /** 401/403 mean "sign in again"; 5xx and 429 are worth retrying. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type DriveClient = {
  list: () => Promise<DriveFile[]>;
  upload: (name: string, bytes: Uint8Array, mimeType: string, props: DriveBackupProps) => Promise<DriveFile>;
  download: (fileId: string) => Promise<Uint8Array>;
  remove: (fileId: string) => Promise<void>;
  get: (fileId: string) => Promise<DriveFile>;
};

type Deps = { getToken: TokenProvider; fetchImpl?: typeof fetch };

export function createDriveClient({ getToken, fetchImpl }: Deps): DriveClient {
  const doFetch: typeof fetch = fetchImpl ?? ((...a: any[]) => (globalThis as any).fetch(...a));

  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    let res: Response;
    try {
      res = await doFetch(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      });
    } catch (e: any) {
      // Network failure (offline) — retryable, and never a credential problem.
      throw new DriveError(e?.message ?? "Network request failed", 0);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new DriveError(
        `Google Drive request failed [${res.status}]: ${body.slice(0, 300)}`,
        res.status,
      );
    }
    return res;
  }

  const FIELDS = "files(id,name,createdTime,size,appProperties)";

  return {
    async list() {
      const url =
        `${FILES}?spaces=appDataFolder&pageSize=100&orderBy=createdTime desc` +
        `&fields=${encodeURIComponent(FIELDS)}`;
      const res = await call(url, { method: "GET" });
      const json = (await res.json()) as { files?: DriveFile[] };
      return json.files ?? [];
    },

    async get(fileId: string) {
      const url = `${FILES}/${fileId}?fields=${encodeURIComponent("id,name,createdTime,size,appProperties")}`;
      const res = await call(url, { method: "GET" });
      return (await res.json()) as DriveFile;
    },

    async upload(name, bytes, mimeType, props) {
      const boundary = `kdf-${Math.random().toString(36).slice(2)}`;
      const metadata = { name, parents: ["appDataFolder"], appProperties: props };
      const head =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const body = new Blob([head, bytes as BlobPart, tail], {
        type: `multipart/related; boundary=${boundary}`,
      });
      const res = await call(
        `${UPLOAD}?uploadType=multipart&fields=${encodeURIComponent("id,name,createdTime,size,appProperties")}`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body,
        },
      );
      return (await res.json()) as DriveFile;
    },

    async download(fileId) {
      const res = await call(`${FILES}/${fileId}?alt=media`, { method: "GET" });
      return new Uint8Array(await res.arrayBuffer());
    },

    async remove(fileId) {
      await call(`${FILES}/${fileId}`, { method: "DELETE" });
    },
  };
}

/** Newest first, by the backup's own createdAt (falling back to Drive's). */
export function sortNewestFirst(files: DriveFile[]): DriveFile[] {
  return [...files].sort((a, b) => {
    const at = a.appProperties?.createdAt ?? a.createdTime ?? "";
    const bt = b.appProperties?.createdAt ?? b.createdTime ?? "";
    return bt.localeCompare(at);
  });
}

/** Only files this app wrote as backups. Anything else is left alone. */
export function isBackupFile(f: DriveFile): boolean {
  return Boolean(f.appProperties?.checksum && f.appProperties?.app === "kdf-pos");
}
