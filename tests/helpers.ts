import { expect, type Page } from '@playwright/test'

export const SHOTS = 'test-results/screens'

export function need(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing from .env; run npm run seed first`)
  return value
}

/** Sign in as the test artist (a real artist login, per CLAUDE.md rule 2). */
export async function signInAsArtist(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Email').fill(need('PRIVACY_TEST_ARTIST_EMAIL'))
  await page.getByLabel('Password').fill(need('PRIVACY_TEST_ARTIST_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible({ timeout: 20_000 })
}

export async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('Email').fill(need('PRIVACY_TEST_MANAGER_EMAIL'))
  await page.getByLabel('Password').fill(need('PRIVACY_TEST_MANAGER_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Managers land on the screen they chose in Settings, so wait for the menu.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' })).toBeVisible({ timeout: 20_000 })
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** A database client signed in as the test manager, for fixtures and clean-up. */
export async function managerClient(): Promise<SupabaseClient> {
  const client = createClient(need('VITE_SUPABASE_URL'), need('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: need('PRIVACY_TEST_MANAGER_EMAIL'),
    password: need('PRIVACY_TEST_MANAGER_PASSWORD'),
  })
  if (error) throw new Error(`manager sign-in failed: ${error.message}`)
  return client
}

/**
 * An admin connection, used only to remove throwaway logins after a test.  The
 * key is fetched through the Supabase CLI and kept in memory, as scripts/seed.ts
 * does; it is never written down or printed.
 */
export function adminClient(): SupabaseClient {
  const url = need('VITE_SUPABASE_URL')
  const projectRef = new URL(url).hostname.split('.')[0]
  const cli = join('node_modules', 'supabase', 'dist', 'supabase.js')
  const result = spawnSync(process.execPath, [cli, 'projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) throw new Error('Could not read the project keys through the Supabase CLI. Are you logged in?')
  const keys = JSON.parse(result.stdout) as { name?: string; api_key?: string }[]
  const key = keys.find((k) => k.name === 'service_role')?.api_key
  if (!key) throw new Error('The Supabase CLI did not return an admin key')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** On an order page, open today's entry form whether it is new or an edit. */
export async function openTodaysEntry(page: Page): Promise<void> {
  const link = page.getByRole('link', { name: /today's entry/ })
  await expect(link).toBeVisible()
  await link.click()
}

/** The two test accounts' ids, read through the manager's client. */
export async function testPeople(mgr: SupabaseClient): Promise<{ artistId: string; managerId: string }> {
  const { data, error } = await mgr
    .from('profiles')
    .select('id, email')
    .in('email', [need('PRIVACY_TEST_ARTIST_EMAIL'), need('PRIVACY_TEST_MANAGER_EMAIL')])
  if (error) throw new Error(error.message)
  const rows = data as { id: string; email: string }[]
  const id = (email: string) => {
    const row = rows.find((r) => r.email === email.toLowerCase())
    if (!row) throw new Error(`no profile for ${email}`)
    return row.id
  }
  return { artistId: id(need('PRIVACY_TEST_ARTIST_EMAIL')), managerId: id(need('PRIVACY_TEST_MANAGER_EMAIL')) }
}
