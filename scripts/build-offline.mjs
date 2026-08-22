/**
 * Builds the offline (desktop) version of the app.
 *
 * The normal build targets the hosting platform. This one always produces a
 * plain local server bundle in `.output/`, which the desktop app starts on a
 * private port on the computer it is installed on.
 */

import { spawnSync } from "node:child_process";

const env = { ...process.env, OFFLINE_BUILD: "1" };
// The hosting build environment forces its own output target; remove those
// markers so the local/offline target is always the one that is used.
delete env.LOVABLE_SANDBOX;
delete env.DEV_SERVER__PROJECT_PATH;
delete env.LOVABLE_NITRO_PRESET;

const res = spawnSync("npx", ["vite", "build"], { stdio: "inherit", env });
process.exit(res.status ?? 1);
