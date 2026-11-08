import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Artist week and Artist by design (brief: Reports and views).
 *
 * Artist week, Test Artist, the week of 7 January 2001:
 *   Mon  clocked 8:00, logged 6:00 with 4 bottles -> gap 2h
 *   Tue  clocked 6:30, nothing logged            -> flagged
 *   Fri  clocked 4:15, logged 5:00 with 3 bottles -> over-explained by 45m
 *
 * Artist by design, on a closed 60-bottle run: Test Artist 3h and Test
 * Manager 2h -> the artist is at 3 min per bottle, the studio at 5.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const FROM = '2001-01-07'
const TO = '2001-01-13'

async function clearWeek(mgr: SupabaseClient, artistId: string): Promise<void> {
  await mgr.from('uattend_days').delete().eq('artist_id', artistId).gte('work_date', FROM).lte('work_date', TO)
  const { data: imports } = await mgr.from('uattend_imports').select('id').eq('period_from', FROM).eq('period_to', TO)
  const ids = ((imports ?? []) as { id: string }[]).map((i) => i.id)
  if (ids.length > 0) await mgr.from('uattend_imports').delete().in('id', ids)
  await mgr.from('uattend_names').delete().eq('name_key', 'artist week test')
}

test('Artist week shows one artist’s days with counts, hours, clocked hours and the gap', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  await clearWeek(mgr, artistId)

  const { data: design } = await mgr.from('designs').insert({ name: `Artist week design ${run}` }).select('id').single()
  const designId = (design as { id: string }).id
  const { data: order } = await mgr
    .from('orders')
    .insert({ name: `Artist week order ${run}`, design_id: designId, bottles_ordered: 10, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  const orderId = (order as { id: string }).id

  try {
    const { error: iErr } = await mgr.rpc('import_uattend', {
      p_file_name: 'artist-week-test.csv',
      p_period_from: FROM,
      p_period_to: TO,
      p_people: [
        {
          name: 'Artist Week Test',
          profile_id: artistId,
          days: [
            { date: '2001-01-08', minutes: 480, missing_punch: false },
            { date: '2001-01-09', minutes: 390, missing_punch: false },
            { date: '2001-01-12', minutes: 255, missing_punch: false },
          ],
        },
      ],
    })
    if (iErr) throw new Error(iErr.message)
    const { data: entries, error: eErr } = await mgr
      .from('entries')
      .insert([
        { order_id: orderId, artist_id: artistId, work_date: '2001-01-08', bottles: 4, points: 2 },
        { order_id: orderId, artist_id: artistId, work_date: '2001-01-12', bottles: 3, note: 'artist week fixture' },
      ])
      .select('id, work_date')
    if (eErr) throw new Error(eErr.message)
    const rows = entries as { id: string; work_date: string }[]
    await mgr.from('entry_time').insert([
      { entry_id: rows.find((r) => r.work_date === '2001-01-08')!.id, minutes: 360 },
      { entry_id: rows.find((r) => r.work_date === '2001-01-12')!.id, minutes: 300 },
    ])

    await signInAsManager(page)
    await page.goto('/manage/reports/artist-week')
    await expect(page.getByRole('heading', { level: 1, name: 'Artist week' })).toBeVisible()
    await page.getByLabel('Person').selectOption({ label: 'Test Artist' })
    await expect(page).toHaveURL(new RegExp(`/manage/reports/artist-week/${artistId}$`))
    await page.goto(`/manage/reports/artist-week/${artistId}?week=${FROM}`)
    await expect(page.getByRole('group', { name: 'Week' })).toContainText('Jan 7 – Jan 13, 2001')

    const totals = page.getByTestId('week-totals')
    await expect(totals).toContainText('18h 45m') // clocked
    await expect(totals).toContainText('11h') // on orders
    await expect(totals).toContainText('7h 45m') // unexplained
    await expect(totals).toContainText('1 clocked day has no entry')
    const counts = page.getByTestId('week-counts')
    await expect(counts.getByRole('listitem').filter({ hasText: 'Bottles' })).toContainText('7')
    await expect(counts.getByRole('listitem').filter({ hasText: 'Points' })).toContainText('2')
    await expect(counts).not.toContainText('9') // bottles and points are never added together

    const day = (name: string) => page.getByRole('region', { name })
    await expect(day('Mon, Jan 8')).toContainText('8h')
    await expect(day('Mon, Jan 8')).toContainText('4 bottles, 2 points')
    await expect(day('Mon, Jan 8')).toContainText('2h')
    await expect(day('Tue, Jan 9')).toContainText('No entry')
    await expect(day('Tue, Jan 9')).toContainText('Clocked in, nothing logged')
    await expect(day('Fri, Jan 12')).toContainText('Over-explained by 45m')
    await expect(day('Fri, Jan 12')).toContainText('artist week fixture')
    await shot(page, '37-artist-week')

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(day('Fri, Jan 12')).toContainText('Over-explained by 45m')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, '38-artist-week-phone')
  } finally {
    await clearWeek(mgr, artistId)
    await mgr.from('entries').delete().eq('order_id', orderId)
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
  }
})

