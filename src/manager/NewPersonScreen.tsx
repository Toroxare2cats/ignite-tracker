import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Role } from '../lib/profile.ts'
import { BackLink } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import { isEmail, parseEmailList } from './format.ts'
import { createAccount } from './queries.ts'

/**
 * A new login.  Public sign-up is off, so this is the only way an account is
 * made.  The pay rate is added on the person's own page straight after.
 */
export default function NewPersonScreen() {
  const navigate = useNavigate()
  const newId = useRef('')
  const [showPassword, setShowPassword] = useState(false)
  const form = useFormState({ name: '', email: '', password: '', role: 'artist' as Role, alternates: '' })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const email = values.email.trim().toLowerCase()
    const alternates = parseEmailList(values.alternates)
    const bad = alternates.find((a) => !isEmail(a))

    if (values.name.trim() === '') return form.fail('Enter the person’s name.')
    if (!/^[a-z0-9._%+-]+@igniteglass\.com$/.test(email)) return form.fail('The login email must be an igniteglass.com address.')
    if (values.password.length < 8) return form.fail('The password must be at least 8 characters.')
    if (bad) return form.fail(`“${bad}” does not look like an email address.`)
    if (alternates.includes(email)) return form.fail('The login email does not need to be listed as an alternate email.')

    const ok = await form.submit(async (v) => {
      newId.current = await createAccount({ email, password: v.password, full_name: v.name.trim(), role: v.role, alternate_emails: alternates })
    })
    if (ok) navigate(`/manage/people/${newId.current}`, { replace: true, state: { saved: 'Account created. They can sign in now. Add their pay rate below.' } })
  }

  return (
    <>
      <BackLink to="/manage/people" label="People" />
      <h1>Add person</h1>
      <form onSubmit={handleSubmit} noValidate className="card form-card">
        <label htmlFor="person-name" style={{ marginTop: 0 }}>
          Full name
        </label>
        <input id="person-name" value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />

        <label htmlFor="person-email">Login email</label>
        <input id="person-email" type="email" placeholder="name@igniteglass.com" value={values.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" />

        <label htmlFor="person-password">Password</label>
        <input
          id="person-password"
          type={showPassword ? 'text' : 'password'}
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          autoComplete="new-password"
        />
        <label className="check-row">
          <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          Show password
        </label>
        <p className="form-note">At least 8 characters. Give it to them in person; it cannot be looked up later, but you can set a new one.</p>

        <label htmlFor="person-role">Role</label>
        <select id="person-role" value={values.role} onChange={(e) => set('role', e.target.value as Role)}>
          <option value="artist">Artist</option>
          <option value="manager">Manager</option>
        </select>
        <p className="form-note">Managers see every pay rate, price and cost.</p>

        <label htmlFor="person-alternates">Alternate emails (optional, one per line)</label>
        <textarea id="person-alternates" value={values.alternates} onChange={(e) => set('alternates', e.target.value)} />
        <p className="form-note">Other addresses they get calendar invitations at.</p>

        <SaveBar form={form} saveLabel="Create account" requireChanges={false} cleanText="Not saved yet">
          <Link to="/manage/people" className="btn secondary">
            Cancel
          </Link>
        </SaveBar>
      </form>
    </>
  )
}
