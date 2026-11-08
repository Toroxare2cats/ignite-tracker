import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Tasks, manager side (brief: Task lists).  A manager creates a weekly task for
 * two people; one of them (a real artist login) completes it on a phone; the
 * next occurrence appears on the next date of the schedule that has not
 * passed, and only one is open.  Then reopen, stop repeating, the Everyone
 * filters, and approving an artist's personal item.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** start + k months, keeping the day of the month where the month allows (as Postgres does). */
function addMonths(iso: string, k: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + k, Math.min(d, last))).toISOString().slice(0, 10)
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)))
}

let cleanUp: (() => Promise<void>) | null = null
test.afterEach(async () => {
  await cleanUp?.()
  cleanUp = null
})

test('a weekly task for two people comes back once, on the right date; reopen and stop repeating', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const title = `Weekly kiln wipe ${run}`
  const today = chicagoToday()
  const firstDue = addDays(today, -10) // done late: Mon schedule logic, skip dates already past
  const expectedNext = addDays(firstDue, 14) // firstDue + 7 is still in the past; + 14 is the next one not yet past

  cleanUp = async () => {
    const { data } = await mgr.from('tasks').select('id').like('title', `%${run}%`)
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length) await mgr.from('tasks').delete().in('id', ids)
  }

  // --- The manager creates it -------------------------------------------------------
  await signInAsManager(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click()
  await expect(page.getByRole('tab', { name: 'Mine' })).toBeVisible()
  await page.getByRole('link', { name: 'New task' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('Note (optional)').fill('Wipe the kiln shelves and log it')
  await page.getByLabel('Test Artist').check()
  await page.getByLabel(/^Test Manager/).check()
  await page.getByLabel('Priority').selectOption('high')
  await page.getByLabel('Repeats').selectOption('weekly')
  await page.getByLabel('First due date').fill(firstDue)
  await expect(page.getByText(/next one appears on the next date of the schedule that has not passed/)).toBeVisible()
  await shot(page, '52-task-form')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText(/Task created for Test Artist, Test Manager/)).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Everyone' })).toHaveAttribute('aria-selected', 'true')

  const card = page.getByTestId('everyone-open').getByTestId('task').filter({ hasText: title })
  await expect(card).toContainText('Assigned to Test Artist and Test Manager')
  await expect(card).toContainText('Every week')
  await expect(card).toContainText('High')
  await shot(page, '53-tasks-everyone')

  // --- One of them, a real artist login on a phone, completes it ---------------------
  const { isMobile: _pm, ...pixel } = devices['Pixel 7']
  const phone = await browser.newContext({ ...pixel, baseURL: test.info().project.use.baseURL })
  const artistPage = await phone.newPage()
  try {
    await signInAsArtist(artistPage)
    await artistPage.goto('/tasks')
    const mine = artistPage.locator('ul.tasks').first().getByTestId('task').filter({ hasText: title })
    await expect(mine).toContainText('With Test Manager')
    await expect(mine).toContainText(/Overdue/)
    await mine.getByRole('button', { name: /Mark .* done/ }).click()
    await expect(artistPage.getByText(`The next one is due ${shortDate(expectedNext)}.`)).toBeVisible()
    await expect(artistPage.locator('ul.tasks').first().getByTestId('task').filter({ hasText: title })).toContainText(
      `Due ${shortDate(expectedNext)}`,
    )
    await shot(artistPage, '54-weekly-next-occurrence')
  } finally {
    await phone.close()
  }

  // In the database: one done (by the artist), exactly one open, on the right date, both people on it.
  const { data: rows } = await mgr.from('tasks').select('id, status, due_date, completed_by, series_id, task_assignees(profile_id)').eq('title', title)
  const all = rows as { id: string; status: string; due_date: string; completed_by: string | null; series_id: string; task_assignees: { profile_id: string }[] }[]
  expect(all).toHaveLength(2)
  const done = all.find((r) => r.status === 'done')!
  const open = all.filter((r) => r.status === 'open')
  expect(done.completed_by).toBe(artistId)
  expect(open).toHaveLength(1)
  expect(open[0].due_date).toBe(expectedNext)
  expect(open[0].series_id).toBe(done.series_id)
  expect(open[0].task_assignees.map((a) => a.profile_id).sort()).toEqual([artistId, managerId].sort())

  // The database itself refuses a second open occurrence.
  const { error: dupErr } = await mgr.from('tasks').insert({ title, series_id: done.series_id })
  expect(dupErr?.message ?? '').toMatch(/tasks_one_open_per_series/)

  // --- Reopen the done one: the occurrence it made is taken back, still one open -------
  await page.reload()
  await page.getByTestId('everyone-done').locator('summary').click()
  const doneCard = page.getByTestId('everyone-done').getByTestId('task').filter({ hasText: title })
  await expect(doneCard).toContainText('Done by Test Artist')
  await doneCard.getByRole('button', { name: 'Reopen' }).click()
  await expect(page.getByText(/was taken back, so only one is open/)).toBeVisible()
  const { data: afterReopen } = await mgr.from('tasks').select('id, status, completed_by').eq('title', title)
  expect(afterReopen).toEqual([{ id: done.id, status: 'open', completed_by: null }])

  // --- Stop repeating: no next one after it ------------------------------------------------
  const openCard = page.getByTestId('everyone-open').getByTestId('task').filter({ hasText: title })
  // Wait for the list to refresh: the open one is now the reopened one, with its own due date.
  await expect(openCard).toContainText(`was due ${shortDate(firstDue)}`)
  await expect(openCard).toHaveCount(1)
  await openCard.getByRole('button', { name: 'Stop repeating' }).click()
  await openCard.getByRole('button', { name: 'Yes, stop' }).click()
  await expect(page.getByText(`“${title}” will not repeat any more.`)).toBeVisible()
  await expect(page.getByTestId('everyone-open').getByTestId('task').filter({ hasText: title })).not.toContainText('Every week')
  await page.getByTestId('everyone-open').getByTestId('task').filter({ hasText: title }).getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText(`Done: “${title}”.`)).toBeVisible()
  const { data: afterStop } = await mgr.from('tasks').select('status').eq('title', title)
  expect(afterStop).toEqual([{ status: 'done' }])
})

