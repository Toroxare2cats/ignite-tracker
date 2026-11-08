import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managerClient, shot, signInAsArtist, testPeople } from './helpers.ts'

/**
 * Tasks tab, artist side (brief: Task lists).  A manager's client plants tasks
 * for the test artist; the artist, on a phone-sized screen, sees them in the
 * brief's order with title, note, priority, due date, order name and
 * co-assignees, marks one done with one tap, and keeps a personal list that a
 * manager approves into a task.
 */

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

async function insertTask(mgr: SupabaseClient, row: Record<string, unknown>, assignees: string[]): Promise<string> {
  const { data, error } = await mgr.from('tasks').insert(row).select('id').single()
  if (error) throw new Error(error.message)
  const id = (data as { id: string }).id
  const { error: aErr } = await mgr.from('task_assignees').insert(assignees.map((p) => ({ task_id: id, profile_id: p })))
  if (aErr) throw new Error(aErr.message)
  return id
}

let cleanUp: (() => Promise<void>) | null = null
test.afterEach(async () => {
  await cleanUp?.()
  cleanUp = null
})

test('an artist sees their tasks in order, marks one done, and keeps a personal list', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const today = chicagoToday()
  const taskIds: string[] = []
  const createdItems: string[] = []

  const { data: order, error: oErr } = await mgr.from('orders').select('id, name').neq('status', 'closed').limit(1).single()
  if (oErr) throw new Error(oErr.message)
  const { id: orderId, name: orderName } = order as { id: string; name: string }

  cleanUp = async () => {
    const { data: items } = await mgr.from('personal_items').select('id, task_id').like('text', `%${run}%`)
    for (const item of (items ?? []) as { id: string; task_id: string | null }[]) {
      if (item.task_id) taskIds.push(item.task_id)
      createdItems.push(item.id)
    }
    if (createdItems.length) await mgr.from('personal_items').delete().in('id', createdItems)
    if (taskIds.length) {
      await mgr.from('tasks').delete().in('previous_task_id', taskIds)
      await mgr.from('tasks').delete().in('id', taskIds)
    }
  }

  // Planted newest first, so the screen's order cannot come from insertion order.
  taskIds.push(await insertTask(mgr, { title: `Low no date ${run}`, priority: 'low' }, [artistId]))
  taskIds.push(await insertTask(mgr, { title: `Normal later ${run}`, priority: 'normal', due_date: addDays(today, 5) }, [artistId]))
  taskIds.push(await insertTask(mgr, { title: `High soon ${run}`, priority: 'high', due_date: addDays(today, 3) }, [artistId]))
  taskIds.push(
    await insertTask(
      mgr,
      { title: `Overdue low ${run}`, note: 'Sweep under bench 2', priority: 'low', due_date: addDays(today, -2), order_id: orderId },
      [artistId, managerId],
    ),
  )
  // Someone else's task: the artist must never see it.
  taskIds.push(await insertTask(mgr, { title: `Not yours ${run}` }, [managerId]))

  await signInAsArtist(page)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tasks' })).toBeVisible()

  const assigned = page.locator('ul.tasks').first()
  await expect(assigned.getByText(`Low no date ${run}`)).toBeVisible()
  const titles = (await assigned.getByTestId('task').locator('.task-title').allTextContents()).filter((t) => t.includes(run))
  expect(titles).toEqual([`Overdue low ${run}`, `High soon ${run}`, `Normal later ${run}`, `Low no date ${run}`])
  await expect(page.getByText(`Not yours ${run}`)).toHaveCount(0)

  const overdue = assigned.getByTestId('task').filter({ hasText: `Overdue low ${run}` })
  await expect(overdue).toContainText('Sweep under bench 2')
  await expect(overdue).toContainText('Low')
  await expect(overdue).toContainText(/Overdue · was due/)
  await expect(overdue).toContainText(`Order: ${orderName}`)
  await expect(overdue).toContainText('With Test Manager')
  await expect(assigned.getByTestId('task').filter({ hasText: `High soon ${run}` })).toContainText('Just you')
  await shot(page, '50-tasks-artist')

  // One tap marks it done for everyone, recording who and when.
  await overdue.getByRole('button', { name: /Mark .* done/ }).click()
  await expect(page.getByText(`Done: “Overdue low ${run}”.`)).toBeVisible()
  await expect(assigned.getByText(`Overdue low ${run}`)).toHaveCount(0)
  const { data: doneRow } = await mgr.from('tasks').select('status, completed_by, completed_at').eq('id', taskIds[3]).single()
  expect(doneRow).toMatchObject({ status: 'done', completed_by: artistId })
  expect((doneRow as { completed_at: string | null }).completed_at).not.toBeNull()
  await page.getByText(/Done in the last 7 days/).click()
  await expect(page.locator('details.done-recently').getByTestId('task').filter({ hasText: `Overdue low ${run}` })).toContainText(
    'Done by Test Artist',
  )

  // Personal list: one-line add, edit, delete.
  await page.getByLabel('Add to your list').fill(`Kiln shelf cracked ${run}`)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Added to your list')).toBeVisible()
  const item = page.getByTestId('personal-item').filter({ hasText: `Kiln shelf cracked ${run}` })
  await item.getByRole('button', { name: 'Edit' }).click()
  // While editing, the words sit in a box, so find the box itself.
  await page.getByLabel('Edit item').fill(`Kiln shelf 3 cracked ${run}`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const edited = page.getByTestId('personal-item').filter({ hasText: `Kiln shelf 3 cracked ${run}` })
  await expect(edited).toBeVisible()

  await page.getByLabel('Add to your list').fill(`Throwaway ${run}`)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const throwaway = page.getByTestId('personal-item').filter({ hasText: `Throwaway ${run}` })
  await throwaway.getByRole('button', { name: 'Delete' }).click()
  await throwaway.getByRole('button', { name: 'Yes, remove' }).click()
  await expect(page.getByTestId('personal-item').filter({ hasText: `Throwaway ${run}` })).toHaveCount(0)

  // A manager approves the item into a task for someone else; the artist sees where it went.
  const { data: own } = await mgr.from('personal_items').select('id').eq('text', `Kiln shelf 3 cracked ${run}`).single()
  const { error: apErr } = await mgr.rpc('approve_personal_item', {
    p_item_id: (own as { id: string }).id,
    p_assignees: [managerId],
    p_priority: 'high',
  })
  if (apErr) throw new Error(apErr.message)
  await page.reload()
  const approved = page.getByTestId('personal-item').filter({ hasText: `Kiln shelf 3 cracked ${run}` })
  await expect(approved).toContainText('Approved → task')
  await expect(approved).toContainText('Went to Test Manager')
  await expect(approved).toContainText('approved by Test Manager')
  await expect(approved.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  // The task itself is not the artist's to see.
  await expect(page.locator('ul.tasks').first().getByText(`Kiln shelf 3 cracked ${run}`)).toHaveCount(0)
  await shot(page, '51-tasks-personal-list')
})
