# Ignite Glass Production Tracker — Brief v2

Nov 2, 2026 · @Arvin

## Purpose and goals

The tracker records what each artist produced on each order, each day, so Ignite Glass can price designs from real costs and see daily productivity. It replaces the notes, lists and spreadsheets used today. It does not replace uAttend, which stays the timesheet.

Two goals, both first-class:

1. **Pricing.** Know what each order cost in labor and materials, so prices can be judged per order and per design over time.
2. **Productivity and accountability.** See what each artist worked on each day and how much they produced.

The system must answer these four questions from the data it collects:

| Question | Answered from |
| --- | --- |
| What did this order cost, and how much of the selling price was left after labor and materials? | Order hours × each contributor's rate at the time, plus approved materials, against the selling price entered at close |
| Is our price for this design high enough, based on past runs? | Cost per bottle and amount remaining per bottle for every closed run of the design |
| How long does this design take per bottle, and is that improving? | All logged order hours ÷ bottles delivered, per run, in date order |
| What did each artist work on this week, and how much did they produce? | The artist's week: days, orders, counts, hours, clocked hours from uAttend, calendar events they were invited to, and tasks completed |

The bar for daily use: an artist logs a day's work on their phone in under a minute, with no training. Counts of what was produced come first; hours are recorded but secondary.

## Settled decisions

These are decided unless Arvin changes them.

| Topic | Decision |
| --- | --- |
| Platform | Installable web app (home-screen icon, no app store) at tracker.igniteglass.com; works on iPhone and Android |
| Services | Supabase for the database, sign-in and photo storage (Pro plan, $25/month, from the pilot onward); Cloudflare Pages for hosting (free) |
| Build | Claude Code, from the Claude desktop app; planning and documents in this project |
| Timesheets | uAttend remains the timesheet; the tracker logs production and completion day by day |
| Managers | Arvin, Ben, Amelia — one manager role, full access to everything; all three can log production work; Amelia's home screen defaults to the assignment board |
| Artists | 6–8, paid hourly, individual accounts created by a manager |
| Pilot | Joey (Android) and Freddy (iPhone), two weeks on real orders, then everyone |
| Website | Independent of the tracker; the subdomain is one DNS pointer and survives any website move |
| Starting data | Start fresh; enter active designs with their current price so pricing views have a baseline |
| Skipped for v1 | Scrap/reject counts, a separate Google Form dry run, native app-store distribution |
| Task lists | Manager-assigned tasks and each artist's personal list, in v1 before go-live, on their own Tasks tab; never a step in logging an entry |
| Calendar | Read-only Google Calendar sync connected as info@igniteglass.com, studio calendars only, built after the pilot starts; the tracker never writes to a calendar |
| Scope | Frozen after task lists and calendar sync until the pilot review |

## Core workflow

1. A manager creates an order from a design, sets quantity and due date, and assigns a primary artist.
2. The artist opens the order on their phone and adds a daily entry: counts of what they made, hours, and a note if needed.
3. Any other signed-in artist can open the same order and add their own entry. No per-order permission is needed, and the primary assignment never changes because someone contributed.
4. Work happens in any sequence. The system never requires prep before bottles, bottles before dabbers, or anything before packing.
5. When production is done, any artist or manager marks the order **Finished**, with their name and the time recorded.
6. A manager **Closes** the order by entering delivered quantities, selling price and materials. Only closed orders feed pricing reports.
7. Weekly, a manager uploads the uAttend export so clocked hours sit beside logged hours for each artist-day.
8. Managers assign tasks, optionally linked to an order; artists work from their Tasks tab and keep a personal list that a manager can turn into assigned tasks.
9. Calendar invitations sync in the background, so a class or event shows beside that day's clocked and logged hours.

## Designs, orders, and resources

A **design** is the reusable thing (a bottle shape, usually with a matching dabber). An **order** is one production run of a design. Every order links to its design so runs can be compared.

**Design** holds: name, product image (optional), dimensions, colors and finishes, production instructions, reference photos, whether it has a dabber, whether it is fumed, and the current selling price per bottle (manager-only).

