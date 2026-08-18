/**
 * Desktop dev runner: starts the normal Vite dev server and opens the Electron
 * window against it once it answers. Same app, same SQLite worker.
 */
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.join(__dirname, "..");
const url = process.env.DESKTOP_DEV_URL || "http://localhost:8080";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const opts = { cwd: root, stdio: "inherit", shell: process.platform === "win32" };

const vite = spawn(npx, ["vite", "dev"], opts);

function ping() {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  for (let i = 0; i < 120; i += 1) {
    if (await ping()) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const electron = spawn(npx, ["electron", "."], {
    ...opts,
    env: { ...process.env, DESKTOP_DEV_URL: url },
  });
  electron.on("exit", () => {
    vite.kill();
    process.exit(0);
  });
})();
