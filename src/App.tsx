import { isSupabaseConfigured } from './lib/supabase.ts'
import { useSession } from './lib/useSession.ts'
import HomeScreen from './screens/HomeScreen.tsx'
import SignInScreen from './screens/SignInScreen.tsx'

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

  return session ? <HomeScreen session={session} /> : <SignInScreen />
}
