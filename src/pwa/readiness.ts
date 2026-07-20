/**
 * Local database readiness gate.
 *
 * Nothing in the app should read business data until IndexedDB has been
 * fully hydrated from Lovable Cloud for the first time. This module tracks
 * that state and lets components subscribe.
 */

let ready = false;
let progressText: string = "Preparing local database…";
const listeners = new Set<() => void>();

export function isLocalReady(): boolean {
  return ready;
}

export function getReadinessProgress(): string {
  return progressText;
}

export function setReadinessProgress(msg: string) {
  progressText = msg;
  emit();
}

export function markLocalReady() {
  if (ready) return;
  ready = true;
  emit();
}

/** Test/dev helper — force back to not-ready. Not used in production paths. */
export function _resetLocalReady() {
  ready = false;
}

export function subscribeReadiness(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function emit() {
  for (const cb of listeners) {
    try { cb(); } catch { /* noop */ }
  }
}
