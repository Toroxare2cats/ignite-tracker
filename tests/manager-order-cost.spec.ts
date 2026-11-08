import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Order cost report (brief: Costs and pricing, worked example).  A closed order
 * with 3 hours at $22 (Test Artist) and 2 hours at $25 (Test Manager), $40
 * materials and a $300 price must show labor $116, recorded cost $156, amount
 * remaining $144, with $66 and $50 by contributor.  Before the close, the money
 * shows as "Financials incomplete" rather than partial numbers.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const RATE_DATE = '2001-01-01'
const WORK_DATE = '2001-01-02'

test('Order cost shows the worked example by contributor and as a whole', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)

  for (const [person, rate] of [[artistId, 22], [managerId, 25]] as const) {
    const { data: found } = await mgr.from('pay_rates').select('id').eq('profile_id', person).eq('effective_from', RATE_DATE).eq('hourly_rate', rate)
    if ((found ?? []).length === 0) {
      const { error } = await mgr.from('pay_rates').insert({ profile_id: person, hourly_rate: rate, effective_from: RATE_DATE })
      if (error) throw new Error(error.message)
    }
  }

  const { data: design, error: dErr } = await mgr.from('designs').insert({ name: `Order cost test design ${run}` }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  const designId = (design as { id: string }).id
  const { data: order, error: oErr } = await mgr
    .from('orders')
    .insert({ name: `Order cost test order ${run}`, design_id: designId, bottles_ordered: 60, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  if (oErr) throw new Error(oErr.message)
  const orderId = (order as { id: string }).id

  try {
    const { data: entries, error: eErr } = await mgr
      .from('entries')
      .insert([
        { order_id: orderId, artist_id: artistId, work_date: WORK_DATE, bottles: 40, note: 'worked example' },
        { order_id: orderId, artist_id: managerId, work_date: WORK_DATE, bottles: 20 },
      ])
      .select('id, artist_id')
    if (eErr) throw new Error(eErr.message)
    const rows = entries as { id: string; artist_id: string }[]
    const { error: tErr } = await mgr.from('entry_time').insert([
      { entry_id: rows.find((r) => r.artist_id === artistId)!.id, minutes: 180 },
      { entry_id: rows.find((r) => r.artist_id === managerId)!.id, minutes: 120 },
    ])
    if (tErr) throw new Error(tErr.message)

    await signInAsManager(page)
    await page.goto('/manage/reports/order-cost')
    await expect(page.getByRole('heading', { level: 1, name: 'Order cost' })).toBeVisible()
    await page.getByLabel('Search orders').fill(run)
    await page.getByRole('link', { name: `Order cost test order ${run}` }).click()
    await expect(page.getByRole('heading', { level: 1, name: `Order cost test order ${run}` })).toBeVisible()

    // Open: hours by contributor, but no money yet.
    await expect(page.getByTestId('cost-card')).toContainText('Financials incomplete')
    const contributors = page.getByTestId('contributors')
    await expect(contributors.getByRole('row', { name: /^Test Artist/ })).toContainText('3h')
    await expect(contributors.getByRole('row', { name: /^Test Artist/ })).toContainText('$66.00')
    await expect(contributors.getByRole('row', { name: /^Test Manager/ })).toContainText('2h')
    await expect(contributors.getByRole('row', { name: /^Test Manager/ })).toContainText('$50.00')
    await expect(contributors.getByRole('row', { name: /^Total/ })).toContainText('5h')
    await expect(contributors.getByRole('row', { name: /^Total/ })).toContainText('$116.00')
    await expect(page.getByTestId('entries').getByRole('row')).toHaveCount(3) // heading plus two entries
    await expect(page.getByTestId('entries')).toContainText('40 bottles')
    await expect(page.getByTestId('entries')).toContainText('worked example')

    // Closed with the worked example's figures.
    const { error: fErr } = await mgr.rpc('finish_order', { p_order_id: orderId })
    if (fErr) throw new Error(fErr.message)
    const { error: cErr } = await mgr.rpc('close_order', {
      p_order_id: orderId,
      p_bottles_delivered: 60,
      p_dabbers_delivered: 0,
      p_selling_price: 300,
      p_materials_total: 40,
    })
    if (cErr) throw new Error(cErr.message)
    await page.reload()
    await expect(page.getByTestId('labor')).toHaveText('$116.00')
    await expect(page.getByTestId('materials')).toHaveText('$40.00')
    await expect(page.getByTestId('recorded')).toHaveText('$156.00')
    await expect(page.getByTestId('price')).toHaveText('$300.00')
    await expect(page.getByTestId('remaining')).toHaveText('$144.00')
    await expect(page.getByTestId('remaining-per-bottle')).toHaveText('$2.40')
    await expect(page.getByTestId('time-per-bottle')).toHaveText('5 min')
    await expect(page.locator('.card', { hasText: 'Closed by' })).toContainText('60 bottles')
    await shot(page, '35-order-cost')
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
