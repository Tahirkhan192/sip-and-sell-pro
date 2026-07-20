const listeners = new Set<() => void>();

export const LOCAL_DATA_EVENT = "cafe:local-data-committed";

export function subscribeLocalDataChanges(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyLocalDataChanged() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_DATA_EVENT));
  }
}