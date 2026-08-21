/**
 * Google Drive bridge for the offline app.
 *
 * The app itself always works from the database on this computer. This route
 * is the only place that ever touches the internet: it copies one snapshot
 * file to and from Google Drive so several computers (and the Android viewer)
 * can share the same data.
 *
 *   GET  /api/drive            → status + latest snapshot metadata
 *   GET  /api/drive?download=1 → the snapshot JSON itself
 *   POST /api/drive            → upload/replace the snapshot
 */

import { createFileRoute } from "@tanstack/react-router";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
export const SNAPSHOT_NAME = "khyber-delicious-food-data.json";

function creds() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const drive = process.env["GOOGLE_DRIVE_API_KEY"];
  return { lovable, drive, ready: Boolean(lovable && drive) };
}

function headers() {
  const { lovable, drive } = creds();
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": String(drive),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function relay(res: Response, what: string) {
  const text = await res.text();
  console.error(`[drive] ${what} failed [${res.status}]: ${text}`);
  return json({ error: `Google Drive ${what} failed [${res.status}]: ${text}` }, 502);
}

type DriveFile = { id: string; name: string; modifiedTime: string; size?: string };

async function findSnapshot(): Promise<{ file: DriveFile | null; error?: Response }> {
  const q = encodeURIComponent(`name = '${SNAPSHOT_NAME}' and trashed = false`);
  const res = await fetch(
    `${GATEWAY}/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)`,
    { headers: headers() },
  );
  if (!res.ok) return { file: null, error: await relay(res, "search") };
  const body = (await res.json()) as { files?: DriveFile[] };
  return { file: body.files?.[0] ?? null };
}

export const Route = createFileRoute("/api/drive")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!creds().ready) {
          return json({ connected: false, reason: "Google Drive is not configured on this computer." });
        }
        const url = new URL(request.url);
        const { file, error } = await findSnapshot();
        if (error) return error;

        if (url.searchParams.get("download") !== "1") {
          return json({ connected: true, file });
        }
        if (!file) return json({ error: "No data file on Google Drive yet." }, 404);

        const res = await fetch(`${GATEWAY}/drive/v3/files/${file.id}?alt=media`, { headers: headers() });
        if (!res.ok) return relay(res, "download");
        return new Response(await res.text(), {
          headers: { "content-type": "application/json", "x-drive-modified": file.modifiedTime },
        });
      },

      POST: async ({ request }) => {
        if (!creds().ready) return json({ error: "Google Drive is not configured on this computer." }, 503);
        const payload = await request.text();
        const { file, error } = await findSnapshot();
        if (error) return error;

        if (file) {
          const res = await fetch(
            `https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files/${file.id}?uploadType=media&fields=id,modifiedTime`,
            { method: "PATCH", headers: { ...headers(), "content-type": "application/json" }, body: payload },
          );
          if (!res.ok) return relay(res, "upload");
          return json({ ok: true, file: await res.json() });
        }

        const boundary = `kdf${Date.now()}`;
        const body =
          `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify({ name: SNAPSHOT_NAME, mimeType: "application/json" })}\r\n` +
          `--${boundary}\r\ncontent-type: application/json\r\n\r\n${payload}\r\n--${boundary}--`;
        const res = await fetch(
          `https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`,
          {
            method: "POST",
            headers: { ...headers(), "content-type": `multipart/related; boundary=${boundary}` },
            body,
          },
        );
        if (!res.ok) return relay(res, "upload");
        return json({ ok: true, file: await res.json() });
      },
    },
  },
});
