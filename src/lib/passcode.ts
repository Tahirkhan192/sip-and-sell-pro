/**
 * Offline sign-in passcode.
 *
 * The app has no online sign-in: the only credential is a numeric passcode
 * stored in the embedded local database on this computer. The default is
 * "1234" and it can be changed in Settings.
 */

import { getEngine } from "@/lib/local-db/engine";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_PASSCODE = "1234";
const OWNER_EMAIL = "owner@local";

type Cred = { email: string; password: string };

/** Reads the single local credential row, creating the default one on first run. */
async function readCredential(): Promise<Cred> {
  const { db } = await getEngine();
  const found = await db.query<Cred>(
    "SELECT email, password FROM auth.local_credentials ORDER BY created_at LIMIT 1",
  );
  if (found.rows.length > 0) return found.rows[0];
  // First run on this computer — sign-in creates the owner account.
  return { email: OWNER_EMAIL, password: DEFAULT_PASSCODE };
}

/** True when the passcode is still the factory default. */
export async function isDefaultPasscode(): Promise<boolean> {
  const cred = await readCredential();
  return cred.password === DEFAULT_PASSCODE;
}

export async function signInWithPasscode(
  passcode: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cred = await readCredential();
  if (passcode !== cred.password) return { ok: false, error: "Incorrect passcode" };
  const { error } = await supabase.auth.signInWithPassword({
    email: cred.email,
    password: passcode,
  });
  if (error) return { ok: false, error: error.message || "Sign in failed" };
  return { ok: true };
}

export async function changePasscode(
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4,}$/.test(next)) return { ok: false, error: "New passcode must be at least 4 digits" };
  const cred = await readCredential();
  if (current !== cred.password) return { ok: false, error: "Incorrect current passcode" };
  const { db } = await getEngine();
  await db.query("UPDATE auth.local_credentials SET password = $1", [next]);
  return { ok: true };
}
