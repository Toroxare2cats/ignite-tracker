import { devices, expect, test, type Page } from '@playwright/test'
import { managerClient, need, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Each manager's landing screen: chosen in Settings, used once each time the
 * app opens, and never in the way of My Work or a link to a particular page.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

// The test manager goes back to the account default, which is what opens on Orders.
test.afterEach(async () => {
  const mgr = await managerClient()
  const { managerId } = await testPeople(mgr)
  const { error } = await mgr.from('profiles').update({ home_screen: 'dashboard' }).eq('id', managerId)
  if (error) throw new Error(error.message)
})

const menu = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 1, name })

test('a manager chooses the screen the app opens on', async ({ page }) => {
  await signInAsManager(page)

  // With nothing chosen yet, a manager opens on Orders.
  await expect(page).toHaveURL(/\/manage\/orders$/)
  await expect(heading(page, 'Orders')).toBeVisible()

  await menu(page).getByRole('link', { name: 'Settings' }).click()
  await expect(heading(page, 'Settings')).toBeVisible()
  const choice = page.getByLabel('Open the app on')
  await expect(choice).toHaveValue('orders')
  await expect(page.getByRole('status')).toHaveText('No changes yet')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled()

  await choice.selectOption({ label: 'Approvals' })
  await expect(page.getByRole('status')).toHaveText('Unsaved changes')
  await shot(page, '36-settings-unsaved')

  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
  await shot(page, '37-settings-saved')

  // Leaving and coming back shows what was saved, not the value from when the app opened.
  await menu(page).getByRole('link', { name: 'Orders' }).click()
  await menu(page).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByLabel('Open the app on')).toHaveValue('approvals')

  // Opening the app again lands there.
  const reopened = await page.context().newPage()
  await reopened.goto('/')
  await expect(reopened).toHaveURL(/\/manage\/approvals$/)
  await expect(heading(reopened, 'Approvals')).toBeVisible()

  // It happens once: My Work is still My Work, even after a refresh.
  await menu(reopened).getByRole('link', { name: 'My Work' }).click()
  await expect(heading(reopened, /^Hi, /)).toBeVisible()
  await reopened.reload()
  await expect(heading(reopened, /^Hi, /)).toBeVisible()

  // A link to a particular page goes to that page.
  const linked = await page.context().newPage()
  await linked.goto('/manage/designs')
  await expect(linked).toHaveURL(/\/manage\/designs$/)
  await expect(heading(linked, 'Designs')).toBeVisible()
  await linked.close()

  // Signing out from any page and back in starts at the landing screen again.
  await menu(reopened).getByRole('link', { name: 'People' }).click()
  await expect(heading(reopened, 'People')).toBeVisible()
  await menu(reopened).getByRole('button', { name: 'Sign out' }).click()
  await reopened.getByLabel('Email').fill(need('PRIVACY_TEST_MANAGER_EMAIL'))
  await reopened.getByLabel('Password').fill(need('PRIVACY_TEST_MANAGER_PASSWORD'))
  await reopened.getByRole('button', { name: 'Sign in' }).click()
  await expect(reopened).toHaveURL(/\/manage\/approvals$/, { timeout: 20_000 })
  await expect(heading(reopened, 'Approvals')).toBeVisible()
  await reopened.close()
})

test('a manager can choose My Work, which stays on the phone too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signInAsManager(page)
  await menu(page).getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel('Open the app on').selectOption({ label: 'My Work' })
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
  await shot(page, '38-settings-phone')

  const reopened = await page.context().newPage()
  await reopened.setViewportSize({ width: 390, height: 844 })
  await reopened.goto('/')
  await expect(heading(reopened, /^Hi, /)).toBeVisible()
  await expect(reopened).toHaveURL(/:\d+\/$/)
  await reopened.close()
})

test('an artist always opens on My Work and cannot reach Settings', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/settings')
  await expect(heading(page, /^Hi, /)).toBeVisible()
  await expect(page.getByLabel('Open the app on')).toHaveCount(0)
})
