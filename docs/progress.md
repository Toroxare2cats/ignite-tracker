# Progress

Last updated: 2026-11-07, at the end of Session 4. Update this file at the end of every session.

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

Done-when from the plan: install the app on a phone, log an entry on a sample order in under a minute, and the icon launches full-screen. Arvin confirmed on 2026-11-06 that the icon installed and launched full-screen on his phone and that logging an entry on a sample order was neither slow nor confusing; everything else was checked with the automated screen tests, signed in as the test artist on a phone-sized browser.

### What exists now

**Artist screens** (every signed-in person sees them; the manager portal comes in session 3). Three tabs along the bottom: My Work, My Week, Materials.

- **My Work** (`/`): orders where the person is primary artist, orders they logged on in the last 14 days, a search box over every open or finished order (by order or design name), and a count of open tasks (reads from `task_assignees`; the Tasks screen itself is session 5). Sign out is at the top.
- **Order** (`/orders/:id`): name, status badge, product image if the design has one, design, quantity (dabbers only when the design has them), due date (late dates in red), primary artist, finished-by details; a prominent "Add today's entry" button that becomes "Edit today's entry" once the person has logged today; a collapsible Resources section (dimensions, colors and finishes, instructions, reference photos with tap-to-enlarge); the shared work log, newest first, showing each entry's artist, date, counts as pills, note, and hours only on the viewer's own entries (managers see all hours because `entry_time` returns them all rows), plus the "Edited by … · time" marker. Closed orders show a notice instead of the button.
- **Add entry** (`/orders/:id/entry`): the brief's field order. Work date (defaults to today; artists limited to the last 7 days), bottles, dabbers (only if the design has a dabber), Prep collapsed under one heading (points, color tube preps, blanks), fuming (only if fumed), hours as 15-minute chips (15m to 8h) with −15m / +15m and free hour/minute boxes, note. Hours are required; counts are optional. Save disables the button while saving; the database's one-entry-per-artist-per-order-per-day rule catches anything else and the app then updates the existing entry instead. A failed save keeps what was typed. The confirmation screen shows the summary and offers "Add another order" (back to My Work with a "pick the next order" notice) and "Back to this order".
- **Editing** (`/entries/:id`): the same form loaded with an existing entry. Artists edit or delete their own entries within 7 days of the work date; older ones open read-only with an explanation. Managers can edit any entry, including its date. Deleting asks for confirmation first.
- **My Week** (`/week`): This week / Last week (Sunday through Saturday), a totals card (hours, and each count type on its own, never added together), then every day with its entries, order names, counts and hours. Calendar events and completed tasks are added in sessions 8 and 5.
- **Materials** (`/materials`): "Record a purchase" opens the form: what was bought, amount, "An order" (pick from open orders) or "Studio stock", optional receipt photo (camera on phones; files go to `receipts/<own id>/…`). Submissions start pending. Below, the person's own submissions with status, order or stock, time, a rejection reason if any, and a "View receipt" link that makes a short-lived signed URL.

**Installable app.** `vite-plugin-pwa` generates `manifest.webmanifest` (name Ignite Tracker, short name Ignite, standalone full-screen, portrait, orange theme) and a service worker that caches only the app's own built files and updates itself in the background. Icons: `public/icon.svg` (source), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (Android), `apple-touch-icon.png` (iPhone). The iPhone meta tags are in `index.html`. Nothing from the database is cached.

**Screen tests.** Playwright (`npm run ui-test`, Chromium only, phone-sized), signed in as the test artist from `.env`; `tests/editing.spec.ts` also signs in as the test manager to plant an entry older than 7 days. Seven tests cover My Work, Order, the entry form (design-driven fields, hours required, chips, confirmation, no duplicate, log), editing rules (marker, read-only after 7 days, database refusal, delete), My Week and Materials. Screenshots land in `test-results/screens/`. `npm run test` now runs the privacy test and then the screen tests.

**New packages** (added, nothing existing updated): `react-router-dom`, `vite-plugin-pwa`, `@playwright/test`.

### Tested and passed at close (2026-11-06)

