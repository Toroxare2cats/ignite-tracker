import { expect, test, type Page } from '@playwright/test'
import { openTodaysEntry, shot, signInAsArtist } from './helpers.ts'

async function openOrder(page: Page, search: string) {
  await page.getByLabel('Find any open order').fill(search)
  await page.locator('ul.list li a.row').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(search, { ignoreCase: true })
}

/** Remove today's entry on an order if one exists, so each run starts clean. */
async function clearToday(page: Page) {
  await expect(page.getByRole('link', { name: /today's entry/ })).toBeVisible()
  const edit = page.getByRole('link', { name: "Edit today's entry" })
  if (await edit.isVisible()) {
    await edit.click()
    await page.getByRole('button', { name: 'Delete this entry' }).click()
    await page.getByRole('button', { name: 'Yes, delete' }).click()
    await expect(page.getByRole('link', { name: "Add today's entry" })).toBeVisible()
  }
}

test('design-driven fields: fumed dabber design shows dabbers and fuming, plain design hides them', async ({ page }) => {
  await signInAsArtist(page)
  await openOrder(page, 'fumed dabber')
  await clearToday(page)
  await page.getByRole('link', { name: "Add today's entry" }).click()
  await expect(page.getByRole('spinbutton', { name: 'Bottles completed' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Dabbers completed' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Fuming completed' })).toBeVisible()
  await shot(page, '03-entry-form-fumed-dabber')

  await page.goto('/')
  await openOrder(page, 'plain bottle')
  await clearToday(page)
  await page.getByRole('link', { name: "Add today's entry" }).click()
  await expect(page.getByRole('spinbutton', { name: 'Bottles completed' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Dabbers completed' })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: 'Fuming completed' })).toHaveCount(0)
  await shot(page, '03-entry-form-plain')
})

test('save an entry: hours required, chips, confirmation, no duplicate, shows in the log', async ({ page }) => {
  await signInAsArtist(page)
  await openOrder(page, 'fumed dabber')
  await clearToday(page)
  await page.getByRole('link', { name: "Add today's entry" }).click()

  // Hours are required.
  await page.getByRole('spinbutton', { name: 'Bottles completed' }).fill('4')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await expect(page.getByRole('alert')).toContainText('Add your hours')

  // Chips set the time; +15 adjusts it.
  await page.getByRole('button', { name: '1h 30m', exact: true }).click()
  await page.getByRole('button', { name: '15 minutes more' }).click()
  await expect(page.locator('.hours-display')).toHaveText('1h 45m')
  await page.getByRole('spinbutton', { name: 'Fuming completed' }).fill('2')
  await page.getByLabel('Note (optional)').fill('Playwright test entry')
  await shot(page, '03-entry-filled')

  // A double tap cannot create two entries: the button disables while saving.
  const save = page.getByRole('button', { name: 'Save entry' })
  await save.click()
  await expect(page.getByRole('heading', { name: 'Entry saved' })).toBeVisible()
  await expect(page.getByText('4 bottles · 2 fumed · 1h 45m')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add another order' })).toBeVisible()
  await shot(page, '03-entry-saved')

  // Back on the order the log shows it, with hours (own entry) and the button now edits.
  await page.getByRole('link', { name: 'Back to this order' }).click()
  await expect(page.getByRole('link', { name: "Edit today's entry" })).toBeVisible()
  const logRow = page.locator('.log-entry.own').first()
  await expect(logRow).toContainText('You')
  await expect(logRow).toContainText('4 bottles')
  await expect(logRow).toContainText('2 fumed')
  await expect(logRow).toContainText('1h 45m')
  await expect(logRow).toContainText('Playwright test entry')
  await shot(page, '03-order-with-log')

  // Opening the form again for today edits the same entry instead of adding one.
  await page.goto(page.url().replace(/\/$/, '') + '/entry')
  await expect(page.getByRole('heading', { name: 'Edit your entry' })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Bottles completed' })).toHaveValue('4')

  // "Add another order" returns to My Work with the saved notice, and the order is now Recent.
  await page.getByRole('link', { name: /Sample order/ }).first().click()
  await page.getByRole('link', { name: "Edit today's entry" }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('link', { name: 'Add another order' }).click()
  await expect(page.getByText('Saved. Pick the next order to log.')).toBeVisible()
})
