import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, need, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Manager portal, Orders (brief: Completion, Costs and pricing).  Walks one
 * order through its whole life on a desktop-sized browser and checks the
 * brief's worked example: 3 hours at $22 and 2 hours at $25, $40 materials,
 * $300 price, 60 bottles gives $116 labor, $156 recorded, $144 remaining,
 * $2.40 remaining per bottle and 5 minutes per bottle.
 *
 * The rates are on a fixed date in 2001 so they cannot affect anything else.
 * Rates can never be deleted (rule 5), so they are added once and reused.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const RATE_DATE = '2001-01-01'
const WORK_DATE = '2001-01-02'

test('a manager takes an order from creation through close and reopen, and the worked example adds up', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const designName = `Portal test design ${run}`
  const orderName = `Portal test order ${run}`

  const { data: design, error: designError } = await mgr
    .from('designs')
    .insert({ name: designName, dimensions: '5 in tall', colors_finishes: 'Clear', instructions: 'Copied from the design', has_dabber: false, is_fumed: false })
    .select('id')
    .single()
  if (designError) throw new Error(designError.message)
  const designId = (design as { id: string }).id

  for (const [person, rate] of [[artistId, 22], [managerId, 25]] as const) {
    const { data: found } = await mgr.from('pay_rates').select('id').eq('profile_id', person).eq('effective_from', RATE_DATE).eq('hourly_rate', rate)
    if ((found ?? []).length === 0) {
      const { error } = await mgr.from('pay_rates').insert({ profile_id: person, hourly_rate: rate, effective_from: RATE_DATE })
      if (error) throw new Error(error.message)
    }
  }

  let orderId = ''
  try {
    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Orders', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Sample order/ }).first()).toBeVisible()
    await shot(page, '10-orders-list')

    // Create from a design.  The save button reports where things stand.
    await page.getByRole('link', { name: 'New order' }).click()
    await expect(page.getByRole('status')).toHaveText('Not saved yet')
    await page.getByLabel('Order name or number').fill(orderName)
    await expect(page.getByRole('status')).toHaveText('Unsaved changes')
    await page.getByLabel('Design').selectOption({ label: designName })
    await expect(page.getByText('Copied from the design')).toBeVisible()
    await expect(page.getByLabel('Dabbers ordered')).toHaveCount(0) // this design has no dabber

    // A refused save keeps what was typed.
    await page.getByRole('button', { name: 'Create order' }).click()
    await expect(page.getByRole('status')).toContainText('Enter the number of bottles')
    await expect(page.getByLabel('Order name or number')).toHaveValue(orderName)

    await page.getByLabel('Bottles ordered').fill('60')
    await page.getByLabel('Due date').fill('2026-12-15')
    await page.getByLabel('Primary artist').selectOption({ label: 'Test Artist' })
    await shot(page, '11-new-order')
    await page.getByRole('button', { name: 'Create order' }).click()
    await expect(page.getByRole('heading', { level: 1, name: orderName })).toBeVisible()
    await expect(page.getByText('Order created.')).toBeVisible()
    orderId = page.url().split('/').pop()!

    // Financials stay hidden until the order is closed.
    await expect(page.getByTestId('cost-card')).toContainText('Financials incomplete')

    // It shows in the list, sorted by due date with its status.
    await page.getByRole('link', { name: 'Orders' }).first().click()
    await page.getByLabel('Search orders').fill(run)
    const row = page.getByRole('row', { name: new RegExp(orderName) })
    await expect(row).toContainText('Test Artist')
    await expect(row).toContainText('Open')
    await row.getByRole('link', { name: orderName }).click()

    // Edit the order's copy of the specs and reassign the primary artist.
    await page.getByRole('link', { name: 'Edit or reassign' }).click()
    await expect(page.getByLabel('Instructions')).toHaveValue('Copied from the design')
    await page.getByLabel('Instructions').fill('Changed for this run only')
    await page.getByLabel('Primary artist').selectOption({ label: 'Test Manager' })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Order saved.')).toBeVisible()
    await expect(page.getByTestId('history')).toContainText('Primary artist changed')
    await expect(page.getByTestId('history')).toContainText('Test Artist → Test Manager')

    // The design itself is untouched by the order's edit.
    const { data: untouched } = await mgr.from('designs').select('instructions').eq('id', designId).single()
    expect((untouched as { instructions: string }).instructions).toBe('Copied from the design')

    // Worked example hours: 3 h and 2 h, logged on the fixed date.
    const { data: entries, error: entryError } = await mgr
      .from('entries')
      .insert([
        { order_id: orderId, artist_id: artistId, work_date: WORK_DATE, bottles: 40 },
        { order_id: orderId, artist_id: managerId, work_date: WORK_DATE, bottles: 20 },
      ])
      .select('id, artist_id')
    if (entryError) throw new Error(entryError.message)
    const rows = entries as { id: string; artist_id: string }[]
    await mgr.from('entry_time').insert(rows.map((e) => ({ entry_id: e.id, minutes: e.artist_id === artistId ? 180 : 120 })))
    await page.reload()
    await expect(page.getByText('5h logged')).toBeVisible()

    // Finish with a packing note and box size.
    await page.getByRole('button', { name: 'Mark Finished' }).click()
    await page.getByLabel('Packing note (optional)').fill('Six to a sleeve')
    await page.getByLabel('Length').fill('12')
    await page.getByLabel('Width').fill('10')
    await page.getByLabel('Height').fill('8')
    await page.getByLabel('Package weight in pounds (optional)').fill('14.5')
    await shot(page, '12-finish-form')
    await page.getByRole('button', { name: 'Mark Finished' }).click()
    await expect(page.getByText('Order marked Finished.')).toBeVisible()
    await expect(page.getByTestId('history')).toContainText('Six to a sleeve')
    await expect(page.getByTestId('history')).toContainText('Box 12 × 10 × 8 in, 14.5 lb')

    // Closing refuses without a price, on screen...
    await page.getByRole('button', { name: 'Close order' }).click()
    await page.getByLabel('Bottles delivered').fill('60')
    await page.getByLabel('Materials cost, manager total ($)').fill('40')
    await page.getByRole('button', { name: 'Close order' }).click()
    await expect(page.locator('form', { hasText: 'Close this order' }).getByRole('status')).toContainText('Enter the selling price')
    await expect(page.locator('.topbar .badge')).toHaveText('Finished')

    // ...and in the database, whatever the screen does.
    const refused = await mgr.rpc('close_order', { p_order_id: orderId, p_bottles_delivered: 60, p_dabbers_delivered: 0, p_selling_price: null, p_materials_total: 40 })
    expect(refused.error?.message).toContain('required to close')

    await page.getByLabel('Selling price, order total ($)').fill('300')
    await expect(page.getByText('That is $5.00 per delivered bottle.')).toBeVisible()
    await shot(page, '13-close-form')
    await page.getByRole('button', { name: 'Close order' }).click()
    await expect(page.getByText('Order closed.')).toBeVisible()
    await expect(page.locator('.topbar .badge')).toHaveText('Closed')

    // The worked example.
    await expect(page.getByTestId('labor')).toHaveText('$116.00')
    await expect(page.getByTestId('materials')).toHaveText('$40.00')
    await expect(page.getByTestId('recorded')).toHaveText('$156.00')
    await expect(page.getByTestId('price')).toHaveText('$300.00')
    await expect(page.getByTestId('remaining')).toHaveText('$144.00')
    await expect(page.getByTestId('remaining-per-bottle')).toHaveText('$2.40')
    await expect(page.getByTestId('time-per-bottle')).toHaveText('5 min')
    await shot(page, '14-closed-order')

    // Closed orders are not editable until reopened.
    await expect(page.getByRole('link', { name: 'Edit or reassign' })).toHaveCount(0)
    await page.goto(`/manage/orders/${orderId}/edit`)
    await expect(page.getByText('Reopen it before changing its details.')).toBeVisible()
    await page.goto(`/manage/orders/${orderId}`)

    // Reopen keeps the prior details in the history.
    await page.getByRole('button', { name: 'Reopen' }).click()
    await page.getByLabel('Reason (optional)').fill('Client added a dozen')
    await page.getByRole('button', { name: 'Reopen order' }).click()
    await expect(page.getByText('Order reopened.')).toBeVisible()
    await expect(page.locator('.topbar .badge')).toHaveText('Open')
    const history = page.getByTestId('history')
    await expect(history).toContainText('Client added a dozen')
    await expect(history).toContainText('Was closed.')
    await expect(history).toContainText('60 bottles delivered, price $300.00, materials $40.00')
    await expect(history.getByText('Created')).toBeVisible()
    await expect(history.getByText('Marked Finished')).toBeVisible()
    await expect(history.getByText('Closed', { exact: true })).toBeVisible()
    await expect(page.getByTestId('cost-card')).toContainText('Financials incomplete')
    await shot(page, '15-reopened-history')
  } finally {
    if (orderId) {
      const { data: o } = await mgr.from('orders').select('status').eq('id', orderId).maybeSingle()
      if ((o as { status: string } | null)?.status === 'closed') await mgr.rpc('reopen_order', { p_order_id: orderId })
      await mgr.from('entries').delete().eq('order_id', orderId)
      await mgr.from('orders').delete().eq('id', orderId)
    }
    await mgr.from('designs').delete().eq('id', designId)
    await mgr.auth.signOut()
  }
})

test('the orders list works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsManager(page)
  await page.goto('/manage/orders')
  await expect(page.getByRole('heading', { level: 1, name: 'Orders', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Sample order/ }).first()).toBeVisible()
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
  await shot(page, '16-orders-phone')
})

test('an artist cannot reach the manager portal', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/orders')
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('link', { name: 'New order' })).toHaveCount(0)
  expect(need('PRIVACY_TEST_ARTIST_EMAIL')).toContain('test.artist')
})
