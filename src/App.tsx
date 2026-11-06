import { isSupabaseConfigured } from './lib/supabase.ts'

// Placeholder screen for step 2. Step 6 replaces this with sign-in and home.
export default function App() {
  return (
    <main className="screen">
      <h1>Ignite Tracker</h1>
      <p>
        {isSupabaseConfigured
          ? 'Connected to Supabase settings. Sign-in comes next.'
          : 'Supabase settings are missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.'}
      </p>
    </main>
  )
}
