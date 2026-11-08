import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { adminClient, managerClient, need, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Manager portal, People (brief: Accounts).  Real logins are made through the
 * manage-account function and each one is signed in with, so these tests prove
 * the whole path.  The throwaway account never gets a pay rate, because a rate
 * can never be deleted and would then stop the account being cleaned up.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

// Runs even if a test times out, which a finally block inside the test does not.
let cleanUp: (() => Promise<void>) | null = null
test.afterEach(async () => {
  await cleanUp?.()
  cleanUp = null
})

test('a manager creates a login, resets its password, and deactivates and reactivates it', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const admin = adminClient()
  const run = randomUUID().slice(0, 8)
  const name = `Test Person ${run}`
  const email = `test.person.${run}@igniteglass.com`
  const firstPassword = `First-${randomUUID()}`
  const secondPassword = `Second-${randomUUID()}`
  let personId = ''

  const theirContext = await browser.newContext()
  const theirPage = await theirContext.newPage()

  cleanUp = async () => {
    await theirContext.close()
    const { data } = await admin.from('profiles').select('id').eq('email', email)
    for (const row of (data ?? []) as { id: string }[]) {
      const { error } = await admin.auth.admin.deleteUser(row.id)
      expect(error, 'the test account was removed').toBeNull()
    }
  }

  await signInAsManager(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'People', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /Test Artist/ })).toContainText('Artist')
  await shot(page, '28-people-list')

  // The form says where it stands, and refuses bad details without saving.
  await page.getByRole('link', { name: 'Add person' }).click()
  await expect(page.getByRole('status')).toHaveText('Not saved yet')
  await page.getByLabel('Full name').fill(name)
  await expect(page.getByRole('status')).toHaveText('Unsaved changes')
  await page.getByLabel('Login email').fill(`test.person.${run}@gmail.com`)
  await page.getByLabel('Password', { exact: true }).fill(firstPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText('igniteglass.com address')

  await page.getByLabel('Login email').fill(email.toUpperCase())
  await page.getByLabel('Password', { exact: true }).fill('short')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText('at least 8 characters')

  await page.getByLabel('Password', { exact: true }).fill(firstPassword)
  await page.getByLabel(/Alternate emails/).fill(`Personal.${run}@Example.com\npersonal.${run}@example.com`)
  await shot(page, '29-new-person')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Account created.')).toBeVisible()
  personId = page.url().split('/').pop()!

  // Lower-cased, repeats removed, and no rate yet shows as missing, never zero.
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByLabel(/Alternate emails/)).toHaveValue(`personal.${run}@example.com`)
  await expect(page.getByTestId('current-rate')).toHaveText('Missing')

  // The same email cannot be used twice, and what was typed stays.
  await page.goto('/manage/people/new')
  await page.getByLabel('Full name').fill(`${name} again`)
  await page.getByLabel('Login email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(firstPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toContainText('already exists', { timeout: 20_000 })
  await expect(page.getByLabel('Full name')).toHaveValue(`${name} again`)

  // One address belongs to one person, because calendars match on it.
  await page.goto(`/manage/people/${personId}`)
  const details = page.locator('form', { has: page.getByLabel('Full name') })
  await page.getByLabel(/Alternate emails/).fill(need('PRIVACY_TEST_ARTIST_EMAIL'))
  await details.getByRole('button', { name: 'Save changes' }).click()
  await expect(details.getByRole('status')).toContainText('already belongs to Test Artist')
  await page.getByLabel(/Alternate emails/).fill(`second.${run}@example.com`)
  await details.getByRole('button', { name: 'Save changes' }).click()
  await expect(details.getByRole('status')).toContainText('Saved')
  await page.reload()
  await expect(page.getByLabel(/Alternate emails/)).toHaveValue(`second.${run}@example.com`)

  // A new password replaces the old one.
  const passwordForm = page.locator('form', { has: page.getByLabel('New password') })
  await passwordForm.getByLabel('New password').fill('short')
  await passwordForm.getByRole('button', { name: 'Set password' }).click()
  await expect(passwordForm.getByRole('status')).toContainText('at least 8 characters')
  await passwordForm.getByLabel('New password').fill(secondPassword)
  await passwordForm.getByRole('button', { name: 'Set password' }).click()
  await expect(passwordForm.getByRole('status')).toContainText('Saved', { timeout: 20_000 })
  await expect(passwordForm.getByLabel('New password')).toHaveValue('')
  await shot(page, '30-person-page')

  await theirPage.goto('/')
  await theirPage.getByLabel('Email').fill(email)
  await theirPage.getByLabel('Password').fill(firstPassword)
  await theirPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(theirPage.getByRole('alert')).toBeVisible({ timeout: 20_000 })

  // They sign in as an artist and see no manager screens.
  await theirPage.getByLabel('Password').fill(secondPassword)
  await theirPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(theirPage.getByRole('heading', { name: /^Hi, / })).toBeVisible({ timeout: 20_000 })
  await theirPage.goto('/manage/people')
  await expect(theirPage.getByRole('heading', { name: /^Hi, / })).toBeVisible()
  await expect(theirPage.getByRole('link', { name: 'Add person' })).toHaveCount(0)

  // Deactivating asks first.  "Keep active" changes nothing.
  await page.getByRole('button', { name: 'Deactivate account' }).click()
  await page.getByRole('button', { name: 'Keep active' }).click()
  await page.getByRole('button', { name: 'Deactivate account' }).click()
  await page.getByRole('button', { name: 'Yes, deactivate' }).click()
  await expect(page.locator('.notice.warn')).toContainText('This account is deactivated.')

  // Their rates are frozen and they lose access straight away.
  await expect(page.getByLabel('New rate ($ per hour)')).toHaveCount(0)
  await expect(page.getByText('Rates are frozen')).toBeVisible()
  await theirPage.reload()
  await expect(theirPage.getByText('Your account is not active.')).toBeVisible()

  // It moves to the Deactivated list; nothing is deleted.
  await page.goto('/manage/people')
  await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0)
  await page.getByRole('button', { name: 'Deactivated' }).click()
  await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Deactivated')

  // Reactivating restores access.
  await page.getByRole('link', { name }).click()
  await page.getByRole('button', { name: 'Reactivate account' }).click()
  await expect(page.getByLabel('New rate ($ per hour)')).toBeVisible()
  await theirPage.reload()
  await expect(theirPage.getByRole('heading', { name: /^Hi, / })).toBeVisible()
})

