/**
 * Desktop build driver (cross-platform, no extra dependencies).
 *
 *   node electron/build.cjs --web-only   → production web build only
 *   node electron/build.cjs              → web build + Windows NSIS installer
 *
 * DESKTOP_BUILD=1 makes vite.config.ts select the Nitro `node-server` preset,
 * which produces `.output/server/index.mjs` — the server Electron forks.
 * The normal cloud build (`npm run build`) is untouched.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const webOnly = process.argv.includes("--web-only");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run(npx, ["vite", "build"], { DESKTOP_BUILD: "1" });

const serverEntry = path.join(root, ".output", "server", "index.mjs");
if (!fs.existsSync(serverEntry)) {
  console.error(
    "\nBuild finished but .output/server/index.mjs is missing.\n" +
      "This happens when the build ran with a non-Node Nitro preset (for example\n" +
      "inside the Lovable sandbox, which always targets Cloudflare).\n" +
      "Run this command on your Windows machine or in CI.\n",
  );
  process.exit(1);
}

if (webOnly) {
  console.log("\nWeb build ready at .output — run `npm run desktop:build` to package.\n");
  process.exit(0);
}

if (!fs.existsSync(path.join(root, "electron", "icon.ico"))) {
  console.error(
    "\nMissing electron/icon.ico. Generate it once:\n" +
      "  npx png-to-ico electron/icon.png > electron/icon.ico\n",
  );
  process.exit(1);
}

run(npx, ["electron-builder", "--win", "--config", "electron-builder.json"]);
console.log("\nInstaller written to desktop-release/\n");
