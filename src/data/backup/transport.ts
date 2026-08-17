/**
 * PHASE 8 — backup bytes on the wire.
 *
 * The CHECKSUM is always computed over the canonical JSON payload, never over
 * the compressed bytes, so compression can be switched on or off without
 * changing a single checksum. Compression is used only when the browser has a
 * native `CompressionStream("gzip")`; otherwise the file is uploaded as plain
 * JSON and the envelope records `compression: "none"`.
 */

import type { BackupCompression, BackupFile } from "./format";

export type EncodedBackup = {
  bytes: Uint8Array;
  compression: BackupCompression;
  mimeType: string;
  /** Bytes of the uncompressed JSON, for the UI and Drive metadata. */
  rawSize: number;
};

function hasGzip(): boolean {
  return typeof (globalThis as any).CompressionStream === "function";
}

async function streamThrough(bytes: Uint8Array, transform: any): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** JSON → (optionally gzipped) bytes. */
export async function encodeBackup(backup: BackupFile): Promise<EncodedBackup> {
  const raw = new TextEncoder().encode(JSON.stringify(backup));
  if (!hasGzip()) {
    return {
      bytes: raw,
      compression: "none",
      mimeType: "application/json",
      rawSize: raw.byteLength,
    };
  }
  const gz = await streamThrough(raw, new (globalThis as any).CompressionStream("gzip"));
  return {
    bytes: gz,
    compression: "gzip",
    mimeType: "application/gzip",
    rawSize: raw.byteLength,
  };
}

/** Bytes → BackupFile. Gzip is detected from the magic number, not the name. */
export async function decodeBackup(bytes: Uint8Array): Promise<BackupFile> {
  let data = bytes;
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzipped) {
    if (typeof (globalThis as any).DecompressionStream !== "function") {
      throw new Error("This browser cannot read a compressed backup.");
    }
    data = await streamThrough(bytes, new (globalThis as any).DecompressionStream("gzip"));
  }
  const text = new TextDecoder().decode(data);
  try {
    return JSON.parse(text) as BackupFile;
  } catch {
    throw new Error("Backup file is malformed — it is not valid JSON.");
  }
}
