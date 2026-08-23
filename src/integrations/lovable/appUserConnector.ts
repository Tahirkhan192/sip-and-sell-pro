/**
 * App User Connector helpers.
 *
 * Server-only. Used by the local app server to start the Google sign-in
 * window and to talk to Google Drive on behalf of the account that signed in.
 * Never import this from a browser file — it reads server secrets.
 */

function requireApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    throw new Error("LOVABLE_API_KEY is not set on this computer.");
  }
  return key;
}

export interface AppUserOAuthAuthorizeParams {
  gatewayBaseUrl: string;
  connectorId: string;
  appUserId: string;
  clientAPIKey: string;
  returnUrl: string;
  connectionAPIKey?: string;
  credentialsConfiguration?: Record<string, unknown>;
}

export async function authorizeAppUserOAuth(
  params: AppUserOAuthAuthorizeParams,
): Promise<{ authorizationUrl: string; sessionId: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${requireApiKey()}`,
    "Content-Type": "application/json",
    "X-Client-Api-Key": params.clientAPIKey,
  };
  if (params.connectionAPIKey) headers["X-Connection-Api-Key"] = params.connectionAPIKey;

  const res = await fetch(`${params.gatewayBaseUrl}/api/v1/app-users/oauth2/authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      connector_id: params.connectorId,
      app_user_id: params.appUserId,
      return_url: params.returnUrl,
      credentials_configuration: params.credentialsConfiguration,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google sign-in could not start (${res.status}): ${text || res.statusText}`);
  const body = JSON.parse(text || "{}") as { authorization_url?: string; session_id?: string };
  if (!body.authorization_url) throw new Error("Google sign-in did not return a window address.");
  return { authorizationUrl: body.authorization_url, sessionId: body.session_id ?? "" };
}

export async function exchangeAppUserOAuthCode(
  gatewayBaseUrl: string,
  code: string,
): Promise<{ connectionAPIKey: string; connectorId: string }> {
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/oauth2/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requireApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google sign-in could not finish (${res.status}): ${text || res.statusText}`);
  const body = JSON.parse(text || "{}") as { api_key?: string; connector_id?: string };
  if (!body.api_key || !body.connector_id) throw new Error("Google sign-in returned an incomplete answer.");
  return { connectionAPIKey: body.api_key, connectorId: body.connector_id };
}

export async function disconnectAppUser(
  gatewayBaseUrl: string,
  connectionAPIKey: string,
  connectorId: string,
): Promise<void> {
  const res = await fetch(`${gatewayBaseUrl}/api/v1/app-users/connection`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "X-Connection-Api-Key": connectionAPIKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connector_id: connectorId }),
  });
  if (!res.ok) throw new Error(`Disconnect failed (${res.status}): ${await res.text()}`);
}
