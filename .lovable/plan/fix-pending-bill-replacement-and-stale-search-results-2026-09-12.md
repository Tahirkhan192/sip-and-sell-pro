# Fix pending bill replacement and stale search results

## Scope
Only correct pending-bill saving and pending-bill search. Leave all other POS behavior unchanged.

## Changes
1. **Load the exact saved bill before editing**
   - Always fetch the selected pending bill and its saved lines fresh from local storage.
   - Replace the on-screen cart with those lines once; never append saved lines to an existing cart.
   - Keep one row per product without increasing its saved quantity.

2. **Make “Save Pending” a true replacement**
   - For an existing pending bill, replace its old item rows atomically with the exact current cart.
   - Restore the old stock effect first, then apply the replacement once.
   - Add a database safeguard so the same product cannot exist twice on one invoice.
   - Preserve the invoice ID; do not create a second invoice when resaving an opened pending bill.

3. **Remove completed and deleted bills from pending search immediately**
   - Require `status = pending` and no deletion marker in both the local query and the displayed results.
   - Remove the affected bill directly from cached pending results after completion or deletion, then refetch from local storage.
   - Prevent an old search response from restoring a bill that is no longer pending.

4. **Repair existing affected local data safely**
   - Run an idempotent local repair for duplicate item rows, preserving the original intended quantity rather than summing accidental duplicates.
   - Reapply the corrected pending replacement rule at startup for existing Chrome-installed databases.

## Verification
- Create a pending bill with quantity 1, reopen and save pending repeatedly without edits: quantity remains 1 and only one invoice exists.
- Reopen, manually change quantity, and save: the old version is replaced by the new quantity exactly once.
- Complete a pending bill: it disappears from pending search and remains completed after restarting the app.
- Delete a pending bill: it disappears from pending search and remains deleted after restarting the app.
- Repeat the checks against the persistent local Chrome database, then run type and build checks.
