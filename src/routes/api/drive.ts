/**
 * Google Drive bridge for the offline app.
 *
 * The app itself always works from the database on this computer. This route
 * is the only place that ever touches the internet: it copies one snapshot
 * file to and from Google Drive so several computers (and the Android viewer)
 * can share the same data.
 *
 *   GET  /api/drive            → status + latest snapshot metadata
 *   GET  /api/drive?about=1    → which Google account is being used
 *   GET  /api/drive?download=1 → the snapshot JSON itself
 *   POST /api/drive            → upload/replace the snapshot
 *
 * A computer can point at its own Google Drive account: the browser sends its
 * saved account key in the `x-kdf-drive-key` header and it is used instead of
 * the account configured for the app.
 */

import { createFileRoute } from "@tanstack/react-router";

const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";
export const SNAPSHOT_NAME = "khyber-delicious-food-data.json";

function creds(request: Request) {
  const lovable = process.env["LOVABLE_API_KEY"];
  const override = request.headers.get("x-kdf-drive-key")?.trim();
  const drive = override || process.env["GOOGLE_DRIVE_API_KEY"];
  return { lovable, drive, custom: Boolean(override), ready: Boolean(lovable && drive) };
}

function headers(request: Request) {
  const { lovable, drive } = creds(request);
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

async function findSnapshot(request: Request): Promise<{ file: DriveFile | null; error?: Response }> {
  const q = encodeURIComponent(`name = '${SNAPSHOT_NAME}' and trashed = false`);
  const res = await fetch(
    `${GATEWAY}/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)`,
    { headers: headers(request) },
  );
  if (!res.ok) return { file: null, error: await relay(res, "search") };
  const body = (await res.json()) as { files?: DriveFile[] };
  return { file: body.files?.[0] ?? null };
}

export const Route = createFileRoute("/api/drive")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const c = creds(request);
        if (!c.ready) {
          return json({ connected: false, reason: "Google Drive is not configured on this computer." });
        }
        const url = new URL(request.url);

        if (url.searchParams.get("about") === "1") {
          const res = await fetch(`${GATEWAY}/drive/v3/about?fields=user,storageQuota`, {
            headers: headers(request),
          });
          if (!res.ok) return relay(res, "account lookup");
          const body = (await res.json()) as {
            user?: { emailAddress?: string; displayName?: string };
            storageQuota?: { usage?: string; limit?: string };
          };
          return json({
            connected: true,
            custom: c.custom,
            email: body.user?.emailAddress ?? null,
            name: body.user?.displayName ?? null,
            storage: body.storageQuota ?? null,
          });
        }

        const { file, error } = await findSnapshot(request);
        if (error) return error;

        // Which Gmail accounts were invited to this backup file.
        if (url.searchParams.get("people") === "1") {
          if (!file) return json({ people: [] });
          const res = await fetch(
            `${GATEWAY}/drive/v3/files/${file.id}/permissions?fields=permissions(id,emailAddress,role,type)`,
            { headers: headers(request) },
          );
          if (!res.ok) return relay(res, "shared list");
          const body = (await res.json()) as {
            permissions?: { id: string; emailAddress?: string; role?: string; type?: string }[];
          };
          return json({
            people: (body.permissions ?? []).filter((p) => p.type === "user" && p.emailAddress),
          });
        }

        if (url.searchParams.get("download") !== "1") {
          return json({ connected: true, custom: c.custom, file });
        }
        if (!file) return json({ error: "No data file on Google Drive yet." }, 404);

        const res = await fetch(`${GATEWAY}/drive/v3/files/${file.id}?alt=media`, { headers: headers(request) });
        if (!res.ok) return relay(res, "download");
        return new Response(await res.text(), {
          headers: { "content-type": "application/json", "x-drive-modified": file.modifiedTime },
        });
      },

      POST: async ({ request }) => {
        if (!creds(request).ready)
          return json({ error: "Google Drive is not configured on this computer." }, 503);

        // Invite flow: the owner types a Gmail address, Google emails that person
        // a request to open the data file, and once they accept the app can find
        // the same backup file from their account.
        const inviteUrl = new URL(request.url);
        if (inviteUrl.searchParams.get("invite") === "1") {
          const { email } = (await request.json()) as { email?: string };
          const address = (email ?? "").trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
            return json({ error: "Enter a valid Gmail address." }, 400);

          const { file, error } = await findSnapshot(request);
          if (error) return error;
          if (!file)
            return json(
              { error: "There is no backup file on Google Drive yet. Let the app upload one first, then invite." },
              409,
            );

          const res = await fetch(
            `${GATEWAY}/drive/v3/files/${file.id}/permissions?sendNotificationEmail=true&fields=id,emailAddress,role`,
            {
              method: "POST",
              headers: { ...headers(request), "content-type": "application/json" },
              body: JSON.stringify({ type: "user", role: "writer", emailAddress: address }),
            },
          );
          if (!res.ok) return relay(res, "invite");
          return json({ ok: true, email: address, file });
        }

        const payload = await request.text();
        const { file, error } = await findSnapshot(request);
        if (error) return error;

        if (file) {
          const res = await fetch(
            `https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files/${file.id}?uploadType=media&fields=id,modifiedTime`,
            {
              method: "PATCH",
              headers: { ...headers(request), "content-type": "application/json" },
              body: payload,
            },
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
            headers: { ...headers(request), "content-type": `multipart/related; boundary=${boundary}` },
            body,
          },
        );
        if (!res.ok) return relay(res, "upload");
        return json({ ok: true, file: await res.json() });
      },
    },
  },
});