- `npm run privacy-test`: 126 of 126 checks passed, signed in as the real test artist. Artists cannot see pay rates, prices, materials costs, other people's hours, other people's purchases, or closed-order financials, and cannot change entries older than 7 days.
- `npm run test` (privacy test, then the seven Playwright screen tests): all passed. The screen tests sign in as the test artist on a phone-sized browser and walk My Work, an order, adding and editing an entry, the 7-day rule, My Week and a materials purchase with a receipt.
- `npx tsc -b` and `npx oxlint`: no errors.
- Live site: https://ignite-tracker.pages.dev serves the manifest, icons and service worker; the deploy from the last push finished.
- By hand, on Arvin's phone: installed from the browser, icon on the home screen, opens full-screen, an entry logged on a sample order.

### Install on a phone

Full steps with troubleshooting are in `docs/install-on-phone.md`. In short:

- **iPhone:** open the address in Safari (not Chrome), sign in, tap Share, tap "Add to Home Screen", tap Add. The orange flame icon opens full-screen.
- **Android:** open the address in Chrome, sign in, tap Install in the banner, or use the ⋮ menu and "Install app". The icon appears on the home screen and in the app drawer.
- Once installed the app stays signed in and picks up new versions in the background; close and reopen it to see an update.

### Decisions made during the session

- Weeks run Sunday through Saturday (Arvin, session 3; session 2 had assumed Monday to Sunday). It is set in one place, `weekStart` in `src/lib/dates.ts`.
- An artist cannot change the work date of an existing entry (delete and re-add instead); a manager can. This keeps "one entry per artist per order per day" simple on the phone.
- Opening "Add today's entry" when today's entry already exists goes straight to editing it, so a second phone or a repeated tap never makes a duplicate.
- The order page shows a "Logged so far" card above the work log: entries, artists and each activity count totalled separately. It is worded as logged counts, with no bar or percentage against the ordered quantity, because daily counts are what went in the kiln, not what survived (rule 3). Added after Arvin's first phone test on 2026-11-06; a true completion indicator would be a change to the brief.
- The entry form's hours chips are fixed totals (15m … 8h) plus −15m / +15m and free entry, which covers the brief's "15-minute tap-chips plus free entry" without a long row of buttons.
- Managers use the same artist screens for now and see hours on every entry. The manager portal is session 3.

### Left unfinished or deferred

- The task count on My Work reads the real tables but the Tasks screen is session 5.
- My Week has no calendar events (session 8) or completed tasks (session 5) yet.
- Studio time entries (brief, "Time") have a table but no screen yet; add it alongside the reconciliation work in session 4.
- Custom address, Supabase Pro, reminders, calendar sync: unchanged from session 1's list.
- The production JavaScript bundle is about 517 kB; fine for now, but a later session could split it so the first open is quicker on slow connections.
- The Playwright tests leave today's test entries on the sample orders (they clean up purchases and the planted old entries). Harmless on sample data; delete them from the manager portal once it exists.

## Session 3 — Manager portal (complete, 2026-11-07)

Done-when from the plan: create a real design and order, approve a test purchase, and close an order with the worked example's numbers (one artist 3 hours at $22, another 2 hours at $25, $40 materials, $300 price), giving $116 labor, $156 recorded cost and $144 remaining; closing refuses without a price. The automated tests do all of this with the test accounts (`tests/manager-orders.spec.ts`, `tests/manager-approvals.spec.ts`, and the privacy test's close checks). Arvin also did it by hand on the live site on 2026-11-07, and the figures matched on screen and in the database (details under "Tested and passed at close").

### What exists now

**Manager portal** (`/manage/…`). Managers get one menu: Orders, Designs, People, Approvals, Settings, then the artist screens My Work, My Week and Materials. On a desktop the menu sits down the left side; on a phone the same menu sits across the top. Every screen and action is the same on both (rule 14). The portal's code downloads only for managers, which is about speed, not privacy: the database decides who reads what.

