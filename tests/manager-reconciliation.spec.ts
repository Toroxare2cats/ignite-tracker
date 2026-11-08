import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Reconciliation (brief: Time; CLAUDE.md rule 13).  The week of 7 January 2001,
 * for the Test Artist, with uAttend hours saved through import_uattend and
 * entries planted by the manager:
 *
 *   Mon  clocked 8:00, logged 6:00            -> gap 2h
 *   Tue  clocked 6:30, nothing logged         -> flagged "No entry", gap 6h 30m
 *   Wed  clocked 0,    nothing logged         -> nothing to explain
 *   Thu  missing punch                        -> "Missing punch", never 0, no gap
 *   Fri  clocked 4:15, logged 5:00            -> over-explained by 45m, shown
 *   Sun, Sat clocked 0
 *
 * Week total: clocked and gap are missing because Thursday cannot be compared.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const FROM = '2001-01-07'
const TO = '2001-01-13'

async function tidy(mgr: SupabaseClient, artistId: string, orderId: string | null, designId: string | null): Promise<void> {
  await mgr.from('uattend_days').delete().eq('artist_id', artistId).gte('work_date', FROM).lte('work_date', TO)
  const { data: imports } = await mgr.from('uattend_imports').select('id').eq('period_from', FROM).eq('period_to', TO)
  const ids = ((imports ?? []) as { id: string }[]).map((i) => i.id)
  if (ids.length > 0) await mgr.from('uattend_imports').delete().in('id', ids)
  await mgr.from('uattend_names').delete().eq('name_key', 'reconciliation test')
  if (orderId) {
    await mgr.from('entries').delete().eq('order_id', orderId)
    await mgr.from('orders').delete().eq('id', orderId)
  }
  if (designId) await mgr.from('designs').delete().eq('id', designId)
}

test('reconciliation shows clocked, logged and gap hours per day, flags blank days and shows over-explained days', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  await tidy(mgr, artistId, null, null)

  const { data: design, error: dErr } = await mgr.from('designs').insert({ name: `Reconciliation test design ${run}` }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  const designId = (design as { id: string }).id
  const { data: order, error: oErr } = await mgr
    .from('orders')
    .insert({ name: `Reconciliation test order ${run}`, design_id: designId, bottles_ordered: 10, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  if (oErr) throw new Error(oErr.message)
  const orderId = (order as { id: string }).id

  try {
    const { error: iErr } = await mgr.rpc('import_uattend', {
      p_file_name: 'reconciliation-test.csv',
      p_period_from: FROM,
      p_period_to: TO,
      p_people: [
        {
          name: 'Reconciliation Test',
          profile_id: artistId,
          days: [
            { date: '2001-01-08', minutes: 480, missing_punch: false },
            { date: '2001-01-09', minutes: 390, missing_punch: false },
            { date: '2001-01-11', minutes: null, missing_punch: true },
            { date: '2001-01-12', minutes: 255, missing_punch: false },
          ],
        },
      ],
    })
    if (iErr) throw new Error(iErr.message)

    const { data: entries, error: eErr } = await mgr
      .from('entries')
      .insert([
        { order_id: orderId, artist_id: artistId, work_date: '2001-01-08', bottles: 4, note: 'reconciliation fixture' },
        { order_id: orderId, artist_id: artistId, work_date: '2001-01-12', bottles: 3 },
      ])
      .select('id, work_date')
    if (eErr) throw new Error(eErr.message)
    const rows = entries as { id: string; work_date: string }[]
    const { error: tErr } = await mgr.from('entry_time').insert([
      { entry_id: rows.find((r) => r.work_date === '2001-01-08')!.id, minutes: 360 },
      { entry_id: rows.find((r) => r.work_date === '2001-01-12')!.id, minutes: 300 },
    ])
    if (tErr) throw new Error(tErr.message)

    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click()
    await page.getByRole('link', { name: /^Reconciliation/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Reconciliation' })).toBeVisible()

    // A week with no upload says so instead of showing zeros.
    await page.goto('/manage/reports/reconciliation?week=2000-01-02')
    await expect(page.getByTestId('import-status')).toContainText('No uAttend upload covers')

    await page.goto(`/manage/reports/reconciliation?week=${FROM}`)
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('Jan 7 – Jan 13, 2001')
    await expect(page.getByTestId('import-status')).toContainText('uAttend upload: Jan 7 – Jan 13, 2001')

    // Week totals: the artist's clocked total and gap are missing because of Thursday.
    const totals = page.getByTestId('week-totals')
    const artistTotals = totals.getByRole('row', { name: /^Test Artist/ })
    await expect(artistTotals).toContainText('Missing punch')
    await expect(artistTotals).toContainText('11h') // 6h + 5h on orders
    await expect(artistTotals).toContainText('1 day no entry')
    await expect(artistTotals).toContainText('1 over-explained')

    // Day by day.
    const days = page.getByRole('region', { name: 'Test Artist, day by day' })
    const row = (name: string) => days.getByRole('row', { name: new RegExp(`^${name}`) })
    await expect(row('Mon, Jan 8')).toContainText('8h')
    await expect(row('Mon, Jan 8')).toContainText('6h')
    await expect(row('Mon, Jan 8')).toContainText('2h')
    await expect(row('Tue, Jan 9')).toContainText('6h 30m')
    await expect(row('Tue, Jan 9')).toContainText('No entry')
    await expect(row('Wed, Jan 10')).not.toContainText('No entry')
    await expect(row('Thu, Jan 11').getByRole('cell').nth(1)).toHaveText('Missing punch') // clocked, never 0
    await expect(row('Thu, Jan 11').getByRole('cell').nth(5)).toHaveText('—') // no gap without a clocked figure
    await expect(row('Fri, Jan 12')).toContainText('Over-explained by 45m')

    // A day opens to show what was logged.
    await days.getByRole('button', { name: /Mon, Jan 8/ }).click()
    await expect(days.getByRole('link', { name: `Reconciliation test order ${run}` })).toBeVisible()
    await expect(days.getByText('4 bottles')).toBeVisible()
    await shot(page, '32-reconciliation')

    // Phone width: the same report stacks without sideways scrolling.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(days.getByText('Over-explained by 45m')).toBeVisible()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(390)
    await shot(page, '33-reconciliation-phone')
  } finally {
    await tidy(mgr, artistId, orderId, designId)
  }
})
