/**
 * Seed — creates the first accounts and the sample designs and orders.
 *
 * Run with: npm run seed
 *
 * Safe to run more than once: people and rows that already exist are left as
 * they are.  Nothing here sends email.  Accounts are created already
 * confirmed, each with a strong random password that is written to
 * .local/seed-accounts.txt (git-ignored) for the owner to pass on privately.
 *
 * The admin key this needs is fetched from the Supabase CLI (you must be
 * logged in: npx supabase login) and kept in memory only.  It is never written
 * to disk or printed.  (CLAUDE.md rule 9.)
 *
 * Test accounts: the addresses in .env under PRIVACY_TEST_ARTIST_EMAIL and
 * PRIVACY_TEST_MANAGER_EMAIL are created as test-only accounts when they are
 * not one of the real people listed below, and their passwords are written into
 * .env so the privacy test can sign in.  Leave them blank to skip that part.
 */

import { createClient, type User } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: fine when the variables are already set.
}

function fail(message: string): never {
  console.error(`\nSeed stopped: ${message}`)
  process.exit(1)
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? fail('VITE_SUPABASE_URL is missing from .env')
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]

// ---------------------------------------------------------------------------
// Who gets an account
// ---------------------------------------------------------------------------

type Role = 'manager' | 'artist'
type Phone = 'iphone' | 'android' | 'unknown'

interface Person {
  email: string
  fullName: string
  role: Role
  phone: Phone
  homeScreen: 'dashboard' | 'orders'
  /** Used only by the automated tests; never a real person. */
  testOnly: boolean
}

function person(email: string, fullName: string, role: Role, extra: Partial<Person> = {}): Person {
  return { email: email.toLowerCase(), fullName, role, phone: 'unknown', homeScreen: 'dashboard', testOnly: false, ...extra }
}

const PEOPLE: Person[] = [
  person('arvin@igniteglass.com', 'Arvin', 'manager'),
  person('ben@igniteglass.com', 'Ben', 'manager'),
  // Brief: Amelia's home screen defaults to Orders.
  person('amelia@igniteglass.com', 'Amelia', 'manager', { homeScreen: 'orders' }),
  // Pilot artists: Joey on Android, Freddy on iPhone.
  person('joseph@igniteglass.com', 'Joey', 'artist', { phone: 'android' }),
  person('freddy@igniteglass.com', 'Freddy', 'artist', { phone: 'iphone' }),
]

const OWNER_EMAIL = 'arvin@igniteglass.com' // recorded as the creator of the sample rows

const TEST_ARTIST_EMAIL = (process.env.PRIVACY_TEST_ARTIST_EMAIL ?? '').trim().toLowerCase()
const TEST_MANAGER_EMAIL = (process.env.PRIVACY_TEST_MANAGER_EMAIL ?? '').trim().toLowerCase()

function addTestAccount(email: string, role: Role, fullName: string, passwordVar: string): void {
  if (!email) {
    console.log(`  (no ${role} test account: PRIVACY_TEST_${role.toUpperCase()}_EMAIL is blank in .env)`)
    return
  }
  const real = PEOPLE.find((p) => p.email === email)
  if (real) {
    if (real.role !== role) fail(`${email} is a ${real.role}, but .env names it as the privacy test's ${role}`)
    if (!process.env[passwordVar]) {
      console.log(`  note: ${email} is a real person's account; type their password into ${passwordVar} in .env by hand`)
    }
    return
  }
  PEOPLE.push(person(email, fullName, role, { testOnly: true }))
}

// ---------------------------------------------------------------------------
// Sample designs (one order each)
// ---------------------------------------------------------------------------

interface SampleDesign {
  name: string
  hasDabber: boolean
  isFumed: boolean
  dimensions: string
  colorsFinishes: string
  /** Placeholder price per bottle, clearly a sample. */
  price: number
  /** Primary artist on the sample order. */
  primaryArtistEmail: string | null
}

const SAMPLE_NOTE = 'Sample design created by the seed script. Figures are placeholders; edit or deactivate freely.'

