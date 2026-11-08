import { expect, test } from '@playwright/test'
import { managerClient, openTodaysEntry, shot, signInAsArtist } from './helpers.ts'
import { addDays, formatShortDate, todayChicago, weekStart } from '../src/lib/dates.ts'

test('weeks run Sunday through Saturday', () => {
  expect(weekStart('2026-11-08')).toBe('2026-11-08') // a Sunday starts its own week
  expect(weekStart('2026-11-09')).toBe('2026-11-08') // Monday
  expect(weekStart('2026-11-14')).toBe('2026-11-08') // Saturday is the last day
  expect(weekStart('2026-11-15')).toBe('2026-11-15') // the next Sunday starts a new one
  expect(weekStart('2027-01-02')).toBe('2026-12-27') // across the new year
})

test('My Week shows this week and last week with own hours and counts', async ({ page }) => {
  await signInAsArtist(page)

  // Make sure there is something to show: log today on the plain bottle order.
  await page.getByLabel('Find any open order').fill('plain bottle')
  await page.locator('ul.list li a.row').first().click()
  await openTodaysEntry(page)
  await page.getByRole('spinbutton', { name: 'Bottles completed' }).fill('6')
  await page.getByRole('button', { name: '2h', exact: true }).click()
  await page.getByRole('button', { name: /Save/ }).click()
  await expect(page.getByRole('heading', { name: /saved/ })).toBeVisible()

  await page.goto('/week')
  await expect(page.getByRole('heading', { name: 'My Week' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'This week' })).toHaveAttribute('aria-selected', 'true')
  const sunday = weekStart(todayChicago())
  await expect(page.getByText(`${formatShortDate(sunday)} – ${formatShortDate(addDays(sunday, 6))}`)).toBeVisible()
  const today = page.locator('.day', { hasText: 'Today' })
  await expect(today).toContainText('Sample order: plain bottle')
  await expect(today).toContainText('6 bottles')
  await expect(today).toContainText('2h')
  await shot(page, '05-my-week')

  await page.getByRole('tab', { name: 'Last week' }).click()
  await expect(page.getByRole('tab', { name: 'Last week' })).toHaveAttribute('aria-selected', 'true')
  await shot(page, '05-my-week-last')
})

test('Materials: submit a purchase with a receipt; it shows as pending in own submissions', async ({ page }) => {
  await signInAsArtist(page)
  await page.getByRole('link', { name: 'Materials' }).click()
  await expect(page.getByRole('heading', { name: 'Materials' })).toBeVisible()
  await page.getByRole('button', { name: 'Record a purchase' }).click()

  // Saved state, and validation.
  await expect(page.getByRole('status')).toHaveText('Not saved yet')
  await page.getByRole('button', { name: 'Submit purchase' }).click()
  await expect(page.getByRole('status')).toContainText('what was bought')

  const stamp = `Playwright wire ${Date.now()}`
  await page.getByLabel('What was bought').fill(stamp)
  await expect(page.getByRole('status')).toHaveText('Unsaved changes')
  await page.getByLabel('Amount paid ($)').fill('12.50')
  await page.getByText('Studio stock').click()
  await page.getByLabel('Receipt photo (optional)').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  })
  await shot(page, '06-materials-form')
  await page.getByRole('button', { name: 'Submit purchase' }).click()
  await expect(page.getByText(/Submitted:/)).toBeVisible()

  const row = page.locator('.log-entry', { hasText: stamp })
  await expect(row).toContainText('$12.50')
  await expect(row).toContainText('Studio stock')
  await expect(row).toContainText('Pending')
  await expect(row.getByRole('button', { name: 'View receipt' })).toBeVisible()
  await shot(page, '06-materials-list')
})

test.afterAll(async () => {
  // Remove the purchases and receipts the Materials test created.
  const mgr = await managerClient()
  const { data } = await mgr.from('purchases').select('id, receipt_path').ilike('description', 'Playwright wire %')
  const rows = (data ?? []) as { id: string; receipt_path: string | null }[]
  const paths = rows.map((r) => r.receipt_path).filter((p): p is string => !!p)
  if (paths.length) await mgr.storage.from('receipts').remove(paths)
  if (rows.length) await mgr.from('purchases').delete().in('id', rows.map((r) => r.id))
  await mgr.auth.signOut()
})
