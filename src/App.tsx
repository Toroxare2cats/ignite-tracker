import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from './lib/supabase.ts'
import { useSession } from './lib/useSession.ts'
import { appAlreadyOpened, landingPath, markAppOpened } from './lib/landing.ts'
import { loadOwnProfile, type Profile } from './lib/profile.ts'
import { ProfileContext, useProfile } from './lib/useProfile.ts'
import Layout from './components/Layout.tsx'
import { Loading } from './components/ui.tsx'
import SignInScreen from './screens/SignInScreen.tsx'
import MyWorkScreen from './screens/MyWorkScreen.tsx'
import OrderScreen from './screens/OrderScreen.tsx'
import EntryFormScreen from './screens/EntryFormScreen.tsx'
import MyWeekScreen from './screens/MyWeekScreen.tsx'
import MaterialsScreen from './screens/MaterialsScreen.tsx'
import TasksScreen from './screens/TasksScreen.tsx'

// Loaded only when a manager opens the portal, so artists' phones never download it.
const ManagerPortal = lazy(() => import('./manager/ManagerPortal.tsx'))

/**
 * The front door.  As the app opens here, a manager goes on to the screen they
 * chose in Settings.  After that this address is simply My Work, so the My Work
 * link works, and a link to a particular page never comes through here at all.
 */
function Home() {
  const profile = useProfile()
  const [landing] = useState(() => (profile.role === 'manager' && !appAlreadyOpened() ? landingPath(profile.home_screen) : '/'))
  return landing === '/' ? <MyWorkScreen /> : <Navigate to={landing} replace />
}

/**
 * Sends anyone who is not a manager back to My Work.  This only keeps the
 * screens tidy: the database is what stops an artist reading manager data.
 */
function ManagerOnly() {
  const profile = useProfile()
  if (profile.role !== 'manager') return <Navigate to="/" replace />
  return (
    <Suspense fallback={<Loading what="the manager portal" />}>
      <ManagerPortal />
    </Suspense>
  )
}

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

  // Runs after Home has made its one decision about where to land.
  useEffect(() => {
    if (state.kind === 'ready') markAppOpened()
  }, [state.kind])

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
        <p>Your account is not active. Ask a manager to switch it on.</p>
        {signOutButton}
      </main>
    )
  }

  return (
    <ProfileContext.Provider value={profile}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/orders/:orderId" element={<OrderScreen />} />
          <Route path="/orders/:orderId/entry" element={<EntryFormScreen />} />
          <Route path="/entries/:entryId" element={<EntryFormScreen />} />
          <Route path="/tasks" element={<TasksScreen />} />
          <Route path="/week" element={<MyWeekScreen />} />
          <Route path="/materials" element={<MaterialsScreen />} />
          <Route path="/manage/*" element={<ManagerOnly />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProfileContext.Provider>
  )
}
