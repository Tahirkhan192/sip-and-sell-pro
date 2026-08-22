# Offline Release: Cloud Backup to Drive, Windows .exe, Android Viewer

## 1. One-time cloud export to Google Drive

The seed data in `public/seed/` was extracted from the cloud database, but no
full snapshot lives on Drive yet. Step one is to push a complete, verified
snapshot of the current cloud data to Drive as `khyber-delicious-food-data.json`.

- Export every table (all 33 tables already listed in the backup format) with
  exact row counts and original IDs.
- Upload it through the existing Drive bridge, then read it back and compare
  per-table counts so we know the copy is complete before anything else.
- On a fresh laptop install, the app pulls this snapshot on first launch and
  imports it into the embedded local database (upsert on original keys, so
  re-running is safe). After that, the laptop works from its local database and
  keeps Drive in step in the background.
- The phone app reads the same snapshot and shows it read-only.

## 2. Drive account switching in Settings

Today the Drive connection is fixed at the project level, so every install
shares one account and it can't be changed from inside the app. To let the
owner pick which Google account holds the data:

- Add a "Google Drive Account" section in Settings showing the connected
  account's email, last sync time, and the snapshot file's timestamp.
- "Connect a different account" opens Google sign-in for that computer; the
  granted access is stored on that machine only, and each computer can point at
  its own account.
- "Disconnect" stops syncing; the app keeps working entirely offline.
- Requires a Google App User Connector client (a Google OAuth client) to be
  configured once for the project — I'll open that setup card during the build.

## 3. Windows .exe packaging (offline preset forced)

- Add explicit build scripts so the offline preset is always applied rather than
  depending on an environment variable being present:
  `build:offline` (sets `OFFLINE_BUILD=1`, node-server output) and
  `package:win`.
- Verify the produced `.output/server/index.mjs` boots inside Electron on a
  private loopback port, with the network blocker already in `electron/main.cjs`
  active.
- Package with `@electron/packager` for `--platform=win32 --arch=x64`, app name
  "Khyber Delicious Food", data folder `%APPDATA%\KhyberDeliciousFood`
  (already surfaced under Help → Where is my data?).
- Deliver a `.zip` of the packaged app. Note: a true one-click `.exe` installer
  needs electron-builder, which cannot run in this sandbox; I'll ship the
  portable Windows build plus a short install note, and can wire an installer
  config for you to run locally if you want the single-file installer.
- Smoke test: launch the build with all non-local requests blocked, sign in with
  the passcode, load the dashboard and one report.

## 4. Android read-only viewer

- Separate Capacitor app, same UI shell, opened in "viewer" mode:
  - loads only the Drive snapshot into memory on launch,
  - stores nothing on the phone (no local database, no cache of the snapshot),
  - all create/edit/delete actions and the POS save buttons hidden,
  - a clear "Read only — data from Google Drive" banner and a Refresh button.
- Needs internet; shows a plain "No connection — cannot load data" screen when
  Drive is unreachable.
- Output: an Android `.apk`.

## Technical notes

- Snapshot format/versioning stays as `src/data/backup/format.ts` v1; import path
  is `applyBackup` with upsert on each table's real primary key.
- Sync engine (`src/lib/drive-sync.ts`) is already pull-on-open plus a push every
  3 minutes when data changed; the first-run import will hook into the same code
  path with a progress screen.
- Viewer mode is a build flag that swaps the local PGlite client for a
  read-only in-memory adapter over the snapshot; no schema changes.
- Conflict handling stays last-write-wins on the whole snapshot; with one active
  laptop this is safe, and I'll note the limitation if more than one laptop edits
  at the same time.
