/**
 * PHASE 8 — Google sign-in for Drive backups (browser only).
 *
 * Uses Google Identity Services' token flow. What that means for security:
 *
 *   * the app never holds a Google client SECRET — the OAuth client id is a
 *     public identifier and is the only Google value stored on the device;
 *   * the access token lives in memory for its lifetime (about an hour) and is
 *     dropped on reload or disconnect. It is NEVER written to SQLite, never
 *     put in a backup file and never logged;
 *   * the only scope requested is `drive.appdata` — the app cannot see, list
 *     or touch any other file in the owner's Drive.
 */

import { DRIVE_SCOPE, type TokenProvider } from "./drive";

const GIS_SRC = "https://accounts.google.com/gsi/client";
/** Public OAuth client id. Not a secret; safe in local settings/env. */
const CLIENT_ID_KEY = "kdf.drive.clientId";
/** Remembers only that the user connected — never the token itself. */
const CONNECTED_KEY = "kdf.drive.connected";

export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

let accessToken: string | null = null;
let expiresAt = 0;
let tokenClient: any = null;

export function getClientId(): string {
  const fromEnv = (import.meta as any).env?.VITE_GOOGLE_DRIVE_CLIENT_ID;
  if (typeof fromEnv === "string" && fromEnv) return fromEnv;
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(CLIENT_ID_KEY) ?? "";
}

export function setClientId(id: string): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = id.trim();
  if (trimmed) localStorage.setItem(CLIENT_ID_KEY, trimmed);
  else localStorage.removeItem(CLIENT_ID_KEY);
}

export function isDriveConfigured(): boolean {
  return getClientId().length > 0;
}

/** True when the user connected Drive at least once on this device. */
export function wasConnected(): boolean {
  return typeof localStorage !== "undefined" && localStorage.getItem(CONNECTED_KEY) === "true";
}

export function hasLiveToken(): boolean {
  return Boolean(accessToken) && Date.now() < expiresAt - 60_000;
}

function loadGis(): Promise<any> {
  const g = (globalThis as any).google;
  if (g?.accounts?.oauth2) return Promise.resolve(g);
  if (typeof document === "undefined") {
    return Promise.reject(new GoogleAuthError("Google sign-in is only available in the browser."));
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const onLoad = () => {
      const loaded = (globalThis as any).google;
      if (loaded?.accounts?.oauth2) resolve(loaded);
      else reject(new GoogleAuthError("Google sign-in failed to load."));
    };
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", () => reject(new GoogleAuthError("Google sign-in failed to load.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = onLoad;
    script.onerror = () => reject(new GoogleAuthError("Google sign-in failed to load."));
    document.head.appendChild(script);
  });
}

async function ensureTokenClient(): Promise<any> {
  const clientId = getClientId();
  if (!clientId) {
    throw new GoogleAuthError(
      "Google Drive backup is not configured yet — add the Google client ID in Settings.",
    );
  }
  if (tokenClient) return tokenClient;
  const google = await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: () => {},
  });
  return tokenClient;
}

function requestToken(prompt: "" | "consent"): Promise<string> {
  return ensureTokenClient().then(
    (client) =>
      new Promise<string>((resolve, reject) => {
        client.callback = (response: any) => {
          if (response?.error) {
            reject(new GoogleAuthError(response.error_description || response.error));
            return;
          }
          accessToken = response.access_token;
          expiresAt = Date.now() + Number(response.expires_in ?? 3600) * 1000;
          if (typeof localStorage !== "undefined") localStorage.setItem(CONNECTED_KEY, "true");
          resolve(accessToken as string);
        };
        client.error_callback = (err: any) =>
          reject(new GoogleAuthError(err?.message ?? "Google sign-in was cancelled."));
        try {
          client.requestAccessToken({ prompt });
        } catch (e: any) {
          reject(new GoogleAuthError(e?.message ?? "Google sign-in could not start."));
        }
      }),
  );
}

/** Interactive connect — shows Google's consent screen. */
export async function connectGoogleDrive(): Promise<void> {
  await requestToken("consent");
}

/** Drops the in-memory token and the "connected" hint. Deletes no backup. */
export function disconnectGoogleDrive(): void {
  accessToken = null;
  expiresAt = 0;
  tokenClient = null;
  if (typeof localStorage !== "undefined") localStorage.removeItem(CONNECTED_KEY);
}

/**
 * Token provider for the Drive client: reuses the live token and silently
 * refreshes when it is close to expiry. Silent refresh only works while the
 * Google session is alive; otherwise the caller gets a clear "reconnect" error.
 */
export const googleTokenProvider: TokenProvider = async () => {
  if (hasLiveToken()) return accessToken as string;
  if (!wasConnected()) {
    throw new GoogleAuthError("Google Drive is not connected on this device.");
  }
  return requestToken("");
};
