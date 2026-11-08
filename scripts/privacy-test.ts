/**
 * Privacy test — proves the database permission rules with real logins.
 *
 * Run with: npm run privacy-test
 *
 * What it does
 *   1. Signs in as the test artist and as a manager (credentials from .env).
 *   2. As the manager, creates a small set of fixture rows: a design, an
 *      order, an entry with hours, financial figures, a purchase, a stock
 *      allocation, a uAttend import, a task assigned to the manager only,
 *      a personal item, a receipt file, and so on.
 *   3. As the artist, tries to read every manager-only table, call every
 *      cost function, download the manager's receipt, read the manager's
 *      hours / purchase / personal item / calendar rows, read the task it is
 *      not assigned to, and change its own role.  Each must return nothing
 *      or be refused.
 *   4. As the manager, performs the same reads and calls.  Each must succeed
 *      with at least one row, so a rule that locks everyone out cannot pass.
 *   5. Confirms public sign-up is switched off, row-level security is switched
 *      on for every table, and no artist-readable table (task, personal-list
 *      and calendar tables included) has a money column.
 *   6. Deletes the fixtures, even when a check fails.
 *
 * Exit code 0 only when every check passes.  Any missing setting, failed
 * sign-in, missing table or function, or failed check exits 1.
 *
 * Rule 2 from CLAUDE.md: this test is only ever run with a real artist login.
 * It refuses to run if the artist account's role is not 'artist'.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: fine when the variables are already set (for example in CI).
}

const missingSettings: string[] = []
function setting(name: string): string {
  const value = process.env[name]
  if (!value) missingSettings.push(name)
  return value ?? ''
}

const SUPABASE_URL = setting('VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = setting('VITE_SUPABASE_ANON_KEY')
const ARTIST_EMAIL = setting('PRIVACY_TEST_ARTIST_EMAIL')
const ARTIST_PASSWORD = setting('PRIVACY_TEST_ARTIST_PASSWORD')
const MANAGER_EMAIL = setting('PRIVACY_TEST_MANAGER_EMAIL')
const MANAGER_PASSWORD = setting('PRIVACY_TEST_MANAGER_PASSWORD')

if (missingSettings.length > 0) {
  console.error('Privacy test cannot run. Missing settings in .env:')
  for (const name of missingSettings) console.error(`  - ${name}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// What the rules must cover.  If a table or function listed here is missing,
// the test fails: a rule cannot be "present" on something that does not exist.
// ---------------------------------------------------------------------------

/** Tables an artist must get nothing from, ever. */
const MANAGER_ONLY_TABLES = [
  'pay_rates',
  'design_prices',
  'order_financials',
  'order_financial_history',
  'stock_allocations',
  'uattend_imports',
  'uattend_days',
  'uattend_names',
  'calendar_connection',
  'calendar_ignored_emails',
] as const

/** Functions only a manager may call. */
const MANAGER_ONLY_FUNCTIONS = ['order_cost', 'design_pricing', 'artist_design_hours'] as const

/** Every table that must exist with row-level security switched on. */
const ALL_TABLES = [
  'profiles', 'pay_rates', 'designs', 'design_prices', 'design_photos',
  'orders', 'order_financials', 'order_financial_history', 'order_events',
  'entries', 'entry_time', 'studio_time',
  'purchases', 'stock_allocations', 'uattend_imports', 'uattend_days', 'uattend_names', 'push_subscriptions',
  'tasks', 'task_assignees', 'personal_items',
  'calendar_connection', 'calendar_events', 'calendar_attendees', 'calendar_ignored_emails',
] as const

/**
 * Tables an artist can read (all rows, own rows, or matched rows).  None of
 * these may carry a money column.  `purchases` is excluded on purpose: an
 * artist sees the amount of their own submissions, by design.
 */
const ARTIST_READABLE_TABLES = [
  'profiles', 'people', 'designs', 'design_photos', 'orders', 'order_events',
  'entries', 'entry_time', 'studio_time', 'push_subscriptions',
  'tasks', 'task_assignees', 'personal_items',
  'calendar_events', 'calendar_attendees',
] as const

const MONEY_WORDS = new Set([
  'price', 'prices', 'cost', 'costs', 'rate', 'rates', 'amount', 'amounts', 'pay', 'paid',
  'wage', 'wages', 'salary', 'dollar', 'dollars', 'usd', 'money', 'fee', 'fees', 'budget',
  'profit', 'margin', 'revenue', 'invoice', 'labor', 'financial', 'financials', 'selling',
])

