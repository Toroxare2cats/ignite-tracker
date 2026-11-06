# Ignite Glass Production Tracker — Build Plan

Nov 2, 2026 · @Arvin

## How the build works

The tracker is built in eight Claude Code sessions over about three weeks, six before the pilot and two during it. The approved Brief v2 is the specification; its acceptance list is the definition of done.

- **Claude Code** writes all code, database rules and tests, runs the app, deploys it, and reads the brief and this plan from the repository.
- **Arvin** creates the accounts, pastes the session prompts, logs in where a human must, checks each session's result on a phone or in the browser, and says what to change.
- **This project** is where decisions change and documents are updated. Code is never written here.

Each session has a "done when" line. A session is not finished until Arvin has checked that line himself; Claude Code reporting success is not the check. Anything the brief does not settle gets a one-line question at the start of a session, not a guess.

## The stack in plain words

| Part | What it is | Why this one |
| --- | --- | --- |
| GitHub repository `ignite-tracker` | The folder of code, with every change kept | You already use GitHub; Cloudflare deploys from it automatically |
| Vite + React + TypeScript | The tools the app's screens are written with; the result is plain web files | Simple to host as static files; well understood by Claude Code; no server of our own to run |
| Supabase | The database (Postgres), sign-in, photo storage and scheduled jobs, run as a service | One account covers everything the brief needs; its row-level security is how financials are enforced in the database |
| Cloudflare Pages | Hosts the web files at tracker.igniteglass.com | Free, allows business use, deploys on every push |
| PWA manifest + service worker | The small files that make the site installable with an icon and able to receive reminders | Home-screen install on iPhone and Android without an app store |
| Playwright + a privacy test script | Automated checks that click through the app and query the database as an artist | Proves the permission rules on every change |
| CLAUDE.md | A text file at the top of the repository that Claude Code reads every session | Holds the rules that must never drift: privacy, counting definitions, commands |
| Google Calendar API | Google's free, read-only way for a program to list calendar events; a scheduled Supabase job calls it every 30 minutes | No fees; one connection signed in as info@ sees the studio calendars; the permission requested cannot write |

## What gets stored

Financial fields live in their own tables rather than as extra columns on shared ones. That way the rule "artists can't read this table" is one line per table, instead of a per-column exception that is easy to get wrong.

