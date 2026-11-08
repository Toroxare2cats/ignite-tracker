import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Tasks on other screens (brief: Task lists, Screens, Reports and views):
 * open tasks on the order page (order name only; an artist sees only their
 * own), the open-task count on My Work, the due-today / overdue strip on
 * Today, and tasks done each day in My Week and Artist week.
 */

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

async function saveTask(mgr: SupabaseClient, title: string, assignees: string[], extra: Record<string, unknown> = {}): Promise<string> {
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

/** A throwaway design and order, removed afterwards. */
async function makeOrder(mgr: SupabaseClient, run: string, primary: string) {
  const { data: design, error: dErr } = await mgr.from('designs').insert({ name: `Task screens design ${run}` }).select('id').single()
  if (dErr) throw new Error(dErr.message)
  const designId = (design as { id: string }).id
  const { data: order, error: oErr } = await mgr
    .from('orders')
    .insert({ name: `Task screens order ${run}`, design_id: designId, bottles_ordered: 10, due_date: addDays(chicagoToday(), 20), primary_artist_id: primary })
    .select('id')
    .single()
  if (oErr) throw new Error(oErr.message)
  return { designId, orderId: (order as { id: string }).id }
}

let cleanUp: (() => Promise<void>) | null = null
test.afterEach(async () => {
  await cleanUp?.()
  cleanUp = null
})

test('artist: order page shows only my open tasks for it, My Work counts them, My Week shows what I did', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const { designId, orderId } = await makeOrder(mgr, run, artistId)
  cleanUp = async () => {
    await mgr.from('tasks').delete().like('title', `%${run}%`)
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
  }

  await saveTask(mgr, `Pack order ${run}`, [artistId, managerId], { p_order_id: orderId, p_priority: 'high', p_due_date: chicagoToday() })
  await saveTask(mgr, `Manager order job ${run}`, [managerId], { p_order_id: orderId })

  await signInAsArtist(page)
  const myWorkTasks = page.getByTestId('my-work-tasks')
  await expect(myWorkTasks).toContainText(/\d+ open tasks?/)
  await myWorkTasks.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()

  await page.goto(`/orders/${orderId}`)
  const section = page.getByTestId('order-tasks')
  const card = section.getByTestId('task').filter({ hasText: `Pack order ${run}` })
  await expect(card).toContainText('High')
  await expect(card).toContainText('Due today')
  await expect(card).toContainText('With Test Manager')
  await expect(card).not.toContainText('Order:') // the page is the order; no need to repeat it
  await expect(section.getByText(`Manager order job ${run}`)).toHaveCount(0) // not assigned to the artist
  await shot(page, '57-order-tasks-artist')

  await card.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText(`Done: “Pack order ${run}”.`)).toBeVisible()
  await expect(section.getByText(`Pack order ${run}`)).toHaveCount(0)

  // The entry form never mentions tasks (rule 12).
  await page.getByRole('link', { name: /today's entry/ }).click()
  await expect(page.getByRole('heading', { name: /entry/i }).first()).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/open tasks?|assigned to you|your list|mark .* done/i)
  await expect(page.locator('main')).not.toContainText(`Pack order ${run}`)

  await page.goto('/week')
  const today = page.locator('section.day').filter({ hasText: 'Today' })
  await expect(today.getByTestId('tasks-done-day')).toContainText(`Pack order ${run}`)
  await expect(page.getByText(/\d+ tasks? done/)).toBeVisible()
  await shot(page, '58-my-week-tasks')
})

test.describe('manager', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Today strip, the manager order page, and tasks done in Artist week', async ({ page }) => {
    const mgr = await managerClient()
    const { artistId, managerId } = await testPeople(mgr)
    const run = randomUUID().slice(0, 8)
    const today = chicagoToday()
    const { designId, orderId } = await makeOrder(mgr, run, artistId)
    cleanUp = async () => {
      await mgr.from('tasks').delete().like('title', `%${run}%`)
      await mgr.from('orders').delete().eq('id', orderId)
      await mgr.from('designs').delete().eq('id', designId)
    }

    await saveTask(mgr, `Overdue strip ${run}`, [artistId], { p_due_date: addDays(today, -3), p_order_id: orderId })
    await saveTask(mgr, `Today strip ${run}`, [managerId, artistId], { p_due_date: today })
    await saveTask(mgr, `Tomorrow strip ${run}`, [artistId], { p_due_date: addDays(today, 1) })
    const doneId = await saveTask(mgr, `Done by manager ${run}`, [managerId])
    const { error } = await mgr.rpc('complete_task', { p_task_id: doneId })
    if (error) throw new Error(error.message)
    // Shared, ticked off by the manager: it counts in both people's weeks (Arvin, 2026-11-08).
    const sharedId = await saveTask(mgr, `Shared done ${run}`, [managerId, artistId])
    const { error: sErr } = await mgr.rpc('complete_task', { p_task_id: sharedId })
    if (sErr) throw new Error(sErr.message)

    await signInAsManager(page)
    await page.goto('/manage/dashboard')
    const strip = page.getByTestId('task-strip')
    await expect(strip.getByRole('listitem').filter({ hasText: `Overdue strip ${run}` })).toContainText(/Overdue/)
    await expect(strip.getByRole('listitem').filter({ hasText: `Overdue strip ${run}` })).toContainText(`Test Artist · Task screens order ${run}`)
    await expect(strip.getByRole('listitem').filter({ hasText: `Today strip ${run}` })).toContainText('Due today')
    await expect(strip.getByText(`Tomorrow strip ${run}`)).toHaveCount(0)
    await expect(strip).toContainText(/\d+ overdue/)
    await shot(page, '59-today-task-strip')

    await page.goto(`/manage/orders/${orderId}`)
    const section = page.getByTestId('order-tasks')
    await expect(section.getByTestId('task').filter({ hasText: `Overdue strip ${run}` })).toContainText('Assigned to Test Artist')
    await section.getByRole('link', { name: '+ Task for this order' }).click()
    await expect(page.getByRole('heading', { name: 'New task' })).toBeVisible()
    await expect(page.getByLabel('Order (optional)')).toHaveValue(orderId)

    await page.goto('/manage/reports/artist-week')
    await page.getByLabel('Person').selectOption({ label: 'Test Manager' })
    const day = page.locator('section.day-card').filter({ has: page.getByTestId('tasks-done-day') }).filter({ hasText: `Done by manager ${run}` })
    await expect(day).toBeVisible()
    await expect(page.getByTestId('week-counts')).toContainText(/\d+ tasks? done/)
    const sharedLine = page.getByTestId('tasks-done-day').getByRole('listitem').filter({ hasText: `Shared done ${run}` })
    await expect(sharedLine).toBeVisible()
    await expect(sharedLine).not.toContainText('done by') // the manager ticked it off themselves
    await shot(page, '60-artist-week-tasks')

    await page.getByLabel('Person').selectOption({ label: 'Test Artist' })
    const artistLine = page.getByTestId('tasks-done-day').getByRole('listitem').filter({ hasText: `Shared done ${run}` })
    await expect(artistLine).toContainText('done by Test Manager')
    await expect(page.getByTestId('tasks-done-day').getByText(`Done by manager ${run}`)).toHaveCount(0) // not on it
    await shot(page, '61-artist-week-shared-task')
  })
})
