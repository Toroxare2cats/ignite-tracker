import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase.ts'
import { useSession } from './lib/useSession.ts'
import { loadOwnProfile, type Profile } from './lib/profile.ts'
import { ProfileContext } from './lib/useProfile.ts'
import Layout from './components/Layout.tsx'
import SignInScreen from './screens/SignInScreen.tsx'
import MyWorkScreen from './screens/MyWorkScreen.tsx'
import OrderScreen from './screens/OrderScreen.tsx'
import EntryFormScreen from './screens/EntryFormScreen.tsx'
import MyWeekScreen from './screens/MyWeekScreen.tsx'
import MaterialsScreen from './screens/MaterialsScreen.tsx'

export default function App() {
  const { session, loading } = useSession()

  if (!isSupabaseConfigured) {
    return (
      <main className="screen">
        <h1>Ignite Tracker</h1>
        <p className="error">
          This copy of the app is missing its server settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).
        </p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="screen">
        <h1>Ignite Tracker</h1>
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!session) return <SignInScreen />

  return (
    <BrowserRouter>
      <SignedInApp session={session} />
    </BrowserRouter>
  )
}

type ProfileState =
  | { kind: 'loading' }
  | { kind: 'ready'; profile: Profile }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

/** Loads the person's profile, then shows the screens their account allows. */
function SignedInApp({ session }: { session: Session }) {
  const [state, setState] = useState<ProfileState>({ kind: 'loading' })
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
  }

  const signOutButton = (
    <button type="button" className="btn secondary block" onClick={signOut} disabled={signingOut}>
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
    <ProfileContext.Provider value={profile}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<MyWorkScreen />} />
          <Route path="/orders/:orderId" element={<OrderScreen />} />
          <Route path="/orders/:orderId/entry" element={<EntryFormScreen />} />
          <Route path="/entries/:entryId" element={<EntryFormScreen />} />
          <Route path="/week" element={<MyWeekScreen />} />
          <Route path="/materials" element={<MaterialsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProfileContext.Provider>
  )
}