**Order** holds: order name or number, design, quantity ordered (bottles and dabbers), due date, primary artist, status (Open / Finished / Closed), who finished it and when, who closed it and when, and the financial fields in the Costs section (manager-only).

When an order is created, the design's text specifications are copied into the order. Managers can edit the order's copy for that run; later changes to the design do not rewrite past orders. Photos stay on the design and are shared by all its orders.

**Resources** is the artist-facing view of the order: specifications, instructions, product image and reference photos. Orders remain fully usable with no image.

The **work log** on each order is shared and chronological: every entry shows the artist, date, counts and note. Hours on an entry are shown only to the entry's author and to managers.

## Daily log

One entry per artist, per order, per day. The form opens from the order; artist and order are filled automatically. Fields in the order they appear:

| Field | Behavior |
| --- | --- |
| Work date | Defaults to today; past dates allowed |
| Bottles completed | Optional count |
| Dabbers completed | Optional count; shown only on orders whose design has a dabber |
| Prep: points, color tube preps, blanks | Three optional counts, collapsed under one "Prep" heading |
| Fuming completed | Optional count; shown only on orders whose design is fumed |
| Hours and minutes | Required; 15-minute tap-chips plus free entry |
| Note | Optional free text: packing details, problems, handoffs, unusual work |

After saving, the form offers "Add another order" so an artist who touched three orders logs all three in one sitting.

**Counting definitions**

- A bottle or dabber counts when it is formed and in the kiln that day, counted by the artist who finished it at the bench. Count what you made, not what survived; losses show up at close as ordered vs. delivered.
- Points, color tube preps and blanks count the number made that day.
- Fuming counts pieces fumed that day. A piece may count once as a bottle and once as fumed; the system never adds the counts together.
- Finishing someone else's piece goes under the matching count if one applies (for example fuming), otherwise in the note.

**Editing rules**

- Artists can edit or delete their own entries for 7 days after the work date. Managers can edit any entry at any time.
- Edited entries show an "edited" marker with who and when.
- A save shows a clear confirmation. A failed save keeps the artist's input on screen; a repeated tap cannot create a duplicate entry.

## Time: uAttend and the tracker

uAttend is the timesheet and the source of paid hours. The tracker records how those hours were spent on orders. The two are joined weekly.

- **Weekly import.** A manager exports the Timecard Report from uAttend as CSV and uploads it in the manager portal. The tracker stores clocked hours per artist per day. uAttend's API is not available to US accounts, so this is a manual step; it takes about a minute a week.
- **Reconciliation.** For each artist-day the portal shows clocked hours, hours logged to orders, calendar events, studio time and the unexplained gap. Days with clocked hours and no tracker entry are flagged.
- **Studio time.** Artists may add an optional "Studio time" entry with a category (cleanup and maintenance; general prep not tied to an order; admin, teaching or other) and a note. It explains a gap; it is never required to make a day add up.
- **Labor cost.** Order labor cost uses tracker order hours. The unexplained gap is reported separately so managers can see how much of payroll the order costs do not account for. A studio-wide overhead rate per hour may be added later; it is not in v1.

## Google Calendar sync

Classes, events and some production are scheduled in Google Calendar, with each employee invited at their igniteglass.com address. The tracker reads those invitations so a manager can see why a clocked day has fewer production hours than expected.