const DESIGNS: SampleDesign[] = [
  {
    name: 'Sample: fumed dabber bottle',
    hasDabber: true,
    isFumed: true,
    dimensions: '4 in tall, 2 in wide (sample)',
    colorsFinishes: 'Clear with silver fume (sample)',
    price: 48,
    primaryArtistEmail: 'joseph@igniteglass.com',
  },
  {
    name: 'Sample: dabber bottle',
    hasDabber: true,
    isFumed: false,
    dimensions: '4 in tall, 2 in wide (sample)',
    colorsFinishes: 'Clear with color lip wrap (sample)',
    price: 40,
    primaryArtistEmail: 'freddy@igniteglass.com',
  },
  {
    name: 'Sample: plain bottle',
    hasDabber: false,
    isFumed: false,
    dimensions: '3.5 in tall, 1.75 in wide (sample)',
    colorsFinishes: 'Clear (sample)',
    price: 32,
    primaryArtistEmail: TEST_ARTIST_EMAIL || null,
  },
]

const SAMPLE_RATE_FOR_TEST_ARTIST = 20 // dollars per hour; test account only

// ---------------------------------------------------------------------------
// Admin access, in memory only
// ---------------------------------------------------------------------------

function jwtRole(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    return (JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { role?: string }).role
  } catch {
    return undefined
  }
}