- **Orders** (`/manage/orders`): every order in a table (order, design, quantity, due date, primary artist, status), soonest due first, with In progress / Closed / All and a search by order or design name. "New order" opens the order form.
- **New order / Edit or reassign**: name, design, bottles ordered, dabbers ordered (only when the design has a dabber), due date and primary artist, all required except dabbers. The design's dimensions, colors and finishes and instructions are copied onto the order and can be adjusted for that order. The design cannot be changed once the order exists. Changing the primary artist is recorded in the order's history with who and when. A closed order cannot be edited until it is reopened.
- **Order page for managers** (`/manage/orders/:id`): the details, the buttons its status allows (Edit or reassign, Mark Finished, Close order, Reopen, Log my own work), Costs, Materials, the work log with everyone's hours, and the full history.
  - *Mark Finished*: optional packing note, box dimensions in inches and package weight in pounds.
  - *Close*: bottles delivered, dabbers delivered (when the design has them), selling price (order total) and materials cost (manager total) are all required, plus an optional materials note. Approved purchases and allocated stock are added on top of the manager total automatically; the form says so and warns when purchases are still waiting for a decision. The database refuses a close without the price or delivered quantities as well.
  - *Reopen*: back to Open with an optional reason; the earlier completion details stay in the history. Artists can read order history, so the form says to leave money out of the reason.
  - *Costs*: "Financials incomplete" until the order is closed. Once closed: labor, materials, recorded cost, selling price and amount remaining, then per delivered bottle: recorded cost, price, amount remaining and logged time. Anything not entered shows as Missing. A note says this is recorded labor and materials against price, not profit after overhead.
  - *Materials*: the manager total and note (saved on their own), plus the approved purchases and stock allocated to this order. Read-only while the Close form is open and on a closed order.
- **Designs** (`/manage/designs`): every design with its current selling price, Missing until one is entered. A new design has a name, dimensions, colors and finishes, production instructions, and which activities its entry form shows (for example dabbers and fuming). The design's page adds a dated selling price (a new price is a new row from a start date; old ones are never overwritten), a product image, reference photos with captions (artists see them under Resources), and retiring the design. Unticking an activity never erases counts already logged.
- **People** (`/manage/people`): every account with its role and current pay rate, Missing until one is entered. "Add person" creates a login (name, login email, starting password, role, optional alternate emails); public sign-up stays off, so this is the only way an account is made. A person's page has their details (name, role and alternate emails; the login email is shown but cannot be changed here), a dated pay rate added as new rows, "Set a new password", and Deactivate / Reactivate. Accounts are never deleted, and a deactivated person's history and rates are kept as they were.
- **Approvals** (`/manage/approvals`): three tabs. *Waiting* lists pending purchases with who, what, amount, order or stock and the receipt; Approve (reason optional) or Reject (reason required). *Stock* lists approved studio-stock purchases with what is left of each, and allocates part of one to an order (order, amount, note) or removes an allocation. *Decided* shows the last 50 decisions. A decision is final.
- **Settings** (`/manage/settings`): each manager's landing screen (see below).

**Artist screens, changes this session.** An artist (or manager) can mark an order Finished from the order page, with the same packing note, box dimensions and weight; it stays available whatever has been logged, and logging continues afterwards. Weeks run Sunday through Saturday. The Materials form and the daily entry form now show whether they are saved.

**Saved and unsaved states.** Every form that saves shows where it stands just above or beside its save button: "No changes yet" or "Not saved yet", "Unsaved changes", "Saving…", "Saved" with the time, or the error. Closing or reloading the page with unsaved changes brings up the browser's own warning; tapping another menu item does not (Arvin's choice, below). Cards on one page save on their own, so saving a photo never throws away unsaved edits to the details. The shared pieces are `src/lib/useFormState.ts` and `src/components/form.tsx`.

**Landing screen.** Each manager picks where the app opens: Orders, Designs, People, Approvals or My Work. It is stored on their own account (`profiles.home_screen`), so it follows them between phone and desktop. It applies once each time the app is opened and again after signing in; a refresh stays put, the My Work link still goes to My Work, and a link to a particular page goes to that page. Artists always open on My Work. A manager who has not chosen opens on Orders for now and moves to the Dashboard automatically once it exists (session 4). Amelia's account is set to Orders. Code: `src/lib/landing.ts`, `Home` in `src/App.tsx`.

**Database.** Four new migrations, all applied:

- `0012` Reassigning the primary artist is recorded in the order history (ids only, no money). Hours on a closed order are locked in the database, not just on screen.
- `0013` Package weight on orders; `finish_order` takes it and `reopen_order` keeps it in the history.
- `0014` Alternate emails are manager-only. A manager cannot deactivate their own account or change their own role, so there is always an active manager. A deactivated account's pay rates are frozen.
- `0015` A purchase decision is final. A closed order's costs hold still: approving a purchase or changing a stock allocation on a closed order is refused (rejecting is allowed, since it changes no cost). Two managers allocating from one stock purchase at the same moment cannot go over its amount.

**Account function.** `supabase/functions/manage-account` runs on Supabase's servers. It creates logins and sets new passwords, and only after checking that the caller is an active manager. It is the one approved place the admin (service_role) key is used (rule 9); the key never reaches a browser or phone. Deploy it again after a change with `npx supabase functions deploy manage-account --project-ref <ref> --use-api`.

