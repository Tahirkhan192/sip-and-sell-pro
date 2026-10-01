# Opening/Closing: freeze exactly what was saved, then auto carry forward

## What you asked for
1. The September closing and October opening in History must show **exactly** the numbers on screen when you pressed "Save as Opening". Positive stays positive, negative stays negative. Nothing gets recalculated afterwards.
2. You will fix September's closing yourself with manual adjustments. The app must not "repair" or change anything on its own.
3. From now on, last month's closing (the Current Stock at month end) becomes the new month's opening everywhere: Stock page, Reports and History.
4. When a new business month begins, the history is saved automatically, so you don't have to press anything.

## Changes
1. **Stop the automatic repair.** The last fix added a step that rewrites each item's starting stock before saving. That step can turn positive into negative or negative into positive. It will be removed. Saving will only copy what the screen shows.
2. **History is read-only and exact.** History will show the saved quantity and value with their real sign, with no rounding and no flipping. The "opening ≠ closing" warning stays.
3. **Saved figures always win.** If a month has a saved opening, the Stock page and Reports use that number. If not, they use the previous month's closing worked out up to the last business day of that month. That way the September closing and the October opening are always the same number.
4. **Your manual adjustments count.** After you add adjustments dated in September, press "Save as Opening" for October again. It will overwrite September's closing and October's opening with the corrected Current Stock. Earlier months stay as they are.
5. **Automatic month-start save.** The first time the app opens on or after the first business day of a new month (your configured 08:00 rollover), it checks if that month already has a saved opening. If not, it saves the opening and the previous month's closing automatically, using the same Save as Opening step. It runs once per month and never writes the same month twice.

## Check first
Before changing anything, I'll compare the saved October opening and September closing rows with what the Stock page shows. That way I can confirm which products the earlier repair changed, and you can see them.

## Technical notes
- `src/lib/month-opening.ts`: delete `repairOverwrittenBase` and its call. `buildLockRows` keeps engine `remaining` (manual items: stored current stock) exactly as is, with no clamping.
- `src/lib/inventory-engine.ts` / `report-engine.ts`: opening = `kind='opening'` snapshot if present, otherwise engine remaining through the day before the business month start.
- New `useAutoMonthLock()` hook in the authenticated layout: on app start, if there is no opening snapshot for the current business month, it calls `buildLockRows` + `lockMonthOpening`. A local flag keyed by year-month stops it from running again.
- No schema changes. The offline copy behaves the same.
