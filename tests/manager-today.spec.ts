import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Today (brief: Reports and views, "Today").  The test manager logs an entry on
 * a throwaway order today; the Test Artist logs nothing.  Today must show the
 * manager as logged with the hours, the artist as not logged, the order in the
 * open-orders table with who logged on it, and the placeholders for tasks and
 * the calendar connection.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

test('Today shows who has logged, who has not, and the open orders by due date', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const today = chicagoToday()

  // Other screen tests leave today's test entries on the sample orders; the artist must have none here.
  const { error: clearErr } = await mgr.from('entries').delete().eq('artist_id', artistId).eq('work_date', today)
  if (clearErr) throw new Error(clearErr.message)

  const { data: design, error: dErr } = await mgr.from('designs').insert({ name: `Today test design ${run}` }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  const designId = (design as { id: string }).id
  const { data: order, error: oErr } = await mgr
    .from('orders')
    .insert({ name: `Today test order ${run}`, design_id: designId, bottles_ordered: 5, due_date: '2001-01-01', primary_artist_id: managerId })
    .select('id')
    .single()
  if (oErr) throw new Error(oErr.message)
  const orderId = (order as { id: string }).id

  try {
    const { data: entry, error: eErr } = await mgr
      .from('entries')
      .insert({ order_id: orderId, artist_id: managerId, work_date: today, bottles: 2 })
      .select('id')
      .single()
    if (eErr) throw new Error(eErr.message)
    const { error: tErr } = await mgr.from('entry_time').insert({ entry_id: (entry as { id: string }).id, minutes: 75 })
    if (tErr) throw new Error(tErr.message)

    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible()

    const logged = page.getByTestId('logged-today')
    await expect(logged.getByRole('listitem').filter({ hasText: 'Test Manager' })).toContainText('1h 15m')
    await expect(logged.getByRole('listitem').filter({ hasText: 'Test Artist' })).toContainText('Not logged')

    const orders = page.getByTestId('open-orders')
    const row = orders.getByRole('row', { name: new RegExp(`Today test order ${run}`) })
    await expect(row).toContainText('Was due Jan 1')
    await expect(row).toContainText('Test Manager')
    await expect(page.getByText(/open orders? (is|are) past/)).toBeVisible()

    await expect(page.getByText('Coming in session 5')).toBeVisible()
    await expect(page.getByText(/Not connected yet/)).toBeVisible()
    await shot(page, '34-today')
  } finally {
    await mgr.from('entries').delete().eq('order_id', orderId)
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
  }
})
