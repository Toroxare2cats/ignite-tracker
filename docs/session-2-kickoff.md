# Session 2 kickoff prompt

How to use this: in the Claude desktop app's Code tab, start a new session in this same folder (`Ignite.Tracker_`). Copy everything from "We are continuing" to "Do not start session 3" into the message box and send it. A new session does not remember the previous conversation, but it reads CLAUDE.md automatically and the prompt tells it where to look for the rest.

---

We are continuing the Ignite Glass production tracker. I am not a developer; explain each step in plain language and ask me one question at a time when you need something from me.

Read CLAUDE.md, docs/brief-v2.md and docs/build-plan.md fully before doing anything, and look at the existing code and migrations so you build on them. Session 1 (Foundation) is finished: the database and its privacy rules, the privacy test, the seed accounts, the sign-in screen and the Cloudflare deployment all exist. The app is live at https://ignite-tracker.pages.dev and every push to main redeploys it. Do not redo session 1 work.

This is session 2, "Artist flow," from the build plan. Build the artist screens described in the brief's "Screens," "Daily log," and "Materials" sections, checking in with me at each numbered step:

1. My Work: assigned orders, recent orders, search, and a count of open tasks (the count may read zero until session 5); a tap opens an order.
2. Order: design, image, quantity, due date, primary artist, status, Resources (specifications, instructions, product image, reference photos), the shared work log, and a prominent "Add today's entry" button. Hours on a log entry are visible only to the entry's author and to managers.
3. Add entry: the daily log form exactly as the brief's "Daily log" table describes. Fields follow the design (dabbers only when the design has a dabber, fuming only when it is fumed), the three Prep counts sit collapsed under one heading, hours use 15-minute tap-chips plus free entry, a save shows a clear confirmation, a repeated tap cannot create a duplicate, a failed save keeps what was typed, and "Add another order" appears after saving. Any signed-in artist can log on any order.
4. Editing: artists edit or delete their own entries for 7 days after the work date; edited entries show who edited and when.
5. My Week: the artist's own weekly summary. Calendar events and completed tasks in it can wait for sessions 5 and 8.
6. Materials purchase: the submission form (what was bought, amount, optional receipt photo, the order it was for or "studio stock") and the artist's past submissions with their status. Artists never see any money figure other than their own submissions.
7. Make the app installable with an icon on both iPhone and Android (web app manifest, icons, full-screen launch), and walk me through installing it on my phone.
8. Run the privacy test before every push; it must still pass. Push to main after each step so the live address updates.

You may add new packages this session needs (for example Playwright for screen tests); do not update existing ones.

Done when: I can install the app on my phone from the live address, log an entry on a sample order in under a minute, see it in the order's log, and get refused when I try, as an artist, to edit an entry older than 7 days. Do not start session 3.
