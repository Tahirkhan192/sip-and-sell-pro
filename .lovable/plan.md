# Make saved month openings carry forward (and stop the double history load)

## Problem (confirmed)
When an opening is saved for a month (with "Set as opening stock" or the pencil editor), later months ignore it. They rebuild their opening from the original opening stock plus every entry ever made. So if you corrected September's opening, October's opening, closing and profit still come from the old figures. The same rebuild also makes the Stock and report screens load the whole history a second time, even when it isn't needed.

## What changes
- A month with no saved opening starts from the **most recent saved opening** before it, plus only the entries made since that month began. It no longer starts from the very first opening stock.
- If a month already has a saved opening for every item, the extra history load is skipped.
- Current Stock and "Set as opening stock" use the same rule. Today's stock becomes: the latest saved opening plus entries since then. Items with no saved opening are calculated the same way they are now.
- Saved openings and closings stay exactly as saved. Signs are kept, nothing is rounded or clamped, and nothing is written to your data.

## What you will notice
- If you edit September's opening, October's opening changes to match.
- Current Stock reflects your saved corrections.
- The Stock and report screens open faster.

## Technical details
- `src/lib/inventory-engine.ts`: load all `kind='opening'` snapshots once. For each item, find the latest snapshot month whose business-month start is on or before `period.from`. Use that as the anchor, and add movements from the anchor's start up to the day before `period.from`. Replace the nested call from 2000-01-01. For the "from the beginning" range, anchor at the latest snapshot on or before `to`, and report the movement columns from that anchor.
- Skip the carry fetch entirely when every item has a snapshot for the requested month.
- `month-opening.ts` and `report-engine.ts` automatically use the anchored engine. No changes to how anything is saved.
- Add a unit test: a saved September opening plus October movements must equal the October opening and closing.
