/**
 * Service worker registration wrapper.
 * Follows the Lovable PWA skill guards: never register in dev, iframe preview,
 * lovableproject.com preview hosts, or when ?sw=off is set. In any of those
 * cases it unregisters any existing /sw.js so a stale worker cannot serve
 * old HTML/chunks.
 */

const SW_URL = "/sw.js";

function shouldSkip(): boolean {
  if (typeof window === "undefined") return true;
  if (!("serviceWorker" in navigator)) return true;
  try {
    if (window.self !== window.top) return true; // iframe
  } catch {
    return true;
  }
  if (!import.meta.env.PROD) return true;
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).has("sw")) {
    if (window.location.search.includes("sw=off")) return true;
  }
  return false;
}

async function unregisterAppSw() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      regs
        .filter((r) => (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "").includes(SW_URL))
        .map((r) => r.unregister()),
    );
  } catch {
    /* ignore */
  }
}

export async function registerPwa() {
  if (shouldSkip()) {
    await unregisterAppSw();
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch (err) {
    console.warn("[pwa] SW register failed:", err);
  }
}
