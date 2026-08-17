import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readSettingsColumns } from "@/data/reads/reference";
import { StockPinDialog } from "@/components/StockPinDialog";

/** Every module the Owner can individually protect with the PIN. */
export const PIN_MODULES = [
  { key: "edit_stock", label: "Edit Stock" },
  { key: "manual_stock_adjustment", label: "Manual Stock Adjustment" },
  { key: "delete_invoice", label: "Delete Invoice" },
  { key: "delete_purchase", label: "Delete Purchase" },
  { key: "delete_expense", label: "Delete Expense" },
  { key: "staff_salary_edit", label: "Staff Salary Edit" },
  { key: "opening_stock", label: "Opening Stock" },
  { key: "digi_katha_opening", label: "Digi Katha Opening" },
  { key: "settings", label: "Settings" },
  { key: "reports", label: "Reports" },
  { key: "user_management", label: "User Management" },
  { key: "money_movement_delete", label: "Money Movement Delete" },
] as const;

export type PinModule = (typeof PIN_MODULES)[number]["key"];

/** Defaults keep the previously hard-coded protections switched on. */
export const DEFAULT_PIN_LOCKS: Record<string, boolean> = {
  edit_stock: true,
  manual_stock_adjustment: true,
  staff_salary_edit: true,
  opening_stock: true,
  digi_katha_opening: true,
};

export function usePinLocks() {
  return useQuery({
    queryKey: ["settings", "pin-locks"],
    queryFn: async (): Promise<Record<string, boolean>> => {
      const data = await readSettingsColumns<{ pin_locks: any }>("pin_locks");
      const raw = (data?.pin_locks ?? null) as Record<string, boolean> | null;
      if (!raw || Object.keys(raw).length === 0) return { ...DEFAULT_PIN_LOCKS };
      return raw;
    },
    staleTime: 30_000,
  });
}

/**
 * PIN gate driven by the Owner's per-module settings.
 * `guard(module, action)` runs `action` immediately when the module is not
 * protected, otherwise it asks for the PIN first.
 */
export function usePinGate() {
  const { data: locks } = usePinLocks();
  const [state, setState] = useState<{ open: boolean; title: string; action: null | (() => void) }>({
    open: false,
    title: "Enter PIN",
    action: null,
  });

  const guard = useCallback(
    (moduleKey: PinModule, action: () => void, title?: string) => {
      const enabled = (locks ?? DEFAULT_PIN_LOCKS)[moduleKey];
      if (!enabled) {
        action();
        return;
      }
      const label = PIN_MODULES.find((m) => m.key === moduleKey)?.label ?? "this action";
      setState({ open: true, title: title ?? `PIN required — ${label}`, action });
    },
    [locks],
  );

  const dialog = (
    <StockPinDialog
      open={state.open}
      title={state.title}
      description="This module is PIN protected in Settings. Enter the PIN to continue."
      onOpenChange={(v) => { if (!v) setState((s) => ({ ...s, open: false, action: null })); }}
      onConfirm={() => {
        const run = state.action;
        setState({ open: false, title: state.title, action: null });
        run?.();
      }}
    />
  );

  return { guard, dialog, locks: locks ?? DEFAULT_PIN_LOCKS };
}
