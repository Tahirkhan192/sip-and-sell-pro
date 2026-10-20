# Make "Complete" and "Save as Pending" save in about 1–2 seconds

Nothing about the bill changes: same invoice number, totals, stock deduction, Katha, staff link, money movements and receipt.

## Why it is still slow
After the main save, the till does several extra steps one after another before it says "saved":
1. Reads the saved bill back in full (all columns).
2. Saves the staff link again, even on bills with no staff.
3. Reads the full bill back a second time.
4. Recalculates the staff Katha again (the database rule already does this).
5. Right after "saved", refreshes products, all sales, customers, staff, dashboard and money movements at once. The local database works one job at a time, so the next bill has to wait behind these.

## What will change
- One read-back of the saved bill instead of two (only the fields the receipt needs).
- The staff link update runs only when the bill has a staff member, or when an opened bill's staff changed. Bills with no staff skip it.
- Staff Katha recalculation is kept, but runs after the "saved" message, in the background.
- After saving, only the product list (for live stock on the till) and the pending-bill search refresh right away. Dashboard, Sales list, customers, staff and money movements are marked "out of date" and refresh when you open them.
- Add a small timer in the browser console showing how long each save took, so it can be checked on your computer.

## Check before finishing
- Run the existing stock test.
- Save a normal bill, a pending bill, a staff Katha bill, and re-save a pending bill as completed on the test app; confirm invoice number, totals, stock drop, staff Katha and money movement are identical to before, and time each save.

## Technical details
- `pos.tsx` save mutation: merge the `select("*")` read-backs into one `select` of receipt fields; guard staff `update` with `nextStaff || (editId && hydrated original staff !== nextStaff)`; move `recompute_staff_katha` to a non-awaited call after return.
- `onSuccess`: keep active refetch for `products` and `["sales","pending-search"]`; use `refetchType: "none"` for `dashboard`, `sales`, `customers`, `staff`, `cash_movements`.
- No SQL, trigger or formula changes.