test('pay rates are dated and added as new rows, never overwritten', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const rate = (20 + Math.floor(Math.random() * 9000) / 100).toFixed(2)
  const { data: before } = await mgr.from('pay_rates').select('id, hourly_rate, effective_from').eq('profile_id', artistId)

  await signInAsManager(page)
  await page.goto(`/manage/people/${artistId}`)
  const form = page.locator('form', { has: page.getByLabel('New rate ($ per hour)') })

  await form.getByRole('button', { name: 'Add rate' }).click()
  await expect(form.getByRole('status')).toContainText('above zero')

  // Dated in 2001 so it cannot affect any real figure or the worked example.
  await form.getByLabel('New rate ($ per hour)').fill(rate)
  await form.getByLabel('Starts on').fill('2001-02-03')
  await form.getByRole('button', { name: 'Add rate' }).click()
  await expect(form.getByRole('status')).toContainText('Saved')
  await expect(page.getByTestId('rate-history')).toContainText(`$${rate}`)
  await expect(page.getByTestId('rate-history')).toContainText('From Feb 3, 2001')

  // Exactly one new row, and every older row is exactly as it was.
  const { data: after } = await mgr.from('pay_rates').select('id, hourly_rate, effective_from').eq('profile_id', artistId)
  expect((after ?? []).length).toBe((before ?? []).length + 1)
  expect(after).toEqual(expect.arrayContaining(before ?? []))
  await mgr.auth.signOut()
})

test('a manager cannot lock themselves out', async ({ page }) => {
  const mgr = await managerClient()
  const { managerId } = await testPeople(mgr)
  await mgr.auth.signOut()

  await signInAsManager(page)
  await page.goto(`/manage/people/${managerId}`)
  await expect(page.getByText('You cannot deactivate your own account.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deactivate account' })).toHaveCount(0)
  await expect(page.getByLabel('Role')).toBeDisabled()
})

test('an artist cannot reach the People screens', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/people')
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add person' })).toHaveCount(0)
})
