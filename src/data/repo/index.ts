/**
 * Repository entry point.
 *
 * The whole application will eventually read and write through `repo()`.
 * Today the active implementation is the cloud one, and the app still calls
 * the Supabase client directly, so behaviour is untouched.
 *
 * The offline switch-over is a single line, performed manually later:
 *
 *   setRepository(new LocalRepository(await openLocalDb()));
 */

import { CloudRepository } from "./cloud-repository";
import type { DataRepository } from "./types";

export * from "./types";
export { CloudRepository } from "./cloud-repository";
export { LocalRepository, REQUIRED_LOCAL_PROCEDURES } from "./local-repository";

let active: DataRepository = new CloudRepository();

/** The repository every data call should go through. */
export function repo(): DataRepository {
  return active;
}

/** Swap the backing store. Intended for the manual offline conversion only. */
export function setRepository(next: DataRepository) {
  active = next;
}
