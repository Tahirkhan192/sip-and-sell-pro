import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Modules the owner can show/hide from navigation. Settings can never be hidden. */
export const MENU_MODULES: { key: string; label: string }[] = [
  { key: "/", label: "Dashboard" },
  { key: "/pos", label: "POS" },
  { key: "/sales", label: "Sales" },
  { key: "/products", label: "Products" },
  { key: "/categories", label: "Categories" },
  { key: "/recipes", label: "Recipes" },
  { key: "/production", label: "Production" },
  { key: "/stock-items", label: "Stock Items" },
  { key: "/stock-transfer", label: "Stock Transfer" },
  { key: "/purchases", label: "Purchases" },
  { key: "/customers", label: "Customers" },
  { key: "/staff", label: "Staff Management" },
  { key: "/expenses", label: "Expenses" },
  { key: "/cash-movements", label: "Money Movements" },
  { key: "/daily-closing", label: "Daily Closing" },
  { key: "/digi-katha-closing", label: "Digi Katha Closing" },
  { key: "/delivery-expenses", label: "Delivery Expenses" },
  { key: "/delivery-report", label: "Delivery Report" },
  { key: "/stock", label: "Stock" },
  { key: "/reports", label: "Reports" },
];

/** Modules that can never be hidden (owner would lock themselves out). */
export const ALWAYS_VISIBLE = new Set<string>(["/settings"]);

export const DEFAULT_MENU_VISIBILITY: Record<string, boolean> = MENU_MODULES.reduce(
  (acc, m) => {
    // Customer module is OFF by default (external Digi Katha app is used instead).
    acc[m.key] = m.key !== "/customers";
    return acc;
  },
  {} as Record<string, boolean>,
);

const LS_KEY = "menu_visibility";

function readLocal(): Record<string, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

function writeLocal(v: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function normalizeVisibility(raw: unknown): Record<string, boolean> {
  const map = { ...DEFAULT_MENU_VISIBILITY };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k in map) map[k] = !!v;
    }
  }
  return map;
}

/** Reads the owner's menu visibility map. Falls back to a local copy when the
 *  settings row/column is unavailable, so navigation never breaks. */
export function useMenuVisibility() {
  return useQuery({
    queryKey: ["settings", "menu-visibility"],
    queryFn: async () => {
      const { data } = await supabase
        .from("settings" as any)
        .select("*")
        .eq("id", 1)
        .maybeSingle();
      const remote = (data as any)?.menu_visibility;
      if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
        const v = normalizeVisibility(remote);
        writeLocal(v);
        return v;
      }
      return normalizeVisibility(readLocal());
    },
    initialData: () => normalizeVisibility(readLocal()),
    staleTime: 30_000,
  });
}

export function useSaveMenuVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (value: Record<string, boolean>) => {
      writeLocal(value);
      const { error } = await supabase.from("settings" as any).upsert({
        id: 1,
        menu_visibility: value,
        updated_at: new Date().toISOString(),
      });
      // Saved locally regardless; surface only unexpected failures silently.
      if (error) return { persisted: false as const };
      return { persisted: true as const };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function isModuleVisible(map: Record<string, boolean> | undefined, path: string) {
  if (ALWAYS_VISIBLE.has(path)) return true;
  const v = map ?? DEFAULT_MENU_VISIBILITY;
  return v[path] !== false;
}

/** Resolves a pathname to the module key that governs it. */
export function moduleKeyForPath(pathname: string): string | null {
  if (pathname === "/") return "/";
  const match = MENU_MODULES.filter((m) => m.key !== "/")
    .map((m) => m.key)
    .filter((k) => pathname === k || pathname.startsWith(k + "/"))
    .sort((a, b) => b.length - a.length)[0];
  return match ?? null;
}
