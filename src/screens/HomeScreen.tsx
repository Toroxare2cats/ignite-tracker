import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase.ts'
import { loadOwnProfile, roleLabel, type Profile } from '../lib/profile.ts'

interface Props {
  session: Session
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; profile: Profile }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/**
 * Placeholder home screen (session 1): who you are and your role.
 * Session 2 replaces the body with the daily entry form.
 */
export default function HomeScreen({ session }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    loadOwnProfile(session.user.id)
      .then((profile) => {
        if (!active) return
        setState(profile ? { kind: 'ready', profile } : { kind: 'missing' })
      })
      .catch((e: unknown) => {
        if (active) setState({ kind: 'error', message: (e as Error).message })
      })
    return () => {
      active = false
    }
  }, [session.user.id])

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    // The session listener in App returns to the sign-in screen.
  }

  const signOutButton = (
    <button type="button" className="secondary" onClick={signOut} disabled={signingOut}>
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  )

  if (state.kind === 'loading') {
    return (
      <main className="screen">
        <h1>Ignite Tracker</h1>
        <p className="muted">Loading your account…</p>
      </main>
    )
  }

  if (state.kind === 'error') {
    return (
      <main className="screen">
        <h1>Ignite Tracker</h1>
        <p className="error" role="alert">
          Could not load your account: {state.message}
        </p>
        {signOutButton}
      </main>
    )
  }

  if (state.kind === 'missing') {
    return (
      <main className="screen">
        <h1>Ignite Tracker</h1>
        <p>This account has no profile yet. Ask a manager to set it up.</p>
        {signOutButton}
      </main>
    )
  }

  const { profile } = state

  if (!profile.active) {
    return (
      <main className="screen">
        <h1>Hi, {profile.full_name}</h1>
        <p>Your account is not switched on yet. Ask a manager to activate it.</p>
        {signOutButton}
      </main>
    )
  }

  return (
    <main className="screen">
      <h1>Hi, {profile.full_name}</h1>
      <div className="card">
        <p>
          <strong>Role:</strong> {roleLabel(profile.role)}
        </p>
        <p className="muted">{profile.email}</p>
        <p className="muted">This is a placeholder. The daily entry form arrives in the next build session.</p>
      </div>
      {signOutButton}
    </main>
  )
}
