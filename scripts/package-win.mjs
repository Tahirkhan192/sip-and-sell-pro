/**
 * Packages the offline app as a Windows program.
 *
 * Produces `electron-release/Khyber Delicious Food-win32-x64/`, a folder that
 * can be copied to any Windows computer and started with
 * "Khyber Delicious Food.exe". All data stays on that computer.
 */

import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
if (!existsSync(path.join(root, ".output", "server", "index.mjs"))) {
  console.error("Run `npm run build:offline` first — no offline build found.");
  process.exit(1);
}

// Carry the keys the optional Google Drive backup needs into the package.
const runtimeEnv = {};
for (const name of [
  "LOVABLE_API_KEY",
  "GOOGLE_DRIVE_APP_USER_CONNECTOR_CLIENT_API_KEY",
  "APP_USER_CONNECTION_KEY_SECRET",
  "GOOGLE_DRIVE_API_KEY",
]) {
  if (process.env[name]) runtimeEnv[name] = process.env[name];
}
writeFileSync(path.join(root, "electron", "runtime-env.json"), JSON.stringify(runtimeEnv, null, 2));

const args = [
  "@electron/packager",
  ".",
  "Khyber Delicious Food",
  "--platform=win32",
  "--arch=x64",
  "--out=electron-release",
  "--overwrite",
  "--app-version=1.0.0",
  "--ignore=^/src",
  "--ignore=^/public",
  "--ignore=^/scripts",
  "--ignore=^/supabase",
  "--ignore=^/dist",
  "--ignore=^/android",
  "--ignore=^/electron-release",
  "--ignore=^/node_modules",
  "--ignore=^/.lovable",
  "--ignore=^/.wrangler",
];

const res = spawnSync("npx", args, { stdio: "inherit" });
process.exit(res.status ?? 1);
