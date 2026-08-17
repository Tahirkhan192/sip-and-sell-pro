/**
 * PHASE 5A — client-side identifier generation.
 *
 * Local records must be able to get their own primary key with no network and
 * no Postgres `gen_random_uuid()`. Cloud UUID behaviour is untouched: this is
 * only used by the local mutation foundation.
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function randomBytes(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    throw new Error("Secure random generation is unavailable — cannot create a local UUID.");
  }
  return c.getRandomValues(new Uint8Array(n));
}

/** RFC 4122 v4 UUID from cryptographically secure randomness. */
export function newUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Identifier for one local mutation (distinct from the entity id). */
export function newMutationId(): string {
  return newUuid();
}

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_V4.test(value);
}
