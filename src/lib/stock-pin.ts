// Client-side PIN gate for manual Current Stock edits.
// Stored as SHA-256 hex in localStorage; default PIN is "1234".
const KEY = "kdf.stockPin.v1";
const DEFAULT_PIN = "1234";

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getStoredHash(): Promise<string> {
  if (typeof window === "undefined") return "";
  const v = window.localStorage.getItem(KEY);
  if (v) return v;
  return await sha256(DEFAULT_PIN);
}

export async function verifyStockPin(pin: string): Promise<boolean> {
  if (!pin) return false;
  const stored = await getStoredHash();
  const attempt = await sha256(pin);
  return stored === attempt;
}

export async function changeStockPin(current: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!next || next.length < 4) return { ok: false, error: "New PIN must be at least 4 digits" };
  const okCurrent = await verifyStockPin(current);
  if (!okCurrent) return { ok: false, error: "Incorrect Current PIN" };
  const hash = await sha256(next);
  window.localStorage.setItem(KEY, hash);
  return { ok: true };
}