| Table | Holds | Artists can read | Managers can read |
| --- | --- | --- | --- |
| `profiles` | Name, login email, alternate emails, role (artist / manager), active flag, home screen, phone type | Everyone's name and role | All |
| `pay_rates` | Rate per worker with an effective-from date; never overwritten, only added to | No | All |
| `designs` | Name, image, dimensions, colors, instructions, has dabber, is fumed | All | All |
| `design_prices` | Current selling price per bottle, dated | No | All |
| `design_photos` | Reference photos (files in storage) | All | All |
| `orders` | Name, design, quantities ordered, due date, primary artist, status, copied specs, finished by/at | All | All |
| `order_financials` | Delivered quantities, selling price, materials total and note, closed by/at | No | All |
| `order_events` | Finished, closed, reopened — who, when, why | All | All |
| `entries` | Artist, order, work date, counts (bottles, dabbers, points, color tube preps, blanks, fuming), note, edited by/at | All | All |
| `entry_time` | Minutes for one entry | Own entries only | All |
| `studio_time` | Artist, date, category, minutes, note | Own only | All |
| `purchases` | Artist, order or stock, description, amount, receipt file, status, decided by, reason | Own only | All |
| `stock_allocations` | Amount of an approved stock purchase assigned to an order | No | All |
| `uattend_days` | Artist, date, clocked minutes, import batch | No | All |
| `push_subscriptions` | Each phone's reminder address | Own only | All |
| `tasks` | Title, note, priority, due date, order link, recurrence rule, created by, status, completed by/at, the personal item it came from | Tasks assigned to them | All |
| `task_assignees` | Task and person | Rows for tasks assigned to them, so they see co-assignees | All |
| `personal_items` | Owner, text, status (open / approved / done), the task it became | Own only | All |
| `calendar_connection` | The info@ access key (held in Supabase's secrets store, readable by the sync job only), chosen calendars, last sync time, status | No | Status and calendar list only; no user can read the key |
| `calendar_events` | Calendar, Google event id, title, start, end, all-day flag | Events they are matched to | All |
| `calendar_attendees` | Event, invited email, response, matched person (blank if unmatched) | Own rows only | All |

Storage buckets: `design-photos` (everyone reads, managers write) and `receipts` (the submitting artist and managers). Labor cost, cost per bottle and hours per bottle are computed by database functions that only a manager account can call.

## Enforcing who sees what

Supabase's row-level security means every table carries rules the database itself applies to each request, after checking who is signed in. The app's screens cannot bypass them, and neither can someone calling the database directly with an artist login.

Rules in plain language:

- A signed-in user's role comes from `profiles`, and only a manager can change a role or create an account.
- Tables marked "No" for artists above have no artist-readable rule at all; an artist request returns nothing.
- `entry_time`, `studio_time`, `purchases`, `personal_items` and `push_subscriptions` return only rows where the artist is the author or owner.
- `tasks` and `task_assignees` return to an artist only the tasks they are assigned to; only managers create, assign, edit or reopen tasks, and only managers approve personal items. Completing a task goes through a `complete_task` function that checks the caller is an assignee or a manager.
- `calendar_events` and `calendar_attendees` return to an artist only events they are matched to; the calendar access key is kept in Supabase's secrets store and used only by the sync job, never read by any user account.
- Artists can insert and update their own `entries` and `entry_time` for 7 days after the work date, and never others'.
- Status changes go through database functions: `finish_order` (anyone), `close_order` and `reopen_order` (managers; `close_order` refuses without delivered quantities, price and materials).
- The cost functions check the caller's role before returning anything.
- Every table change that matters carries `edited_by` and `edited_at`.

**The privacy test.** A script signs in as a test artist and tries to read every manager-only table, call every cost function, download a receipt it did not submit, read another artist's `entry_time`, `personal_items` and calendar rows, and read a task it is not assigned to. It must get nothing back from each. It also checks that no task or personal-list table has a money column. It runs on every push, and a failure blocks deployment. The same script, signed in as a manager, must succeed on each, so a broken rule can't pass by locking everyone out.

## Before session 1: setup checklist

About 30 minutes, all in the browser where you are already signed in. Keep the two secrets in a password manager; nothing else needs saving.

- [ ] **GitHub:** create a new private repository named `ignite-tracker`, empty (no README). Note the address, e.g. `github.com/<your-account>/ignite-tracker`.
- [ ] **Supabase:** create a new project named `ignite-tracker`, region US (the closest option to Chicago), and generate a strong database password. Save the password — Supabase cannot show it again. Stay on the Free plan for now.
- [ ] **Supabase:** in Project Settings → API, copy the Project URL and the `anon` public key. These two are pasted into Claude Code in session 1; they are safe to have in the app. Do not copy the `service_role` key anywhere.
- [ ] **Cloudflare:** nothing yet; session 1 connects Pages to the repository.
- [ ] **DNS:** confirm which site manages igniteglass.com's records (GoDaddy's DNS page or WP Engine's). Nothing changes until session 6.
- [ ] **Google:** nothing yet. Session 8 needs a manager with Workspace admin access signed in; confirm the seven studio calendars are shared with info@igniteglass.com at "see all event details."
- [ ] **Claude desktop app:** install it, sign in, open the Code tab, and choose a folder on your computer for projects (for example `Documents/Code`).
- [ ] **Pilot phones:** confirm Freddy's iPhone runs a recent iOS (16.4 or later, for reminders) and Joey's Android has Chrome.

## Build sessions

Each session is one Claude Code conversation of two to four hours, plus your check. Sessions 2–4 can be split if a session runs long; the done-when line is what matters.

| # | Claude Code builds | You check | Done when |
| --- | --- | --- | --- |
| 1 — Foundation | Repository with CLAUDE.md, the brief and this plan; the app skeleton; all tables and rules from the sections above, including the task and calendar tables; the privacy test; seed accounts (Arvin, Ben, Amelia, Joey, Freddy, one test artist) and three sample designs; first deploy to a temporary Cloudflare address | Open the temporary address, sign in as yourself and as the test artist | Both logins work; the privacy test passes; the address is live |
| 2 — Artist flow | My Work, Order (with Resources and shared log), Add entry with design-driven fields and 15-minute chips, "Add another order," 7-day edit, My Week, Materials purchase; installable with icon on both phones | Install on your phone; log an entry on a sample order in under a minute; try to edit an old entry | An entry saves in under a minute with no help; the icon launches full-screen |
| 3 — Manager portal | Orders (create, assign, finish, close, reopen), Designs (specs, price, photos), People (accounts, alternate emails, rates, deactivate), Approvals, home-screen preference, saved/unsaved states | Create a real design and order; approve a test purchase; close an order with the worked example's numbers | Worked example gives $116 / $156 / $144; a closed order refuses to close without price |
| 4 — Reports and imports | Today, Order cost, Design pricing, Artist week, Artist by design, Reconciliation with the full gap formula (calendar and studio columns fill in later); uAttend CSV upload; CSV exports | Export one week from uAttend and upload it; look at your own Artist week | Clocked, logged and gap hours show per day; blank days flagged |
| 5 — Task lists | Tasks tab for everyone (Mine / Everyone for managers); create, assign to several people, priority, due date, order link, recurrence; completion by any assignee with who and when; reopen; personal list with one-line add; approval into a task; open tasks on the order page; task count on My Work; due/overdue strip on Today; completed tasks in Artist week | Create a task for Joey and Freddy and complete it as one of them; add a personal item as the test artist and approve it; set a weekly task and complete it | The next weekly occurrence appears with the right date and only one is open; the approved item shows where it went; the privacy test still passes |
| 6 — Go live | tracker.igniteglass.com DNS record; Supabase Pro upgrade; backups confirmed; runbook; onboarding steps for iPhone and Android; full walk through the acceptance list | Walk the acceptance list yourself, item by item | Every item ticked except reminders and calendar; Joey and Freddy's phones installed |
| 7 — Reminders (during pilot) | Push reminders: entries at 4:30 pm on workdays for clocked-no-entry artists; tasks at 10 am on the due date and once when overdue; fixes from pilot feedback | A daily reminder and a task reminder arrive on both phones | Both reminder items ticked |
| 8 — Calendar sync (during pilot) | Google Cloud project and Internal consent screen, walked through click by click; Connect / Reconnect / Sync now in Settings; chosen calendars; 30-minute sync; matching by login and alternate emails; Unmatched invitees; calendar and studio columns live in Reconciliation and Artist week; own events in My Week | Connect as info@, select the seven calendars, find a real class on an artist's day in Artist week | The calendar acceptance item ticked; the connection shows a read-only permission only |

After the pilot: one review session here (not in Claude Code) to decide changes, then a short Claude Code session to make them, then install for everyone.

## Schedule

Dates assume roughly three sessions a week. Thanksgiving falls inside the pilot, which is fine: fewer entries, but the reconciliation view will show the gap honestly.

| Milestone | Target |
| --- | --- |
| Setup checklist done | Nov 6, 2026 |
| Session 1 — Foundation | Nov 9, 2026 |
| Session 2 — Artist flow | Nov 11, 2026 |
| Session 3 — Manager portal | Nov 13, 2026 |
| Session 4 — Reports and imports | Nov 16, 2026 |
| Session 5 — Task lists | Nov 18, 2026 |
| Session 6 — Go live; install on Joey's and Freddy's phones | Nov 20, 2026 |
| Pilot (two weeks) | Nov 23, 2026 to Dec 4, 2026 |
| Session 7 — Reminders (entries and tasks) | by Nov 25, 2026 |
| Session 8 — Calendar sync | by Dec 2, 2026 |
| Pilot review (here) | Dec 7, 2026 |
| Rollout to all artists | Dec 9, 2026 |
| First pricing review (after ten closed orders) | Jan 22, 2027 |

## CLAUDE.md

This file goes at the top of the repository in session 1, alongside `docs/brief-v2.md` and `docs/build-plan.md` (exports of the two documents in this project). Claude Code reads it at the start of every session.

The file's contents follow. Everything from the title line to the end of the People list goes into the file, formatted as headings and bullet lists exactly as shown.

### Ignite Glass Production Tracker

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
7. Completion is explicit: finish\_order, close\_order, reopen\_order functions only. close\_order requires delivered quantities, price and materials.
8. Artists edit their own entries for 7 days; managers edit anything; every edit sets edited\_by / edited\_at.
9. The service\_role key is never committed, logged, or used in the app.
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

## Session 1 kickoff prompt

Before pasting: export Brief v2 and this plan as Markdown (click each document's name → Export → Markdown) and save them as `brief-v2.md` and `build-plan.md` in the project folder you chose. In the Claude desktop app's Code tab, open that folder, then copy everything from "We are starting" to "Do not start session 2" into the message box and send it.

We are starting the Ignite Glass production tracker. I am not a developer; explain each step in plain language and ask me one question at a time when you need something from me.

In this folder you will find brief-v2.md (the specification) and build-plan.md (the plan). Read both fully before doing anything.

This is session 1, "Foundation," from the build plan. Do the following, checking in with me at each numbered step:

1. Create the repository structure, move the two documents into docs/, and write CLAUDE.md with exactly the contents the build plan's CLAUDE.md section specifies. Initialize git and connect it to my GitHub repository (I will give you the address). Commit.
2. Set up Vite + React + TypeScript with the Supabase client. I will give you the Supabase Project URL and anon key when you ask; keep them in a .env file that git ignores.
3. Write the database migrations for every table, bucket and function in the build plan's "What gets stored" and "Enforcing who sees what" sections, including the task, personal-list and calendar tables, with row-level security on every table. Help me link the Supabase project (I will log in when the browser opens) and apply the migrations. Do not set up the Google Calendar connection; that is session 8.
4. Write scripts/privacy-test.ts as described in the plan and run it. It must fail cleanly if any rule is missing, and pass only when a real artist login gets nothing from every manager-only table and function, another artist's rows, and tasks it is not assigned to, while a manager login succeeds.
5. Seed accounts: managers Arvin, Ben, Amelia; artists Joey, Freddy; and a test artist used only by tests. I will give you the emails; each person's login email is their igniteglass.com address. Seed three sample designs (one with a dabber and fumed, one with a dabber only, one plain) and one sample order each.
6. Build a minimal sign-in screen and a placeholder home screen that shows the signed-in person's name and role.
7. Connect the repository to Cloudflare Pages (walk me through the clicks), deploy, and give me the temporary address.

Done when: I can sign in at the temporary address as myself and as the test artist, and npm run privacy-test passes. Do not start session 2.

## Risks and fallbacks

| Risk | What we do |
| --- | --- |
| A session runs out of Claude usage mid-way | Work is committed to GitHub at each step, so nothing is lost; resume when the limit resets, or move to Max 5x if it happens twice |
| Supabase Free project pauses during the build | Restore from the Supabase dashboard; upgrade to Pro in session 6 before artists depend on it |
| iPhone reminders don't arrive | Reminders need the home-screen install and iOS 16.4+; the Today view covers the pilot either way |
| Artists skip logging | Reconciliation flags it the same week; managers raise it in person during the pilot before it becomes habit |
| uAttend CSV format differs from what the import expects | Session 4 builds the import from your real export file, not a guess; the importer shows a preview before saving |
| Something breaks when nobody technical is around | Runbook first; then open Claude Code and paste the error; the form-and-spreadsheet fallback covers a bad week |
| A website migration later removes the tracker's DNS record | The runbook lists the record; check tracker.igniteglass.com after any website change |
| The Google Calendar connection stops working | The dashboard shows the failure; a manager clicks Reconnect and signs in as info@. If it keeps happening, switch to a service account with domain-wide access, which never needs reconnecting |
| A calendar is shared with info@ at free/busy only, so attendees are missing | Events appear with no one matched; Settings flags calendars with zero matched attendees so a manager can fix the sharing level |
| Tasks pull attention away from logging entries | Tasks stay on their own tab and never appear in the entry form; if entry counts drop during the pilot, the Today view will show it and the task count on My Work can be hidden |
