import { devices, expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { managerClient, shot, signInAsArtist, signInAsManager, testPeople } from './helpers.ts'

/**
 * Manager portal, Approvals (brief: Materials).  A real artist login submits
 * the purchases on the Materials screen; a manager decides them; the money is
 * then read back through the order_cost function that the order page uses.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const PHONE_WIDTH = 390

// Runs even if a test times out, which a finally block inside the test does not.
let cleanUp: (() => Promise<void>) | null = null
test.afterEach(async () => {
  await cleanUp?.()
  cleanUp = null
})

async function submitPurchase(page: Page, description: string, amount: string, orderName: string | null, withReceipt = false) {
  await page.getByRole('button', { name: 'Record a purchase' }).click()
  await page.getByLabel('What was bought').fill(description)
  await page.getByLabel('Amount paid ($)').fill(amount)
  if (orderName) {
    await page.getByLabel('An order').check()
    await page.getByLabel('Which order').selectOption({ label: orderName })
  } else {
    await page.getByLabel('Studio stock').check()
  }
  if (withReceipt) {
    await page.getByLabel('Receipt photo (optional)').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
    })
  }
  await page.getByRole('button', { name: 'Submit purchase' }).click()
  await expect(page.getByText(`Submitted: ${description}.`)).toBeVisible()
}

test('a manager decides purchases, and approved money reaches the order or the stock list', async ({ page, browser }) => {
  test.setTimeout(180_000)
  const mgr = await managerClient()
  const { artistId } = await testPeople(mgr)
  const run = randomUUID().slice(0, 8)
  const orderA = `Approvals order A ${run}`
  const orderB = `Approvals order B ${run}`
  const wire = `Approvals wire ${run}`
  const rods = `Approvals rods ${run}`
  const gloves = `Approvals gloves ${run}`
  const lastMinute = `Approvals late ${run}`
  const stale = `Approvals stale ${run}`
  const orderIds: string[] = []
  let designId = ''

  const artistContext = await browser.newContext({ ...devices['Pixel 7'] })
  const artistPage = await artistContext.newPage()

  cleanUp = async () => {
    await artistContext.close()
    for (const id of orderIds) {
      const { data: o } = await mgr.from('orders').select('status').eq('id', id).maybeSingle()
      if ((o as { status: string } | null)?.status === 'closed') await mgr.rpc('reopen_order', { p_order_id: id })
    }
    await mgr.from('stock_allocations').delete().in('order_id', orderIds)
    const { data } = await mgr.from('purchases').select('id, receipt_path').ilike('description', `%${run}%`)
    const rows = (data ?? []) as { id: string; receipt_path: string | null }[]
    const paths = rows.map((r) => r.receipt_path).filter((p): p is string => p !== null)
    if (paths.length) await mgr.storage.from('receipts').remove(paths)
    if (rows.length) await mgr.from('purchases').delete().in('id', rows.map((r) => r.id))
    await mgr.from('orders').delete().in('id', orderIds)
    if (designId) await mgr.from('designs').delete().eq('id', designId)
    await mgr.auth.signOut()
  }

  const { data: design, error: designError } = await mgr.from('designs').insert({ name: `Approvals design ${run}` }).select('id').single()
  if (designError) throw new Error(designError.message)
  designId = (design as { id: string }).id
  for (const name of [orderA, orderB]) {
    const { data, error } = await mgr
      .from('orders')
      .insert({ name, design_id: designId, bottles_ordered: 10, dabbers_ordered: 0, due_date: '2026-12-15', primary_artist_id: artistId })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    orderIds.push((data as { id: string }).id)
  }
  const [orderAId, orderBId] = orderIds as [string, string]

  const materialsOf = async (orderId: string) => {
    const { data, error } = await mgr.rpc('order_cost', { p_order_id: orderId })
    if (error) throw new Error(error.message)
    return Number((data as { materials_cost: number }[])[0]?.materials_cost)
  }
  const { error: totalError } = await mgr.from('order_financials').upsert({ order_id: orderAId, materials_total: 10 }, { onConflict: 'order_id' })
  if (totalError) throw new Error(totalError.message)

  // A real artist submits four purchases on their phone.
  await signInAsArtist(artistPage)
  await artistPage.goto('/materials')
  await submitPurchase(artistPage, wire, '40.50', orderA, true)
  await submitPurchase(artistPage, rods, '100', null)
  await submitPurchase(artistPage, gloves, '12', orderA)
  await submitPurchase(artistPage, lastMinute, '7', orderB)
  await expect(artistPage.locator('.log-entry', { hasText: wire }).locator('.badge')).toHaveText('Pending')

  // Pending money counts nowhere yet.
  expect(await materialsOf(orderAId)).toBe(10)

  // The menu shows there is something to decide.
  await signInAsManager(page)
  const nav = page.getByRole('navigation', { name: 'Main' })
  const link = nav.getByRole('link', { name: /Approvals/ })
  await expect(link).toContainText(/\d/)
  await link.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals', exact: true })).toBeVisible()

  const card = (text: string) => page.locator('.card', { hasText: text })
  await expect(card(wire)).toContainText('Test Artist')
  await expect(card(wire)).toContainText(orderA)
  await expect(card(rods)).toContainText('Studio stock')
  await expect(card(rods)).toContainText('No receipt')
  await shot(page, '31-approvals-waiting')

  // The receipt opens.
  const href = await card(wire).getByRole('link', { name: 'View receipt' }).getAttribute('href')
  expect((await page.request.get(href!)).ok()).toBe(true)

  // A rejection needs a reason, and says where the form stands.
  await card(gloves).getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(card(gloves).getByRole('status')).toHaveText('Not decided yet')
  await card(gloves).getByRole('button', { name: 'Reject purchase' }).click()
  await expect(card(gloves).getByRole('status')).toContainText('one-line reason')
  await card(gloves).getByLabel('Reason for rejecting').fill('Gloves come from studio stock')
  await expect(card(gloves).getByRole('status')).toHaveText('Unsaved changes')
  await card(gloves).getByRole('button', { name: 'Reject purchase' }).click()
  await expect(page.getByText(`Rejected: ${gloves}.`)).toBeVisible()
  await expect(card(gloves)).toHaveCount(0)
  expect(await materialsOf(orderAId)).toBe(10)

  // Approving asks first, and Cancel changes nothing.
  await card(wire).getByRole('button', { name: 'Approve' }).click()
  await expect(card(wire)).toContainText('This adds $40.50 to the order’s materials cost.')
  await card(wire).getByRole('button', { name: 'Cancel' }).click()
  await card(wire).getByRole('button', { name: 'Approve' }).click()
  await shot(page, '31b-approvals-confirm')
  await card(wire).getByRole('button', { name: 'Yes, approve' }).click()
  await expect(page.getByText(`Approved: ${wire}.`)).toBeVisible()

  // An approved order purchase adds to that order's materials cost.
  expect(await materialsOf(orderAId)).toBe(50.5)

  // A second manager with an old page open cannot overturn a decision.
  const { error: staleError } = await mgr
    .from('purchases')
    .insert({ artist_id: artistId, order_id: orderAId, description: stale, amount: 5 })
  if (staleError) throw new Error(staleError.message)
  await page.reload()
  await expect(card(stale)).toBeVisible()
  await mgr.from('purchases').update({ status: 'rejected', decision_reason: 'Decided elsewhere' }).ilike('description', stale)
  await card(stale).getByRole('button', { name: 'Approve' }).click()
  await card(stale).getByRole('button', { name: 'Yes, approve' }).click()
  await expect(card(stale).getByRole('status')).toContainText('already decided')
  expect(await materialsOf(orderAId)).toBe(50.5)
  await page.reload()

  // A decision is final, even for a direct database call.
  const { error: redecide } = await mgr.from('purchases').update({ status: 'rejected', decision_reason: 'Changed my mind' }).ilike('description', wire)
  expect(redecide?.message).toContain('already been decided')
  const { error: changeAmount } = await mgr.from('purchases').update({ amount: 1 }).ilike('description', wire)
  expect(changeAmount?.message).toContain('already been decided')

  // An approved stock purchase goes to the stock list, not to any order.
  await card(rods).getByRole('button', { name: 'Approve' }).click()
  await expect(card(rods)).toContainText('This adds $100.00 to the stock list.')
  await card(rods).getByRole('button', { name: 'Yes, approve' }).click()
  await expect(page.getByText(`Approved: ${rods}.`)).toBeVisible()
  await page.getByRole('button', { name: 'Stock' }).click()
  const stockCard = card(rods)
  await expect(stockCard.locator('.facts')).toContainText('$100.00')
  expect(await materialsOf(orderAId)).toBe(50.5)

  // Allocating cannot go over what is left, and keeps what was typed.
  await stockCard.getByLabel('Order').selectOption({ label: orderA })
  await stockCard.getByLabel('Amount ($)').fill('130')
  await stockCard.getByRole('button', { name: 'Allocate' }).click()
  await expect(stockCard.getByRole('status')).toContainText('more than is left')
  await expect(stockCard.getByLabel('Amount ($)')).toHaveValue('130')

  await stockCard.getByLabel('Amount ($)').fill('30')
  await stockCard.getByLabel('Note (optional)').fill('A third of the batch')
  await stockCard.getByRole('button', { name: 'Allocate' }).click()
  await expect(stockCard.locator('.facts')).toContainText('$30.00')
  await expect(stockCard.locator('.facts')).toContainText('$70.00')
  await expect(stockCard.getByRole('status')).toContainText('Saved')
  await expect(stockCard.getByLabel('Amount ($)')).toHaveValue('')
  expect(await materialsOf(orderAId)).toBe(80.5)

  // The database refuses the same thing whatever the screen does.
  const { data: rodRows } = await mgr.from('purchases').select('id').ilike('description', rods)
  const rodsId = (rodRows as { id: string }[])[0]!.id
  const { error: overAllocate } = await mgr.from('stock_allocations').insert({ purchase_id: rodsId, order_id: orderAId, amount: 71 })
  expect(overAllocate?.message).toContain('more than is left')

  // A portion allocated by mistake can be removed; it asks first.
  await stockCard.getByLabel('Order').selectOption({ label: orderB })
  await stockCard.getByLabel('Amount ($)').fill('5')
  await stockCard.getByRole('button', { name: 'Allocate' }).click()
  await expect(stockCard.locator('.facts')).toContainText('$65.00')
  await stockCard.locator('li', { hasText: orderA }).getByRole('button', { name: 'Remove' }).click()
  await stockCard.locator('li', { hasText: orderA }).getByRole('button', { name: 'Keep' }).click()
  await expect(stockCard.locator('.facts')).toContainText('$65.00')
  await shot(page, '32-approvals-stock')

  // The order page lists both kinds of added cost.
  await page.goto(`/manage/orders/${orderAId}`)
  await expect(page.getByText(wire)).toBeVisible()
  await expect(page.getByText(rods)).toBeVisible()
  await expect(page.getByText('A third of the batch')).toBeVisible()
  await expect(page.getByText(gloves)).toHaveCount(0)

  // The close form warns about a purchase still waiting on that order.
  const finishing = await mgr.rpc('finish_order', { p_order_id: orderBId, p_packing_note: null, p_box_length: null, p_box_width: null, p_box_height: null, p_box_weight: null })
  expect(finishing.error).toBeNull()
  await page.goto(`/manage/orders/${orderBId}`)
  await page.getByRole('button', { name: 'Close order' }).click()
  await expect(page.getByText('1 pending purchase is not counted')).toBeVisible()

  // A closed order's costs hold still until it is reopened.
  const closing = await mgr.rpc('close_order', { p_order_id: orderBId, p_bottles_delivered: 10, p_dabbers_delivered: 0, p_selling_price: 100, p_materials_total: 0 })
  expect(closing.error).toBeNull()
  await page.goto('/manage/approvals')
  await expect(card(lastMinute)).toContainText('This order is closed')
  await expect(card(lastMinute).getByRole('button', { name: 'Approve' })).toBeDisabled()
  const { error: approveClosed } = await mgr.from('purchases').update({ status: 'approved' }).ilike('description', lastMinute)
  expect(approveClosed?.message).toContain('Reopen it')

  const { error: allocateClosed } = await mgr.from('stock_allocations').insert({ purchase_id: rodsId, order_id: orderBId, amount: 1 })
  expect(allocateClosed?.message).toContain('Reopen it')
  const { error: removeClosed } = await mgr.from('stock_allocations').delete().eq('order_id', orderBId)
  expect(removeClosed?.message).toContain('Reopen it')
  await page.getByRole('button', { name: 'Stock' }).click()
  await expect(card(rods).locator('li', { hasText: orderB }).getByRole('button', { name: 'Remove' })).toHaveCount(0)
  await expect(card(rods).locator('li', { hasText: orderB })).toContainText('closed')

  // Allocations can be removed from an order that is not closed.
  const orderARow = card(rods).locator('li', { hasText: orderA })
  await orderARow.getByRole('button', { name: 'Remove' }).click()
  await orderARow.getByRole('button', { name: 'Yes, remove' }).click()
  await expect(card(rods).locator('.facts')).toContainText('$95.00')
  expect(await materialsOf(orderAId)).toBe(50.5)

  // Rejecting on a closed order is fine: it changes no cost.
  await page.getByRole('button', { name: /^Waiting/ }).click()
  await card(lastMinute).getByRole('button', { name: 'Reject', exact: true }).click()
  await card(lastMinute).getByLabel('Reason for rejecting').fill('Too late for this order')
  await card(lastMinute).getByRole('button', { name: 'Reject purchase' }).click()
  await expect(page.getByText(`Rejected: ${lastMinute}.`)).toBeVisible()

  // The Decided list keeps every outcome, with the reason.
  await page.getByRole('button', { name: 'Decided' }).click()
  await expect(page.getByRole('row', { name: new RegExp(gloves) })).toContainText('Gloves come from studio stock')
  await expect(page.getByRole('row', { name: new RegExp(gloves) })).toContainText('Rejected')
  await expect(page.getByRole('row', { name: new RegExp(wire) })).toContainText('Approved')
  await expect(page.getByRole('row', { name: new RegExp(wire) })).toContainText('Test Manager')
  await shot(page, '33-approvals-decided')

  // All three views work on a phone.
  await page.setViewportSize({ width: PHONE_WIDTH, height: 844 })
  for (const name of [/^Waiting/, /^Stock/, /^Decided/]) {
    await page.getByRole('button', { name }).click()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width, `${String(name)} fits a phone`).toBeLessThanOrEqual(PHONE_WIDTH)
  }
  await shot(page, '34-approvals-phone')

  // The artist sees their own outcomes and reasons, and no money beyond their own.
  await artistPage.reload()
  await expect(artistPage.locator('.log-entry', { hasText: wire }).locator('.badge')).toHaveText('Approved')
  await expect(artistPage.locator('.log-entry', { hasText: lastMinute })).toContainText(orderB) // a closed order keeps its name
  await expect(artistPage.locator('.log-entry', { hasText: gloves }).locator('.badge')).toHaveText('Rejected')
  await expect(artistPage.locator('.log-entry', { hasText: gloves })).toContainText('Gloves come from studio stock')
  await expect(artistPage.getByText('Allocated')).toHaveCount(0)
  await expect(artistPage.getByText('$10.00')).toHaveCount(0)
  await shot(artistPage, '35-artist-sees-decisions')
})

test('an artist cannot reach Approvals', async ({ page }) => {
  await signInAsArtist(page)
  await page.goto('/manage/approvals')
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Approvals', exact: true })).toHaveCount(0)
})
