# Fix pending bills, staff bills, and speed

Everything else stays exactly as it is. Only the points below change.

## 1. Pending bill items multiplying

What I confirmed: the app keeps a copy of recently seen bill data in the browser's
offline store, including the "pending bill search" and the "open bill for editing"
data. When a bill is reopened, that saved copy can be loaded into the order panel
before the real one arrives, and the order panel currently trusts whatever comes
first. The exact multiplication path is not proven yet, so step 1 is to reproduce it.

Fix:
- Stop keeping offline copies of bill (pending / editing) data. Reference lists
  (products, categories, customers, settings) keep working offline as today.
- When a bill is opened, rebuild the order panel from a single fresh read and
  merge any repeated line of the same product into one line with the correct
  quantity, so a bill can never grow just by being opened.
- Guard the save so re-saving the same bill always replaces its items once, never
  adds a second set.
- After the fix, open the same pending bill three times in a row and confirm the
  quantities never change.

## 2. Completed bills still showing as pending

Same cause family: the pending search list is served from the saved offline copy,
so a bill completed a minute ago can still appear there. Removing that saved copy
(above) plus always reading pending bills live fixes it. Additionally:
- The pending list will only ever show bills whose status is pending.
- Once a bill is completed it disappears from the pending search immediately.

## 3. Staff bills not reaching Staff Management

Confirmed cause: the staff link is only written when a **new** bill is saved.
Any bill that was first saved as pending and completed later never gets linked to
the staff member, so nothing reaches the staff's salary.

Fix:
- Write the staff link on every save (new bill, edited bill, pending completed
  later), and clear it when the staff member is removed from the bill.
- The staff's actual remaining and monthly remaining salary then reduce
  automatically as they already do for directly-created staff bills.
- Show the staff bill in the Sales list in the colour chosen in Settings
  (this colour is already stored; it will be applied to the staff rows again).

## 4. Speed

- Remove the offline copies that are re-read on every screen (above) — that alone
  removes work on each bill screen.
- Keep already-loaded lists in memory a little longer instead of refetching them
  on every screen change.
- Avoid refetching every screen after each save; refresh only what the save
  actually changed.

## 5. Where the app runs and where data lives (answer, no change)

- The page itself is served from Lovable hosting when you open it in Chrome.
- All your data — bills, purchases, stock, staff, money movements — lives in an
  embedded database inside the app on your own computer, not in the cloud. This is
  true for both the Chrome-installed app and the desktop version.
- The Chrome-installed app and the desktop version keep **separate** local data,
  because each one has its own storage area. Google Drive backup is the bridge
  between them.

## Technical notes

- `src/data/cache/read-cache.ts`: drop `isPendingBillsKey` so `["sales", …]`
  keys are never mirrored or seeded from IndexedDB.
- `src/routes/_authenticated/pos.tsx`: hydrate cart from a deduplicated
  (`product_id` → summed quantity) mapping of `sale_items`; dedupe again in the
  save payload; move the staff link out of the `!editId` branch so it applies to
  `update_sale` as well, setting `staff_id` to `staffId ?? null`.
- Verify `update_sale` does not drop `staff_id` and that
  `trg_sale_staff_katha` recomputes the balance on status change.
- `src/routes/_authenticated/sales.tsx`: apply `staff_invoice_color` to rows with
  a `staff_id`.
- Query defaults: raise `staleTime`/`gcTime` for reference lists; narrow the
  invalidation list after a POS save.
- No schema change is expected; if one is needed it will be mirrored into
  `public/seed/schema.sql` and `electron/db/schema.sql`.

The installable desktop setup file is a separate step, after this is approved and
verified.