**Tests.** The privacy test now has 165 checks (39 new), covering purchase decisions, stock allocation, design and photo edits, reassignment, an artist changing their own alternate emails, the manager lock-out guards, closing without a price or quantities, hours on a closed order, deactivated accounts, and an artist changing a manager's landing screen. There are 28 screen tests (21 new): the manager screens at desktop size, phone-width checks for every manager screen, and an artist being turned away from each one. Manager tests sign in as the test manager from `.env` and remove the orders, designs and purchases they make. The People test makes a throwaway login and removes it afterwards with the admin key, which it reads through the logged-in Supabase CLI into memory the same way `scripts/seed.ts` does; it is never written down or printed. Selling prices and pay rates can only be added, so the tests reuse the Test Artist and Test Manager rates and a retired design called "Test fixture: design prices"; the price and rate tests add a few rows to those test fixtures each run.

### Tested and passed at close (2026-11-07)

- `npx tsc -b` and `npx oxlint`: no errors.
- `npm run build`: builds. The main file is 527 kB; the manager portal is a separate 72 kB file.
- `npm run test`: privacy test 165 of 165, signed in as the real test artist, then all 28 screen tests passed (2.3 minutes).
- Final run before closing the session (2026-11-07, after the run-through below): `npm run test` passed again (privacy test 165 of 165, then 28 of 28 screen tests in 2.2 minutes), and `npm run privacy-test` on its own passed 165 of 165. Both sign in as the test artist and the test manager. One of the checks has the test artist try to add an email to their own alternate emails; the database refuses it ("Only a manager can change a role, active flag, login email, alternate emails or name"). The same database rule refuses removing or replacing one; the test exercises the adding case.
- Live site: https://ignite-tracker.pages.dev serves this version (commit `24856aa`), checked 2026-11-07 within a minute of the push. The app file Cloudflare built is byte-for-byte the one tested here, and the manager portal file, manifest and service worker all load. Every later push that day changed only this progress file, so the app itself is unchanged since `24856aa`.
- By hand, on the live site (2026-11-07), signed in as Arvin: created the design "TEST worked example" and a 60-bottle order on it, with Test Artist as primary artist. Claude logged the hours with the two test accounts: 3 hours for Test Artist and 2 hours for Test Manager, dated 2001-01-02, the day those accounts' $22 and $25 rates are in force, so no real person got a pay rate. Test Artist sent a $1.00 studio-stock purchase, which Arvin approved. Arvin marked the order Finished and closed it: labor $116, materials $40, recorded cost $156, price $300, amount remaining $144; per delivered bottle $2.60 cost, $5.00 price, $2.40 remaining, 5 minutes. The database's own figures matched. The first close went in with $0 materials, so Arvin reopened it and closed it again with $40, which also showed Reopen keeping the earlier figures in the managers' history. Afterwards, with Arvin's OK, the test order, its entries and history, the design and the purchase were removed; the test accounts and their rates are unchanged.
- Not tried yet: the manager screens on a real phone, real receipt photos from an iPhone, and signing in as Amelia to see her landing screen.

### Decisions made during the session

Only what the brief and build plan do not already say.

