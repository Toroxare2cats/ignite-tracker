# Ignite Glass Production Tracker

Installable web app at tracker.igniteglass.com for a glassblowing studio. Artists log what they produced on each order each day; managers price designs from real costs, see daily productivity, assign tasks, and see calendar commitments beside logged work. Owner: Arvin, who is not a developer: explain changes in plain language and ask before guessing.

**Specification**

- docs/brief-v2.md is the spec. docs/build-plan.md is the plan.
- If a request conflicts with the brief, say so and ask; do not silently change behavior the brief defines.

**Stack**

- Vite + React + TypeScript, deployed to Cloudflare Pages from main.
- Supabase: Postgres, Auth (email + password), Storage, scheduled functions (cron) for reminders and the calendar sync.
- Database changes only via migrations in supabase/migrations.
- Tests: Playwright (ui) and scripts/privacy-test.ts (permissions).
- Google Calendar API, read-only scope only, called from a Supabase scheduled function.

**Commands**

- npm run dev — run locally
- npm run test — all tests
- npm run privacy-test — permission rules (must pass before any push)
- npm run build — production build
- supabase db push — apply migrations to the linked project

**Rules that never change**

1. Pay rates, selling prices, materials costs, labor costs and any comparison are manager-only, enforced by row-level security and function role checks in the database. Never rely on hiding a field in the UI. Never add a financial column to an artist-readable table, including task, personal-list and calendar tables.
2. Never run the privacy test as anything but a real artist login.
3. Activity counts (bottles, dabbers, points, color tube preps, blanks, fuming) are never summed into a finished-bottle figure.
4. Hours per bottle = all logged order minutes / bottles delivered.
5. Rates are dated; cost calculations use the rate in force on the entry's work date. Never update a rate row; insert a new one.
6. Missing price, materials or rate shows as missing, never zero.
7. Completion is explicit: finish_order, close_order, reopen_order functions only. close_order requires delivered quantities, price and materials.
8. Artists edit their own entries for 7 days; managers edit anything; every edit sets edited_by / edited_at.
9. The service_role key is never committed, logged, or used in the app.
10. Dependencies are updated only in a session that says so.
11. Google Calendar access is read-only. Request only the calendar.readonly scope; the app never creates, edits or deletes calendar events. The access key lives in Supabase secrets and is used only by the sync function.
12. Tasks are never part of the daily entry form and never required to log an entry. Only managers create, assign, edit or reopen tasks; any assignee or manager may complete one. Personal-list items are visible only to their owner and managers.
13. Reconciliation gap = clocked minutes (uAttend) − order minutes − calendar minutes (capped at clocked, all-day events excluded) − studio minutes; negative results are shown as over-explained, never hidden.

**Counting definitions (from the brief)**

- Bottle/dabber: formed and in the kiln that day, by the artist who finished it at the bench.
- Points, color tube preps, blanks: number made that day.
- Fuming: pieces fumed that day; a piece can count as a bottle and as fumed.

**Reminders (America/Chicago)**

- Daily entry reminder: workdays at 4:30 pm, to artists with clocked hours and no entry that day.
- Task reminders: 10 am on the due date, and once when a task becomes overdue. Undated tasks get none.

**People**

- Managers: Arvin, Ben, Amelia (one role, full access, no privacy between them). Artists: 6–8, hourly.
- Pilot: Joey (Android), Freddy (iPhone).
- Calendar connection account: info@igniteglass.com. Synced calendars: Flame Shop; General Hot Shop; Hot Shop Bench 1–4; Ignite Events Studio Calendar.
