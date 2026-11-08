import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Manager portal, Designs (brief: Designs, orders, and resources).
 *
 * Prices can never be deleted (rule 5), and that also stops a design with a
 * price from being deleted.  So the price test always uses one retired fixture
 * design and adds a single row each run; every other test makes its own design
 * with no price and removes it afterwards.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const PRICE_FIXTURE = 'Test fixture: design prices'
const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function png(name: string) {
  return { name, mimeType: 'image/png', buffer: ONE_PIXEL_PNG }
}

async function removeDesign(mgr: SupabaseClient, designId: string): Promise<void> {
  if (!designId) return
  const { data } = await mgr.storage.from('design-photos').list(designId)
  const paths = (data ?? []).map((f) => `${designId}/${f.name}`)
  if (paths.length > 0) await mgr.storage.from('design-photos').remove(paths)
  await mgr.from('designs').delete().eq('id', designId)
}

test('a manager creates a design, edits it, adds photos, artists see them, and it can be retired', async ({ page, browser }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const name = `Design test ${run}`
  let designId = ''
  let orderId = ''

  try {
    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Designs' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Designs', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /^Sample/ }).first()).toBeVisible()
    await shot(page, '21-designs-list')

    // Create.  A blank name is refused, and the form says where it stands.
    await page.getByRole('link', { name: 'New design' }).click()
    await expect(page.getByRole('status')).toHaveText('Not saved yet')
    await page.getByRole('button', { name: 'Create design' }).click()
    await expect(page.getByRole('status')).toContainText('Give the design a name')

    await page.getByLabel('Design name').fill(name)
    await expect(page.getByRole('status')).toHaveText('Unsaved changes')
    await page.getByLabel('Dimensions').fill('5 in tall')
    await page.getByLabel('Colors and finishes').fill('Cobalt with a clear lip')
    await page.getByLabel('Production instructions').fill('First version')
    await page.getByLabel('Has a matching dabber').check()
    await shot(page, '22-new-design')
    await page.getByRole('button', { name: 'Create design' }).click()

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(page.getByText('Design created.')).toBeVisible()
    designId = page.url().split('/').pop()!

    // No price yet shows as missing, never zero (rule 6).
    await expect(page.getByTestId('current-price')).toHaveText('Missing')

    // A second design cannot take the same name, and what was typed stays.
    await page.goto('/manage/designs/new')
    await page.getByLabel('Design name').fill(name.toUpperCase())
    await page.getByRole('button', { name: 'Create design' }).click()
    await expect(page.getByRole('status')).toContainText('already exists')
    await expect(page.getByLabel('Design name')).toHaveValue(name.toUpperCase())

    // Edit, and it is still there after a reload.
    await page.goto(`/manage/designs/${designId}`)
    const details = page.locator('form', { has: page.getByLabel('Design name') })
    await page.getByLabel('Production instructions').fill('Second version')
    await expect(details.getByRole('status')).toHaveText('Unsaved changes')
    await details.getByRole('button', { name: 'Save changes' }).click()
    await expect(details.getByRole('status')).toContainText('Saved')
    await page.reload()
    await expect(page.getByLabel('Production instructions')).toHaveValue('Second version')
    await expect(page.getByLabel('Has a matching dabber')).toBeChecked()

    // Photos: something that is not a photo is refused.
    const imageForm = page.locator('form', { has: page.getByLabel('Choose a product image') })
    await imageForm.getByLabel('Choose a product image').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await imageForm.getByRole('button', { name: 'Upload image' }).click()
    await expect(imageForm.getByRole('status')).toContainText('JPEG, PNG or WebP')

    await imageForm.getByLabel('Choose a product image').setInputFiles(png('product.png'))
    await imageForm.getByRole('button', { name: 'Upload image' }).click()
    await expect(page.getByRole('img', { name: `${name} product` })).toBeVisible()

    const photoForm = page.locator('form', { has: page.getByLabel('Add a reference photo') })
    await photoForm.getByLabel('Add a reference photo').setInputFiles(png('first.png'))
    await photoForm.getByLabel('Caption (optional)').fill('Lip detail')
    await photoForm.getByRole('button', { name: 'Upload photo' }).click()
    await expect(page.getByText('Lip detail')).toBeVisible()
    await photoForm.getByLabel('Add a reference photo').setInputFiles(png('second.png'))
    await photoForm.getByLabel('Caption (optional)').fill('Throwaway')
    await photoForm.getByRole('button', { name: 'Upload photo' }).click()
    await expect(page.getByText('Throwaway')).toBeVisible()
    await shot(page, '23-design-page')

    // Removing asks first; "Keep it" leaves the photo alone.
    const second = page.locator('figure', { hasText: 'Throwaway' })
    await second.getByRole('button', { name: 'Remove photo' }).click()
    await second.getByRole('button', { name: 'Keep it' }).click()
    await expect(page.getByText('Throwaway')).toBeVisible()
    await second.getByRole('button', { name: 'Remove photo' }).click()
    await second.getByRole('button', { name: 'Yes, remove' }).click()
    await expect(page.getByText('Throwaway')).toHaveCount(0)

    // Replacing the product image leaves only one file behind.
    const replaceForm = page.locator('form', { has: page.getByLabel('Replace the product image') })
    await replaceForm.getByLabel('Replace the product image').setInputFiles(png('replacement.png'))
    await replaceForm.getByRole('button', { name: 'Upload image' }).click()
    await expect.poll(async () => {
      const { data } = await mgr.storage.from('design-photos').list(designId)
      return (data ?? []).map((f) => f.name.replace(/^\d+-/, '')).sort()
    }).toEqual(['first.png', 'replacement.png'])

    // An artist sees the photos in Resources.
    const { data: order, error: orderError } = await mgr
      .from('orders')
      .insert({ name: `Design test order ${run}`, design_id: designId, bottles_ordered: 6, dabbers_ordered: 6, due_date: '2026-12-15', primary_artist_id: artistId })
      .select('id')
      .single()
    if (orderError) throw new Error(orderError.message)
    orderId = (order as { id: string }).id

    const artistContext = await browser.newContext()
    const artistPage = await artistContext.newPage()
    await signInAsArtist(artistPage)
    await artistPage.goto(`/orders/${orderId}`)
    await expect(artistPage.getByRole('img', { name: `${name} product` })).toBeVisible()
    await artistPage.getByText('Resources').click()
    const photo = artistPage.getByRole('img', { name: 'Lip detail' })
    await expect(photo).toBeVisible()
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await artistContext.close()

    // Retire it: gone from the New order list, still reachable under Retired.
    await page.goto(`/manage/designs/${designId}`)
    await page.getByLabel('Active (can be chosen for new orders)').uncheck()
    await details.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('This design is retired.')).toBeVisible()

    await page.goto('/manage/orders/new')
    await expect(page.getByLabel('Design').locator('option', { hasText: /^Sample/ }).first()).toHaveCount(1)
    await expect(page.getByLabel('Design').locator('option', { hasText: name })).toHaveCount(0)

    await page.goto('/manage/designs')
    await expect(page.getByRole('link', { name })).toHaveCount(0)
    await page.getByRole('button', { name: 'Retired' }).click()
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Retired')
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Missing')
  } finally {
    if (orderId) await mgr.from('orders').delete().eq('id', orderId)
    await removeDesign(mgr, designId)
    await mgr.auth.signOut()
  }
})