- **Package weight** (addition to the brief): when an order is marked Finished, an optional package weight in pounds is recorded with the packing note and box dimensions, for the shipping label (Arvin). Stored on `orders` (migration 0013); `finish_order` takes it and `reopen_order` keeps it in the history.
- Box dimensions are in inches.
- Weeks run Sunday through Saturday everywhere (Arvin; CLAUDE.md rule 15).
- Anything a manager can see on a desktop is also in the installed app on a phone, and the reverse: one app, one menu, nothing hidden by device (Arvin; rule 14). The brief only said managers can use it on a phone.
- The admin key may be used only by the `manage-account` function, on Supabase's servers, to create logins and set passwords (Arvin, 2026-11-06; rule 9).
- Arvin considered locking Mark Finished until the ordered bottles were logged, and decided against it: it stays as the brief has it, open to any artist or manager at any time. Logged bottles count what went into the kiln, not what survived.
- An order's design cannot be changed once the order exists; make a new order instead.
- Changing an order's primary artist is recorded in its history with who and when.
- The brief says entries on a closed order need a reopen first. The same now holds for the order's details, hours, purchase approvals and stock allocations. Rejecting a purchase is still allowed, since it changes no cost.
- Only managers can change alternate emails, because the calendar sync (session 8) will use them to decide whose event an invitation is. An artist cannot change their own.
- A manager cannot deactivate their own account or change their own role, so the studio always has an active manager.
- A design's selling price and a person's pay rate are added on that design's or person's own page right after it is created, because each is a dated row of its own.
- Purchase decisions are final. There is no undo for a wrong approval yet; ask for one if it becomes a problem.
- Landing screen: once per opening of the app and after signing in; Orders until the Dashboard exists. The brief gives Amelia's home as the assignment board in one place and Orders in another; the session 3 instruction said Orders, so her account uses Orders.
- Settings holds only the landing screen for now; the calendar settings in the brief come with the calendar work in session 8.
- Unsaved changes warn only on closing or reloading the page, not when tapping another menu item (Arvin, 2026-11-07: keep it as is).
- On the Materials form, Cancel throws away what was typed, and the form starts fresh after each submission instead of remembering the last order picked.
- The test artist's password showed up in the Claude Code conversation while a failing test was being debugged. It is a test-only account that can see what any artist sees and nothing financial. Arvin chose to leave it as is (2026-11-07). To replace it later: set a new password on the test artist's People page and put it in `PRIVACY_TEST_ARTIST_PASSWORD` in `.env`.

### Left unfinished or deferred

- The manager screens on a real phone, a real receipt photo from an iPhone, and Amelia's landing screen (checked in the database, not by signing in as her).
- Watch: in the run-through the first close went in with $0 materials and was put right by reopening. If the Close form's hint "Use 0 if approved purchases and stock cover all of it" turns out to invite that slip, reword it.
- The Dashboard is session 4; managers without a landing choice will open on it automatically.
- A login email cannot be changed from People. It would need the account function; ask if it is wanted.
- The test accounts appear in the primary-artist list on the order form.
- A reopen reason is readable by artists (the form warns).
- Studio time entries still have no screen; planned with the reconciliation work in session 4.
- The main JavaScript file is 527 kB; splitting it further is still a later clean-up.
- Custom address, Supabase Pro, reminders and calendar sync: unchanged from session 1's list.

## Session 4 — Reports and imports (complete, 2026-11-07)

Done-when from the plan: upload a real uAttend week and see clocked, logged and gap hours per artist per day, with blank days flagged; the worked-example order shows correctly in Order cost and Design pricing. Arvin uploaded the real Nov 1–7, 2026 Timecard Report on the local preview during the session and checked each report in the browser pane as it was built; the automated tests cover the worked example in Order cost and Design pricing (see "Tested and passed at close").

### What exists now

**Imports** (`/manage/imports`). A manager uploads uAttend's Timecard Report as CSV: the version with one block per person and one line per day or punch (uAttend's "Batch Report"). The weekly-totals version (one line per person) is refused with an explanation, because it has no days in it.

- The browser reads the file and shows a **preview before anything is saved**: each uAttend name, who that is in the tracker, each day's clocked time, the week's total, and a check against uAttend's own Total Hours line. Clocked time is regular plus overtime (REG + OT1 + OT2); paid leave (VAC, HOL, SIC) and OTH are shown but never counted as clocked. A punch with no clock-out (uAttend prints `------`) is a **missing punch**: the day shows as missing, never as zero. The Gross Pay line is skipped before anything reaches the database; no pay figure from the file is read or stored.
- **Name matching.** Arvin confirmed on 2026-11-07: Arvin Makhsous → Arvin, Amelia Carroll → Amelia, Joseph Wallander → Joey, Freddy Mcclanahan → Freddy. The other seven people in the file have no tracker account yet and are skipped. The tracker remembers each spelling (`uattend_names`), suggests a match for a new spelling from the first name or login, and a manager chooses "Not in the tracker (skip)" or a person for anything new. Two names cannot be matched to one person. A wrong match is fixed on the same screen: the imported hours move to the right person, or are removed when the name is nobody.
- **Saving** goes through one database function, `import_uattend`, in a single transaction. Every day of the pay period up to today gets a row for each matched person (0 on a day with no punches), so "did not clock in" is different from "not imported yet". **Uploading the same period again replaces those days for the people in the file**; it never adds a second copy, and people not in the file are untouched.
- **Import history**: when, who, pay period, file, how many people and days, days with a missing punch, skipped names, and whether the upload is still in use or has been replaced by a later one.

