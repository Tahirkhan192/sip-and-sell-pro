/**
 * Connecting a Google Drive account from Settings.
 *
 *   GET  /api/drive-connect?start=1&device=<id>  → address of the Google window
 *   POST /api/drive-connect  { code }            → finishes and returns the
 *                                                  saved (unreadable) account code
 *   POST /api/drive-connect?forget=1 { token }   → signs the account out
 *
 * The real Google handle never reaches the app window: it is sealed with the
 * app's own key and only opened again inside this local server.
 */

import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeAppUserOAuth,
  disconnectAppUser,
  exchangeAppUserOAuthCode,
} from "@/integrations/lovable/appUserConnector";

const GATEWAY = "https://connector-gateway.lovable.dev";
const CONNECTOR = "google_drive";

const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/drive.file",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const Route = createFileRoute("/api/drive-connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const clientKey = process.env["GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY"];
        if (!clientKey || !process.env["LOVABLE_API_KEY"]) {
          return json({ error: "Google Drive sign-in is not available in this copy of the app." }, 503);
        }
        const url = new URL(request.url);
        const device = url.searchParams.get("device")?.trim();
        if (!device) return json({ error: "Missing device id" }, 400);

        const host = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
        const returnUrl = new URL(
          "/oauth/google-drive/return",
          host ? `https://${host}` : url.origin,
        ).toString();

        try {
          const { authorizationUrl } = await authorizeAppUserOAuth({
            gatewayBaseUrl: GATEWAY,
            connectorId: CONNECTOR,
            appUserId: device,
            clientAPIKey: clientKey,
            returnUrl,
            credentialsConfiguration: { scopes: SCOPES },
          });
          return json({ authorizationUrl });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 502);
        }
      },

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const { sealDriveToken, openDriveToken } = await import("@/lib/drive-token.server");

        if (url.searchParams.get("forget") === "1") {
          const { token } = (await request.json()) as { token?: string };
          try {
            if (token) await disconnectAppUser(GATEWAY, openDriveToken(token), CONNECTOR);
          } catch (err) {
            console.error("[drive-connect] disconnect", err);
          }
          return json({ ok: true });
        }

        const { code } = (await request.json()) as { code?: string };
        if (!code) return json({ error: "Missing sign-in code" }, 400);
        try {
          const { connectionAPIKey, connectorId } = await exchangeAppUserOAuthCode(GATEWAY, code);
          if (connectorId !== CONNECTOR) return json({ error: "Wrong Google service" }, 400);
          return json({ ok: true, token: sealDriveToken(connectionAPIKey) });
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : String(err) }, 502);
        }
      },
    },
  },
});