test('selling prices are dated, never overwritten, and only count from their start date', async ({ page }) => {
  const mgr = await managerClient()

  // The fixture is retired so it never appears in the New order list.
  const { data: found } = await mgr.from('designs').select('id').eq('name', PRICE_FIXTURE).maybeSingle()
  let designId = (found as { id: string } | null)?.id ?? ''
  if (!designId) {
    const { data, error } = await mgr.from('designs').insert({ name: PRICE_FIXTURE, active: false }).select('id').single()
    if (error) throw new Error(error.message)
    designId = (data as { id: string }).id
    await mgr.from('design_prices').insert([
      { design_id: designId, price_per_bottle: 7, effective_from: '2001-03-01' },
      { design_id: designId, price_per_bottle: 999, effective_from: '2099-01-01' },
    ])
  }

  // A price nobody has used before, so finding it proves this run saved it.
  const price = (10 + Math.floor(Math.random() * 900000) / 100).toFixed(2)
  const { count: before } = await mgr.from('design_prices').select('id', { count: 'exact', head: true }).eq('design_id', designId)

  await signInAsManager(page)
  await page.goto(`/manage/designs/${designId}`)
  const form = page.locator('form', { has: page.getByLabel('New price ($)') })

  // Refused: nothing, zero, and no start date.
  await form.getByRole('button', { name: 'Add price' }).click()
  await expect(form.getByRole('status')).toContainText('above zero')
  await form.getByLabel('New price ($)').fill('0')
  await form.getByRole('button', { name: 'Add price' }).click()
  await expect(form.getByRole('status')).toContainText('above zero')
  await form.getByLabel('New price ($)').fill(price)
  await form.getByLabel('Starts on').fill('')
  await form.getByRole('button', { name: 'Add price' }).click()
  await expect(form.getByRole('status')).toContainText('Choose the date')
  await expect(form.getByLabel('New price ($)')).toHaveValue(price)

  await form.getByLabel('Starts on').fill('2001-03-02')
  await form.getByRole('button', { name: 'Add price' }).click()
  await expect(form.getByRole('status')).toContainText('Saved')

  // Newest price with a start date in the past wins; the 2099 price does not count yet.
  const shown = `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  await expect(page.getByTestId('current-price')).toContainText(shown)
  await expect(page.getByTestId('current-price')).toContainText('Mar 2, 2001')
  await expect(page.getByTestId('price-history')).toContainText('Starts Jan 1, 2099')
  await expect(page.getByTestId('price-history')).toContainText('$7.00')
  await shot(page, '24-design-prices')

  // Added as a new row, with the older ones still there.
  const { count: after } = await mgr.from('design_prices').select('id', { count: 'exact', head: true }).eq('design_id', designId)
  expect(after).toBe((before ?? 0) + 1)

  // The list shows the same current price.
  await page.goto('/manage/designs')
  await page.getByRole('button', { name: 'All' }).click()
  await page.getByLabel('Search designs').fill(PRICE_FIXTURE)
  await expect(page.getByRole('row', { name: new RegExp(PRICE_FIXTURE) })).toContainText(shown)
  await mgr.auth.signOut()
})

test('unticking a design option never erases counts already logged', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  let designId = ''
  let orderId = ''

  try {
    const { data: design, error: designError } = await mgr
      .from('designs')
      .insert({ name: `Option test ${run}`, has_dabber: true, is_fumed: true })
      .select('id')
      .single()
    if (designError) throw new Error(designError.message)
    designId = (design as { id: string }).id

    const { data: order, error: orderError } = await mgr
      .from('orders')
      .insert({ name: `Option test order ${run}`, design_id: designId, bottles_ordered: 6, dabbers_ordered: 6, primary_artist_id: artistId })
      .select('id')
      .single()
    if (orderError) throw new Error(orderError.message)
    orderId = (order as { id: string }).id

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
    const { data: entry, error: entryError } = await mgr
      .from('entries')
      .insert({ order_id: orderId, artist_id: artistId, work_date: today, bottles: 2, dabbers: 3, fuming: 4 })
      .select('id')
      .single()
    if (entryError) throw new Error(entryError.message)
    const entryId = (entry as { id: string }).id
    await mgr.from('entry_time').insert({ entry_id: entryId, minutes: 60 })

    // A manager turns both options off after the work was logged.
    await mgr.from('designs').update({ has_dabber: false, is_fumed: false }).eq('id', designId)

    // The artist corrects the note; the counts must survive that save.
    await signInAsArtist(page)
    await page.goto(`/entries/${entryId}`)
    await expect(page.getByRole('spinbutton', { name: 'Dabbers completed' })).toHaveValue('3')
    await expect(page.getByRole('spinbutton', { name: 'Fuming completed' })).toHaveValue('4')
    await page.getByLabel('Note').fill('Corrected note')
    await page.getByRole('button', { name: /Save/ }).click()
    await expect.poll(async () => {
      const { data } = await mgr.from('entries').select('note, dabbers, fuming').eq('id', entryId).single()
      return data
    }).toEqual({ note: 'Corrected note', dabbers: 3, fuming: 4 })
  } finally {
    if (orderId) {
      await mgr.from('entries').delete().eq('order_id', orderId)
      await mgr.from('orders').delete().eq('id', orderId)
    }
    await removeDesign(mgr, designId)
    await mgr.auth.signOut()
  }
})

test('the Designs screens work at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsManager(page)
  await page.goto('/manage/designs')
  await expect(page.getByRole('link', { name: /^Sample/ }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await shot(page, '25-designs-phone')

  await page.getByRole('link', { name: /^Sample/ }).first().click()
  await expect(page.getByTestId('current-price')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await shot(page, '26-design-phone')
})

test('an artist cannot reach the Designs screens', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/designs')
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('link', { name: 'New design' })).toHaveCount(0)
})
