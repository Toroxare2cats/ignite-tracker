import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Design pricing (brief: Costs and pricing, "Is our price for this design high
 * enough?").  One design, two closed runs and one still open:
 *
 *   Run A  60 bottles, 5h at $22, $40 materials, $300 price  -> $2.50 cost, $5.00 price, $2.50 remaining, 5 min per bottle
 *   Run B  10 bottles, 1h at $22, $0 materials, $40 price    -> $2.20 cost, $4.00 price, $1.80 remaining, 6 min per bottle
 *   Run C  open, never shown
 *
 * Runs appear oldest first, so A is closed before B.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const RATE_DATE = '2001-01-01'
const WORK_DATE = '2001-01-02'

async function makeOrder(mgr: SupabaseClient, designId: string, name: string, artistId: string, bottles: number, minutes: number): Promise<string> {
  const { data, error } = await mgr
    .from('orders')
    .insert({ name, design_id: designId, bottles_ordered: bottles, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  const orderId = (data as { id: string }).id
  const { data: entry, error: eErr } = await mgr.from('entries').insert({ order_id: orderId, artist_id: artistId, work_date: WORK_DATE, bottles }).select('id').single()
  if (eErr) throw new Error(eErr.message)
  const { error: tErr } = await mgr.from('entry_time').insert({ entry_id: (entry as { id: string }).id, minutes })
  if (tErr) throw new Error(tErr.message)
  return orderId
}

async function closeOrder(mgr: SupabaseClient, orderId: string, bottles: number, price: number, materials: number): Promise<void> {
  const { error: fErr } = await mgr.rpc('finish_order', { p_order_id: orderId })
  if (fErr) throw new Error(fErr.message)
  const { error } = await mgr.rpc('close_order', { p_order_id: orderId, p_bottles_delivered: bottles, p_dabbers_delivered: 0, p_selling_price: price, p_materials_total: materials })
  if (error) throw new Error(error.message)
}

test('Design pricing lists every closed run of a design in date order with per-bottle figures', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)

  const { data: found } = await mgr.from('pay_rates').select('id').eq('profile_id', artistId).eq('effective_from', RATE_DATE).eq('hourly_rate', 22)
  if ((found ?? []).length === 0) {
    const { error } = await mgr.from('pay_rates').insert({ profile_id: artistId, hourly_rate: 22, effective_from: RATE_DATE })
    if (error) throw new Error(error.message)
  }

  const { data: design, error: dErr } = await mgr.from('designs').insert({ name: `Pricing test design ${run}` }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  const designId = (design as { id: string }).id
  const { error: pErr } = await mgr.from('design_prices').insert({ design_id: designId, price_per_bottle: 6, effective_from: RATE_DATE })
  if (pErr) throw new Error(pErr.message)
  const orderIds: string[] = []

  try {
    const a = await makeOrder(mgr, designId, `Pricing run A ${run}`, artistId, 60, 300)
    const b = await makeOrder(mgr, designId, `Pricing run B ${run}`, artistId, 10, 60)
    const c = await makeOrder(mgr, designId, `Pricing run C ${run}`, artistId, 5, 30)
    orderIds.push(a, b, c)
    await closeOrder(mgr, a, 60, 300, 40)
    await closeOrder(mgr, b, 10, 40, 0)

    await signInAsManager(page)
    await page.goto('/manage/reports/design-pricing')
    await expect(page.getByRole('heading', { level: 1, name: 'Design pricing' })).toBeVisible()
    await page.getByLabel('Search designs').fill(run)
    const pick = page.getByRole('row', { name: new RegExp(`Pricing test design ${run}`) })
    await expect(pick).toContainText('$6.00')
    await pick.getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1, name: `Pricing test design ${run}` })).toBeVisible()

    const runs = page.getByTestId('runs')
    const rows = runs.getByRole('row').filter({ hasText: 'Pricing run' })
    await expect(rows).toHaveCount(2) // the open run C is not a closed run
    await expect(rows.nth(0)).toContainText(`Pricing run A ${run}`)
    await expect(rows.nth(1)).toContainText(`Pricing run B ${run}`)

    const cells = (row: ReturnType<typeof rows.nth>) => row.getByRole('cell')
    await expect(cells(rows.nth(0)).nth(2)).toHaveText('60')
    await expect(cells(rows.nth(0)).nth(3)).toContainText('5m')
    await expect(cells(rows.nth(0)).nth(4)).toHaveText('$2.50')
    await expect(cells(rows.nth(0)).nth(5)).toHaveText('$5.00')
    await expect(cells(rows.nth(0)).nth(6)).toHaveText('$2.50')
    await expect(cells(rows.nth(1)).nth(2)).toHaveText('10')
    await expect(cells(rows.nth(1)).nth(3)).toContainText('6m')
    await expect(cells(rows.nth(1)).nth(4)).toHaveText('$2.20')
    await expect(cells(rows.nth(1)).nth(5)).toHaveText('$4.00')
    await expect(cells(rows.nth(1)).nth(6)).toHaveText('$1.80')

    // The latest complete run is called out against the current price.
    const latest = page.getByTestId('latest-run')
    await expect(latest).toContainText(`Pricing run B ${run}`)
    await expect(latest).toContainText('$1.80')
    await expect(latest).toContainText('That run sold at $4.00 per bottle; the current price is $6.00.')
    await shot(page, '36-design-pricing')
  } finally {
    for (const id of orderIds) {
      const { data: o } = await mgr.from('orders').select('status').eq('id', id).maybeSingle()
      if (o?.status === 'closed') await mgr.rpc('reopen_order', { p_order_id: id, p_reason: 'test cleanup' })
      await mgr.from('entries').delete().eq('order_id', id)
      await mgr.from('order_financial_history').delete().eq('order_id', id)
      await mgr.from('order_financials').delete().eq('order_id', id)
      await mgr.from('orders').delete().eq('id', id)
    }
    await mgr.from('design_prices').delete().eq('design_id', designId)
    await mgr.from('designs').delete().eq('id', designId)
  }
})
