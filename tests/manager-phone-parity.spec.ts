import { devices, expect, test, type Page } from '@playwright/test'
import { shot, signInAsManager } from './helpers.ts'

/**
 * CLAUDE.md rule 14: anything a manager can see on desktop is also available
 * on a phone, and the reverse.  This reads the menu rather than a fixed list,
 * so every screen added in a later session is covered automatically.
 */
const { isMobile: _m, hasTouch: _t, ...desktop } = devices['Desktop Chrome']
test.use({ ...desktop, viewport: { width: 1280, height: 900 } })

const PHONE_WIDTH = 390

function menu(page: Page) {
  return page.getByRole('navigation', { name: 'Main' })
}

test('a manager has the same menu on a phone as on a desktop, and every screen fits', async ({ page }) => {
  await signInAsManager(page)
  // The number beside Approvals changes as purchases come in, so it is left out.
  const names = async () => (await menu(page).getByRole('link').allInnerTexts()).map((text) => text.replace(/\s*\d+$/, ''))
  const onDesktop = await names()
  expect(onDesktop.length).toBeGreaterThan(3)

  await page.setViewportSize({ width: PHONE_WIDTH, height: 844 })
  await page.reload()
  await expect(menu(page).getByRole('link').first()).toBeVisible()
  expect(await names()).toEqual(onDesktop)
  await shot(page, '27-manager-menu-phone')

  // Nothing is cut off at the edge of the screen, including Sign out.
  const items = [...(await menu(page).getByRole('link').all()), menu(page).getByRole('button', { name: 'Sign out' })]
  for (const item of items) {
    await expect(item).toBeVisible()
    const box = await item.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_WIDTH)
  }

  // Every screen in the menu opens on a phone without sideways scrolling.
  const links = await menu(page).getByRole('link').all()
  const paths = await Promise.all(links.map((link) => link.getAttribute('href')))
  for (const path of paths) {
    await page.goto(path!)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width, `${path} fits a phone`).toBeLessThanOrEqual(PHONE_WIDTH)
  }
})