test('Artist by design shows one artist’s minutes per bottle beside the studio figure, per run', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)

  const { data: design } = await mgr.from('designs').insert({ name: `By design test ${run}` }).select('id').single()
  const designId = (design as { id: string }).id
  const { data: order } = await mgr
    .from('orders')
    .insert({ name: `By design run ${run}`, design_id: designId, bottles_ordered: 60, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  const orderId = (order as { id: string }).id

  try {
    const { data: entries, error: eErr } = await mgr
      .from('entries')
      .insert([
        { order_id: orderId, artist_id: artistId, work_date: '2001-01-02', bottles: 40 },
        { order_id: orderId, artist_id: managerId, work_date: '2001-01-02', bottles: 20 },
      ])
      .select('id, artist_id')
    if (eErr) throw new Error(eErr.message)
    const rows = entries as { id: string; artist_id: string }[]
    await mgr.from('entry_time').insert([
      { entry_id: rows.find((r) => r.artist_id === artistId)!.id, minutes: 180 },
      { entry_id: rows.find((r) => r.artist_id === managerId)!.id, minutes: 120 },
    ])
    await mgr.rpc('finish_order', { p_order_id: orderId })
    const { error: cErr } = await mgr.rpc('close_order', { p_order_id: orderId, p_bottles_delivered: 60, p_dabbers_delivered: 0, p_selling_price: 300, p_materials_total: 40 })
    if (cErr) throw new Error(cErr.message)

    await signInAsManager(page)
    await page.goto('/manage/reports/artist-by-design')
    await expect(page.getByRole('heading', { level: 1, name: 'Artist by design' })).toBeVisible()
    await page.getByLabel('Person').selectOption(artistId)
    await page.getByLabel('Design').selectOption(designId)

    const summary = page.getByTestId('abd-summary')
    await expect(summary).toContainText('3 min')
    await expect(summary).toContainText('5 min')
    const row = page.getByTestId('abd-runs').getByRole('row', { name: new RegExp(`By design run ${run}`) })
    await expect(row).toContainText('60')
    await expect(row).toContainText('3h')
    await expect(row).toContainText('3 min')
    await expect(row).toContainText('5h')
    await expect(row).toContainText('5 min')
    await shot(page, '39-artist-by-design')

    // The other contributor sees their own figure against the same studio figure.
    await page.getByLabel('Person').selectOption(managerId)
    await expect(summary).toContainText('2 min')
    await expect(summary).toContainText('5 min')
  } finally {
    const { data: o } = await mgr.from('orders').select('status').eq('id', orderId).maybeSingle()
    if (o?.status === 'closed') await mgr.rpc('reopen_order', { p_order_id: orderId, p_reason: 'test cleanup' })
    await mgr.from('entries').delete().eq('order_id', orderId)
    await mgr.from('order_financial_history').delete().eq('order_id', orderId)
    await mgr.from('order_financials').delete().eq('order_id', orderId)
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
  }
})
