# Three authorized changes only

Everything outside the three items below stays untouched: offline engine, PGlite, seed data, POS, inventory, purchases, expenses, closing, sync and all other reports.

## 1. Staff Management — salary and attendance

Upgrade the existing Staff pages (list + member detail); no new module, no schema rewrite.

Rules kept on a fixed 30-day basis:
- Daily Base Salary = Monthly Salary / 30
- Actual Earned Salary = Daily Base Salary x Actual Present Days (up to today)
- Remaining Salary = Opening Balance + Monthly Salary − Salary Paid − POS Amounts + Amounts Received From Member
- Actual Remaining Salary = Opening Balance + Actual Earned Salary − Salary Paid − POS Amounts + Amounts Received From Member

Staff list: keeps current columns and behaviour, keeps the quick Present / Absent controls, and shows both Remaining Salary and Actual Remaining Salary.

Member page shows: Total Monthly Salary, Daily Base Salary, Total Present Until Today, Total Absent Until Today, Opening Balance, Salary Paid, POS Amounts, Amounts Received From Member, Remaining Salary, Actual Remaining Salary — plus the existing full salary-payment history and POS purchase history tables.

Buttons on the member page: Set Opening (+/−), Pay Amounts, Receive Amounts From Member, Edit, Delete. These reuse the existing payment dialog and existing tables (staff_payments, staff_month_carry) — Set Opening writes the same manual carry record that already exists.

Month end: the member's Actual Remaining Salary becomes next month's Opening Balance automatically, and the owner can still override it manually with Set Opening.

## 2. Reports → Monthly → Monthly P&L — staff salary

Only the staff-salary lines change:
- Payable Salary per member = Daily Base Salary x Total Present Days in the selected month
- Total Staff Salary = sum of all members
- Show three clear lines: Total Net Profit Before Staff Salary, Total Staff Salary, Net Profit After Staff Salary

One correction required inside this item: the P&L currently counts only days explicitly marked "present", while Staff Management counts every day that is not marked "absent". The two screens therefore disagree today. The P&L will be switched to the Staff Management definition (days elapsed up to today minus absent days, from the joining date) so both always match. No other P&L figure changes.

## 3. Google Drive login — "accounts.google.com is blocked"

Cause to fix: the connect button opens an empty pop-up first and then sends it to Google. A pop-up that starts empty inherits the app page's isolation policy, and Google's sign-in page then refuses to load with ERR_BLOCKED_BY_RESPONSE.

Minimum fix, same feature and same UI:
- Ask the server for the Google address first, then open the pop-up directly on that address (no empty window step), so nothing is inherited.
- The return page hands the one-time code back through same-origin browser storage as well as the existing message, so the flow completes even when the pop-up is opened detached.
- If a pop-up is refused entirely, the Settings card falls back to opening Google in the same window and returning straight back to Settings.
- Desktop app: the Google window is opened as a normal separate window and the Google sign-in helper hosts (fonts/static/content hosts used by accounts.google.com) are added to the existing allow list, so the page can finish loading. Offline behaviour, the block-everything-else rule and the local server stay exactly as they are.

Connect, Check, Back up now, Restore from Drive and Remove account keep working unchanged.

## Deliverables

After the changes and verification (offline saves, POS, reports, existing Drive backup/restore): a new Windows ZIP and a new Android APK built from the same version.

## Technical notes

- Files touched: `src/routes/_authenticated/staff.tsx`, `src/routes/_authenticated/staff_.$staffId.tsx`, one migration extending `staff_salary_summary` with earned/actual-remaining and opening-balance fields, `src/lib/report-engine.ts` (staff present-day definition only), `src/routes/_authenticated/reports.tsx` (three P&L lines), `src/lib/drive-sync.ts`, `src/routes/oauth/google-drive/return.tsx`, `src/components/DriveAccountCard.tsx` (fallback only), `electron/main.cjs` (window handler + host allow list).
- No dependency changes, no schema restructuring, no data edits.
