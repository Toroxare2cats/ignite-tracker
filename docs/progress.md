# Progress

Last updated: 2026-11-06, at the end of Session 1. Update this file at the end of every session.

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
- Playwright screen tests are named in `CLAUDE.md` but not installed yet; add them in session 2 (adding packages is allowed there, updating existing ones is not).
- No scheduled functions yet: reminders are session 7, calendar sync is session 8. The calendar tables hold only the seed fixture.
- `push_subscriptions` exists as a table; no push code yet.
- Supabase is on the Free plan; upgrade in session 6 before artists depend on it.
- All artist and manager screens beyond sign-in are still to build (sessions 2 to 5).
- For Arvin: move the passwords out of `.local/seed-accounts.txt` into a password manager and delete the file; give Ben and Amelia their passwords privately.

## Session 2 — Artist flow (not started)

Start it with `docs/session-2-kickoff.md`.
