# Offline status check and the road to a real offline .exe

## Where the app stands today (verified in code)

Already built and working:

- Local SQLite database in the app (OPFS), opened through a dedicated worker, with schema versioning and integrity checks.
- One-time cloud-to-local seed (all existing cloud data copied down, checksum-validated) — your requirement 1 is done.
- Local writes + outbox + background sync engine (ordered, retrying, conflict-aware) for master data: products, stock items, categories, customers, suppliers, staff, recipes, settings, expenses, stock adjustments.
- Offline sign-in (device enrollment + PBKDF2 local unlock).
- Local backup snapshots, Google Drive `appDataFolder` backup with rotation (keep 10), verification, and full transactional restore — including restore onto a brand-new device from the same Drive account. Requirements 3, 4, 5 are essentially done.
- Electron desktop packaging architecture (fixed origin `http://localhost:43117`, persistent `%APPDATA%` profile, NSIS installer config). Requirement 4 (multiple installations, each with its own local database + own device id) is satisfied by design.

## What is still missing

1. **The money-making screens cannot run offline.** This is the big one. These still require the Internet because they are written by cloud RPCs/triggers:
   - Sales / POS (`save_sale`, `sale_items`, `cash_movements`)
   - Purchases and purchase items / stock purchases
   - Production batches, Stock transfers
   - Daily closing, Digi Katha, Staff payments and attendance
   Without these, the "offline app" can only edit master data offline.
2. **Drive backup runs hourly, not every minute** (`BACKUP_INTERVAL_MS = 1 hour`), and it always uploads a new file with rotation rather than a fast "replace latest" cycle.
3. **The Windows .exe has never actually been built.** The packaging config exists, but the installer must be produced on a Windows machine (the sandbox has no Windows toolchain), and `electron/icon.ico` has not been generated yet.
4. Local/offline feature flags rely on built-in defaults; the desktop build should pin them explicitly so a packaged app never silently falls back to cloud-only.

## The plan

### Stage A — Make transactions work offline (largest stage)
Move each cloud-only transactional write to the same local-write + outbox + sync pipeline that master data already uses, one entity at a time, in this order:

1. Sales / POS (sale + sale items + the cash movements the sale creates), including invoice numbering that is safe on multiple devices (device-prefixed sequence).
2. Purchases (+ purchase items, stock purchases, and the linked money movement).
3. Stock transfers and stock-to-expense transfers.
4. Production batches (+ component consumption and costing).
5. Staff payments, staff attendance, daily closing, Digi Katha closing.

For each: port the server-side rule (trigger/RPC logic) into a local transactional procedure so the numbers are identical offline and online, push the same change to the cloud through the outbox, and keep the existing UI unchanged. Each step ends with tests comparing local vs cloud results.

### Stage B — One-minute Drive backup
- Change the Drive scheduler interval to 60 seconds, with change detection so an idle minute does not upload an identical snapshot.
- Keep one "latest" backup that is replaced every minute, plus a small rolling history (e.g. hourly/daily keeps) so a mistake made 10 minutes ago is still recoverable.
- Backpressure: skip a tick when the previous upload is still running or the device is offline; retry with backoff.
- Show last-backup time and result in Settings.

### Stage C — Desktop cutover and the .exe
- Pin offline flags on for the desktop build and skip the browser service worker inside Electron.
- Generate `electron/icon.ico`, then run `npm run desktop:build` on a Windows PC to produce `Khyber Delicious Food POS Setup <version>.exe`. I will provide the exact step-by-step commands; the final .exe cannot be compiled here.

### Stage D — Final verification
- Full offline drill: unplug the network, complete a sale, a purchase, a transfer, a closing; reconnect and confirm the cloud matches exactly.
- Restore drill: wipe local data, restore from Drive on the same machine and on a second machine, confirm identical figures.

## Technical notes

- Files touched in Stage A: `src/data/local/mutations/procedures/*` (new transactional procedures), `src/data/repo/entity-classification.ts` and `operations.ts` (flip entities to local write), `src/data/sync/sync-protocol.ts` (upload mapping for the new entities), plus the POS/Purchases/Production/Closing routes only where they call the repository.
- Stage B touches `src/data/backup/drive-backup.ts` and the Settings backup card.
- No schema change to the cloud database is required for Stage B or C; Stage A may add a couple of sync-support columns.

## Suggested order

Stage B and C are small and give immediate value (minute-level backups plus a real installer). Stage A is the long one and is what actually makes the POS usable with no Internet.