test('edit, filters, and the monthly schedule keeps the day of the month', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const today = chicagoToday()

  cleanUp = async () => {
    const { data } = await mgr.from('tasks').select('id').like('title', `%${run}%`)
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length) await mgr.from('tasks').delete().in('id', ids)
  }

  const save = async (title: string, assignees: string[], extra: Record<string, unknown> = {}) => {
    const { data, error } = await mgr.rpc('save_task', {
      p_task_id: null,
      p_title: title,
      p_note: null,
      p_priority: 'normal',
      p_due_date: null,
      p_order_id: null,
      p_recurrence: null,
      p_assignees: assignees,
      ...extra,
    })
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }

  // Monthly from Jan 31: the next one is the first month-end-ish date after today.
  const monthlyId = await save(`Monthly ${run}`, [managerId], { p_recurrence: 'monthly', p_due_date: '2026-01-31' })
  const { error: cErr } = await mgr.rpc('complete_task', { p_task_id: monthlyId })
  if (cErr) throw new Error(cErr.message)
  let k = 1
  while (addMonths('2026-01-31', k) <= today) k++
  const { data: next } = await mgr.from('tasks').select('due_date').eq('previous_task_id', monthlyId).single()
  expect((next as { due_date: string }).due_date).toBe(addMonths('2026-01-31', k))

  // A repeating task without a first due date is refused.
  const { error: noDate } = await mgr.rpc('save_task', {
    p_task_id: null, p_title: `No date ${run}`, p_note: null, p_priority: 'normal', p_due_date: null,
    p_order_id: null, p_recurrence: 'weekly', p_assignees: [managerId],
  })
  expect(noDate?.message ?? '').toMatch(/first due date/)

  await save(`Artist only ${run}`, [artistId], { p_due_date: today })
  await save(`Manager only ${run}`, [managerId], { p_due_date: addDays(today, -1) })

  await signInAsManager(page)
  await page.goto('/tasks?view=everyone')
  const open = page.getByTestId('everyone-open')
  await expect(open.getByText(`Artist only ${run}`)).toBeVisible()
  await page.getByLabel('Person').selectOption({ label: 'Test Artist' })
  await expect(open.getByText(`Manager only ${run}`)).toHaveCount(0)
  await expect(open.getByText(`Artist only ${run}`)).toBeVisible()
  await page.getByLabel('Person').selectOption('')
  await page.getByLabel('Due').selectOption('overdue')
  await expect(open.getByText(`Manager only ${run}`)).toBeVisible()
  await expect(open.getByText(`Artist only ${run}`)).toHaveCount(0)
  await page.getByLabel('Due').selectOption('today')
  await expect(open.getByText(`Artist only ${run}`)).toBeVisible()
  await page.getByLabel('Due').selectOption('all')

  // Edit: change the title, priority and who it is assigned to.
  await open.getByTestId('task').filter({ hasText: `Artist only ${run}` }).getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('heading', { name: 'Edit task' })).toBeVisible()
  await page.getByLabel('Title').fill(`Both now ${run}`)
  await page.getByLabel('Priority').selectOption('low')
  await page.getByLabel(/^Test Manager/).check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Task saved.')).toBeVisible()
  const { data: edited } = await mgr.from('tasks').select('priority, edited_by, task_assignees(profile_id)').eq('title', `Both now ${run}`).single()
  const e = edited as { priority: string; edited_by: string; task_assignees: { profile_id: string }[] }
  expect(e.priority).toBe('low')
  expect(e.edited_by).toBe(managerId)
  expect(e.task_assignees.map((a) => a.profile_id).sort()).toEqual([artistId, managerId].sort())

  // Phone width: the same screens, nothing hidden (rule 14).
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tasks?view=everyone')
  await expect(page.getByRole('link', { name: 'New task' })).toBeVisible()
  await expect(page.getByLabel('Person')).toBeVisible()
  await page.getByRole('link', { name: 'New task' }).click()
  await expect(page.getByLabel('Repeats')).toBeVisible()
  await shot(page, '55-task-form-phone')
})

