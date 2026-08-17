/**
 * PHASE 5B — business settings (the single `settings` row, id = 1).
 *
 * Writable: negative-stock policy, business timezone / day-start / month-start
 * day, PIN locks, staff invoice colour, WhatsApp country code and auto-send.
 *
 * NOT writable locally: the WhatsApp token, phone id and business id. They are
 * credentials — the local path never stores, hashes or transmits them.
 *
 * The row is never created and never deleted locally: it always exists.
 */

import { updateMasterRow, type MasterMutationResult } from "./run";

export const SETTINGS_ID = 1;

export type BusinessSettingsInput = {
  allow_negative_stock?: boolean;
  timezone?: string;
  /** 'HH:MM:SS' — the business-date rollover time. */
  business_day_start_time?: string;
  /** 1–28. */
  business_month_start_day?: number;
  pin_locks?: Record<string, unknown>;
  staff_invoice_color?: string;
  whatsapp_country_code?: string | null;
  whatsapp_auto_send?: boolean | null;
};

export function updateBusinessSettings(
  input: BusinessSettingsInput,
): Promise<MasterMutationResult> {
  return updateMasterRow("settings", SETTINGS_ID, { ...input });
}

/** Convenience wrapper for the granular PIN-lock settings. */
export function updatePinLocks(pinLocks: Record<string, unknown>): Promise<MasterMutationResult> {
  return updateMasterRow("settings", SETTINGS_ID, { pin_locks: pinLocks });
}
