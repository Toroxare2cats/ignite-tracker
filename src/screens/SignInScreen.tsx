import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase.ts'

/** Turns Supabase's error text into something a person can act on. */
function friendlyMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'That email and password do not match. Check both and try again.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'This account has not been switched on yet. Ask a manager.'
  }
  if (/fetch|network/i.test(message)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Wait a minute and try again.'
  }
  return message
}

export default function SignInScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (signInError) {
      setError(friendlyMessage(signInError.message))
      setBusy(false)
    }
    // On success the session listener in App swaps this screen for Home.
  }

  return (
    <main className="screen">
      <h1>Ignite Tracker</h1>
      <p className="muted">Sign in with your igniteglass.com email.</p>

      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