test('a manager approves an artist’s personal item; the artist sees where it went', async ({ page, browser }) => {
  const mgr = await managerClient()
  const run = randomUUID().slice(0, 8)
  const text = `Torch hose is cracked ${run}`

  cleanUp = async () => {
    const { data } = await mgr.from('personal_items').select('id, task_id').eq('text', text)
    for (const item of (data ?? []) as { id: string; task_id: string | null }[]) {
      await mgr.from('personal_items').delete().eq('id', item.id)
      if (item.task_id) await mgr.from('tasks').delete().eq('id', item.task_id)
    }
  }

  const { isMobile: _pm, ...pixel } = devices['Pixel 7']
  const phone = await browser.newContext({ ...pixel, baseURL: test.info().project.use.baseURL })
  const artistPage = await phone.newPage()
  try {
    await signInAsArtist(artistPage)
    await artistPage.goto('/tasks')
    await artistPage.getByLabel('Add to your list').fill(text)
    await artistPage.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(artistPage.getByText('Added to your list')).toBeVisible()

    await signInAsManager(page)
    await page.goto('/tasks?view=everyone')
    const owner = page.getByTestId('owner-list').filter({ has: page.getByRole('heading', { name: /Test Artist/ }) })
    const item = owner.getByTestId('personal-item').filter({ hasText: text })
    await item.getByRole('link', { name: 'Approve as task' }).click()
    await expect(page.getByRole('heading', { name: 'Approve into a task' })).toBeVisible()
    await expect(page.getByText(text)).toBeVisible()
    await page.getByLabel(/^Test Manager/).check()
    await page.getByLabel('Priority').selectOption('high')
    await page.getByLabel('Due date (optional)').fill(addDays(chicagoToday(), 2))
    await page.getByRole('button', { name: 'Approve as task' }).click()
    await expect(page.getByText(/Approved\. .* is now a task for Test Manager\. Test Artist will see where it went\./)).toBeVisible()
    await expect(page.getByTestId('everyone-open').getByTestId('task').filter({ hasText: text })).toContainText('High')
    await expect(owner.getByTestId('personal-item').filter({ hasText: text })).toContainText('Approved → task')
    await expect(owner.getByTestId('personal-item').filter({ hasText: text }).getByRole('link', { name: 'Approve as task' })).toHaveCount(0)

    await artistPage.reload()
    const approved = artistPage.getByTestId('personal-item').filter({ hasText: text })
    await expect(approved).toContainText('Approved → task')
    await expect(approved).toContainText('Went to Test Manager')
    await shot(artistPage, '56-approved-item-artist')
  } finally {
    await phone.close()
  }
})
