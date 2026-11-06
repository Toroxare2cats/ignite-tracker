# Progress

Last updated: 2026-11-06, at the end of Session 2. Update this file at the end of every session.

## Session 1 — Foundation (complete, 2026-11-06)

Done-when from the plan, all met: Arvin and the test artist can sign in at the temporary address, the privacy test passes (126 of 126 checks), and the address is live.

### What exists now

**Repository.** GitHub `Toroxare2cats/ignite-tracker`, branch `main`. Holds `CLAUDE.md`, `docs/brief-v2.md`, `docs/build-plan.md`, a short `README.md` with the commands, and `docs/session-2-kickoff.md` (the prompt that starts the next session).

**App skeleton.** Vite + React + TypeScript with the Supabase client. Local settings live in `.env` (git-ignored); `.env.example` shows the names. Two screens so far:

- Sign-in: email and password, with plain-language messages for a wrong password, an unconfirmed account, a lost connection or too many attempts.
- Placeholder home: "Hi, [name]", the person's role, their email and a sign-out button. Inactive accounts see "not switched on yet"; accounts with no profile see "ask a manager to set it up".

**Database.** Supabase project `ignite-tracker` (ref `glyreoyrrexrtacpcati`), eleven migrations in `supabase/migrations`, all applied.

- Tables (24): `profiles`, `pay_rates`, `designs`, `design_prices`, `design_photos`, `orders`, `order_financials`, `order_financial_history`, `order_events`, `entries`, `entry_time`, `studio_time`, `purchases`, `stock_allocations`, `uattend_imports`, `uattend_days`, `push_subscriptions`, `tasks`, `task_assignees`, `personal_items`, `calendar_connection`, `calendar_events`, `calendar_attendees`, `calendar_ignored_emails`. One view, `people` (names and roles only, for active users).
- Row-level security on every table. Money tables (`pay_rates`, `design_prices`, `order_financials`, `order_financial_history`, `stock_allocations`) and the uAttend and calendar tables return nothing to artists. Hours sit in `entry_time`, separate from counts in `entries`, so the shared work log shows counts without hours.
- Functions the app calls: `finish_order`, `close_order`, `reopen_order`, `complete_task`, `approve_personal_item`, `order_cost`, `design_pricing`, `artist_design_hours`. The role checks are inside the functions. `rls_status` and `table_columns` exist only for the privacy test.
- Guards built into the database: a design's text specs are copied onto an order when it is created; entries cannot be added to a closed order; artists edit their own entries for 7 days; every edit stamps `edited_by` / `edited_at`; pay rates are dated and looked up by work date; a new account starts inactive until a manager switches it on; `close_order` refuses without delivered quantities, price and materials.
- Storage buckets: `design-photos` and `receipts`, both private. Artists can only use their own folder in `receipts`.

**Privacy test.** `scripts/privacy-test.ts` (`npm run privacy-test`). Signs in as the test artist and the test manager, creates fixtures, runs 126 checks (artist denied everywhere it should be, manager allowed everywhere it should be, structure checks on every table, public sign-up switched off), then removes its fixtures. Must pass before any push.

**Seed.** `scripts/seed.ts` (`npm run seed`), safe to run again. Creates: managers Arvin, Ben, Amelia; artists Joey (login `joseph@igniteglass.com`, display name "Joey") and Freddy; test accounts `test.artist@` and `test.manager@igniteglass.com` used only by tests. Three sample designs (fumed dabber bottle, dabber bottle, plain bottle), one sample order each, a pay rate for the test artist, and one fixture calendar event so the calendar tables are not empty for the test. The seed reads the service key from the logged-in Supabase CLI in memory and never writes it anywhere.

**Deployment.** Cloudflare Pages project `ignite-tracker` under Arvin's Cloudflare account. Live at https://ignite-tracker.pages.dev. Builds from `main` with `npm run build`, publishes `dist/`. The two `VITE_` settings are stored in the Cloudflare dashboard. Every push to `main` redeploys automatically.

**Settings changed by hand in dashboards.** Supabase → Authentication → Sign In / Providers → "Allow new users to sign up" is off. Nothing else was changed from defaults.

### Decisions made during the session

- New accounts start inactive no matter how they were created, and public sign-up is off. The brief says managers create accounts; this closes the gap where a stranger with the public key could have made themselves an artist.
- A test manager account exists alongside the test artist so the privacy test can set up its fixtures without the service key.
- The privacy test caught a real bug in `order_cost` (the list of missing figures crashed); fixed in migration 0011.

### Left unfinished or deferred

- Custom address `tracker.igniteglass.com` is not attached; that is session 6.
- Playwright screen tests are named in `CLAUDE.md` but not installed yet; added in session 2.
- No scheduled functions yet: reminders are session 7, calendar sync is session 8. The calendar tables hold only the seed fixture.
- `push_subscriptions` exists as a table; no push code yet.
- Supabase is on the Free plan; upgrade in session 6 before artists depend on it.
- All artist and manager screens beyond sign-in are still to build (artist screens: session 2; manager portal: sessions 3 to 5).
- For Arvin: move the passwords out of `.local/seed-accounts.txt` into a password manager and delete the file; give Ben and Amelia their passwords privately.

