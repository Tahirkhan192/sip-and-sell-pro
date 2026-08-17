import { it, expect, vi } from "vitest";
it("env", () => {
  vi.stubEnv("VITE_ENABLE_LOCAL_SQLITE", "true");
  expect((import.meta as any).env.VITE_ENABLE_LOCAL_SQLITE).toBe("true");
  expect(String(process.env.VITE_ENABLE_LOCAL_SQLITE)).toBe("true");
});
