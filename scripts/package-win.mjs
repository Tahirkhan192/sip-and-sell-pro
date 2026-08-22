/**
 * Packages the offline app as a Windows program.
 *
 * Produces `electron-release/Khyber Delicious Food-win32-x64/`, a folder that
 * can be copied to any Windows computer and started with
 * "Khyber Delicious Food.exe". All data stays on that computer.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
if (!existsSync(path.join(root, ".output", "server", "index.mjs"))) {
  console.error("Run `npm run build:offline` first — no offline build found.");
  process.exit(1);
}

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