// ---------------------------------------------------------------------------
// Result bookkeeping
// ---------------------------------------------------------------------------

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${name}${detail ? `  (${detail})` : ''}`)
}

type Reply = { data: unknown; error: { message: string; code?: string } | null }

function rowCount(data: unknown): number {
  if (Array.isArray(data)) return data.length
  return data == null ? 0 : 1
}

/** Errors that mean "this thing does not exist", which must never count as a refusal. */
function isMissingObject(error: { message: string; code?: string }): boolean {
  const text = `${error.code ?? ''} ${error.message}`
  return /42P01|PGRST202|PGRST205|does not exist|Could not find the (table|function)|Bucket not found/i.test(text)
}

/** The artist side: nothing back, or a refusal. */
async function expectDenied(name: string, run: () => PromiseLike<Reply>): Promise<void> {
  try {
    const { data, error } = await run()
    if (error) {
      if (isMissingObject(error)) record(name, false, `MISSING: ${error.message}`)
      else record(name, true, `refused: ${error.message}`)
      return
    }
    const rows = rowCount(data)
    if (rows === 0) record(name, true, 'nothing returned')
    else record(name, false, `LEAK: got ${rows} row(s)`)
  } catch (e) {
    const err = e as { message?: string; code?: string }
    const msg = err.message ?? String(e)
    if (isMissingObject({ message: msg, code: err.code })) record(name, false, `MISSING: ${msg}`)
    else record(name, true, `refused: ${msg}`)
  }
}

/** The manager side (and artist positive checks): must succeed with rows. */
async function expectAllowed(name: string, run: () => PromiseLike<Reply>, minRows = 1): Promise<unknown> {
  try {
    const { data, error } = await run()
    if (error) {
      record(name, false, `error: ${error.message}`)
      return null
    }
    const rows = rowCount(data)
    if (rows < minRows) {
      record(name, false, `expected at least ${minRows} row(s), got ${rows}`)
      return null
    }
    record(name, true, `${rows} row(s)`)
    return data
  } catch (e) {
    record(name, false, `threw: ${(e as Error).message}`)
    return null
  }
}

/** A fixture step that must work; throws so setup stops early with a clear message. */
async function must(what: string, run: () => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Record<string, string>> {
  const { data, error } = await run()
  if (error) throw new Error(`Fixture step failed — ${what}: ${error.message}`)
  if (data == null) throw new Error(`Fixture step returned nothing — ${what}`)
  return data as Record<string, string>
}

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function newClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function signIn(label: string, email: string, password: string): Promise<{ client: SupabaseClient; id: string; role: string; name: string }> {
  const client = newClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    throw new Error(`Could not sign in as the ${label} (${email}): ${error?.message ?? 'no user returned'}`)
  }
  const { data: profile, error: pErr } = await client
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', data.user.id)
    .maybeSingle()
  if (pErr || !profile) {
    throw new Error(`Signed in as the ${label} but could not read its own profile: ${pErr?.message ?? 'no row'}`)
  }
  if (!profile.active) throw new Error(`The ${label} account (${email}) is deactivated`)
  return { client, id: data.user.id, role: profile.role, name: profile.full_name }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Calls the manage-account function directly and returns the HTTP status. */
async function callAccountFunction(token: string, body: unknown): Promise<number> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await response.body?.cancel()
  return response.status
}

async function main(): Promise<number> {
  console.log(`Privacy test against ${SUPABASE_URL}\n`)

  const artist = await signIn('test artist', ARTIST_EMAIL, ARTIST_PASSWORD)
  const manager = await signIn('manager', MANAGER_EMAIL, MANAGER_PASSWORD)

  if (artist.role !== 'artist') {
    throw new Error(`Refusing to run: ${ARTIST_EMAIL} has role '${artist.role}', not 'artist'. The privacy test only runs as a real artist login.`)
  }
  if (manager.role !== 'manager') {
    throw new Error(`${MANAGER_EMAIL} has role '${manager.role}', not 'manager'.`)
  }
  if (artist.id === manager.id) {
    throw new Error('The artist and manager logins are the same account.')
  }
  console.log(`Artist:  ${artist.name} (${ARTIST_EMAIL})`)
  console.log(`Manager: ${manager.name} (${MANAGER_EMAIL})\n`)

  const art = artist.client
  const mgr = manager.client
  const runId = randomUUID().slice(0, 8)
  const today = chicagoToday()

  // Fixture ids, filled in as they are created, used again for cleanup.
  const fx: {
    designId?: string
    designPhotoPath?: string
    orderId?: string
    managerEntryId?: string
    artistEntryId?: string
    purchaseId?: string
    artistPurchaseId?: string
    importId?: string
    uattendName?: string
    ignoredEmail?: string
    managerTaskId?: string
    artistTaskId?: string
    managerItemId?: string
    artistItemId?: string
    studioTimeId?: string
    pushId?: string
    managerReceiptPath?: string
    artistReceiptPath?: string
  } = {}

  try {
    // -----------------------------------------------------------------------
    // Fixtures (as the manager)
    // -----------------------------------------------------------------------
    console.log('--- Creating fixtures as the manager ---')

    const design = await must('create design', () =>
      mgr.from('designs')
        .insert({ name: `Privacy test design ${runId}`, has_dabber: true, is_fumed: true, instructions: 'Test fixture; safe to delete' })
        .select('id').single())
    fx.designId = design.id

    const order = await must('create order', () =>
      mgr.from('orders')
        .insert({ name: `Privacy test order ${runId}`, design_id: fx.designId, bottles_ordered: 60, dabbers_ordered: 60, primary_artist_id: manager.id })
        .select('id, status').single())
    fx.orderId = order.id

    const mEntry = await must('create manager entry', () =>
      mgr.from('entries')
        .insert({ order_id: fx.orderId, artist_id: manager.id, work_date: today, bottles: 5, note: 'fixture' })
        .select('id').single())
    fx.managerEntryId = mEntry.id
    await must('create manager entry_time', () =>
      mgr.from('entry_time').insert({ entry_id: fx.managerEntryId, minutes: 90 }).select('entry_id').single())

    await must('create order_financials', () =>
      mgr.from('order_financials')
        .insert({ order_id: fx.orderId, materials_total: 40, materials_note: 'fixture' })
        .select('order_id').single())

    const purchase = await must('create stock purchase', () =>
      mgr.from('purchases')
        .insert({ artist_id: manager.id, for_stock: true, description: `Privacy test stock purchase ${runId}`, amount: 25 })
        .select('id').single())
    fx.purchaseId = purchase.id
    await must('approve stock purchase', () =>
      mgr.from('purchases').update({ status: 'approved' }).eq('id', fx.purchaseId).select('id').single())
    await must('create stock allocation', () =>
      mgr.from('stock_allocations')
        .insert({ purchase_id: fx.purchaseId, order_id: fx.orderId, amount: 10 })
        .select('id').single())

    const imp = await must('create uattend import', () =>
      mgr.from('uattend_imports').insert({ file_name: `privacy-test-${runId}.csv`, row_count: 1 }).select('id').single())
    fx.importId = imp.id
    await must('create uattend day', () =>
      mgr.from('uattend_days')
        .insert({ artist_id: manager.id, work_date: '2000-01-01', clocked_minutes: 480, import_id: fx.importId })
        .select('id').single())

    fx.uattendName = `Privacy Test ${runId}`
    await must('create uattend name', () =>
      mgr.from('uattend_names')
        .insert({ name_key: fx.uattendName!.toLowerCase(), uattend_name: fx.uattendName, profile_id: manager.id })
        .select('name_key').single())

    fx.ignoredEmail = `privacy-test-${runId}@example.invalid`
    await must('create ignored email', () =>
      mgr.from('calendar_ignored_emails').insert({ email: fx.ignoredEmail }).select('email').single())

    const mTask = await must('create manager-only task', () =>
      mgr.from('tasks').insert({ title: `Privacy test task (manager only) ${runId}` }).select('id').single())
    fx.managerTaskId = mTask.id
    await must('assign manager task', () =>
      mgr.from('task_assignees').insert({ task_id: fx.managerTaskId, profile_id: manager.id }).select('task_id').single())

    const aTask = await must('create artist task', () =>
      mgr.from('tasks').insert({ title: `Privacy test task (artist) ${runId}` }).select('id').single())
    fx.artistTaskId = aTask.id
    await must('assign artist task', () =>
      mgr.from('task_assignees').insert({ task_id: fx.artistTaskId, profile_id: artist.id }).select('task_id').single())

    const mItem = await must('create manager personal item', () =>
      mgr.from('personal_items').insert({ text: `Privacy test personal item ${runId}` }).select('id').single())
    fx.managerItemId = mItem.id

    const st = await must('create manager studio_time', () =>
      mgr.from('studio_time')
        .insert({ artist_id: manager.id, work_date: today, category: 'general_prep', minutes: 30, note: 'fixture' })
        .select('id').single())
    fx.studioTimeId = st.id

    const push = await must('create manager push subscription', () =>
      mgr.from('push_subscriptions')
        .insert({ profile_id: manager.id, endpoint: `https://example.invalid/privacy-test/${runId}`, p256dh: 'fixture', auth: 'fixture' })
        .select('id').single())
    fx.pushId = push.id

    fx.designPhotoPath = `${fx.designId}/privacy-test-${runId}.png`
    await must('upload design photo', () =>
      mgr.storage.from('design-photos').upload(fx.designPhotoPath!, new Blob(['fixture photo'], { type: 'image/png' })))

    fx.managerReceiptPath = `${manager.id}/privacy-test-${runId}.txt`
    await must('upload manager receipt', () =>
      mgr.storage.from('receipts').upload(fx.managerReceiptPath!, new Blob(['fixture receipt'], { type: 'text/plain' })))

    console.log('Fixtures ready.\n')

    // -----------------------------------------------------------------------
    // Artist: things that must work (so a rule set that denies everything
    // cannot pass either)
    // -----------------------------------------------------------------------
    console.log('--- Artist: allowed actions ---')

    await expectAllowed('artist reads designs', () => art.from('designs').select('id').eq('id', fx.designId!))
    await expectAllowed('artist reads orders', () => art.from('orders').select('id, status').eq('id', fx.orderId!))
    await expectAllowed('artist reads order events', () => art.from('order_events').select('id').eq('order_id', fx.orderId!))
    await expectAllowed('artist reads names and roles (people view)', () => art.from('people').select('id, full_name, role'), 2)
    await expectAllowed("artist reads the shared log (manager's counts, not hours)", () =>
      art.from('entries').select('id, bottles, note').eq('id', fx.managerEntryId!))

    const aEntry = await expectAllowed('artist logs an entry on the order', () =>
      art.from('entries').insert({ order_id: fx.orderId, artist_id: artist.id, work_date: today, bottles: 3 }).select('id').single()) as { id: string } | null
    if (aEntry) {
      fx.artistEntryId = aEntry.id
      await expectAllowed('artist records hours on own entry', () =>
        art.from('entry_time').insert({ entry_id: fx.artistEntryId, minutes: 180 }).select('entry_id').single())
      await expectAllowed('artist reads own hours', () =>
        art.from('entry_time').select('minutes').eq('entry_id', fx.artistEntryId!))
    }

    await expectAllowed('artist sees the task assigned to them', () => art.from('tasks').select('id').eq('id', fx.artistTaskId!))
    await expectAllowed('artist sees co-assignees on own task', () => art.from('task_assignees').select('profile_id').eq('task_id', fx.artistTaskId!))
    await expectAllowed('artist completes own task', () => art.rpc('complete_task', { p_task_id: fx.artistTaskId }))

    const aItem = await expectAllowed('artist adds a personal item', () =>
      art.from('personal_items').insert({ text: `Privacy test artist item ${runId}` }).select('id').single()) as { id: string } | null
    if (aItem) fx.artistItemId = aItem.id

    fx.artistReceiptPath = `${artist.id}/privacy-test-${runId}.txt`
    await expectAllowed('artist uploads a receipt into own folder', () =>
      art.storage.from('receipts').upload(fx.artistReceiptPath!, new Blob(['artist receipt'], { type: 'text/plain' })))
    await expectAllowed('artist downloads own receipt', () => art.storage.from('receipts').download(fx.artistReceiptPath!))

    // -----------------------------------------------------------------------
    // Artist: everything that must be refused or return nothing
    // -----------------------------------------------------------------------
    console.log('\n--- Artist: manager-only tables ---')
    for (const table of MANAGER_ONLY_TABLES) {
      await expectDenied(`artist reads ${table}`, () => art.from(table).select('*'))
    }
    await expectDenied('artist reads order_financials for the fixture order', () =>
      art.from('order_financials').select('*').eq('order_id', fx.orderId!))
    await expectDenied('artist reads stock_allocations for the fixture order', () =>
      art.from('stock_allocations').select('*').eq('order_id', fx.orderId!))

    console.log('\n--- Artist: cost functions ---')
    const costArgs: Record<(typeof MANAGER_ONLY_FUNCTIONS)[number], Record<string, unknown>> = {
      order_cost: { p_order_id: fx.orderId },
      design_pricing: { p_design_id: fx.designId },
      artist_design_hours: { p_artist_id: manager.id, p_design_id: fx.designId },
    }
    for (const fn of MANAGER_ONLY_FUNCTIONS) {
      await expectDenied(`artist calls ${fn}`, () => art.rpc(fn, costArgs[fn]))
    }

    console.log("\n--- Artist: other people's rows ---")
    await expectDenied("artist reads another person's hours (entry_time)", () =>
      art.from('entry_time').select('*').eq('entry_id', fx.managerEntryId!))
    await expectDenied("artist reads another person's studio_time", () =>
      art.from('studio_time').select('*').eq('id', fx.studioTimeId!))
    await expectDenied("artist reads another person's purchases", () =>
      art.from('purchases').select('*').eq('id', fx.purchaseId!))
    await expectDenied("artist reads another person's personal_items", () =>
      art.from('personal_items').select('*').eq('id', fx.managerItemId!))
    await expectDenied("artist reads another person's push_subscriptions", () =>
      art.from('push_subscriptions').select('*').eq('id', fx.pushId!))
    await expectDenied("artist reads another person's full profile row", () =>
      art.from('profiles').select('*').eq('id', manager.id))
    await expectDenied('artist reads calendar_events (none matched to them)', () => art.from('calendar_events').select('*'))
    await expectDenied('artist reads calendar_attendees (none are theirs)', () => art.from('calendar_attendees').select('*'))

    console.log('\n--- Purchases and stock ---')
    const ownPurchase = await expectAllowed('artist submits a purchase', () =>
      art.from('purchases')
        .insert({ artist_id: artist.id, for_stock: true, description: `Privacy test artist purchase ${runId}`, amount: 12 })
        .select('id').single())
    fx.artistPurchaseId = (ownPurchase as { id?: string } | null)?.id
    await expectDenied('artist submits a purchase already marked approved', () =>
      art.from('purchases')
        .insert({ artist_id: artist.id, for_stock: true, description: `Privacy test forged ${runId}`, amount: 1, status: 'approved' })
        .select())
    await expectDenied("artist submits a purchase in another person's name", () =>
      art.from('purchases')
        .insert({ artist_id: manager.id, for_stock: true, description: `Privacy test forged ${runId}`, amount: 1 })
        .select())
    await expectDenied('artist reads the stock list', () =>
      art.from('purchases').select('*').eq('for_stock', true).neq('artist_id', artist.id))
    await expectDenied('artist allocates stock to an order', () =>
      art.from('stock_allocations').insert({ purchase_id: fx.purchaseId, order_id: fx.orderId, amount: 1 }).select())
    await expectDenied('artist removes a stock allocation', () =>
      art.from('stock_allocations').delete().eq('order_id', fx.orderId!).select())
    if (fx.artistPurchaseId) {
      await expectDenied('artist approves their own purchase', () =>
        art.from('purchases').update({ status: 'approved' }).eq('id', fx.artistPurchaseId!).select())
      await expectDenied('artist writes a decision reason on their own purchase', () =>
        art.from('purchases').update({ decision_reason: 'approved by me' }).eq('id', fx.artistPurchaseId!).select())
      const { data: stillPending } = await art.from('purchases').select('status').eq('id', fx.artistPurchaseId).maybeSingle()
      record('own purchase is still pending after the attempts', stillPending?.status === 'pending', `status = ${stillPending?.status}`)

      await expectAllowed('manager approves the purchase', () =>
        mgr.from('purchases').update({ status: 'approved' }).eq('id', fx.artistPurchaseId!).select())
      await expectDenied('artist changes the amount after approval', () =>
        art.from('purchases').update({ amount: 999 }).eq('id', fx.artistPurchaseId!).select())
      await expectDenied('artist deletes a purchase after approval', () =>
        art.from('purchases').delete().eq('id', fx.artistPurchaseId!).select())
      await expectDenied('a manager cannot change a decided purchase', () =>
        mgr.from('purchases').update({ amount: 999 }).eq('id', fx.artistPurchaseId!).select())
      await expectDenied('a manager cannot overturn a decided purchase', () =>
        mgr.from('purchases').update({ status: 'rejected', decision_reason: 'privacy test' }).eq('id', fx.artistPurchaseId!).select())
    }

    console.log('\n--- Artist: tasks not assigned to them ---')
    await expectDenied('artist reads a task assigned to someone else', () =>
      art.from('tasks').select('*').eq('id', fx.managerTaskId!))
    await expectDenied("artist reads someone else's task assignees", () =>
      art.from('task_assignees').select('*').eq('task_id', fx.managerTaskId!))
    await expectDenied('artist completes a task not assigned to them', () =>
      art.rpc('complete_task', { p_task_id: fx.managerTaskId }))

    console.log("\n--- Artist: another person's receipt ---")
    await expectDenied("artist downloads the manager's receipt", () =>
      art.storage.from('receipts').download(fx.managerReceiptPath!))
    await expectDenied("artist lists the manager's receipt folder", () =>
      art.storage.from('receipts').list(manager.id))
    await expectDenied("artist signs a URL for the manager's receipt", () =>
      art.storage.from('receipts').createSignedUrl(fx.managerReceiptPath!, 60))
    await expectDenied("artist uploads into the manager's receipt folder", () =>
      art.storage.from('receipts').upload(`${manager.id}/intruder-${runId}.txt`, new Blob(['x'], { type: 'text/plain' })))

    console.log('\n--- Artist: manager-only actions ---')
    await expectDenied('artist calls close_order', () =>
      art.rpc('close_order', { p_order_id: fx.orderId, p_bottles_delivered: 60, p_dabbers_delivered: 60, p_selling_price: 300, p_materials_total: 40 }))
    await expectDenied('artist calls reopen_order', () => art.rpc('reopen_order', { p_order_id: fx.orderId }))
    await expectDenied('artist calls import_uattend', () =>
      art.rpc('import_uattend', {
        p_file_name: 'intruder.csv', p_period_from: '2000-01-02', p_period_to: '2000-01-08',
        p_people: [{ name: fx.uattendName, profile_id: artist.id, days: [{ date: '2000-01-03', minutes: 60, missing_punch: false }] }],
      }))
    await expectDenied('artist calls set_uattend_match', () =>
      art.rpc('set_uattend_match', { p_uattend_name: fx.uattendName, p_profile_id: artist.id }))
    await expectDenied('artist calls approve_personal_item', () =>
      art.rpc('approve_personal_item', { p_item_id: fx.managerItemId, p_assignees: [artist.id] }))
    await expectDenied('artist inserts a pay rate', () =>
      art.from('pay_rates').insert({ profile_id: artist.id, hourly_rate: 1 }).select())
    await expectDenied('artist inserts a design price', () =>
      art.from('design_prices').insert({ design_id: fx.designId, price_per_bottle: 1 }).select())
    await expectDenied('artist inserts order financials', () =>
      art.from('order_financials').insert({ order_id: fx.orderId, selling_price: 1 }).select())
    await expectDenied('artist creates a task', () =>
      art.from('tasks').insert({ title: 'intruder task' }).select())
    await expectDenied('artist creates an order', () =>
      art.from('orders').insert({ name: 'intruder order', design_id: fx.designId }).select())
    await expectDenied('artist creates a design', () =>
      art.from('designs').insert({ name: `intruder design ${runId}` }).select())
    await expectDenied('artist edits a design', () =>
      art.from('designs').update({ name: `intruder design ${runId}` }).eq('id', fx.designId!).select())
    await expectDenied('artist adds a reference photo record', () =>
      art.from('design_photos').insert({ design_id: fx.designId, storage_path: `${fx.designId}/intruder-${runId}.png` }).select())
    await expectDenied('artist uploads to design photos', () =>
      art.storage.from('design-photos').upload(`${fx.designId}/intruder-${runId}.png`, new Blob(['x'], { type: 'image/png' })))
    await expectAllowed('artist views a design photo (Resources)', () => art.storage.from('design-photos').download(fx.designPhotoPath!))
    {
      // A refused delete can look like success, so check the file is still there.
      await art.storage.from('design-photos').remove([fx.designPhotoPath!])
      await expectAllowed('design photo survives an artist trying to delete it', () => mgr.storage.from('design-photos').download(fx.designPhotoPath!))
    }
    await expectDenied('artist reassigns the primary artist directly', () =>
      art.from('orders').update({ primary_artist_id: artist.id }).eq('id', fx.orderId!).select())
    await expectDenied('artist edits the shared order status directly', () =>
      art.from('orders').update({ status: 'closed' }).eq('id', fx.orderId!).select())
    await expectDenied("artist edits another person's entry", () =>
      art.from('entries').update({ bottles: 99 }).eq('id', fx.managerEntryId!).select())
    await expectDenied('artist promotes own account to manager', () =>
      art.from('profiles').update({ role: 'manager' }).eq('id', artist.id).select())

    {
      const { data } = await art.from('profiles').select('role').eq('id', artist.id).maybeSingle()
      record('artist role is still artist after the attempt', data?.role === 'artist', `role = ${data?.role}`)
    }

    // Anyone may finish an open order.
    console.log('\n--- Completion flow ---')
    {
      // Checks the permission itself, not just the sign-in check inside the
      // function: finish_order was rebuilt in 20261106000013.
      const { error } = await newClient().rpc('finish_order', { p_order_id: fx.orderId })
      record('signed-out visitor has no permission to run finish_order', error?.message.includes('permission denied') === true, error?.message ?? 'no error')
    }
    await expectAllowed('artist marks the order Finished', () => art.rpc('finish_order', { p_order_id: fx.orderId }))

    console.log('\n--- Accounts ---')
    await expectDenied('artist adds an alternate email to their own profile', () =>
      art.from('profiles').update({ alternate_emails: ['someone.else@example.com'] }).eq('id', artist.id).select())
    await expectDenied("artist changes a manager's landing screen", () =>
      art.from('profiles').update({ home_screen: 'people' }).eq('id', manager.id).select())
    await expectDenied('manager cannot deactivate their own account', () =>
      mgr.from('profiles').update({ active: false }).eq('id', manager.id).select())
    await expectDenied('manager cannot change their own role', () =>
      mgr.from('profiles').update({ role: 'artist' }).eq('id', manager.id).select())

    // The account function holds the admin key, so it is tested from outside,
    // the way an attacker would call it.  A status is checked, not just "an
    // error", so a function that is missing or broken cannot pass as refused.
    {
      const account = { action: 'create', email: `intruder.${runId}@igniteglass.com`, password: 'not-a-real-password', full_name: 'Intruder', role: 'manager' }
      const artistToken = (await art.auth.getSession()).data.session?.access_token ?? ''
      const managerToken = (await mgr.auth.getSession()).data.session?.access_token ?? ''

      const signedOut = await callAccountFunction(SUPABASE_ANON_KEY, account)
      record('signed-out visitor cannot create a login', signedOut === 401, `status ${signedOut}`)
      const byArtist = await callAccountFunction(artistToken, account)
      record('artist cannot create a login', byArtist === 403, `status ${byArtist}`)
      const resetByArtist = await callAccountFunction(artistToken, { action: 'set-password', id: manager.id, password: 'not-a-real-password' })
      record("artist cannot reset a manager's password", resetByArtist === 403, `status ${resetByArtist}`)
      const outsideEmail = await callAccountFunction(managerToken, { ...account, email: `intruder.${runId}@gmail.com` })
      record('manager cannot create a login outside igniteglass.com', outsideEmail === 400, `status ${outsideEmail}`)
      const { count } = await mgr.from('profiles').select('id', { count: 'exact', head: true }).like('email', `intruder.${runId}%`)
      record('no login was created by those attempts', count === 0, `${count} found`)
    }

    // -----------------------------------------------------------------------
    // Manager: every denied item above must succeed here
    // -----------------------------------------------------------------------
    console.log('\n--- Manager: cost functions and closing ---')
    await expectAllowed('manager calls order_cost', () => mgr.rpc('order_cost', { p_order_id: fx.orderId }))
    await expectDenied('manager cannot close without materials cost', () =>
      mgr.rpc('close_order', { p_order_id: fx.orderId, p_bottles_delivered: 60, p_dabbers_delivered: 60, p_selling_price: 300, p_materials_total: null }))
    await expectDenied('manager cannot close without a selling price', () =>
      mgr.rpc('close_order', { p_order_id: fx.orderId, p_bottles_delivered: 60, p_dabbers_delivered: 60, p_selling_price: null, p_materials_total: 40 }))
    await expectDenied('manager cannot close without delivered quantities', () =>
      mgr.rpc('close_order', { p_order_id: fx.orderId, p_bottles_delivered: null, p_dabbers_delivered: 60, p_selling_price: 300, p_materials_total: 40 }))
    await expectAllowed('manager closes the order (with all required figures)', () =>
      mgr.rpc('close_order', { p_order_id: fx.orderId, p_bottles_delivered: 60, p_dabbers_delivered: 60, p_selling_price: 300, p_materials_total: 40 }))
    await expectAllowed('manager calls design_pricing', () => mgr.rpc('design_pricing', { p_design_id: fx.designId }))
    await expectAllowed('manager calls artist_design_hours', () =>
      mgr.rpc('artist_design_hours', { p_artist_id: manager.id, p_design_id: fx.designId }))
    await expectDenied('artist reads order_financials after close', () =>
      art.from('order_financials').select('*').eq('order_id', fx.orderId!))
    if (fx.artistEntryId) {
      await expectDenied('artist changes own hours on a closed order', () =>
        art.from('entry_time').update({ minutes: 1 }).eq('entry_id', fx.artistEntryId!).select())
      const { data: kept } = await art.from('entry_time').select('minutes').eq('entry_id', fx.artistEntryId!).maybeSingle()
      record('hours on a closed order are unchanged after the attempt', kept?.minutes === 180, `minutes = ${kept?.minutes}`)
    }
    await expectAllowed('manager reopens the order', () => mgr.rpc('reopen_order', { p_order_id: fx.orderId, p_reason: 'privacy test' }))
    await expectDenied('artist reads order_financial_history after reopen', () =>
      art.from('order_financial_history').select('*').eq('order_id', fx.orderId!))

    console.log('\n--- Manager: manager-only tables ---')
    for (const table of MANAGER_ONLY_TABLES) {
      await expectAllowed(`manager reads ${table}`, () => mgr.from(table).select('*'))
    }

    console.log("\n--- Manager: other people's rows ---")
    await expectAllowed("manager reads the artist's hours", () => mgr.from('entry_time').select('*').eq('entry_id', fx.artistEntryId ?? fx.managerEntryId!))
    await expectAllowed("manager reads the artist's personal item", () =>
      mgr.from('personal_items').select('*').eq('id', fx.artistItemId ?? fx.managerItemId!))
    await expectAllowed('manager reads purchases', () => mgr.from('purchases').select('*').eq('id', fx.purchaseId!))
    await expectAllowed('manager reads studio_time', () => mgr.from('studio_time').select('*').eq('id', fx.studioTimeId!))
    await expectAllowed('manager reads push_subscriptions', () => mgr.from('push_subscriptions').select('*').eq('id', fx.pushId!))
    await expectAllowed("manager reads the artist's full profile", () => mgr.from('profiles').select('*').eq('id', artist.id))
    await expectAllowed('manager reads calendar_events', () => mgr.from('calendar_events').select('*'))
    await expectAllowed('manager reads calendar_attendees', () => mgr.from('calendar_attendees').select('*'))
    await expectAllowed('manager reads every task', () => mgr.from('tasks').select('id').in('id', [fx.managerTaskId!, fx.artistTaskId!]), 2)
    await expectAllowed('manager completes a task', () => mgr.rpc('complete_task', { p_task_id: fx.managerTaskId }))
    await expectAllowed("manager downloads the artist's receipt", () => mgr.storage.from('receipts').download(fx.artistReceiptPath!))
    await expectAllowed('manager lists the receipts bucket', () => mgr.storage.from('receipts').list(artist.id))

    // -----------------------------------------------------------------------
    // Structure: RLS on every table, no money columns where artists can read
    // -----------------------------------------------------------------------
    console.log('\n--- Structure ---')
    {
      // Public sign-up must be off.  The app's public key is visible to anyone
      // who opens the site; with sign-up on, a stranger could create an account.
      // (New accounts also start inactive, migration 0010, as a second line.)
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
        const settings = (await res.json()) as { disable_signup?: boolean }
        const off = settings.disable_signup === true
        record(
          'public sign-up is switched off',
          off,
          off ? 'disable_signup = true' : 'turn off "Allow new users to sign up" under Authentication > Sign In / Providers in the Supabase dashboard',
        )
      } catch (e) {
        record('public sign-up is switched off', false, (e as Error).message)
      }
    }
    {
      const { data, error } = await mgr.rpc('rls_status')
      if (error) {
        record('row-level security status is readable', false, error.message)
      } else {
        const rows = (data ?? []) as { table_name: string; rls_enabled: boolean; policy_count: number }[]
        const byName = new Map(rows.map((r) => [r.table_name, r]))
        for (const table of ALL_TABLES) {
          const row = byName.get(table)
          if (!row) record(`table ${table} exists`, false, 'MISSING table')
          else record(`row-level security on ${table}`, row.rls_enabled, `${row.policy_count} policies`)
        }
        for (const row of rows) {
          if (!(ALL_TABLES as readonly string[]).includes(row.table_name)) {
            record(`row-level security on ${row.table_name} (not in the expected list)`, row.rls_enabled, 'add it to ALL_TABLES in privacy-test.ts')
          }
        }
      }
    }
    {
      const { data, error } = await mgr.rpc('table_columns')
      if (error) {
        record('column list is readable', false, error.message)
      } else {
        const cols = (data ?? []) as { table_name: string; column_name: string }[]
        for (const table of ARTIST_READABLE_TABLES) {
          const offenders = cols
            .filter((c) => c.table_name === table)
            .filter((c) => c.column_name.toLowerCase().split('_').some((part) => MONEY_WORDS.has(part)))
            .map((c) => c.column_name)
          const present = cols.some((c) => c.table_name === table)
          if (!present) record(`no money column on ${table}`, false, 'MISSING table')
          else record(`no money column on ${table}`, offenders.length === 0, offenders.length ? `found: ${offenders.join(', ')}` : 'clean')
        }
      }
    }
    // Deactivation is checked last, and the test artist is always switched back on.
    console.log('\n--- Deactivated account ---')
    await must('deactivate the test artist', () => mgr.from('profiles').update({ active: false }).eq('id', artist.id).select('id').single())
    try {
      await expectDenied('deactivated artist reads orders', () => art.from('orders').select('id').limit(1))
      await expectDenied('deactivated artist reads designs', () => art.from('designs').select('id').limit(1))
      await expectDenied('deactivated artist reads the people list', () => art.from('people').select('id').limit(1))
      await expectDenied('deactivated account gets no new pay rate', () =>
        mgr.from('pay_rates').insert({ profile_id: artist.id, hourly_rate: 1, effective_from: '2001-01-01' }).select())
    } finally {
      await must('reactivate the test artist', () => mgr.from('profiles').update({ active: true }).eq('id', artist.id).select('id').single())
    }
    await expectAllowed('reactivated artist reads orders again', () => art.from('orders').select('id').limit(1))
  } finally {
    // -----------------------------------------------------------------------
    // Cleanup (as the manager), best effort, reporting anything left behind
    // -----------------------------------------------------------------------
    console.log('\n--- Cleanup ---')
    const leftovers: string[] = []
    const tidy = async (what: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
      try {
        const { error } = await run()
        if (error) leftovers.push(`${what}: ${error.message}`)
      } catch (e) {
        leftovers.push(`${what}: ${(e as Error).message}`)
      }
    }

    if (fx.orderId) {
      const { data: o } = await mgr.from('orders').select('status').eq('id', fx.orderId).maybeSingle()
      if (o?.status === 'closed') await tidy('reopen order', () => mgr.rpc('reopen_order', { p_order_id: fx.orderId, p_reason: 'privacy test cleanup' }))
      await tidy('entries', () => mgr.from('entries').delete().eq('order_id', fx.orderId!))
      await tidy('stock_allocations', () => mgr.from('stock_allocations').delete().eq('order_id', fx.orderId!))
    }
    for (const id of [fx.purchaseId, fx.artistPurchaseId]) {
      if (id) await tidy('purchase', () => mgr.from('purchases').delete().eq('id', id))
    }
    if (fx.importId) {
      await tidy('uattend_days', () => mgr.from('uattend_days').delete().eq('import_id', fx.importId!))
      await tidy('uattend_import', () => mgr.from('uattend_imports').delete().eq('id', fx.importId!))
    }
    if (fx.uattendName) await tidy('uattend name', () => mgr.from('uattend_names').delete().eq('name_key', fx.uattendName!.toLowerCase()))
    if (fx.ignoredEmail) await tidy('ignored email', () => mgr.from('calendar_ignored_emails').delete().eq('email', fx.ignoredEmail!))
    for (const id of [fx.managerTaskId, fx.artistTaskId]) {
      if (id) await tidy('task', () => mgr.from('tasks').delete().eq('id', id))
    }
    for (const id of [fx.managerItemId, fx.artistItemId]) {
      if (id) await tidy('personal item', () => mgr.from('personal_items').delete().eq('id', id))
    }
    if (fx.studioTimeId) await tidy('studio_time', () => mgr.from('studio_time').delete().eq('id', fx.studioTimeId!))
    if (fx.pushId) await tidy('push subscription', () => mgr.from('push_subscriptions').delete().eq('id', fx.pushId!))
    const paths = [fx.managerReceiptPath, fx.artistReceiptPath, `${manager.id}/intruder-${runId}.txt`].filter((p): p is string => Boolean(p))
    if (paths.length) await tidy('receipt files', () => mgr.storage.from('receipts').remove(paths))
    if (fx.designPhotoPath) await tidy('design photo', () => mgr.storage.from('design-photos').remove([fx.designPhotoPath!, `${fx.designId}/intruder-${runId}.png`]))
    if (fx.orderId) await tidy('order', () => mgr.from('orders').delete().eq('id', fx.orderId!))
    if (fx.designId) await tidy('design', () => mgr.from('designs').delete().eq('id', fx.designId!))

    if (leftovers.length) {
      record('fixtures cleaned up', false, leftovers.join('; '))
    } else {
      console.log('Fixtures removed.')
    }

    await art.auth.signOut()
    await mgr.auth.signOut()
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`)
  if (failed.length) {
    console.log('\nFAILED:')
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `  (${f.detail})` : ''}`)
    console.log('\nPRIVACY TEST FAILED')
    return 1
  }
  console.log('\nPRIVACY TEST PASSED')
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(`\nPRIVACY TEST FAILED: ${(e as Error).message}`)
    process.exit(1)
  })