**Today** (`/manage/dashboard`), the manager dashboard and the default landing screen. Who has logged today and who has not (artists, then managers), with hours; a "clocked, no entry" flag once uAttend covers the day; the count of purchases waiting; open orders by due date with who logged on each today and a warning for overdue ones; placeholders for tasks due today (session 5) and the Google Calendar connection status (session 8; read from `calendar_connection`, never the key).

**Reports** (`/manage/reports`), one screen each, all with a Sunday-to-Saturday week picker where a week applies (`?week=YYYY-MM-DD`):

- **Order cost**: pick an order (closed first), then the costs card shared with the order page, closing details, **hours by contributor with each person's labor** (new function `order_cost_by_contributor`, rate in force on each work date), and every entry with counts, hours and note. Open orders show "Financials incomplete" and the hours.
- **Design pricing**: pick a design (with its current price per bottle), then every closed run oldest first: delivered quantity, hours per bottle (all logged minutes ÷ bottles delivered), cost, price and amount remaining per bottle, and anything missing named. The latest complete run is called out beside the current price. Open orders never appear.
- **Artist week**: one person (any account), one week: totals (clocked, on orders, calendar, studio, unexplained), produced counts each kept separate, and a card per day with clocked, logged, gap, flags and what was logged. Blank clocked days are flagged; a week with no uAttend rows says so.
- **Artist by design**: pick a person and a design; their minutes per bottle on each closed run beside the studio figure for the same run, plus the overall figures. Only ever per design; no score.
- **Reconciliation**: all artists for a week, totals per person and a day-by-day table each: clocked, on orders, calendar, studio, unexplained, flags, and which uAttend upload covers the week. The **formula lives in one place**, `src/lib/gap.ts` (rule 13): clocked − order minutes − calendar (capped at clocked, all-day and declined events left out) − studio; negative shown as "Over-explained by …", never hidden. Calendar and studio columns read their real tables, which stay empty until sessions 8 and later. Missing punches and un-imported days show as missing, never 0, and a week containing one has no clocked total or gap.

**Exports** (`/manage/exports`), managers only: CSV of orders (with delivered quantities, price, materials, labor, recorded cost and amount remaining for closed orders), entries (each count separate, minutes, notes, who edited), designs (specs and current price per bottle) and purchases (amount, order or stock, status, decision). Built in the browser from what the signed-in manager can read, downloaded as `ignite-<what>-<date>.csv`. Every cell is quoted; text that looks like a spreadsheet formula is neutralised. Tasks join the exports in session 5.

**Database.** Two new migrations, both applied: `0016` (`uattend_names`; `uattend_days` gains the source name and a missing-punch flag and allows null minutes only for a missing punch; `uattend_imports` gains people, skipped names and missing-punch counts; `import_uattend` and `set_uattend_match`, managers only) and `0017` (`order_cost_by_contributor`, managers only).

**Tests.** Privacy test: 172 checks (7 new: artist gets nothing from `uattend_names`, is refused by `import_uattend`, `set_uattend_match` and `order_cost_by_contributor`; manager succeeds on each). Screen tests: 37 (9 new) in 18 files: Imports (preview, matching, save, stored days, history, re-upload replaces, fixing a match, refusing the weekly-totals file), Reconciliation (every case incl. phone width), Today, Order cost (worked example open and closed), Design pricing (two closed runs and one open), Artist week (incl. phone width), Artist by design, Exports (all four files; an artist turned away). Test fixtures live in January 2001 so no real person's hours or rates are touched. `tests/fixtures/` holds two made-up uAttend files in the real export's layout for the test accounts only.

**Files.** New: `src/manager/uattend.ts` (reads the uAttend file), `uattendQueries.ts`, `ImportsScreen.tsx`, `TodayScreen.tsx`, `dashboardQueries.ts`, `ReportsScreen.tsx`, `ReconciliationScreen.tsx`, `OrderCostScreen.tsx`, `DesignPricingScreen.tsx`, `ArtistWeekScreen.tsx`, `ArtistByDesignScreen.tsx`, `ExportsScreen.tsx`, `exports.ts`, `reportQueries.ts`, `CostCard.tsx` (moved out of the order page), `WeekPicker.tsx`; `src/lib/gap.ts`, `useWeek.ts`, `csv.ts`.

### Tested and passed at close (2026-11-07)

