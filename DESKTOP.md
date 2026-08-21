# Khyber Delicious Food POS — Windows desktop packaging

This document covers ONLY packaging. No business logic, database schema, sync,
backup or UI behaviour was changed.

## Chosen runtime: Electron

| Requirement | Electron | Tauri |
| --- | --- | --- |
| SQLite WASM in a dedicated Web Worker | Chromium — identical to the browser build | WebView2 on Windows: worker + WASM support varies by installed WebView2 version |
| OPFS SAH Pool (`createSyncAccessHandle`) | Supported, same Chromium implementation | Not reliably available across WebView2 builds — would risk the existing local database |
| Predictable, pinned origin for OPFS | Yes (`http://localhost:43117`) | Custom `tauri://` / `https://tauri.localhost` scheme changes storage origin |
| Service worker / PWA behaviour | Same as Chrome | Restricted under custom schemes |
| Google Identity Services (Drive backup) | Works — `http://localhost:<port>` is an allowed OAuth JS origin | Custom scheme is not an allowed OAuth origin |
| Supabase auth + fetch | Unchanged | Unchanged |
| Bundled runtime, no user prerequisites | Yes | Depends on WebView2 runtime on the machine |

Electron is chosen because the app's most fragile asset — the OPFS-backed
SQLite database written through a dedicated Worker — behaves byte-for-byte like
the browser build, with zero changes to `src/data/local/*`.

## How the desktop app runs

```
Electron main (electron/main.cjs)
  └─ forks the production Nitro node-server bundle (.output/server/index.mjs)
       on the FIXED origin http://localhost:43117
  └─ BrowserWindow loads that origin
       └─ same React app, same SQLite Worker, same OPFS pool /kdf-pos.sqlite3
```

Two hard rules encoded in `electron/config.cjs`:

1. **Never `file://`.** OPFS, `crypto.subtle` and service workers require a
   secure context. `http://localhost` is a secure context; `file://` is not.
2. **Fixed port 43117.** OPFS is keyed by origin. A random port would create a
   new, empty database on every launch.

## Data location (Windows)

`%APPDATA%\KhyberDeliciousFoodPOS\` — pinned in `main.cjs` via
`app.setPath("userData", ...)`. Chromium keeps OPFS (and therefore the SQLite
file, device id, outbox, audit log and sync state) inside that folder.

It survives: app restart, PC restart, app update, crashes. The NSIS installer is
configured with `deleteAppDataOnUninstall: false`, so uninstalling never deletes
business data. There is exactly ONE local database — no second desktop SQLite.

## Multi-computer installs

Each installation has its own `%APPDATA%` profile, therefore its own device id
and its own local database. Never copy the profile folder between machines —
use the existing cloud sync and Google Drive backup/restore instead. The same
Supabase account can sign in on any number of computers.

## Migrating from the browser/PWA version

Browser → Settings → Backup → create a local backup (or Drive backup) →
desktop app → Settings → restore. The backup format, checksum and validation
are unchanged; nothing desktop-specific was added to the format.

## Google Cloud Console configuration (Drive backup)

For the OAuth **Web application** client used by Google Identity Services, add
to *Authorised JavaScript origins*:

```
http://localhost:43117
```

(plus your existing web origins). No redirect URI is needed — the app uses the
GIS token flow, which never handles a client secret or refresh token. The client
id remains a public value supplied via `VITE_GOOGLE_DRIVE_CLIENT_ID` or Settings.

## Secrets

No credential was moved into desktop code. Supabase publishable/anon key and the
Google client id are public identifiers only; service-role keys and OAuth client
secrets appear nowhere in this repository, and the backup redaction rules are
untouched.

## Commands

```bash
npm install                 # installs electron + electron-builder devDeps
npm run desktop:dev         # vite dev server + Electron window
npm run desktop:build:web   # production web build with the node-server preset
npm run desktop:build       # web build + Windows NSIS installer (.exe)
```

`desktop:build` must run **on Windows** (or with wine/CI on Linux) to produce
the signed-installer-shaped output:

```
desktop-release\Khyber Delicious Food POS Setup <version>.exe
```

`npm run desktop:build:web` sets `DESKTOP_BUILD=1`, which switches the Nitro
preset to `node-server` (see `vite.config.ts`). The normal `npm run build` for
the cloud deployment is unchanged.

## Icon

`electron/icon.png` (1024×1024) is the source. Windows needs a multi-size
`.ico`; generate it once on Windows and commit it:

```bash
npx png-to-ico electron/icon.png > electron/icon.ico
```

## Auto-update

Not enabled. `publish: null` in `electron-builder.json`. Updates are installed
by running a newer setup .exe over the old one; because `userData` is outside
the install directory and `deleteAppDataOnUninstall` is false, an update never
touches SQLite, the device id, the outbox or audit history. Local schema
migrations remain transactional and run through the existing worker path.

## Known limitations

- The Windows `.exe` cannot be compiled in the Lovable sandbox (no Windows
  toolchain, and the sandbox build always targets Cloudflare). Run the command
  above on Windows.
- `electron/icon.ico` must be generated once (see above) before the first
  Windows build.
