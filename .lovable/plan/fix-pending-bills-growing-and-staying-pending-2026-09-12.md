# Fix pending bills growing and staying pending

Nothing else in the app changes. Only the points below.

## What I checked

- The current saving rule for an edited bill is correct today: it removes the old
  lines and writes the ones on screen, and it sets the bill to completed.
- The rules inside your local database are only written the first time the app
  creates that database on a device. A device that was set up earlier keeps the
  older rules forever, even after the app is updated. This matches both symptoms
  exactly: lines being added on top of the old ones (quantity grows each time the
  bill is opened and saved) and the status never changing away from pending.
- This is the most likely cause, but it is not proven on your device yet, so the
  first step is a check that reports which rule version your Chrome app is using.

## The fix

1. On every app start, rewrite the bill-saving rules in the local database to the
   current version. This is safe and repeatable and touches no saved row.
2. One-time cleanup that runs once per device: any bill that has the same product
   listed more than once is collapsed to a single line. When the repeated lines are
   identical, the original quantity is kept (not the sum), so a bill returns to what
   was actually entered. The cleanup is logged so the affected bills can be reviewed.
3. A bill is written exactly as it stands on screen: one line per product, quantity
   unchanged unless someone edits it. Opening a pending bill — after an hour or after
   two months — shows exactly what was saved and changes nothing on its own.
4. Once a bill is completed it leaves the pending list immediately: the pending
   search always reads live and only ever lists bills whose status is pending.
5. After the fix I open the same pending bill three times and complete it, and
   confirm the quantities never move and it disappears from pending.

## Where your data is stored (answer, no change)

- Chrome app: the whole database lives inside Chrome's own storage for this app on
  your computer — nothing is kept on a server. In Chrome it is the site storage for
  the app's address, under your Chrome user profile folder.
- Desktop app: the same kind of database, but inside `D:\app data` on that computer.
- The Chrome app and the desktop app keep **separate** copies. Google Drive backup
  is the only bridge between them.
- Because the Chrome copy lives in Chrome's storage, clearing Chrome site data for
  the app would erase it — the Drive backup is the protection against that.

## Technical notes

- `src/lib/local-db/upgrades.ts`: append the current `save_sale`, `update_sale` and
  `apply_stock_for_sale_item` definitions (verbatim from `public/seed/schema.sql`) so
  `applyUpgrades` refreshes them on every start; they are `CREATE OR REPLACE`, so
  existing databases are repaired without a reinstall.
- Add an idempotent, `_local_meta`-flagged cleanup that collapses duplicate
  `sale_items` rows per `(sale_id, product_id)`, keeping the earliest row's
  quantity/price, then recomputes `sales.grand_total` from the surviving lines
  (discount and delivery preserved). Run under `session_replication_role = replica`
  so stock triggers do not fire, then re-run `repairGeneratedMovements`.
- Add a startup diagnostic that compares the installed `update_sale` body against
  the shipped one and logs a one-line result.
- `src/routes/_authenticated/pos.tsx`: keep the existing fresh-read hydration and
  `mergeLines`; set `staleTime: 0` on the `["sales","pending-search",…]` query and
  invalidate it after every save.
- Mirror any statement added to the upgrades into `public/seed/schema.sql` and
  `electron/db/schema.sql` so fresh installs match.