- `npx tsc -b` and `npx oxlint`: no errors.
- `npm run build`: builds. The main file is 529 kB; the manager portal is a separate 144 kB file (it was 72 kB before this session's screens).
- `npm run test`: privacy test 172 of 172, signed in as the real test artist, then all 37 screen tests passed (2.7 minutes). Run after step 7, with no code changes afterwards.
- By hand, on the local preview (2026-11-07), Arvin uploaded the real uAttend Timecard Report for Nov 1–7, 2026: the preview showed the four known people suggested and the seven unknown names to skip; after saving, Reconciliation for that week showed, for example, Freddy at 27h 46m clocked, 1h on orders and 26h 46m unexplained with four days flagged "No entry", Joey at 43h 44m clocked with five days flagged, and Arvin's four days without a clock-out as "Missing punch" rather than 0. Arvin checked each report in the browser pane as it was built and approved each step.
- Live site: https://ignite-tracker.pages.dev serves this version (commit `2780cc0`), checked 2026-11-07 a few minutes after the push. The main app file, the manager portal file, the stylesheet and the manifest Cloudflare built are byte-for-byte the ones tested here; the service worker differs only in the order of two entries in its file list. The push itself was made from Arvin's terminal, because the app's permission check refused Claude Code's own push to the live site.

### Decisions made during the session

Only what the brief and build plan do not already say.

- **The uAttend file to upload is the daily Timecard Report** (uAttend calls the export "Batch Report"), not the weekly-totals Timecard Report Arvin exported first, which has no days in it (Arvin, 2026-11-07). The import refuses the weekly-totals version and says which one to export.
- **Clocked time = REG + OT1 + OT2.** Paid leave (VAC, HOL, SIC) and OTH are shown in the preview but not counted as clocked, since they are not time in the studio to explain.
- **A missing punch is shown as missing, never zero**, on the day and in any total that includes it (rule 6 applied to clocked time). In the real Nov 1–7 file Arvin's Tue–Fri had no clock-outs, so his week shows "Missing punch" rather than 11h 11m.
- A day in the pay period with no punches is stored as 0 clocked minutes, so the reconciliation can tell "did not clock in" from "not imported yet". Days after today are not filled in.
- Re-uploading a period replaces the days for the people in the file (by uAttend name and by matched person) and leaves everyone else alone. Each upload is kept in the history and marked "In use", "Partly replaced" or "Replaced by a later upload".
- Name matches are remembered by spelling (trimmed, spaces collapsed, case ignored: uAttend writes "Joe  Waropay" with two spaces). Fixing a match moves already-imported hours; choosing "Not in the tracker" removes them.
- The reconciliation lists every active account (managers log production work too) plus anyone switched off who has hours in the week; people with nothing imported and nothing logged collapse to one line.
- Calendar minutes count toward a day by the event's start date in Chicago, non-declined and not all-day, capped at clocked (rule 13). Session 8 may refine events that cross midnight.
- Today is the landing default ("dashboard"), as session 3 planned; Amelia's account stays on Orders.
- Artist by design's overall figure: the artist's minutes over bottles delivered on the runs they logged on, beside the studio's minutes over all bottles delivered on every closed run of the design.
- The CSV exports hold pay-related figures; the screen says to store them where only managers can see them.
- The studio-time entry form (brief, "Time") was deferred again: this session's instruction was that the studio column is empty until a later session, and the column and formula are live now.

### Left unfinished or deferred

- The real uAttend export files Arvin saved in `docs/samples/` hold real employees' names and clocked times. They are not committed; decide whether to keep them out of git (add `docs/samples/` to `.gitignore`) or commit them to the private repository.
- Studio time entries still have no screen; the Reconciliation and Artist week columns are ready for them.
- Tasks due today on the dashboard, completed tasks in Artist week and a tasks CSV: session 5. Calendar connection status, Sync now and the calendar columns filling in: session 8.
- Seven people in the uAttend file have no tracker account yet (Jack Basso, Eleanor Harvey, Charlie Matz, Kenny Pollok, Olivia Ramirez, Alan Robles, Joe Waropay); their hours are skipped until accounts exist. Once an account is made, match the name on Imports and upload the week again.
- The Orders export calls the cost function once per closed order; fine for a studio's order count, but worth batching if it ever feels slow.
- The manager reports on a real phone and Amelia's landing screen: still not tried by hand.
- Custom address, Supabase Pro, reminders and calendar sync: unchanged from session 1's list.
