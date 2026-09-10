# Staff katha bill fix + remove Customers from the menu

## 1. Staff bill does not reach the staff member

What I checked in the code:

- Choosing a staff name in the bill screen does store the staff member on the bill screen, and the "Add remaining to Katha" tick is forced on for an unpaid staff bill.
- The bill itself is saved by one saved routine, and the staff member is then attached by a **second, separate step** that runs only if that routine hands back the new bill's identity.
- The staff balance is recalculated by a rule inside the data store that only counts bills that are completed, marked katha, and carry the staff member.

What I have **not** yet proved: which of those steps fails on your device. The
warning you see ("saved but not linked") comes from the second step, so the bill
is saved and the staff attachment is what fails. The most likely reason is that
the save routine returns the new bill in a form the app cannot read back, so the
attachment step is skipped or verified against nothing — but this must be
confirmed before changing anything.

### Step 1 — Reproduce and identify (first thing done)

Create a staff bill in the running app and record exactly what the save returns
and what is stored on the bill row, so the failing step is named, not guessed.

### Step 2 — Make the attachment part of the save itself

Instead of "save the bill, then attach the staff member", the staff member and
the katha mark are written in the same step that writes the bill, matched by the
bill number. This removes the dependency on what the save routine hands back, so
there is no step left that can silently be skipped.

### Step 3 — Recalculate and refresh, always

After a staff bill is saved:
- the staff member's katha balance is recalculated,
- Staff Management, salary figures, digi katha and the Sales list are refreshed,
- the bill shows in the Sales list in the colour chosen in Settings.

### Step 4 — No error, clear result

If the staff member truly cannot be attached (for example the staff record no
longer exists), the bill still saves and one plain message names the reason.
Otherwise nothing is shown but the normal saved confirmation.

### Step 5 — Verify

Create a staff bill (unpaid, added to katha, completed) and confirm in the same
session: the bill appears in Sales in the staff colour, the staff member's katha
balance rises by the unpaid amount, and the monthly and actual remaining salary
drop by that amount.

## 2. Remove Customers from the menu

The Customers entry is removed from the left menu and from the Settings list of
modules that can be shown or hidden, so it can never reappear. Nothing about
customer data or existing bills changes, and the rest of the menu stays exactly
as it is.

## Technical notes

- `src/routes/_authenticated/pos.tsx`: move `staff_id` / `katha` persistence so it
  is applied by invoice number after `save_sale` / `update_sale` rather than by the
  returned record's `id`; keep the read-back verification but never treat a
  successful sale as an error.
- Check `rpc()` in `src/lib/local-db/client.ts`: `save_sale` returns a composite
  `sales` row via `SELECT save_sale(...) AS value`; if PGlite returns that as a
  string, `saleData.id` is undefined and the whole staff-link block is skipped.
  If confirmed, parse or re-select the row by invoice number.
- Confirm `sales.staff_id`, `recompute_staff_katha` and `trg_sale_staff_katha`
  exist after `LOCAL_UPGRADE_SQL` on an older local database.
- `src/components/AppShell.tsx`: drop the `/customers` NAV entry.
  `src/lib/menu-visibility.ts`: drop `/customers` from `MENU_MODULES` and the
  default map. The `/customers` route file stays in place.
- No schema change expected; if one is needed it is mirrored into
  `public/seed/schema.sql` and `electron/db/schema.sql`.