## Session 2 — Artist flow (complete, 2026-11-06)

Done-when from the plan: install the app on a phone, log an entry on a sample order in under a minute, and the icon launches full-screen. Arvin checks the phone install himself; everything else was checked with the automated screen tests, signed in as the test artist on a phone-sized browser.

### What exists now

**Artist screens** (every signed-in person sees them; the manager portal comes in session 3). Three tabs along the bottom: My Work, My Week, Materials.

- **My Work** (`/`): orders where the person is primary artist, orders they logged on in the last 14 days, a search box over every open or finished order (by order or design name), and a count of open tasks (reads from `task_assignees`; the Tasks screen itself is session 5). Sign out is at the top.
- **Order** (`/orders/:id`): name, status badge, product image if the design has one, design, quantity (dabbers only when the design has them), due date (late dates in red), primary artist, finished-by details; a prominent "Add today's entry" button that becomes "Edit today's entry" once the person has logged today; a collapsible Resources section (dimensions, colors and finishes, instructions, reference photos with tap-to-enlarge); the shared work log, newest first, showing each entry's artist, date, counts as pills, note, and hours only on the viewer's own entries (managers see all hours because `entry_time` returns them all rows), plus the "Edited by … · time" marker. Closed orders show a notice instead of the button.
- **Add entry** (`/orders/:id/entry`): the brief's field order. Work date (defaults to today; artists limited to the last 7 days), bottles, dabbers (only if the design has a dabber), Prep collapsed under one heading (points, color tube preps, blanks), fuming (only if fumed), hours as 15-minute chips (15m to 8h) with −15m / +15m and free hour/minute boxes, note. Hours are required; counts are optional. Save disables the button while saving; the database's one-entry-per-artist-per-order-per-day rule catches anything else and the app then updates the existing entry instead. A failed save keeps what was typed. The confirmation screen shows the summary and offers "Add another order" (back to My Work with a "pick the next order" notice) and "Back to this order".
- **Editing** (`/entries/:id`): the same form loaded with an existing entry. Artists edit or delete their own entries within 7 days of the work date; older ones open read-only with an explanation. Managers can edit any entry, including its date. Deleting asks for confirmation first.
- **My Week** (`/week`): This week / Last week (Monday to Sunday), a totals card (hours, and each count type on its own, never added together), then every day with its entries, order names, counts and hours. Calendar events and completed tasks are added in sessions 8 and 5.
- **Materials** (`/materials`): "Record a purchase" opens the form: what was bought, amount, "An order" (pick from open orders) or "Studio stock", optional receipt photo (camera on phones; files go to `receipts/<own id>/…`). Submissions start pending. Below, the person's own submissions with status, order or stock, time, a rejection reason if any, and a "View receipt" link that makes a short-lived signed URL.

**Installable app.** `vite-plugin-pwa` generates `manifest.webmanifest` (name Ignite Tracker, short name Ignite, standalone full-screen, portrait, orange theme) and a service worker that caches only the app's own built files and updates itself in the background. Icons: `public/icon.svg` (source), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android), `apple-touch-icon.png` (iPhone). The iPhone meta tags are in `index.html`. Nothing from the database is cached.

**Screen tests.** Playwright (`npm run ui-test`, Chromium only, phone-sized), signed in as the test artist from `.env`; `tests/editing.spec.ts` also signs in as the test manager to plant an entry older than 7 days. Seven tests cover My Work, Order, the entry form (design-driven fields, hours required, chips, confirmation, no duplicate, log), editing rules (marker, read-only after 7 days, database refusal, delete), My Week and Materials. Screenshots land in `test-results/screens/`. `npm run test` now runs the privacy test and then the screen tests.

**New packages** (added, nothing existing updated): `react-router-dom`, `vite-plugin-pwa`, `@playwright/test`.

### Decisions made during the session

- Weeks run Monday to Sunday in My Week. The brief does not say; change it in `src/lib/dates.ts` (`weekStart`) if the studio counts weeks differently.
- An artist cannot change the work date of an existing entry (delete and re-add instead); a manager can. This keeps "one entry per artist per order per day" simple on the phone.
- Opening "Add today's entry" when today's entry already exists goes straight to editing it, so a second phone or a repeated tap never makes a duplicate.
- The entry form's hours chips are fixed totals (15m … 8h) plus −15m / +15m and free entry, which covers the brief's "15-minute tap-chips plus free entry" without a long row of buttons.
- Managers use the same artist screens for now and see hours on every entry. The manager portal is session 3.

### Left unfinished or deferred

- The task count on My Work reads the real tables but the Tasks screen is session 5.
- My Week has no calendar events (session 8) or completed tasks (session 5) yet.
- Studio time entries (brief, "Time") have a table but no screen yet; add it alongside the reconciliation work in session 4.
- Custom address, Supabase Pro, reminders, calendar sync: unchanged from session 1's list.
- The production JavaScript bundle is about 517 kB; fine for now, but a later session could split it so the first open is quicker on slow connections.
- The Playwright tests leave today's test entries on the sample orders (they clean up purchases and the planted old entries). Harmless on sample data; delete them from the manager portal once it exists.

## Session 3 — Manager portal (not started)
