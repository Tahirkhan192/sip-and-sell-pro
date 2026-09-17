# Chrome app: own data folder on D: drive

Forget the Windows .exe for now. The Chrome app becomes the main app: it works
fully offline, keeps a live copy of all data in a folder you choose on the
D: drive, restores from that folder, and sends everything to Google Drive
whenever internet is available.

## One important limit, stated plainly

Chrome is not allowed to put its internal database on the D: drive — that part
always lives inside Chrome's own storage. What Chrome *can* do (and this covers
everything you asked) is write a live, always-current data file into a folder
you pick once, and read it back. So:

- Every entry is saved instantly inside the app (offline, as today).
- Within a few seconds the same data is written to
  `D:\Khyber Delicious Food Data\khyber-data.json` in your chosen folder.
- If Chrome's storage is ever cleared or you move to another computer, one
  click restores everything from that folder.
- The folder is also where a Drive snapshot gets placed when you restore.

## What gets built

### 1. Settings → "Data folder on this computer"
- "Choose data folder" opens the normal Windows folder picker; you select
  (or create) `D:\Khyber Delicious Food Data`. Permission is remembered, so it
  is asked once, not every day.
- The card shows the folder name, the last time data was written there, the
  file size and row count, and a "Save now" button.
- "Forget folder" stops writing there; the app keeps working.
- If Chrome ever asks for permission again after a restart, a single
  "Allow again" button re-grants it.

### 2. Automatic saving into that folder
- After any change (sale, pending bill, purchase, expense, delivery expense,
  money movement, stock transfer, settings), a full snapshot is written to the
  folder a few seconds later — debounced, so a busy POS session writes once,
  not once per keystroke.
- Also written every 2 minutes as a safety net, and once when the app closes.
- Writes go to a temporary file first and are then renamed into place, so a
  power cut can never leave a half-written file.
- The previous copy is kept as `khyber-data-previous.json` (one rolling backup).
- Works with no internet — nothing in this path touches the network.

### 3. Restore from that folder
- The existing "Restore from backup file" section gains a second button:
  "Restore from data folder" — reads `khyber-data.json` from the chosen folder,
  validates it first, then imports with the same no-duplicate rules already in
  place (matched on original IDs).
- You can also drop a Drive snapshot file into that folder and restore it from
  there; both file formats are accepted, as today.

### 4. Google Drive stays as it is
- Push-only, every minute, only when internet is there and data changed.
- Nothing is pulled from Drive automatically; pulling stays a manual choice.
- No change to how Drive files are named or cleaned up.

## Technical notes

- New `src/lib/data-folder.ts`: File System Access API — `showDirectoryPicker()`,
  handle persisted in IndexedDB (`kdf.dataFolder.v1`), `queryPermission` /
  `requestPermission('readwrite')` on startup, `getFileHandle(..., {create:true})`
  + `createWritable()` for the atomic temp-then-rename write.
- Snapshot content is exactly `exportFullBackup()` from `src/data/backup/export.ts`
  — same format v1 the Drive snapshot and the Restore card already use, so the
  reuse of `validateBackup` / `applyBackup` needs no format work.
- Change detection reuses the existing content hash from `drive-sync.ts`
  (extracted into a shared helper) so an unchanged database is not rewritten.
- New `src/components/DataFolderCard.tsx`, mounted in
  `src/routes/_authenticated/settings.tsx` next to `BackupCard`/`RestoreCard`.
- `RestoreCard` gains the "Restore from data folder" path reading through the
  same handle; existing file-upload path untouched.
- Feature-detected: if `window.showDirectoryPicker` is missing (phone viewer,
  non-Chromium browser) the card explains it and hides the buttons; no other
  screen changes behaviour.
- No changes to POS, stock, reports, Digi Katha or any calculation.
