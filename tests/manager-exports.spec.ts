import { devices, expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Exports (brief: Operations, "Export").  A manager downloads each CSV and the
 * fixture rows are in them, with the financial columns filled in for a closed
 * order.  An artist cannot reach the screen, and the tables the exports read
 * from return nothing financial to an artist (the privacy test proves that).
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

test('a manager downloads the orders, entries, designs, tasks and purchases CSV files', async ({ page }) => {
  const mgr = await managerClient()
  const { artistId, managerId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)

  const { data: design } = await mgr.from('designs').insert({ name: `Export test design ${run}`, has_dabber: true }).select('id').single()
  const designId = (design as { id: string }).id
  const { data: order } = await mgr
    .from('orders')
    .insert({ name: `Export test order ${run}`, design_id: designId, bottles_ordered: 60, dabbers_ordered: 60, due_date: '2001-02-01', primary_artist_id: artistId })
    .select('id')
    .single()
  const orderId = (order as { id: string }).id
  let purchaseId = ''
  let taskId = ''

  try {
    const { data: entry } = await mgr
      .from('entries')
      .insert({ order_id: orderId, artist_id: managerId, work_date: '2001-01-02', bottles: 12, note: `Note with a comma, "quotes" and a\nline break ${run}` })
      .select('id')
      .single()
    await mgr.from('entry_time').insert({ entry_id: (entry as { id: string }).id, minutes: 120 })
    const { data: purchase } = await mgr
      .from('purchases')
      .insert({ artist_id: managerId, order_id: orderId, for_stock: false, description: `Export test purchase ${run}`, amount: 12.5 })
      .select('id')
      .single()
    purchaseId = (purchase as { id: string }).id
    await mgr.rpc('finish_order', { p_order_id: orderId })
    const { error: cErr } = await mgr.rpc('close_order', { p_order_id: orderId, p_bottles_delivered: 60, p_dabbers_delivered: 58, p_selling_price: 300, p_materials_total: 40 })
    if (cErr) throw new Error(cErr.message)

    await signInAsManager(page)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Exports' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Exports' })).toBeVisible()

    const download = async (name: string): Promise<string> => {
      const waiting = page.waitForEvent('download')
      await page.getByRole('button', { name: `Download ${name} CSV` }).click()
      const file = await waiting
      expect(file.suggestedFilename()).toMatch(new RegExp(`^ignite-${name.toLowerCase()}-\\d{4}-\\d{2}-\\d{2}\\.csv$`))
      const path = await file.path()
      return readFile(path, 'utf8')
    }

    const orders = await download('Orders')
    const orderLine = orders.split('\r\n').find((l) => l.includes(`Export test order ${run}`))!
    expect(orderLine).toBeTruthy()
    expect(orders.split('\r\n')[0]).toContain('"Selling price","Materials (manager total)"')
    expect(orderLine).toContain('"closed"')
    expect(orderLine).toContain('"60","58","300","40"') // delivered bottles, dabbers, price, manager materials
    expect(orderLine).toContain('"50"') // labor: 2h at the test manager's $25 rate
    await expect(page.getByRole('status').filter({ hasText: 'ignite-orders' })).toBeVisible()

    const entries = await download('Entries')
    expect(entries).toContain(`"Note with a comma, ""quotes"" and a\nline break ${run}"`)
    const entryLine = entries.split('\r\n').find((l) => l.includes(`Export test order ${run}`))!
    expect(entryLine).toContain('"2001-01-02","Test Manager"')
    expect(entryLine).toContain('"12"')
    expect(entryLine).toContain('"120"')

    const designs = await download('Designs')
    const designLine = designs.split('\r\n').find((l) => l.includes(`Export test design ${run}`))!
    expect(designLine).toContain('"yes","yes","no"') // active, has dabber, fumed

    const purchases = await download('Purchases')
    const purchaseLine = purchases.split('\r\n').find((l) => l.includes(`Export test purchase ${run}`))!
    expect(purchaseLine).toContain(`"Export test order ${run}"`)
    expect(purchaseLine).toContain('"12.5","pending"')
    const { data: task, error: tErr } = await mgr.rpc('save_task', {
      p_task_id: null, p_title: 'Export test task ' + run, p_note: null, p_priority: 'high', p_due_date: '2001-02-01',
      p_order_id: orderId, p_recurrence: 'weekly', p_assignees: [managerId, artistId],
    })
    if (tErr) throw new Error(tErr.message)
    taskId = (task as { id: string }).id
    const tasks = await download('Tasks')
    const taskLine = tasks.split('\r\n').find((l) => l.includes(`Export test task ${run}`))!
    expect(taskLine).toContain('"Test Artist; Test Manager","high","2001-02-01","Export test order ' + run + '","weekly","open"')
    await shot(page, '40-exports')
  } finally {
    const { data: o } = await mgr.from('orders').select('status').eq('id', orderId).maybeSingle()
    if (o?.status === 'closed') await mgr.rpc('reopen_order', { p_order_id: orderId, p_reason: 'test cleanup' })
    if (purchaseId) await mgr.from('purchases').delete().eq('id', purchaseId)
    if (taskId) await mgr.from('tasks').delete().eq('id', taskId)
    await mgr.from('entries').delete().eq('order_id', orderId)
    await mgr.from('order_financial_history').delete().eq('order_id', orderId)
    await mgr.from('order_financials').delete().eq('order_id', orderId)
    await mgr.from('orders').delete().eq('id', orderId)
    await mgr.from('designs').delete().eq('id', designId)
  }
})

test('an artist is turned away from Exports', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/exports')
  await expect(page.getByRole('heading', { level: 1, name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Exports' })).toHaveCount(0)
})
