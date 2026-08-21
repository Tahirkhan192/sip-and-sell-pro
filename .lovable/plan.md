# Full Offline Conversion — Local SQLite + Windows .exe

Goal: the app stops using the cloud entirely. All data lives in a local SQLite file on the PC, the existing cloud data is imported once, and you get a Windows executable that runs with no internet.

---

## 1. Where data lives today (verified)

- Every screen talks to the cloud database directly: 41 files call `supabase.from(...)` / `supabase.rpc(...)` (POS alone has 16 calls).
- 28 distinct stored procedures are called from the UI (`save_sale`, `update_sale`, `restore_sale_stock`, `save_stock_transfer`, `save_production`, `stock_to_expense_transfer`, `staff_pay`, `staff_salary_summary`, `digi_katha_summary`, `daily_closing_summary`, `rebuild_item_remaining`, …), and the cloud database additionally runs ~20 triggers that silently keep money movements, weighted-average cost, staff katha and stock in sync.
- Login/auth is cloud auth.
- Live data to migrate: 9,460 sales, 15,648 sale items, 1,534 money movements, 423 expenses, 239 purchases, 84 products, 77 stock items, 28 recipes, plus staff/katha/settings.

## 2. What already exists for offline

- `src/data/local/schema.sql` — full local SQLite schema mirroring every table (inert today).
- `src/data/repo/` — repository contract, cloud pass-through, empty local implementation, `setRepository()` switch.
- `src/data/backup/` — full verbatim export + validated restore plan.

## 3. What is missing (the real work)

1. All business logic that currently lives inside the cloud database (28 procedures + ~20 triggers) must be re-implemented locally, byte-for-byte in behaviour.
2. Every one of the 41 screens/hooks must be switched from `supabase.*` to the repository.
3. Local login (no cloud auth).
4. A desktop shell with a real SQLite file on disk, plus the one-time import of your existing cloud data.
5. Packaging to `.exe`.

---

## 4. Target architecture

```text
+-----------------------------------------------+
|  Windows .exe (Electron)                       |
|                                                |
|  Existing React UI  (unchanged screens)        |
|        |                                       |
|        v                                       |
|  Business logic (report/inventory engines)     |
|        |                                       |
|        v                                       |
|  repo()  -> LocalRepository                    |
|        |                                       |
|        v   (IPC)                               |
|  SQLite engine in main process                 |
|   - schema.sql                                 |
|   - procedures.ts  (ports of the 28 RPCs)      |
|   - triggers as SQL triggers where possible    |
|        |                                       |
|        v                                       |
|  C:\Users\<you>\AppData\KhyberPOS\pos.sqlite3  |
+-----------------------------------------------+
        no network, no cloud, no hosting
```

Data file is a single SQLite file; backup = copy that file (plus the existing JSON export/restore, kept working offline).

---

## 5. Phases

### Phase A — Export your current cloud data
Run the existing backup export to produce one verified JSON snapshot of all 26 tables with original IDs and relationships intact, and store it as the seed file bundled with the desktop app. Row counts are verified table-by-table against the cloud before continuing.

### Phase B — Port the database logic to SQLite
- Translate `schema.sql` gaps: defaults, unique indexes (`invoice_no`), foreign keys, `updated_at` triggers.
- Port each stored procedure into `src/data/local/procedures/*.ts`, one file per procedure, each running inside a single SQLite transaction so invoices + stock + money movement stay all-or-nothing.
- Port the trigger behaviour (purchase → money movement, sale → money movement + staff katha, purchase → weighted-average cost, stock transfer reversal, staff payment → katha).
- Parity harness: run the same inputs against the cloud copy and the local engine and compare resulting rows and report totals. Nothing ships until totals match exactly for your existing 9,460 invoices.

### Phase C — Switch the app to the repository
- Extend the repository contract with `rpc(name, args)` and query helpers the screens actually need.
- Convert all 41 files from `supabase.*` to `repo()`, screen by screen, keeping every query shape identical (same filters, same ordering, same paging — no 1000-row caps).
- Replace cloud auth with a local login (single owner account + PIN, stored hashed in the local DB). Existing PIN-lock rules are untouched.
- Delete `src/integrations/supabase/*`, the Supabase package, the auth middleware, the MCP/server routes that exist only for cloud hosting, and the service-worker cloud bits.

### Phase D — Desktop shell + first-run import
- Electron main process owns SQLite (`better-sqlite3`), exposes the repository over IPC via a preload bridge (`contextIsolation: true`, `nodeIntegration: false`).
- First run: creates the DB from `schema.sql`, imports the Phase A snapshot preserving all IDs, then verifies row counts per table and shows a report. Re-running never duplicates (upsert on original primary key).
- Settings gains: "Backup now" (copies the SQLite file + JSON export to a folder you pick) and "Restore from backup".

### Phase E — Build the .exe
- `vite build` with `base: './'`, packaged with `@electron/packager --platform=win32 --arch=x64`.
- Delivered as a `.zip` containing `KhyberPOS.exe` plus its runtime files — unzip anywhere and run, no install, no internet.
- A Linux build is produced alongside for smoke-testing here; the Windows build is cross-compiled and cannot be launched inside this sandbox, so final confirmation happens on your PC.

### Phase F — Cloud removal
- Cloud stays untouched and read-only during A–E as the fallback.
- After you confirm the .exe works and the numbers match, the cloud project is disconnected and the web hosting is retired.

---

## 6. Guarantees

- No screen, layout or calculation formula changes. Only the storage underneath changes.
- No data loss: original IDs and every relationship preserved; import verified row-by-row against the cloud counts.
- No duplicates: restore is upsert-on-primary-key; `invoice_no` stays unique locally.
- Cloud is only read, never modified, during the whole migration.

## 7. Technical notes

- `better-sqlite3` is synchronous and native — it runs in the Electron main process only, never in the renderer.
- Money is stored as it is today (numeric text/real, same rounding), and SQLite date handling uses your existing configurable business-date rules from `settings`.
- Report engine and inventory engine keep their current code; they only change their data source call.
- Sequential invoice numbering moves to a local counter table with the same format.

## 8. Decisions I need from you

1. Login for the offline app: single owner account with a PIN is my default — or do you want the current multi-user roles kept?
2. Where should the data file and automatic backups live? Default: `AppData\KhyberPOS\`, with a daily copy into a `Backups` subfolder.
3. Confirm the cloud is switched off only after you verify the .exe on your PC.
