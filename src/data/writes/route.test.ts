/**
 * PHASE 5C — proofs for the write router.
 *
 * These are the guarantees the whole phase rests on: exactly one path runs,
 * nothing is silently dropped, and a genuine data rejection is never retried
 * against the cloud.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalMutationError } from "@/data/local/mutations/errors";

const canWriteLocally = vi.fn<(t: string) => Promise<boolean>>();
vi.mock("@/data/repo/health", () => ({ canWriteLocally: (t: string) => canWriteLocally(t) }));

const { routeMasterWrite } = await import("./route");

const okLocal = { ok: true } as any;

describe("routeMasterWrite", () => {
  beforeEach(() => canWriteLocally.mockReset());

  it("uses the cloud mutation when the local gate is closed", async () => {
    canWriteLocally.mockResolvedValue(false);
    const local = vi.fn();
    const cloud = vi.fn().mockResolvedValue(undefined);

    const out = await routeMasterWrite("categories", local as any, cloud);

    expect(out.path).toBe("cloud");
    expect(local).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it("uses the local procedure when the gate is open — and never dual-writes", async () => {
    canWriteLocally.mockResolvedValue(true);
    const local = vi.fn().mockResolvedValue(okLocal);
    const cloud = vi.fn();

    const out = await routeMasterWrite("categories", local, cloud as any);

    expect(out.path).toBe("local");
    expect(out.local).toBe(okLocal);
    expect(cloud).not.toHaveBeenCalled();
  });

  it("falls back to the cloud when the local database is unusable", async () => {
    canWriteLocally.mockResolvedValue(true);
    const local = vi
      .fn()
      .mockRejectedValue(new LocalMutationError("DATABASE_LOCKED", "another tab holds the pool"));
    const cloud = vi.fn().mockResolvedValue(undefined);

    const out = await routeMasterWrite("categories", local, cloud);

    expect(out.path).toBe("cloud");
    expect(out.fallbackReason).toBe("DATABASE_LOCKED");
    expect(cloud).toHaveBeenCalledTimes(1);
  });

  it("surfaces a real rejection instead of retrying it against the cloud", async () => {
    canWriteLocally.mockResolvedValue(true);
    const local = vi
      .fn()
      .mockRejectedValue(new LocalMutationError("TRANSACTION_FAILED", "duplicate name"));
    const cloud = vi.fn();

    await expect(routeMasterWrite("categories", local, cloud as any)).rejects.toThrow(
      "duplicate name",
    );
    expect(cloud).not.toHaveBeenCalled();
  });
});
