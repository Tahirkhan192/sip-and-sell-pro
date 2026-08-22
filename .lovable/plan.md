# Fix: saving entries in the desktop app must work with no internet

Goal: in the installed Windows app, POS sales, purchases, money movements, stock transfers, expenses and delivery expenses all save with the network completely off.

## What I checked

- Every screen's data calls are already redirected to the embedded local database (the `@/integrations/supabase/client` import is aliased to `src/lib/local-db/client.ts`), and inserts/updates/deletes in that client run plain SQL against the local Postgres.
- There are no server functions in the app, and the only outbound calls in the code are Google Drive sync (`src/lib/drive-sync.ts` → `/api/drive`) and WhatsApp invoice sending.
- Running the app in a browser with all non-local requests blocked produced zero outside requests.

So the failure is specific to the packaged desktop build, and I have not yet confirmed its cause. Step 1 below is to reproduce it and get the actual error instead of guessing.

## Step 1 — Reproduce the exact failure in the packaged app

Run the packaged desktop build inside a headless display in the sandbox with networking disabled, then drive it: sign in, save a POS sale, a purchase, a money movement, a stock transfer, an expense and a delivery expense. Capture the window's console errors and every request it attempts. That names the real blocker (a cancelled request, a database write error, storage permission, or a failing background call whose error is shown as a save failure).

## Step 2 — Fix what the reproduction shows

Expected fix areas, applied only as the evidence supports:

- Desktop shell (`electron/main.cjs`): the built-in blocker currently cancels everything that is not the app's own loopback address. Make sure the app's own pages, assets, database files and `/api` routes are always allowed (both `127.0.0.1` and `localhost` forms), and that a blocked background call can never surface as a save error.
- Background sync: make Drive sync, status checks and any other optional network work fully fire-and-forget, so a dead network can never block or fail a save. Optional: allow only Google Drive through the blocker so sync still works when the computer is online.
- Saving paths: for each of the six entry types, confirm the whole handler (including any follow-up refresh or linked record) writes only to the local database, and that the real database error text is shown when something genuinely fails.
- Local storage durability: request persistent storage for the embedded database in the desktop window so writes are never dropped, and show a clear message if the storage folder is not writable.

## Step 3 — Built-in proof

Add a "Offline self-test" action in Settings that writes and removes one test record for each of the six entry types against the local database and reports pass/fail per type. This gives you a one-click check on any computer, with no internet.

## Step 4 — Verify and repackage

Re-run the scripted desktop test with networking off and confirm all six entry types save and stay after restarting the app. Then rebuild the Windows package and give you the new download.

## Notes

No existing data, screens or workflows change; this is a wiring and packaging fix plus one new self-test action in Settings.
