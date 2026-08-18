/**
 * Minimal, read-only bridge. No Node APIs, no filesystem, no secrets.
 * The renderer only learns that it is running inside the desktop shell so it
 * can skip the browser service worker (the desktop app is already local).
 */
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("__KDF_DESKTOP__", {
  platform: process.platform,
  isDesktop: true,
});
