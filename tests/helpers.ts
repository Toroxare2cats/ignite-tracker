import { expect, type Page } from '@playwright/test'

export const SHOTS = 'test-results/screens'

function need(name: string): string {
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
  await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible({ timeout: 20_000 })
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

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
