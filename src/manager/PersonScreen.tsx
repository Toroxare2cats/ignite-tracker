import { useState, type FormEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { useProfile } from '../lib/useProfile.ts'
import type { Role } from '../lib/profile.ts'
import { loadPeople } from '../lib/queries.ts'
import type { Person } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import DatedAmountCard from './DatedAmountCard.tsx'
import { isEmail, parseEmailList } from './format.ts'
import { addPayRate, loadAccounts, loadPayRates, setAccountActive, setAccountPassword, updateAccount, type Account, type PayRate } from './queries.ts'

interface Data {
  accounts: Account[]
  rates: PayRate[]
  names: Map<string, Person>
}

/**
 * One person: their details, pay rate, password and whether the account is
 * active.  Each card saves on its own.  Deactivating keeps all of their
 * history; accounts are never deleted.
 */
export default function PersonScreen() {
  const { personId = '' } = useParams()
  const location = useLocation()
  const me = useProfile()
  const [notice] = useState<string | null>((location.state as { saved?: string } | null)?.saved ?? null)

  const { state, reload } = useAsync<Data>(async () => {
    const [accounts, rates, names] = await Promise.all([loadAccounts(), loadPayRates(personId), loadPeople()])
    return { accounts, rates, names }
  }, [personId])

  if (state.kind === 'loading') return <Loading what="this person" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />

  const { accounts, rates, names } = state.data
  const person = accounts.find((a) => a.id === personId)
  if (!person) {
    return (
      <>
        <BackLink to="/manage/people" label="People" />
        <p>This person could not be found.</p>
      </>
    )
  }

  const isMe = person.id === me.id

  return (
    <>
      <BackLink to="/manage/people" label="People" />
      <div className="topbar">
        <h1>{person.full_name}</h1>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {!person.active && <p className="notice warn">This account is deactivated. They cannot use the app, and their history is kept.</p>}

      <div className="portal-columns">
        <div>
          <DetailsCard key={person.id} person={person} accounts={accounts} isMe={isMe} onSaved={reload} />
          <StatusCard person={person} isMe={isMe} onChanged={reload} />
        </div>
        <div>
          <DatedAmountCard
            title="Pay rate per hour"
            noun="rate"
            testId="rate"
            newLabel="New rate ($ per hour)"
            example="22.00"
            suffix=" per hour"
            note="Rates are never overwritten. A rate applies to work on or after its start date. To correct a mistake, add a new rate with the same date; the newest one counts."
            rows={rates.map((r) => ({ ...r, amount: r.hourly_rate }))}
            people={names}
            frozen={person.active ? null : 'Rates are frozen while this account is deactivated.'}
            onAdd={(amount, from) => addPayRate(person.id, amount, from)}
            onSaved={reload}
          />
          <PasswordCard key={`${person.id}-password`} person={person} />
        </div>
      </div>
    </>
  )
}

function DetailsCard({ person, accounts, isMe, onSaved }: { person: Account; accounts: Account[]; isMe: boolean; onSaved: () => void }) {
  const form = useFormState({ name: person.full_name, role: person.role, alternates: person.alternate_emails.join('\n') })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const name = values.name.trim()
    const alternates = parseEmailList(values.alternates)
    const bad = alternates.find((a) => !isEmail(a))
    // Calendar invitations are matched by address, so one address means one person.
    const clash = accounts.find((a) => a.id !== person.id && alternates.some((e) => e === a.email || a.alternate_emails.includes(e)))

    if (name === '') return form.fail('Enter the person’s name.')
    if (bad) return form.fail(`“${bad}” does not look like an email address.`)
    if (alternates.includes(person.email)) return form.fail('The login email does not need to be listed as an alternate email.')
    if (clash) return form.fail(`An address here already belongs to ${clash.full_name}.`)

    const ok = await form.submit(async (v) => {
      await updateAccount(person.id, { full_name: name, role: v.role, alternate_emails: alternates })
      return { ...v, name, alternates: alternates.join('\n') }
    })
    if (ok) onSaved()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <label htmlFor="person-name" style={{ marginTop: 0 }}>
        Full name
      </label>
      <input id="person-name" value={values.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />

      <label>Login email</label>
      <p className="plain-value">{person.email}</p>

      <label htmlFor="person-role">Role</label>
      <select id="person-role" value={values.role} disabled={isMe} onChange={(e) => set('role', e.target.value as Role)}>
        <option value="artist">Artist</option>
        <option value="manager">Manager</option>
      </select>
      <p className="form-note">{isMe ? 'Another manager must change your role.' : 'Managers see every pay rate, price and cost.'}</p>

      <label htmlFor="person-alternates">Alternate emails (one per line)</label>
      <textarea id="person-alternates" value={values.alternates} onChange={(e) => set('alternates', e.target.value)} />
      <p className="form-note">Other addresses they get calendar invitations at.</p>

      <SaveBar form={form} />
    </form>
  )
}

function PasswordCard({ person }: { person: Account }) {
  const [show, setShow] = useState(false)
  const form = useFormState({ password: '' })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (values.password.length < 8) return form.fail('The password must be at least 8 characters.')
    await form.submit(async (v) => {
      await setAccountPassword(person.id, v.password)
      return { password: '' }
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <h3 style={{ marginTop: 0 }}>Set a new password</h3>
      <label htmlFor="new-password">New password</label>
      <input id="new-password" type={show ? 'text' : 'password'} value={values.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
      <label className="check-row">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show password
      </label>
      <p className="form-note">At least 8 characters. Their old password stops working. Give the new one to them in person.</p>
      <SaveBar form={form} saveLabel="Set password" requireChanges={false} cleanText="Nothing to save yet" />
    </form>
  )
}

function StatusCard({ person, isMe, onChanged }: { person: Account; isMe: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(active: boolean) {
    setBusy(true)
    setError(null)
    try {
      await setAccountActive(person.id, active)
      setAsking(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Account status</h3>
      <p className="small" style={{ margin: 0 }}>
        {person.active ? 'Active.' : 'Deactivated.'}
      </p>
      {isMe && <p className="form-note">You cannot deactivate your own account. Ask another manager.</p>}
      {!isMe && !person.active && (
        <div className="action-row">
          <button type="button" onClick={() => change(true)} disabled={busy}>
            {busy ? 'Saving…' : 'Reactivate account'}
          </button>
        </div>
      )}
      {!isMe && person.active && !asking && (
        <div className="action-row">
          <button type="button" className="secondary" onClick={() => setAsking(true)}>
            Deactivate account
          </button>
        </div>
      )}
      {!isMe && person.active && asking && (
        <>
          <p className="form-note">They lose access straight away. Their entries, rates and history stay, and their rates are frozen as they are.</p>
          <div className="action-row">
            <button type="button" className="secondary" onClick={() => setAsking(false)} disabled={busy}>
              Keep active
            </button>
            <button type="button" className="danger" onClick={() => change(false)} disabled={busy}>
              {busy ? 'Saving…' : 'Yes, deactivate'}
            </button>
          </div>
        </>
      )}
      {error && <p className="save-status error">{error}</p>}
    </div>
  )
}