- **Connection.** A Google Cloud project is created inside the igniteglass.com Workspace with its consent screen set to Internal, so Google requires no app review and the access key does not expire on a timer. A manager clicks **Connect Google Calendar** in the portal, signs in as info@igniteglass.com, and grants read-only calendar access once. The key is stored server-side; no app user can read it.
- **Read-only, always.** The tracker never creates, edits or deletes calendar events. The permission it asks Google for is read-only, so it could not write even by mistake.
- **Calendars synced:** Flame Shop; General Hot Shop; Hot Shop Bench 1, Bench 2, Bench 3 and Bench 4; Ignite Events Studio Calendar. Managers can change the list. Each must be shared with info@ at "see all event details," otherwise attendees are invisible and matching fails.
- **Sync:** every 30 minutes, 60 days back and 90 days ahead, plus a **Sync now** button. The dashboard shows sync status and a **Reconnect** button if the connection breaks (for example if the app is removed under info@'s Google security settings). A password change on info@ does not break a calendar-only connection.
- **Matching.** An event belongs to a person when their login email, or an alternate email on their profile, is on the invite. Accepted and unanswered invites count; declined ones are shown greyed and not counted. Invites to addresses with no account appear in a manager-only **Unmatched invitees** list, where a manager can map the address to a person or ignore it.
- **What is stored:** title, start, end, calendar name, attendees and their responses. Descriptions and locations are not stored.
- **Who sees it.** Managers see everyone's events in Artist week and Reconciliation. An artist sees only their own events, in My Week.
- **Reconciliation.** For each artist-day: clocked (uAttend) − production hours − calendar hours − studio time = unexplained gap. Calendar hours are capped at clocked hours; all-day events are shown but not counted; a negative result is flagged as over-explained. Scheduled time is an explanation, not a measurement, and the view says so. uAttend remains the timesheet.

## Completion: Finished and Closed

Completion is a deliberate action, never a side effect of counts reaching the ordered quantity. An order moves through three states.

| State | Who sets it | What is recorded |
| --- | --- | --- |
| Open | Manager, at creation | Order details and primary artist |
| Finished | Any artist or manager | Who and when; optional packing note and box dimensions (length × width × height) for the shipping label |
| Closed | Manager only | Delivered bottles and dabbers, selling price (order total), materials cost; who and when |

Rules:

- Finished does not wait on any particular activity. An order whose design is fumed can be finished whether or not fuming counts were logged.
- Delivered quantity, selling price and materials cost are required to close. The system derives price per bottle from the order total.
- Only closed orders appear in pricing reports. Open and finished orders show "financials incomplete" rather than a partial number.
- A manager can reopen a finished or closed order; the reopening is recorded with who and when, and prior completion details are kept in the order history.
- Artists can still add entries to a finished order (for example packing). Entries on a closed order require a manager to reopen it first.

## Materials

An order's materials cost is a manager-maintained total with a short note explaining any allocation from bulk purchases. Two ways money gets there:

1. **Manager entry.** A manager enters or adjusts the total directly.
2. **Artist purchase submission.** When an artist buys materials with management approval, they record it in the app: what was bought, amount, receipt photo (optional), and either the order it was for or "studio stock." The submission is **pending** until a manager approves it. Approved order purchases add to that order's materials cost; approved stock purchases sit in a stock list from which managers allocate portions to orders later. Rejected submissions keep a one-line reason.

Artists see only their own submissions and their status. They never see an order's materials total, the stock list, or any other financial figure.

## Task lists

Two kinds of list, on one **Tasks** tab that everyone has. Tasks are never a step in logging an entry; the daily log form does not mention them.

**Manager-assigned tasks**

- A manager creates a task with a title and optional note, assigns it to one or more people, and may set a priority (High / Normal / Low), a due date, an order link and a recurrence (daily, weekly, every two weeks, monthly). No other fields.
- Each person's list is ordered: overdue first, then priority, then due date, then newest.
- Assignees see who else has the task. Any assignee can mark it done, and it is done for everyone; who and when are recorded. Managers can reopen a task.
- Completing a recurring task creates the next one with the next scheduled date. Only one occurrence is open at a time, and a manager can stop the recurrence.
- A task linked to an order appears on that order's page. The link shows the order's name only.
- Reminders: a push notification at 10 am on the due date, and one more when the task goes overdue. Undated tasks get no reminder.

**Artist's own list**

- Each artist has a personal list for things they notice need doing, by them or by anyone at the studio. Adding an item is one line of text; nothing else is required. The owner can edit or delete items.
- The list is visible to its owner and to managers, never to other artists. Artists are told this during onboarding.
- A manager can approve an item, which turns it into a manager-assigned task with assignees, priority and due date. The item then shows "Approved → task" with who it went to.

**Managers** use the same Tasks tab with a Mine / Everyone switch; the dashboard shows a due-today / overdue strip. Task tables hold no financial fields, and no money, rates or prices are written in task titles or notes.

## Users and permissions

Two roles. The only privacy wall in the system is between them; the three managers see everything, including each other's pay rates.

| Capability | Artist | Manager |
| --- | --- | --- |
| View orders, resources and the shared work log (counts and notes) | Yes | Yes |
| View hours on log entries | Own entries only | Yes |
| Add, edit (7 days) and delete own daily entries | Yes | Yes |
| Edit any entry | No | Yes |
| Contribute to an order without being its primary artist | Yes | Yes |
| Mark an order Finished | Yes | Yes |
| Close or reopen an order | No | Yes |
| Submit a materials purchase | Yes | Yes |
| Approve purchases; maintain materials and stock | No | Yes |
| Create orders, assign primary artists, maintain designs and resources | No | Yes |
| Create and manage accounts; set pay rates | No | Yes |
| Upload uAttend exports; view reconciliation | No | Yes |
| View pay rates, selling prices, labor costs and financial comparisons | No | Yes |
| View own weekly summary (days, counts, hours) | Yes | Yes |
| View all artists' weekly summaries and comparisons | No | Yes |
| Export data (CSV) | No | Yes |
| View and complete tasks assigned to them; see co-assignees | Yes | Yes |
| Create, assign, edit, reopen tasks; set recurrence; view all tasks | No | Yes |
| Keep a personal list | Own only | Yes; sees every artist's list |
| Approve a personal item into an assigned task | No | Yes |
| Connect Google Calendar; choose synced calendars; view everyone's events | No | Yes |
| View own calendar events in My Week | Yes | Yes |

**Enforcement.** Every restriction above is enforced in the database (row-level security), not only in the screens. An artist account cannot obtain pay rates, materials costs, selling prices, computed labor costs or financial comparisons through the interface, direct data requests, photo storage, or exports. An automated test proves this on every code change.

**Accounts.** Managers create accounts (email and password, no self-signup); phones stay signed in. Deactivating an account keeps all of that person's history and freezes their rates as they were.

## Costs and pricing

All fields and results in this section are manager-only.

| Field or result | Definition |
| --- | --- |
| Pay rate | Each worker's hourly rate; every change is dated, and past entries keep the rate in force on their work date |
| Order labor cost | Sum over every contributor of logged order hours × that contributor's rate on that date |
| Materials cost | Manager total plus approved artist purchases allocated to the order |
| Recorded cost | Labor cost + materials cost |
| Selling price | Order total entered at close; price per bottle derived |
| Amount remaining | Selling price − recorded cost, in total and per delivered bottle |
| Hours per bottle | All logged order hours ÷ bottles delivered; dabber hours are not separated, so designs with dabbers run higher and compare only with their own past runs |

Missing inputs are shown as missing, never as zero, and a comparison appears only when its inputs are present. These results are recorded labor and materials against price; they are not net profit after rent, gas, oxygen or other overhead.

**Worked example (test case).** One artist logs 3 hours at $22/hour and another logs 2 hours at $25/hour: labor is $116. With $40 of materials, recorded cost is $156. At a $300 selling price, $144 remains. Delivered quantity 60 bottles gives $2.40 remaining per bottle and 5 minutes of logged time per bottle.

## Reports and views

**Manager views**

| View | Shows |
| --- | --- |
| Today | Who has logged today and who has not; open orders by due date; tasks due today and overdue; calendar sync status |
| Order cost | One order: entries, hours by contributor, labor cost, materials, price, amount remaining |
| Design pricing | One design: every closed run in date order with quantity, hours per bottle, cost per bottle, price per bottle, amount remaining per bottle |
| Artist week | One artist, one week: each day's orders, counts, logged hours, clocked hours (uAttend), calendar events, studio time, tasks completed, and the unexplained gap; blank days flagged |
| Artist by design | One artist's hours per bottle on one design across runs, beside the studio average for that design |
| Reconciliation | All artists for a pay period: clocked, production, calendar, studio and unexplained hours per day, with the uAttend import status; over-explained days flagged |
| Pending approvals | Artist materials submissions awaiting a decision |
| Tasks — Everyone | All open tasks across the studio, filterable by person, order and due date |
| Unmatched invitees | Calendar invite addresses with no tracker account, to map to a person or ignore |

**Artist views**

| View | Shows |
| --- | --- |
| My Work | Orders where they are primary artist, orders they contributed to recently, and search for any other open order |
| My Week | Their own days, orders, counts, hours, calendar events and completed tasks for the current and previous week |
| Tasks | Their assigned tasks in priority order with co-assignees, and their personal list |

No automatic performance score is produced. Comparisons between artists are available to managers only, in the Artist by design view, and are shown per design because designs differ in difficulty.

## Screens

One web app, one set of records. Managers and artists use the same app; the role decides which screens appear. Managers can use it on a phone; the reporting screens are designed for a desktop browser.

**Artist (phone)**

1. **My Work** — assigned orders, recent orders, search, and a count of open tasks; a tap opens an order.
2. **Order** — design, image, quantity, due date, primary artist, status, Resources, open tasks linked to the order, the shared work log, and a prominent "Add today's entry" button.
3. **Add entry** — the daily log form; "Save" then "Add another order."
4. **Tasks** — assigned tasks in priority order, then the personal list with a one-line add box.
5. **Materials purchase** — the submission form and the artist's past submissions.
6. **My Week** — the artist's own summary, including their calendar events and completed tasks.

The path from opening the icon to a saved entry is three taps plus the counts and hours.

**Manager (browser)**

1. **Dashboard** — Today view, pending approvals, tasks due today and overdue, calendar sync status.
2. **Orders** — list, create, edit, assign, finish, close, reopen.
3. **Tasks** — Mine / Everyone; create, assign, set priority, due date, order link and recurrence; approve personal items.
4. **Designs** — list, create, edit specs, photos and price.
5. **People** — accounts, roles, alternate emails, pay rates, deactivation.
6. **Reports** — the manager views above.
7. **Imports** — uAttend upload and import history.
8. **Exports** — CSV of orders, entries, designs, purchases and tasks.
9. **Settings** — Google Calendar connection, synced calendars, unmatched invitees, landing screen.

Each manager chooses their landing screen; Amelia's defaults to Orders. Saved and unsaved states are shown clearly; a saved change is visible to everyone on their next refresh.

## Reminders and building the habit

The tracker is not tied to pay, so the habit has to be built deliberately.

- **From day one:** the Today view shows who has not logged, and the Reconciliation view shows clocked days with no entries. Managers check it daily during the pilot.
- **Before the pilot ends:** push reminders to phones on workdays at a set time (for example 4:30 pm) for artists with clocked hours and no entry. Reminders require the app to be installed on the home screen, which is part of onboarding.
- **Task reminders:** at 10 am on a task's due date and once more when it goes overdue, built in the same session as the daily reminders.
- **Onboarding:** a manager installs the app on each artist's phone in the studio and walks through one entry. Install steps are written for both iPhone (Safari → Share → Add to Home Screen) and Android (Chrome → Install app).
- **What artists are told:** what is recorded (counts per order per day, hours, studio time, tasks, calendar invitations), that managers can see their personal list, and what it is for: pricing and planning first, then seeing where help is needed. Rates are not tied to this data until the numbers are trusted.

## Operations

| Item | Arrangement |
| --- | --- |
| Address | tracker.igniteglass.com, one DNS record (a CNAME) pointing at Cloudflare Pages; the website's records are untouched |
| Hosting | Cloudflare Pages (free); deploys automatically when code is pushed to the GitHub repository |
| Database, sign-in, photos | Supabase Pro ($25/month): daily backups, no pausing |
| Backups | Supabase daily backups plus a monthly CSV export kept by a manager |
| Export | Managers can export orders, entries, designs and purchases as CSV at any time |
| Code | GitHub repository owned by Ignite Glass, with a CLAUDE.md describing the stack, commands and rules |
| Runbook | One page: add or deactivate a user, reset a password, upload uAttend, reconnect Google Calendar, add or remove a synced calendar, restore a backup, what to do if the site is down, and the DNS record to preserve during any website migration |
| Maintenance | A dependency-update session in Claude Code every two to three months |
| Running cost | About $25/month plus the existing Claude plan |
| Calendar connection | A Google Cloud project inside the igniteglass.com Workspace (free, no billing), consent screen Internal, read-only calendar permission granted once by info@igniteglass.com; status and Reconnect in Settings |

## Acceptance criteria

The first release passes when every line is demonstrated.

- [ ] A manager creates an order from a design with quantity, due date and primary artist.
- [ ] The primary artist opens it on a phone and saves an entry with counts and hours in under a minute.
- [ ] Bottles, dabbers, prep counts, fuming and the note are optional and save independently; fuming appears only on fumed designs, dabbers only on designs with one.
- [ ] A second artist finds the order and adds an entry without any per-order approval; the primary assignment is unchanged.
- [ ] The shared log shows both artists' dates, counts and notes; each artist sees hours only on their own entries; managers see all hours.
- [ ] Entries can be logged in any sequence; no stage is required before another.
- [ ] An artist edits their own entry within 7 days and cannot edit it after; a manager edits any entry; the edited marker appears.
- [ ] An artist or manager marks the order Finished with name and time; a manager closes it only after entering delivered quantity, selling price and materials; a manager reopens it and the history is kept.
- [ ] Managers save specifications, price and photos on a design; artists see Resources; an order with no image is fully usable.
- [ ] An artist submits a materials purchase with a receipt photo; it is pending until a manager approves; the approved amount appears in the order's materials cost; the artist never sees the total.
- [ ] A manager uploads a uAttend CSV; the Reconciliation and Artist week views show clocked, logged and gap hours per day, and flag clocked days with no entry.
- [ ] The worked example produces $116 labor, $156 recorded cost, $144 remaining; a rate change after the fact does not alter it.
- [ ] Missing price, materials or rate shows as missing, never as zero, and no comparison appears without its inputs.
- [ ] An artist account cannot obtain pay rates, materials costs, selling prices, labor costs or comparisons through the interface, direct data requests, photo storage or exports; the automated privacy test passes, including the task and calendar tables.
- [ ] Activity counts are never summed into a finished-bottle figure.
- [ ] A saved change is visible on the other device on refresh; a failed or repeated save neither loses nor duplicates an entry.
- [ ] The artist flow works on Freddy's iPhone and Joey's Android; the manager portal works in a desktop browser.
- [ ] A manager creates a task assigned to two artists with a priority and due date; both see it and each other; one completes it and it is done for both, with who and when recorded.
- [ ] A weekly task, once completed, reappears with the next scheduled date, and only one occurrence is open at a time.
- [ ] An artist adds a personal item; another artist cannot see it; a manager approves it and it becomes an assigned task that the artist can see was approved.
- [ ] A task linked to an order appears on the order page and shows the order's name only.
- [ ] The daily-reminder push notification arrives on both phones, and a task reminder arrives at 10 am on a due date (before the pilot ends).
- [ ] A manager connects Google Calendar as info@igniteglass.com and selects the seven studio calendars; an artist's class invitation appears on that day in Artist week and Reconciliation and reduces the unexplained gap; an invite to an unknown address appears in Unmatched invitees; the connection holds no write permission (during the pilot).

## Pilot and rollout

1. **Build** — first working version, including task lists, in Claude Code; the acceptance list above is the test plan.
2. **Pilot** — Joey and Freddy, two weeks, on real orders. Managers log their own production work too. Counting definitions and form order may change during the pilot; the brief is updated to match.
3. **During the pilot** — push reminders (entries and tasks), then the calendar sync; a manager checks each before the review.
4. **Review** — one session: what was skipped, what was confusing, what the reconciliation showed. Fix, then install for the remaining artists in the studio.
5. **Rollout** — everyone, with push reminders on; managers check the Today view daily for the first month.
6. **First pricing review** — after the first ten closed orders, use the Design pricing view and decide whether anything in the cost model needs changing.

## Not in the first version

Proposed later, each with its purpose and effect on the daily workflow before it is added:

- Scrap or reject counts per entry
- A studio overhead rate (gas, oxygen, kiln, rent) added to hours for a fuller cost picture
- Photos attached to a log entry
- Per-activity timing
- Automatic performance scores
- Design versioning beyond the copy-at-creation rule
- Native App Store or Google Play distribution
- Any automatic connection to uAttend, should its API become available to US accounts
- Task comments, attachments or sub-tasks
- Writing anything to Google Calendar
