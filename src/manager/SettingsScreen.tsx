import { type FormEvent } from 'react'
import { LANDING_SCREENS, landingValue } from '../lib/landing.ts'
import { loadOwnProfile } from '../lib/profile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { useFormState } from '../lib/useFormState.ts'
import { useProfile } from '../lib/useProfile.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { saveLandingScreen } from './queries.ts'

/**
 * Each manager's own settings.  The account is read fresh here, because the
 * copy held since the app opened does not know about a change saved since.
 */
export default function SettingsScreen() {
  const profile = useProfile()
  const { state, reload } = useAsync(() => loadOwnProfile(profile.id), [profile.id])

  return (
    <>
      <h1>Settings</h1>
      {state.kind === 'loading' && <Loading what="your settings" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && <LandingForm meId={profile.id} stored={state.data?.home_screen ?? profile.home_screen} />}
    </>
  )
}

function LandingForm({ meId, stored }: { meId: string; stored: string }) {
  const form = useFormState({ screen: landingValue(stored) })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await form.submit(async (v) => {
      await saveLandingScreen(meId, v.screen)
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card form-card">
      <h2 style={{ marginTop: 0 }}>Landing screen</h2>
      <label htmlFor="landing-screen">Open the app on</label>
      <select id="landing-screen" value={form.values.screen} onChange={(e) => form.set('screen', e.target.value)}>
        {LANDING_SCREENS.map((screen) => (
          <option key={screen.value} value={screen.value}>
            {screen.label}
          </option>
        ))}
      </select>
      <p className="form-note">This is your own choice and follows you between your phone and a desktop. It takes effect the next time you open the app.</p>
      <SaveBar form={form} />
    </form>
  )
}
