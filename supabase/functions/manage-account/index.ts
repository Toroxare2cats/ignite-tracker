/**
 * manage-account: creates logins and resets passwords for managers.
 *
 * This is the one place the service_role key is used (CLAUDE.md rule 9, the
 * exception Arvin approved on 2026-11-06).  It exists because making a login
 * needs that key, and the key must never reach a browser or phone.  Supabase
 * supplies it to this function on its own servers; it is not in this code, not
 * in the repository, and is never written to a log.
 *
 * Every request is checked first: the caller must be signed in, and the
 * database must say they are an active manager.  Nothing is logged, so
 * passwords cannot end up in a log.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://ignite-tracker.pages.dev', 'https://tracker.igniteglass.com']
const LOGIN_EMAIL = /^[a-z0-9._%+-]+@igniteglass\.com$/
const ANY_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function needEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not available to this function`)
  return value
}

/** A failure the manager should read, with the status that goes with it. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

interface CreateRequest {
  action: 'create'
  email?: unknown
  password?: unknown
  full_name?: unknown
  role?: unknown
  alternate_emails?: unknown
}

interface PasswordRequest {
  action: 'set-password'
  id?: unknown
  password?: unknown
}

function checkPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Refusal(400, `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }
  return password
}

async function createAccount(request: CreateRequest, caller: SupabaseClient, admin: SupabaseClient): Promise<{ id: string }> {
  const email = typeof request.email === 'string' ? request.email.trim().toLowerCase() : ''
  const fullName = typeof request.full_name === 'string' ? request.full_name.trim() : ''
  const role = request.role === 'manager' ? 'manager' : request.role === 'artist' ? 'artist' : null
  const alternates = request.alternate_emails ?? []

  if (!LOGIN_EMAIL.test(email)) throw new Refusal(400, 'The login email must be an igniteglass.com address.')
  if (fullName === '') throw new Refusal(400, 'Enter the person’s name.')
  if (role === null) throw new Refusal(400, 'Choose a role.')
  if (!Array.isArray(alternates) || alternates.some((a) => typeof a !== 'string' || !ANY_EMAIL.test(a))) {
    throw new Refusal(400, 'One of the alternate emails is not an email address.')
  }
  const password = checkPassword(request.password)

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) {
    if (error?.code === 'email_exists' || /already/i.test(error?.message ?? '')) {
      throw new Refusal(409, 'An account with this email already exists.')
    }
    throw new Refusal(400, error?.message ?? 'The account could not be created.')
  }

  // New accounts start switched off (migration 0010).  This update runs as the
  // manager, not the admin key, so the profile records who set it up.
  const { error: updateError, count } = await caller
    .from('profiles')
    .update({ role, active: true, alternate_emails: alternates }, { count: 'exact' })
    .eq('id', data.user.id)
  if (updateError || count === 0) {
    await admin.auth.admin.deleteUser(data.user.id)
    throw new Refusal(500, 'The account could not be set up, so nothing was created. Please try again.')
  }

  return { id: data.user.id }
}

async function setPassword(request: PasswordRequest, caller: SupabaseClient, admin: SupabaseClient): Promise<{ id: string }> {
  const id = typeof request.id === 'string' ? request.id : ''
  const password = checkPassword(request.password)

  const { data: person } = await caller.from('profiles').select('id').eq('id', id).maybeSingle()
  if (!person) throw new Refusal(404, 'This account could not be found.')

  const { error } = await admin.auth.admin.updateUserById(id, { password })
  if (error) throw new Refusal(400, error.message)
  return { id }
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get('Origin')), 'Content-Type': 'application/json' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })

  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'Not allowed.' })

  try {
    const url = needEnv('SUPABASE_URL')
    const authorization = req.headers.get('Authorization') ?? ''
    const options = { auth: { persistSession: false, autoRefreshToken: false } }

    // The caller's own connection: the database decides who they are.
    const caller = createClient(url, needEnv('SUPABASE_ANON_KEY'), { ...options, global: { headers: { Authorization: authorization } } })
    const { data: who } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (!who?.user) throw new Refusal(401, 'Please sign in again.')

    const { data: me } = await caller.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle()
    if (me?.role !== 'manager' || !me.active) throw new Refusal(403, 'Only a manager can do this.')

    const request = (await req.json()) as CreateRequest | PasswordRequest
    const admin = createClient(url, needEnv('SUPABASE_SERVICE_ROLE_KEY'), options)

    if (request.action === 'create') return reply(200, await createAccount(request, caller, admin))
    if (request.action === 'set-password') return reply(200, await setPassword(request, caller, admin))
    throw new Refusal(400, 'Unknown action.')
  } catch (e) {
    if (e instanceof Refusal) return reply(e.status, { error: e.message })
    return reply(500, { error: 'Something went wrong on the server. Please try again.' })
  }
})
