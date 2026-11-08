# Ignite Glass Production Tracker

Installable web app for the Ignite Glass studio. Artists log what they produced
on each order each day; managers price designs from real costs.

- Specification: [docs/brief-v2.md](docs/brief-v2.md)
- Build plan: [docs/build-plan.md](docs/build-plan.md)
- Rules for Claude Code: [CLAUDE.md](CLAUDE.md)

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app locally |
| `npm run build` | Production build into `dist/` |
| `npm run test` | Privacy test, then the screen tests |
| `npm run privacy-test` | Prove the permission rules with a real artist login |
| `npm run ui-test` | Playwright screen tests in a phone-sized browser (needs `npx playwright install chromium` once) |
| `npm run seed` | Create the seed accounts, designs and orders |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npx supabase functions deploy manage-account --project-ref <ref> --use-api` | Deploy the account function that creates logins and sets passwords (managers only) |

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the Supabase values.
3. `npx supabase login`, then `npx supabase link --project-ref <ref>`.
4. `npm run db:push`
