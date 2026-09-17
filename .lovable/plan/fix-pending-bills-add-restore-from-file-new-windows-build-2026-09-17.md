# Fix pending bills, add restore from file, new Windows build

Everything else in the app stays exactly as it is.

## 1. Pending bill behaves as "replace, not add"

- Opening a pending bill loads it exactly as it was saved — same products, same
  quantities, nothing added.
- Pressing **Save Pending** or **Complete** on a reopened bill removes the old
  saved copy completely and stores the reopened one as the fresh, only copy.
  The bill number stays the same.
- This works the same the 2nd, 3rd or 20th time the same bill is opened — the
  quantity never grows on its own; it only changes when you change it.
- Completing a bill removes it from the pending list and the pending search at
  once, and it stays gone after restarting the app.
- Deleting a pending bill removes it the same way.

Nothing is lost while this happens: the old copy's stock effect and its money
entries are reversed first, then the new copy is written once, all in a single
step so a failure can never leave half a bill behind.

## 2. Every entry still counted exactly once

After the change I re-check each place an entry must appear, so none is missed
and none is doubled:

- pending bills, completed bills
- purchases, expenses, delivery expenses
- money movements (including the ones a bill creates)
- staff bills and staff katha
- stock movements
- the Google Drive backup snapshot

## 3. Restore from a file in Settings

A new **Restore from backup file** section in Settings:

- Choose a backup file from the computer (the app's own exported backup file,
  or the Google Drive snapshot file — both accepted).
- The file is checked first: counts, missing links and duplicates are reported
  before anything is written. If it fails the check, nothing is imported.
- Import shows table-by-table progress and a final summary of rows restored.
- Records are matched on their original IDs, so restoring the same file twice
  never creates a second copy of anything.
- The restored data is written into the app's own data folder on that computer
  (the folder created at installation), so it stays after restart.

## 4. Windows program with its own data folder

- The desktop app creates and uses its own folder for data, made on first run,
  instead of the shared `D:\app data` location. The current folder is read once
  and moved across automatically, so nothing is lost.
- Settings → Help shows the exact folder path.
- I rebuild the Windows package and give you the download.

One limitation to be clear about: the sandbox can produce a portable Windows
build (a zip with `Khyber Delicious Food.exe` inside — unzip anywhere and run,
no install needed). A true one-click `.exe` installer needs a packaging tool
that cannot run here. If you want the single-file installer, I can add the
installer configuration for you to run once on your PC.

## Technical notes

- `pos.tsx` + `sale-rules.sql`: on resave of an existing bill, run a single
  transaction that reverses the old sale's stock/movements, deletes its
  `sale_items` and the sale row, then reinserts the sale with the same `id` and
  `invoice_no` and the current lines; keep the `sale_items` unique index.
- Pending search: status re-checked on screen, cached rows dropped and refetched
  after save/complete/delete.
- Restore UI: new `RestoreCard` using existing `validateBackup` + `applyBackup`
  (upsert on original primary key, `withRestoreMode` so triggers don't
  re-generate movements); accepts both backup format v1 and the Drive snapshot.
- Electron: data dir resolved to an app-created folder with one-time migration
  from `D:\app data`; `KDF_DATA_DIR` override kept.
- Verification: type check, build, and a pending-bill save/reopen/complete cycle
  run against the running app.
