import { expect, test } from '@playwright/test'
import { shot, signInAsArtist } from './helpers.ts'

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
