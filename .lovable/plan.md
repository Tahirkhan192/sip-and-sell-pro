# Fix: completed bills still appear in pending invoice search

Nothing else in the app changes. Only the points below.

## What I checked

- The pending bill search in the POS already asks the database for pending bills
  only, and it already re-reads live (no saved offline copy).
- Two gaps remain:
  1. The search trusts whatever the database layer returns; there is no final
     check on the screen that each listed bill is really still pending.
  2. Your Chrome-installed app runs the **published** version of the app. The
     earlier pending-bill fixes are only in the working copy — they have not been
     published yet, so your installed app still runs the old behaviour.

## The fix

1. In the pending search, add a final safety filter on the screen itself: a bill
   is only shown if its status is pending at that moment. Even if anything ever
   returns a completed bill, it can never appear in the list.
2. After every save (pending or completed), explicitly refresh the pending
   search list so a just-completed bill disappears immediately, even while the
   search box is still open.
3. Publish the app so the Chrome-installed app on your computer and phone picks
   up this and the earlier pending-bill fixes. Until it is published, the
   installed app keeps running the old version.

## Verification

- Save a bill as pending, search the customer — it appears.
- Complete that bill, search again with the same text still in the box — it is
  gone from the results.

## Technical notes

- `src/routes/_authenticated/pos.tsx`: add `status` to the pending-search
  select, filter the returned rows client-side with `s.status === "pending"`,
  add `refetchOnWindowFocus: true`, and invalidate the
  `["sales", "pending-search"]` key directly in the save mutation's onSuccess.
- No database, schema, or stored-data changes.
