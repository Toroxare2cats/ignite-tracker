import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { shot, signInAsArtist } from './helpers.ts'

/**
 * Editing rules (brief, "Editing rules"): an artist edits or deletes their own
 * entries for 7 days after the work date and no longer; edited entries show
 * who and when; a manager edits any entry.
 *
 * To test the "older than 7 days" case the test manager account plants an
 * old entry for the test artist (the artist account cannot create one, which
 * is itself the rule under test).
 */

function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing from .env`)
  return value
}

function chicagoDate(daysAgo: number): string {
  const now = new Date(Date.now() - daysAgo * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

async function managerClient(): Promise<SupabaseClient> {
  const client = createClient(need('VITE_SUPABASE_URL'), need('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: need('PRIVACY_TEST_MANAGER_EMAIL'),
    password: need('PRIVACY_TEST_MANAGER_PASSWORD'),
  })
  if (error) throw new Error(`manager sign-in failed: ${error.message}`)
  return client
}

test('artist edits a recent entry (marker appears) and cannot change one older than 7 days', async ({ page }) => {
  const mgr = await managerClient()
  const { data: artistRow } = await mgr.from('profiles').select('id').eq('email', need('PRIVACY_TEST_ARTIST_EMAIL')).single()
  const artistId = (artistRow as { id: string }).id
  const { data: orderRow } = await mgr.from('orders').select('id, name').ilike('name', '%plain bottle%').neq('status', 'closed').limit(1).single()
  const order = orderRow as { id: string; name: string }

  // Fixtures: one entry 2 days ago (editable) and one 10 days ago (locked).
  const recentDate = chicagoDate(2)
  const oldDate = chicagoDate(10)
  await mgr.from('entries').delete().eq('order_id', order.id).eq('artist_id', artistId).in('work_date', [recentDate, oldDate])
  const { data: inserted, error } = await mgr
    .from('entries')
    .insert([
      { order_id: order.id, artist_id: artistId, work_date: recentDate, bottles: 2, note: 'fixture recent' },
      { order_id: order.id, artist_id: artistId, work_date: oldDate, bottles: 5, note: 'fixture old' },
    ])
    .select('id, work_date')
  if (error) throw new Error(error.message)
  const rows = inserted as { id: string; work_date: string }[]
  const recentId = rows.find((r) => r.work_date === recentDate)!.id
  const oldId = rows.find((r) => r.work_date === oldDate)!.id
  await mgr.from('entry_time').insert([
    { entry_id: recentId, minutes: 60 },
    { entry_id: oldId, minutes: 120 },
  ])

  try {
    await signInAsArtist(page)

    // Recent entry: editable, and the edited marker appears after saving.
    await page.goto(`/entries/${recentId}`)
    await expect(page.getByRole('heading', { name: 'Edit your entry' })).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Bottles completed' })).toHaveValue('2')
    await page.getByRole('spinbutton', { name: 'Bottles completed' }).fill('3')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { name: 'Changes saved' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to this order' }).click()
    const row = page.locator('.log-entry', { hasText: 'fixture recent' })
    await expect(row).toContainText('3 bottles')
    await expect(row).toContainText('Edited by you')
    await shot(page, '04-edited-marker')

    // Old entry: shown read-only in the app...
    await page.goto(`/entries/${oldId}`)
    await expect(page.getByText(/older, so it is read-only/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete this entry' })).toHaveCount(0)
    await shot(page, '04-old-entry-locked')

    // ...and the database itself refuses a change from the artist's session.
    const refused = await page.evaluate(async ({ id, url, key }) => {
      const raw = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const token = raw ? (JSON.parse(localStorage.getItem(raw)!) as { access_token: string }).access_token : null
      const res = await fetch(`${url}/rest/v1/entries?id=eq.${id}`, {
        method: 'PATCH',
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ bottles: 99 }),
      })
      const body = (await res.json()) as unknown[]
      return { status: res.status, updated: Array.isArray(body) ? body.length : -1 }
    }, { id: oldId, url: need('VITE_SUPABASE_URL'), key: need('VITE_SUPABASE_ANON_KEY') })
    expect(refused.updated).toBe(0)

    const { data: still } = await mgr.from('entries').select('bottles').eq('id', oldId).single()
    expect((still as { bottles: number }).bottles).toBe(5)

    // Delete the recent entry from the app.
    await page.goto(`/entries/${recentId}`)
    await page.getByRole('button', { name: 'Delete this entry' }).click()
    await page.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText(order.name)
    await expect(page.locator('.log-entry', { hasText: 'fixture recent' })).toHaveCount(0)
  } finally {
    await mgr.from('entries').delete().in('id', [recentId, oldId])
    await mgr.auth.signOut()
  }
})
