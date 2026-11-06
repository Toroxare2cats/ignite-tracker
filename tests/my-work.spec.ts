import { expect, test } from '@playwright/test'
import { shot, signInAsArtist } from './helpers.ts'

test('My Work shows orders, search and the task count', async ({ page }) => {
  await signInAsArtist(page)
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent' })).toBeVisible()
  await expect(page.getByText(/open tasks?/)).toBeVisible()
  await shot(page, '01-my-work')

  // Search finds the sample orders by name or design.
  await page.getByLabel('Find any open order').fill('sample')
  await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible()
  const results = page.locator('ul.list li a.row')
  await expect(results.first()).toBeVisible()
  await shot(page, '01-my-work-search')

  await page.getByLabel('Find any open order').fill('zzz-no-such-order')
  await expect(page.getByText(/No open order matches/)).toBeVisible()
})
