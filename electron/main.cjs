/**
 * Khyber Delicious Food — offline desktop shell.
 *
 * Everything runs on this computer:
 *   - the app itself is served from a private loopback port inside this process
 *   - the database is the embedded Postgres (PGlite) stored in the app's own
 *     data folder, shown to the user under Help → Where is my data?
 *
 * There is no cloud, no sync and no internet access of any kind: every request
 * to a non-local address is blocked below.
 */

const { app, BrowserWindow, Menu, dialog, shell, session } = require("electron");
const path = require("path");
const net = require("net");

// Keep all local data in one clearly named folder next to the other app data.
const DATA_DIR = path.join(app.getPath("appData"), "KhyberDeliciousFood");
app.setPath("userData", DATA_DIR);
app.setName("Khyber Delicious Food");

let serverPort = 0;

// Keys needed only for the optional Google Drive backup. They are written into
// the package when it is built; without them the app still runs completely
// offline, Google Drive backup is simply unavailable.
try {
  const envFile = path.join(__dirname, "runtime-env.json");
  if (require("fs").existsSync(envFile)) {
    const saved = JSON.parse(require("fs").readFileSync(envFile, "utf8"));
    for (const [k, v] of Object.entries(saved)) if (v) process.env[k] = String(v);
  }
} catch {
  /* backup stays unavailable */
}


function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function startServer() {
  serverPort = await freePort();
  process.env.PORT = String(serverPort);
  process.env.HOST = "127.0.0.1";
  process.env.NITRO_PORT = String(serverPort);
  process.env.NITRO_HOST = "127.0.0.1";
  const entry = path.join(__dirname, "..", ".output", "server", "index.mjs");
  await import(require("url").pathToFileURL(entry).href);
  // Wait until the loopback server answers before showing the window.
  for (let i = 0; i < 120; i++) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(serverPort, "127.0.0.1");
      s.on("connect", () => (s.destroy(), resolve(true)));
      s.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The local application server did not start.");
}

/**
 * Only this computer's own app server may be reached. Google Drive is allowed
 * as well so the optional backup keeps working when the computer is online —
 * nothing else is. Blocked addresses are written to a log file in the data
 * folder so a problem can always be traced.
 */
const DRIVE_HOSTS = [
  "https://www.googleapis.com",
  "https://oauth2.googleapis.com",
  "https://accounts.google.com",
  "https://connector-gateway.lovable.dev",
  "https://mcp.lovable.dev",
];


function blockNetwork() {
  const fs = require("fs");
  const logFile = path.join(DATA_DIR, "blocked-requests.log");
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const url = details.url || "";
    let local = false;
    try {
      const u = new URL(url);
      local =
        (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1") &&
        (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:" || u.protocol === "wss:");
    } catch {
      local = false;
    }
    const allowed =
      local ||
      url.startsWith("devtools:") ||
      url.startsWith("blob:") ||
      url.startsWith("data:") ||
      url.startsWith("file:") ||
      url.startsWith("chrome-extension:") ||
      DRIVE_HOSTS.some((h) => url.startsWith(h));
    if (!allowed) {
      try {
        fs.appendFileSync(logFile, `${new Date().toISOString()} blocked ${url}\n`);
      } catch {
        /* logging must never break the app */
      }
    }
    cb({ cancel: !allowed });
  });
}

/**
 * Removes any service worker and cached pages left by an earlier version, so
 * the desktop app always runs the code inside this package (an old cached copy
 * is what makes saving look like it needs internet).
 */
async function clearStaleWebCaches() {
  try {
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage", "shadercache"] });
    await session.defaultSession.clearCache();
  } catch {
    /* best effort */
  }
}


function buildMenu(win) {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "quit" }],
      },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      {
        label: "Help",
        submenu: [
          {
            label: "Where is my data?",
            click: async () => {
              await dialog.showMessageBox(win, {
                type: "info",
                title: "Local data folder",
                message: "All your data is stored on this computer only.",
                detail: DATA_DIR,
                buttons: ["Open folder", "Close"],
                defaultId: 0,
              }).then((r) => {
                if (r.response === 0) shell.openPath(DATA_DIR);
              });
            },
          },
          {
            label: "About",
            click: () =>
              dialog.showMessageBox(win, {
                type: "info",
                title: "Khyber Delicious Food",
                message: "Khyber Delicious Food — offline edition",
                detail: "Runs completely offline. No cloud, no sync, no internet access.",
              }),
          },
        ],
      },
    ]),
  );
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: "#ffffff",
    title: "Khyber Delicious Food",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  buildMenu(win);
  win.once("ready-to-show", () => win.maximize());
  win.once("ready-to-show", () => win.show());
  await win.loadURL(`http://127.0.0.1:${serverPort}/`);
}

app.whenReady().then(async () => {
  try {
    await clearStaleWebCaches();
    await startServer();
    blockNetwork();
    await createWindow();

  } catch (err) {
    dialog.showErrorBox("Khyber Delicious Food", String((err && err.stack) || err));
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
