import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { todayChicago } from '../lib/dates.ts'
import { roleLabel } from '../lib/profile.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { formatMoney } from './format.ts'
import { inForceOn, loadAccounts, loadPayRates, type Account, type PayRate } from './queries.ts'

type Filter = 'active' | 'deactivated' | 'all'

interface Data {
  accounts: Account[]
  rates: PayRate[]
}

/** People: every account with its role and current pay rate, which shows as Missing until one is entered. */
export default function PeopleScreen() {
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const { state, reload } = useAsync<Data>(async () => {
    const [accounts, rates] = await Promise.all([loadAccounts(), loadPayRates()])
    return { accounts, rates }
  }, [])

  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data.accounts.filter((a) => {
      if (filter === 'active' && !a.active) return false
      if (filter === 'deactivated' && a.active) return false
      return q === '' || a.full_name.toLowerCase().includes(q) || a.email.includes(q)
    })
  }, [state, filter, query])

  const today = todayChicago()

  return (
    <>
      <div className="topbar">
        <h1>People</h1>
        <Link to="/manage/people/new" className="btn">
          Add person
        </Link>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" className={filter === 'active' ? 'active' : ''} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
            Active
          </button>
          <button type="button" className={filter === 'deactivated' ? 'active' : ''} aria-pressed={filter === 'deactivated'} onClick={() => setFilter('deactivated')}>
            Deactivated
          </button>
          <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
        <input
          type="search"
          aria-label="Search people"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {state.kind === 'loading' && <Loading what="people" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login email</th>
              <th>Role</th>
              <th>Pay rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  {query.trim() ? `No one matches “${query.trim()}”.` : 'No one to show here.'}
                </td>
              </tr>
            )}
            {shown.map((a) => {
              const rate = inForceOn(
                state.data.rates.filter((r) => r.profile_id === a.id),
                today,
              )
              return (
                <tr key={a.id}>
                  <td data-label="Name">
                    <Link to={`/manage/people/${a.id}`} className="row-title">
                      {a.full_name}
                    </Link>
                  </td>
                  <td data-label="Login email">{a.email}</td>
                  <td data-label="Role">{roleLabel(a.role)}</td>
                  <td data-label="Pay rate">{rate ? `${formatMoney(rate.hourly_rate)} per hour` : <span className="missing">Missing</span>}</td>
                  <td data-label="Status">{a.active ? 'Active' : 'Deactivated'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
