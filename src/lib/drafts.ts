/**
 * Crash-recovery draft persistence. Saves in-progress invoices/purchases/expenses
 * to localStorage so a browser crash or accidental refresh does not lose input.
 *
 * Usage:
 *   saveDraft("pos", cartState)   // on every meaningful change
 *   const draft = loadDraft<CartState>("pos")
 *   clearDraft("pos")             // once the record is persisted
 */
import { logger } from "./logger";

const PREFIX = "cafe.draft.";

export type DraftKey = "pos" | "purchase" | "expense" | "money_movement";

export function saveDraft<T>(key: DraftKey, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch (e) {
    logger.warn("app", `Failed to save draft:${key}`, e);
  }
}

export function loadDraft<T>(key: DraftKey): { savedAt: number; value: T } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as { savedAt: number; value: T };
  } catch (e) {
    logger.warn("app", `Failed to load draft:${key}`, e);
    return null;
  }
}

export function clearDraft(key: DraftKey): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
