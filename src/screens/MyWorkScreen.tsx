import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.ts'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { addDays, todayChicago } from '../lib/dates.ts'
import { countOpenTasks, loadOpenOrders, loadPeople, loadRecentOrderIds } from '../lib/queries.ts'
import type { OrderWithDesign, Person } from '../lib/types.ts'
import { ErrorNote, Loading, OrderRow } from '../components/ui.tsx'

const RECENT_DAYS = 14

interface Data {
  orders: OrderWithDesign[]
  recentIds: string[]
  people: Map<string, Person>
  openTasks: number | null
}

/**
 * My Work: the orders assigned to me, the ones I have logged on lately, a
 * search box for any other open order, and a count of my open tasks.
 */
export default function MyWorkScreen() {
  const profile = useProfile()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  // The entry form sends people here after "Add another order".
  const justSaved = (location.state as { justSaved?: boolean } | null)?.justSaved === true

  const { state, reload } = useAsync<Data>(async () => {
    const since = addDays(todayChicago(), -RECENT_DAYS)
    const [orders, recentIds, people, openTasks] = await Promise.all([
      loadOpenOrders(),
      loadRecentOrderIds(profile.id, since),
      loadPeople(),
      countOpenTasks(profile.id),
    ])
    return { orders, recentIds, people, openTasks }
  }, [profile.id])

  const sections = useMemo(() => {
    if (state.kind !== 'ready') return null
    const { orders, recentIds } = state.data
    const mine = orders.filter((o) => o.primary_artist_id === profile.id)
    const mineIds = new Set(mine.map((o) => o.id))
    const byId = new Map(orders.map((o) => [o.id, o]))
    const recent = recentIds.map((id) => byId.get(id)).filter((o): o is OrderWithDesign => !!o && !mineIds.has(o.id))
    const q = query.trim().toLowerCase()
    const matches = q
      ? orders.filter((o) => o.name.toLowerCase().includes(q) || o.design.name.toLowerCase().includes(q))
      : []
    return { mine, recent, matches }
  }, [state, profile.id, query])

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
  }

  const first = profile.full_name.split(' ')[0]

  return (
    <>
      <div className="topbar">
        <h1>Hi, {first}</h1>
        <button type="button" className="link small" onClick={signOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {justSaved && <p className="notice">Saved. Pick the next order to log.</p>}

      {state.kind === 'loading' && <Loading what="your orders" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}

      {state.kind === 'ready' && sections && (
        <>
          <label htmlFor="search" className="muted small">
            Find any open order
          </label>
          <input
            id="search"
            type="search"
            className="search"
            placeholder="Order or design name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />

          {query.trim() ? (
            <>
              <h2>Search results</h2>
              <ul className="list">
                {sections.matches.length === 0 && <li className="empty">No open order matches “{query.trim()}”.</li>}
                {sections.matches.map((o) => (
                  <OrderRow key={o.id} order={o} primaryName={primaryName(o, state.data.people)} />
                ))}
              </ul>
            </>
          ) : (
            <>
              <h2>Your orders</h2>
              <ul className="list">
                {sections.mine.length === 0 && (
                  <li className="empty">No orders are assigned to you right now. Search above to log on any open order.</li>
                )}
                {sections.mine.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </ul>

              <h2>Recent</h2>
              <ul className="list">
                {sections.recent.length === 0 && (
                  <li className="empty">Orders you log on in the last {RECENT_DAYS} days show up here.</li>
                )}
                {sections.recent.map((o) => (
                  <OrderRow key={o.id} order={o} primaryName={primaryName(o, state.data.people)} />
                ))}
              </ul>

              <h2>Tasks</h2>
              <div className="card">
                <p style={{ margin: 0 }}>
                  <strong>{state.data.openTasks ?? 0}</strong> open {state.data.openTasks === 1 ? 'task' : 'tasks'}
                </p>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  The Tasks screen arrives in a later update.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

function primaryName(order: OrderWithDesign, people: Map<string, Person>): string | null {
  if (!order.primary_artist_id) return null
  return people.get(order.primary_artist_id)?.full_name ?? null
}
