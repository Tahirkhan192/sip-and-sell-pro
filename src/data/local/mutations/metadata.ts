/**
 * PHASE 5A — mutation metadata + deterministic payload integrity.
 *
 * The metadata answers, for a future sync engine: who/which device created a
 * mutation, when (UTC + business date/time), what operation happened, on which
 * entity, and against which local schema version.
 *
 * Payload hashing reuses the canonical serializer that Backup v1/v3 integrity
 * already relies on, so the same logical payload always produces the same
 * SHA-256 regardless of property order.
 */

import { canonicalStringify } from "@/data/backup/format";
import { LOCAL_SCHEMA_VERSION } from "../engine";
import type { LocalMutationEventRow } from "./engine-mutations";
import { newMutationId } from "./ids";
import type { MutationOperation, MutationStatus } from "./schema";
import { businessStamp, type BusinessStamp } from "./timestamps";

export type { MutationOperation, MutationStatus };

/**
 * Keys that must never appear in a stored mutation payload. Anything matching
 * is stripped before serialization AND before hashing, so a secret cannot
 * leak into the local event log or into a future upload.
 */
const FORBIDDEN_KEY_PATTERNS = [
  /pass(word|phrase)/i,
  /secret/i,
  /token/i,
  /jwt/i,
  /api[_-]?key/i,
  /service[_-]?role/i,
  /authorization/i,
  /credential/i,
  /session/i,
  /whatsapp_(token|phone_id|business_id)/i,
  /refresh/i,
  /access[_-]?key/i,
];

export const REDACTED = "[redacted]";

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((p) => p.test(key));
}

/** Recursively removes credential-like fields from a payload. */
export function redactPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactPayload(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isForbiddenKey(k) ? REDACTED : redactPayload(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Canonical (property-order independent) serialization of a payload. */
export function canonicalPayload(payload: unknown): string {
  return canonicalStringify(redactPayload(payload));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 of the canonical payload. Same logical payload → same hash. */
export async function payloadHash(payload: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable — cannot hash a mutation payload.");
  const bytes = new TextEncoder().encode(canonicalPayload(payload));
  return toHex(await subtle.digest("SHA-256", bytes));
}

export type MutationMetadata = {
  mutationId: string;
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: MutationOperation;
  businessDate: string;
  businessTime: string;
  createdAt: string;
  schemaVersion: number;
  payloadHash: string;
  status: MutationStatus;
};

export type BuildMetadataInput = {
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: MutationOperation;
  payload: unknown;
  status?: MutationStatus;
  mutationId?: string;
  at?: Date;
  stamp?: BusinessStamp;
};

/** Builds the metadata record for one local mutation. */
export async function buildMutationMetadata(
  input: BuildMetadataInput,
): Promise<MutationMetadata> {
  const stamp = input.stamp ?? businessStamp(input.at ?? new Date());
  return {
    mutationId: input.mutationId ?? newMutationId(),
    deviceId: input.deviceId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    businessDate: stamp.businessDate,
    businessTime: stamp.businessTime,
    createdAt: stamp.utc,
    schemaVersion: LOCAL_SCHEMA_VERSION,
    payloadHash: await payloadHash(input.payload),
    status: input.status ?? "local_test",
  };
}

/** Metadata → the row shape the worker stores. */
export function metadataToEventRow(m: MutationMetadata): LocalMutationEventRow {
  return {
    mutation_id: m.mutationId,
    device_id: m.deviceId,
    entity_type: m.entityType,
    entity_id: m.entityId,
    operation: m.operation,
    business_date: m.businessDate,
    business_time: m.businessTime,
    created_at: m.createdAt,
    schema_version: m.schemaVersion,
    payload_hash: m.payloadHash,
    status: m.status,
  };
}