function fetchServiceKey(projectRef: string): string {
  const cli = join('node_modules', 'supabase', 'dist', 'supabase.js')
  if (!existsSync(cli)) fail('the Supabase CLI is not installed; run npm install first')
  const result = spawnSync(
    process.execPath,
    [cli, 'projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status !== 0) {
    fail(
      "could not read the project's keys through the Supabase CLI. Are you logged in (npx supabase login)?\n" +
        result.stderr.trim(),
    )
  }
  let keys: { name?: string; api_key?: string }[]
  try {
    keys = JSON.parse(result.stdout) as { name?: string; api_key?: string }[]
  } catch {
    fail('the Supabase CLI returned something other than JSON for the project keys')
  }
  const key =
    keys.find((k) => k.name === 'service_role')?.api_key ??
    keys.find((k) => k.api_key?.startsWith('sb_secret_'))?.api_key ??
    keys.map((k) => k.api_key ?? '').find((k) => jwtRole(k) === 'service_role')
  if (!key) fail('the Supabase CLI did not return an admin key for this project')
  return key
}

const admin = createClient(SUPABASE_URL, fetchServiceKey(PROJECT_REF), {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newPassword(): string {
  return randomBytes(18).toString('base64url') // 24 characters, safe in .env
}

function isoDatePlusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function setEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`
}

async function listAllUsers(): Promise<Map<string, User>> {
  const users = new Map<string, User>()
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) fail(`could not list accounts: ${error.message}`)
    for (const u of data.users) if (u.email) users.set(u.email.toLowerCase(), u)
    if (data.users.length < 200) break
  }
  return users
}

interface PersonResult {
  person: Person
  id: string
  /** Set only when a password was created or reset this run. */
  password?: string
  status: 'created' | 'exists' | 'exists, password reset'
}

async function ensurePerson(p: Person, existing: Map<string, User>): Promise<PersonResult> {
  const passwordVar = `PRIVACY_TEST_${p.role.toUpperCase()}_PASSWORD`
  let user = existing.get(p.email)
  let password: string | undefined
  let status: PersonResult['status'] = 'exists'

  if (!user) {
    password = newPassword()
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true, // already confirmed: no confirmation email is sent
      user_metadata: { full_name: p.fullName },
    })
    if (error || !data.user) fail(`could not create the account for ${p.email}: ${error?.message ?? 'no user returned'}`)
    user = data.user
    status = 'created'
  } else if (p.testOnly && !process.env[passwordVar]) {
    // A test-only account whose password we no longer know: give it a new one.
    password = newPassword()
    const { error } = await admin.auth.admin.updateUserById(user.id, { password })
    if (error) fail(`could not reset the password for ${p.email}: ${error.message}`)
    status = 'exists, password reset'
  }

  // The profile row is created by a database trigger (inactive by default).
  // Fill it in for new accounts, or for an account that somehow has none.
  const { data: profile, error: readError } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (readError) fail(`could not read the profile for ${p.email}: ${readError.message}`)
  if (status === 'created' || !profile) {
    const { error } = await admin.from('profiles').upsert(
      {
        id: user.id,
        email: p.email,
        full_name: p.fullName,
        role: p.role,
        phone_type: p.phone,
        home_screen: p.homeScreen,
        active: true,
      },
      { onConflict: 'id' },
    )
    if (error) fail(`could not set up the profile for ${p.email}: ${error.message}`)
  }

  return { person: p, id: user.id, password, status }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Seeding project ${PROJECT_REF}\n`)

  console.log('People')
  addTestAccount(TEST_ARTIST_EMAIL, 'artist', 'Test Artist', 'PRIVACY_TEST_ARTIST_PASSWORD')
  addTestAccount(TEST_MANAGER_EMAIL, 'manager', 'Test Manager', 'PRIVACY_TEST_MANAGER_PASSWORD')

  const existing = await listAllUsers()
  const results: PersonResult[] = []
  for (const p of PEOPLE) {
    const r = await ensurePerson(p, existing)
    results.push(r)
    console.log(`  ${r.person.email.padEnd(32)} ${r.person.role.padEnd(8)} ${r.status}`)
  }

  const idOf = (email: string | null): string | null => results.find((r) => r.person.email === email)?.id ?? null
  const ownerId = idOf(OWNER_EMAIL) ?? fail(`${OWNER_EMAIL} is not in the people list`)

  // Passwords: to the local file, and into .env for test-only accounts.
  const withPasswords = results.filter((r) => r.password)
  if (withPasswords.length > 0) {
    mkdirSync('.local', { recursive: true })
    const file = join('.local', 'seed-accounts.txt')
    const lines = [
      `# Accounts created or reset by "npm run seed" on ${new Date().toISOString()}`,
      '# Give each person their password privately (a password manager is best), then delete this file.',
      ...withPasswords.map((r) => `${r.person.email.padEnd(32)} ${r.password}`),
      '',
      '',
    ]
    appendFileSync(file, lines.join('\n'), { encoding: 'utf8' })
    console.log(`\n  Passwords written to ${file} (git-ignored). Never printed here.`)

    const testOnly = withPasswords.filter((r) => r.person.testOnly)
    if (testOnly.length > 0 && existsSync('.env')) {
      let env = readFileSync('.env', 'utf8')
      for (const r of testOnly) {
        const prefix = `PRIVACY_TEST_${r.person.role.toUpperCase()}`
        env = setEnvValue(env, `${prefix}_EMAIL`, r.person.email)
        env = setEnvValue(env, `${prefix}_PASSWORD`, r.password!)
      }
      writeFileSync('.env', env, 'utf8')
      console.log('  Test-account passwords written into .env for the privacy test.')
    }
  }

  // Pay rate for the test artist only (the privacy test needs one row to exist).
  const testArtistId = idOf(TEST_ARTIST_EMAIL)
  if (testArtistId && results.find((r) => r.id === testArtistId)?.person.testOnly) {
    const { data: rates, error } = await admin.from('pay_rates').select('id').eq('profile_id', testArtistId).limit(1)
    if (error) fail(`could not read pay rates: ${error.message}`)
    if ((rates ?? []).length === 0) {
      const { error: insertError } = await admin.from('pay_rates').insert({
        profile_id: testArtistId,
        hourly_rate: SAMPLE_RATE_FOR_TEST_ARTIST,
        effective_from: '2026-01-01',
        created_by: ownerId,
      })
      if (insertError) fail(`could not add the test artist's sample pay rate: ${insertError.message}`)
      console.log('\n  Sample pay rate added for the test artist (real artists get theirs in the app).')
    }
  }

  // Designs, prices and one order each.
  console.log('\nDesigns and orders')
  for (const d of DESIGNS) {
    const { data: found, error: findError } = await admin.from('designs').select('id').ilike('name', d.name).maybeSingle()
    if (findError) fail(`could not look up design "${d.name}": ${findError.message}`)
    let designId = found?.id as string | undefined
    let designStatus = 'exists'
    if (!designId) {
      const { data, error } = await admin
        .from('designs')
        .insert({
          name: d.name,
          dimensions: d.dimensions,
          colors_finishes: d.colorsFinishes,
          instructions: SAMPLE_NOTE,
          has_dabber: d.hasDabber,
          is_fumed: d.isFumed,
          created_by: ownerId,
        })
        .select('id')
        .single()
      if (error || !data) fail(`could not create design "${d.name}": ${error?.message ?? 'no row returned'}`)
      designId = data.id as string
      designStatus = 'created'
    }

    const { data: prices, error: priceError } = await admin.from('design_prices').select('id').eq('design_id', designId).limit(1)
    if (priceError) fail(`could not read prices for "${d.name}": ${priceError.message}`)
    let priceStatus = 'price exists'
    if ((prices ?? []).length === 0) {
      const { error } = await admin.from('design_prices').insert({
        design_id: designId,
        price_per_bottle: d.price,
        effective_from: '2026-01-01',
        created_by: ownerId,
      })
      if (error) fail(`could not add the sample price for "${d.name}": ${error.message}`)
      priceStatus = 'placeholder price added'
    }

    const orderName = `Sample order: ${d.name.replace(/^Sample: /, '')}`
    const { data: order, error: orderFindError } = await admin
      .from('orders')
      .select('id, primary_artist_id')
      .eq('name', orderName)
      .maybeSingle()
    if (orderFindError) fail(`could not look up order "${orderName}": ${orderFindError.message}`)
    let orderStatus = 'order exists'
    const primaryArtistId = idOf(d.primaryArtistEmail)
    if (order && !order.primary_artist_id && primaryArtistId) {
      // The order was created before its primary artist had an account.
      const { error } = await admin.from('orders').update({ primary_artist_id: primaryArtistId }).eq('id', order.id as string)
      if (error) fail(`could not set the primary artist on "${orderName}": ${error.message}`)
      orderStatus = 'order exists, primary artist set'
    }
    if (!order) {
      const { error } = await admin.from('orders').insert({
        name: orderName,
        design_id: designId,
        bottles_ordered: 12,
        dabbers_ordered: d.hasDabber ? 12 : 0,
        due_date: isoDatePlusDays(30),
        primary_artist_id: primaryArtistId,
        created_by: ownerId,
      })
      if (error) fail(`could not create order "${orderName}": ${error.message}`)
      orderStatus = 'order created'
    }
    console.log(`  ${d.name.padEnd(30)} ${designStatus}, ${priceStatus}, ${orderStatus}`)
  }

  // Calendar fixture: one long-past event with every manager invited, so the
  // privacy test's manager login has calendar rows to read and the artist login
  // has rows it must not see.  Calendar tables have no user insert policy, so
  // only this script (or session 8's sync job) can write them.
  console.log('\nCalendar fixture')
  const { data: event, error: eventError } = await admin
    .from('calendar_events')
    .upsert(
      {
        calendar_id: 'seed-fixture',
        calendar_name: 'Seed fixture',
        google_event_id: 'seed-fixture-managers',
        title: 'Seed fixture event (not a real meeting)',
        starts_at: '2000-01-01T15:00:00Z',
        ends_at: '2000-01-01T16:00:00Z',
        all_day: false,
      },
      { onConflict: 'calendar_id,google_event_id' },
    )
    .select('id')
    .single()
  if (eventError || !event) fail(`could not write the calendar fixture: ${eventError?.message ?? 'no row returned'}`)

  const { data: managers, error: managersError } = await admin.from('profiles').select('id, email').eq('role', 'manager')
  if (managersError) fail(`could not list managers: ${managersError.message}`)
  for (const m of managers ?? []) {
    const { error } = await admin.from('calendar_attendees').upsert(
      { event_id: event.id as string, email: m.email as string, response: 'accepted', profile_id: m.id as string },
      { onConflict: 'event_id,email' },
    )
    if (error) fail(`could not add ${m.email} to the calendar fixture: ${error.message}`)
  }
  console.log(`  fixture event in place with ${(managers ?? []).length} manager(s) invited`)

  console.log('\nDone. Reminder: public sign-up must be switched off in Supabase')
  console.log('(Authentication > Sign In / Providers > "Allow new users to sign up"). The privacy test checks it.')
}

main().catch((e: unknown) => fail((e as Error).message))
