import { expect, test } from '@playwright/test'
import { managerClient, openTodaysEntry, shot, signInAsArtist } from './helpers.ts'

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

  // Validation.
  await page.getByRole('button', { name: 'Submit purchase' }).click()
  await expect(page.getByRole('alert')).toContainText('what was bought')

  const stamp = `Playwright wire ${Date.now()}`
  await page.getByLabel('What was bought').fill(stamp)
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
