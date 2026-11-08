import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

test('Order shows details, Resources, the work log and the entry button', async ({ page }) => {
  await signInAsArtist(page)
  await page.getByLabel('Find any open order').fill('fumed dabber')
  await page.locator('ul.list li a.row').first().click()

  await expect(page.getByRole('heading', { name: /fumed dabber bottle/i })).toBeVisible()
  await expect(page.getByText('Design', { exact: true })).toBeVisible()
  await expect(page.getByText('12 bottles · 12 dabbers')).toBeVisible()
  await expect(page.getByText('Primary artist', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /today's entry/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Work log' })).toBeVisible()
  await shot(page, '02-order')

  await page.getByText('Resources').click()
  await shot(page, '02-order-resources')
})

test('an artist marks an order Finished and can still log work on it', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const orderName = `Artist finish test ${run}`

  const { data: design, error: designError } = await mgr
    .from('designs')
    .insert({ name: `Artist finish design ${run}`, has_dabber: false, is_fumed: false })
    .select('id')
    .single()
  if (designError) throw new Error(designError.message)
  const designId = (design as { id: string }).id

  const { data: order, error: orderError } = await mgr
    .from('orders')
    .insert({ name: orderName, design_id: designId, bottles_ordered: 6, dabbers_ordered: 0, due_date: '2026-12-15', primary_artist_id: artistId })
    .select('id')
    .single()
  if (orderError) throw new Error(orderError.message)
  const orderId = (order as { id: string }).id

  try {
    await signInAsArtist(page)
    await page.goto(`/orders/${orderId}`)
    await expect(page.getByRole('heading', { level: 1, name: orderName })).toBeVisible()

    // One tap only opens the form; nothing changes until it is confirmed.
    await page.getByRole('button', { name: 'Mark Finished' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('.topbar .badge')).toHaveText('Open')

    await page.getByRole('button', { name: 'Mark Finished' }).click()
    await page.getByLabel('Packing note (optional)').fill('Six to a sleeve')
    await page.getByLabel('Length').fill('12')
    await page.getByLabel('Width').fill('10')
    await page.getByLabel('Height').fill('8')

    // A weight that is not a number is refused, and the rest stays as typed.
    await page.getByLabel('Package weight in pounds (optional)').fill('heavy')
    await page.getByRole('button', { name: 'Mark Finished' }).click()
    await expect(page.getByRole('status')).toContainText('numbers above zero')
    await expect(page.getByLabel('Length')).toHaveValue('12')

    await page.getByLabel('Package weight in pounds (optional)').fill('4.5')
    await shot(page, '17-artist-finish-form')
    await page.getByRole('button', { name: 'Mark Finished' }).click()

    await expect(page.getByText('Order marked Finished.')).toBeVisible()
    await expect(page.locator('.topbar .badge')).toHaveText('Finished')
    await expect(page.locator('dl.facts')).toContainText('Test Artist')
    await expect(page.locator('dl.facts')).toContainText('Six to a sleeve')
    await expect(page.locator('dl.facts')).toContainText('12 × 10 × 8 in, 4.5 lb')
    await shot(page, '18-artist-finished-order')

    // It can only be finished once, and work can still be logged (brief: packing).
    await expect(page.getByRole('button', { name: 'Mark Finished' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /today's entry/ })).toBeVisible()

    // The database credits the artist who did it, not whoever is looking.
    const { data: saved } = await mgr.from('orders').select('status, finished_by, box_weight').eq('id', orderId).single()
    expect(saved).toEqual({ status: 'finished', finished_by: artistId, box_weight: 4.5 })
  } finally {
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
    await mgr.auth.signOut()
  }
})

test('a manager can create an order on a phone', async ({ page }) => {
  const mgr = await managerClient()
  const orderName = `Phone order test ${randomUUID().slice(0, 8)}`
  let orderId = ''

  try {
    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Orders' }).click()
    await page.getByRole('link', { name: 'New order' }).click()
    await page.getByLabel('Order name or number').fill(orderName)
    await page.getByLabel('Design').selectOption({ index: 1 })
    await page.getByLabel('Bottles ordered').fill('12')
    await page.getByLabel('Due date').fill('2026-12-15')
    await page.getByLabel('Primary artist').selectOption({ label: 'Test Artist' })

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(pageWidth).toBeLessThanOrEqual(page.viewportSize()!.width)
    await shot(page, '19-new-order-phone')

    await page.getByRole('button', { name: 'Create order' }).click()
    await expect(page.getByRole('heading', { level: 1, name: orderName })).toBeVisible()
    orderId = page.url().split('/').pop()!
    await shot(page, '20-order-phone')
  } finally {
    if (orderId) await mgr.from('orders').delete().eq('id', orderId)
    await mgr.auth.signOut()
  }
})
