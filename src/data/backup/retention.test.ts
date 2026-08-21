/**
 * Minute-level Drive backups must not shred the history: tiered retention
 * keeps the newest N files, one per hour for a day, one per day for a
 * fortnight, and drops everything else.
 */
import { describe, expect, it } from "vitest";
import { selectRetained, DEFAULT_KEEP } from "./drive-backup";
import type { DriveFile } from "./drive";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function file(minutesAgo: number): DriveFile {
  const t = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  return {
    id: `f-${minutesAgo}`,
    name: `kdf-pos-backup-${t}.json.gz`,
    createdTime: t,
    appProperties: { app: "kdf-pos", checksum: `c-${minutesAgo}`, createdAt: t },
  };
}

describe("tiered Drive retention", () => {
  it("keeps every one of the newest backups", () => {
    const files = Array.from({ length: 30 }, (_, i) => file(i));
    const kept = selectRetained(files, DEFAULT_KEEP, NOW);
    for (let i = 0; i < DEFAULT_KEEP; i += 1) {
      expect(kept.some((f) => f.id === `f-${i}`)).toBe(true);
    }
  });

  it("thins the last day down to roughly one per hour", () => {
    // 24 hours of minute backups.
    const files = Array.from({ length: 24 * 60 }, (_, i) => file(i));
    const kept = selectRetained(files, DEFAULT_KEEP, NOW);
    // newest 10 + at most one per hour bucket in the day
    expect(kept.length).toBeLessThanOrEqual(DEFAULT_KEEP + 26);
    expect(kept.length).toBeGreaterThan(20);
  });

  it("keeps one per day for two weeks and drops anything older", () => {
    const files = [
      file(0),
      file(60 * 24 * 2), // 2 days
      file(60 * 24 * 2 + 5), // same day, later minute
      file(60 * 24 * 13), // 13 days
      file(60 * 24 * 40), // 40 days — gone
    ];
    const kept = selectRetained(files, 1, NOW);
    const ids = kept.map((f) => f.id);
    expect(ids).toContain("f-0");
    expect(ids).toContain(`f-${60 * 24 * 13}`);
    expect(ids).not.toContain(`f-${60 * 24 * 40}`);
    // only one of the two same-day files survives
    expect(ids.filter((id) => id.startsWith(`f-${60 * 24 * 2}`)).length).toBe(1);
  });

  it("never empties an existing set", () => {
    const kept = selectRetained([file(60 * 24 * 365)], 10, NOW);
    expect(kept).toHaveLength(1);
  });
});
