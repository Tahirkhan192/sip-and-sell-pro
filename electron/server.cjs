/**
 * Starts the production TanStack Start (Nitro `node-server`) build inside the
 * packaged desktop app and waits until it answers on the fixed desktop origin.
 *
 * The server is a plain Node process (Electron's own binary re-used with
 * ELECTRON_RUN_AS_NODE=1) so no extra Node.js installation is required on the
 * Windows machine. Nothing about the app's server code is modified — this is
 * the exact same server bundle the web deployment runs.
 */
const { fork } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { DESKTOP_HOST, DESKTOP_PORT } = require("./config.cjs");

/** Locates `.output/server/index.mjs` in dev and inside the asar-unpacked app. */
function resolveServerEntry(appRoot) {
  const candidates = [
    path.join(process.resourcesPath || "", "server", "index.mjs"),
    path.join(appRoot, ".output", "server", "index.mjs"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function ping(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: DESKTOP_HOST, port: DESKTOP_PORT, path: "/", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServer({ attempts = 120, delayMs = 250 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * @returns {Promise<{ child: import('node:child_process').ChildProcess | null }>}
 */
async function startServer(appRoot) {
  // Another instance (or a dev server) already owns the origin — reuse it so
  // two processes never fight over the same OPFS database.
  if (await ping()) return { child: null };

  const entry = resolveServerEntry(appRoot);
  if (!entry) {
    throw new Error(
      "Desktop server bundle not found. Run `npm run desktop:build:web` before packaging.",
    );
  }

  const child = fork(entry, [], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: DESKTOP_HOST,
      PORT: String(DESKTOP_PORT),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const up = await waitForServer();
  if (!up) {
    child.kill();
    throw new Error("Local application server did not start in time.");
  }
  return { child };
}

module.exports = { startServer, waitForServer, resolveServerEntry, ping };
