// Guarded service-worker registration for the app shell.
// Registers only in the published production app; never in dev, iframe
// preview, or Lovable preview hosts. Supports `?sw=off` kill switch.

const SW_PATH = "/sw.js";

/**
 * The desktop (offline) app runs on a private loopback address. There we never
 * want a service worker: a cached copy of an older build could keep serving
 * outdated code, which is exactly how "saving needs internet" happens. The
 * embedded database already makes the app work without a connection.
 */
function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function isBlockedHost(hostname: string): boolean {
  if (isLoopback(hostname)) return true;
  if (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--")
  ) {
    return true;
  }
  if (
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  ) {
    return true;
  }
  return false;
}


async function unregisterMatching() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const url =
        reg.active?.scriptURL ||
        reg.waiting?.scriptURL ||
        reg.installing?.scriptURL ||
        "";
      if (url.endsWith(SW_PATH)) {
        await reg.unregister();
      }
    }
  } catch {
    /* ignore */
  }
}

export async function registerAppServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) {
    await unregisterMatching();
    return;
  }
  try {
    if (window.self !== window.top) {
      await unregisterMatching();
      return;
    }
  } catch {
    await unregisterMatching();
    return;
  }
  const { hostname, search } = window.location;
  if (isBlockedHost(hostname)) {
    await unregisterMatching();
    return;
  }
  if (new URLSearchParams(search).get("sw") === "off") {
    await unregisterMatching();
    return;
  }
  try {
    await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  } catch (err) {
    console.warn("[pwa] service worker registration failed", err);
  }
}
