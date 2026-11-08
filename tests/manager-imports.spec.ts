import { devices, expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsManager, testPeople } from './helpers.ts'

/**
 * Imports (brief: Time, uAttend and the tracker).  Uploads a made-up uAttend
 * Timecard Report in the real export's layout, for the test accounts in a week
 * of January 2001, so no real person's hours are touched:
 *
 *   Test Artist   Mon 8:00, Tue 6:30 (two punches), Thu missing clock-out, Fri 4:15
 *   Test Manager  Mon 4:00
 *   Pat Example   not in the tracker (skipped)
 *
 * Checks the preview, the name matching, the save, that uploading the same week
 * again replaces rather than duplicates, the import history, fixing a match
 * afterwards, and the friendly refusal of the weekly-totals export.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const FROM = '2001-01-07'
const TO = '2001-01-13'
const WEEK_FILE = 'tests/fixtures/uattend-test-week.csv'
const TOTALS_FILE = 'tests/fixtures/uattend-weekly-totals.csv'
const NAME_KEYS = ['test artist', 'test manager', 'pat example']

async function tidy(mgr: SupabaseClient, artistId: string, managerId: string): Promise<void> {
  const { data: imports } = await mgr.from('uattend_imports').select('id').eq('period_from', FROM).eq('period_to', TO)
  await mgr.from('uattend_days').delete().in('artist_id', [artistId, managerId]).gte('work_date', FROM).lte('work_date', TO)
  const ids = ((imports ?? []) as { id: string }[]).map((i) => i.id)
  if (ids.length > 0) await mgr.from('uattend_imports').delete().in('id', ids)
  await mgr.from('uattend_names').delete().in('name_key', NAME_KEYS)
}

test('a manager uploads a uAttend week, checks the preview, saves, re-uploads and fixes a match', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  await tidy(mgr, artistId, managerId)

  try {
    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Imports' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Imports' })).toBeVisible()

    // The weekly-totals version is refused with an explanation.
    await page.getByLabel('Timecard Report (CSV file)').setInputFiles(TOTALS_FILE)
    await expect(page.getByRole('alert')).toContainText('weekly-totals version')
    await expect(page.getByTestId('uattend-preview')).toHaveCount(0)

    // The daily version shows a preview, with nothing saved yet.
    await page.getByLabel('Timecard Report (CSV file)').setInputFiles(WEEK_FILE)
    const preview = page.getByTestId('uattend-preview')
    await expect(preview).toContainText('Preview: nothing is saved yet')
    await expect(preview).toContainText('pay period Jan 7 – Jan 13, 2001')
    await expect(preview).toContainText('3 people in the file')

    const artistRow = preview.getByRole('row', { name: /Test Artist/ })
    await expect(artistRow).toContainText('Suggested match')
    await expect(artistRow).toContainText('8h') // Monday
    await expect(artistRow).toContainText('6h 30m') // Tuesday's two punches
    await expect(artistRow).toContainText('Missing punch') // Thursday, never zero
    await expect(artistRow).toContainText('18h 45m')
    await expect(artistRow).toContainText("Matches uAttend's total")
    await expect(page.getByLabel('Tracker person for Test Artist')).toHaveValue(artistId)
    await expect(page.getByLabel('Tracker person for Test Manager')).toHaveValue(managerId)

    // A new name has to be decided before saving.
    const patRow = preview.getByRole('row', { name: /Pat Example/ })
    await expect(patRow).toContainText('New name')
    await expect(page.getByRole('button', { name: /^Save hours/ })).toBeDisabled()
    await expect(preview.getByRole('status')).toContainText('Choose who one new name is')

    // Two names cannot be matched to one person.
    await page.getByLabel('Tracker person for Pat Example').selectOption({ label: 'Test Artist' })
    await expect(preview.getByRole('status')).toContainText('are both matched to Test Artist')
    await expect(page.getByRole('button', { name: /^Save hours/ })).toBeDisabled()

    await page.getByLabel('Tracker person for Pat Example').selectOption({ label: 'Not in the tracker (skip)' })
    await expect(preview.getByRole('status')).toContainText('2 people to save, 1 skipped')
    await shot(page, '30-uattend-preview')
    await page.getByRole('button', { name: 'Save hours for 2 people' }).click()
    await expect(page.getByText('Saved uAttend hours for 2 people, Jan 7 – Jan 13, 2001.')).toBeVisible()
    await expect(page.getByTestId('uattend-preview')).toHaveCount(0)

    // Every day of the week is stored, 0 on days with no punches, the missing punch kept as missing.
    const { data: days } = await mgr
      .from('uattend_days')
      .select('work_date, clocked_minutes, missing_punch')
      .eq('artist_id', artistId)
      .gte('work_date', FROM)
      .lte('work_date', TO)
      .order('work_date')
    expect(days).toEqual([
      { work_date: '2001-01-07', clocked_minutes: 0, missing_punch: false },
      { work_date: '2001-01-08', clocked_minutes: 480, missing_punch: false },
      { work_date: '2001-01-09', clocked_minutes: 390, missing_punch: false },
      { work_date: '2001-01-10', clocked_minutes: 0, missing_punch: false },
      { work_date: '2001-01-11', clocked_minutes: null, missing_punch: true },
      { work_date: '2001-01-12', clocked_minutes: 255, missing_punch: false },
      { work_date: '2001-01-13', clocked_minutes: 0, missing_punch: false },
    ])

    // The history shows the upload.
    const history = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Skipped names' }) })
    const firstUpload = history.getByRole('row', { name: /Jan 7 – Jan 13, 2001/ })
    await expect(firstUpload).toContainText('2 people, 14 days')
    await expect(firstUpload).toContainText('1 day with a missing punch')
    await expect(firstUpload).toContainText('Pat Example')
    await expect(firstUpload).toContainText('In use')

    // The same week again: the names are remembered, and the days are replaced, not doubled.
    await page.getByLabel('Timecard Report (CSV file)').setInputFiles(WEEK_FILE)
    await expect(preview).toContainText('This period was already uploaded')
    await expect(preview.getByRole('row', { name: /Pat Example/ })).not.toContainText('New name')
    await expect(preview.getByLabel('Tracker person for Pat Example')).toHaveValue('skip')
    await page.getByRole('button', { name: 'Save hours for 2 people' }).click()
    await expect(page.getByText('Saved uAttend hours for 2 people')).toBeVisible()
    const { count } = await mgr
      .from('uattend_days')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', artistId)
      .gte('work_date', FROM)
      .lte('work_date', TO)
    expect(count).toBe(7)
    const rows = history.getByRole('row', { name: /Jan 7 – Jan 13, 2001/ })
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('In use')
    await expect(rows.nth(1)).toContainText('Replaced by a later upload')
    await shot(page, '31-uattend-history')

    // Fixing a match afterwards: Test Manager's hours are removed when the name is not anyone.
    const known = page.getByRole('region', { name: 'uAttend names' }).getByLabel('Tracker person for Test Manager')
    await known.selectOption({ label: 'Not in the tracker (skip)' })
    await expect(page.getByText('Hours already imported for Test Manager will be removed.')).toBeVisible()
    await page.getByRole('button', { name: 'Save match' }).click()
    await expect(page.getByText('Match saved')).toBeVisible()
    const { count: managerDays } = await mgr
      .from('uattend_days')
      .select('id', { count: 'exact', head: true })
      .eq('artist_id', managerId)
      .gte('work_date', FROM)
      .lte('work_date', TO)
    expect(managerDays).toBe(0)
  } finally {
    await tidy(mgr, artistId, managerId)
  }
})
