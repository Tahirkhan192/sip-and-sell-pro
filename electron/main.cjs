/**
 * Khyber Delicious Food POS — Electron main process.
 *
 * Design rules (do not change casually):
 *   1. The app is served over http://localhost:43117, never file://.
 *      OPFS + SQLite WASM + Web Workers + crypto.subtle all require a SECURE
 *      CONTEXT; file:// is not one, so the existing local database would break.
 *   2. The port is fixed, because OPFS storage is keyed by origin.
 *   3. userData is pinned to a stable %APPDATA% folder so the SQLite database,
 *      device id, outbox and audit history survive restarts and app updates.
 *   4. Single instance only — two windows must never open the same OPFS pool.
 */
const { app, BrowserWindow, shell, session } = require("electron");
const path = require("node:path");
const { startServer } = require("./server.cjs");
const { DESKTOP_ORIGIN, USER_DATA_DIR, WINDOW } = require("./config.cjs");

const isDev = !app.isPackaged;
const devUrl = process.env.DESKTOP_DEV_URL || "http://localhost:8080";
const appRoot = path.join(__dirname, "..");

// Persistent, update-safe profile location (%APPDATA%\KhyberDeliciousFoodPOS).
// Chromium stores OPFS inside this folder, so the local SQLite database lives
// here and is NEVER touched by installing a newer version of the app.
app.setPath("userData", path.join(app.getPath("appData"), USER_DATA_DIR));
app.setAppUserModelId("com.khyberdeliciousfood.pos");

let mainWindow = null;
let serverChild = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    title: WINDOW.title,
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    backgroundColor: "#fff5e6",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // External links (WhatsApp, Google sign-in help, docs) open in the real
  // browser; app navigation stays inside the window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(DESKTOP_ORIGIN)) {
      void shell.openExternal(target);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    const allowed = target.startsWith(DESKTOP_ORIGIN) || (isDev && target.startsWith(devUrl));
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });

  void mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  // Ask Chromium to treat this profile as persistent storage so OPFS data is
  // never evicted under disk pressure.
  try {
    await session.defaultSession.clearStorageData({ storages: [] }); // no-op, keeps API surface explicit
  } catch {
    /* ignore */
  }

  let url = devUrl;
  if (!isDev) {
    const started = await startServer(appRoot);
    serverChild = started.child;
    url = DESKTOP_ORIGIN;
  }
  createWindow(url);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

function stopServer() {
  if (serverChild && !serverChild.killed) {
    try {
      serverChild.kill();
    } catch {
      /* ignore */
    }
    serverChild = null;
  }
}

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stopServer);
process.on("exit", stopServer);
