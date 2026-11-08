import { Link } from 'react-router-dom'
import { formatLongDate, formatMinutes, formatStamp, todayChicago } from '../lib/dates.ts'
import { countPendingPurchases, loadOpenOrders } from '../lib/queries.ts'
import { useAsync } from '../lib/useAsync.ts'
import type { OrderWithDesign } from '../lib/types.ts'
import { DueDate, ErrorNote, Loading, StatusBadge } from '../components/ui.tsx'
import { loadAccounts, type Account } from './queries.ts'
import { loadCalendarStatus, type CalendarStatus } from './dashboardQueries.ts'
import { loadClocked, loadEntriesBetween, loadStudioTime, type ClockedDay, type ReportEntry, type StudioTimeRow } from './reportQueries.ts'

interface Data {
  today: string
  accounts: Account[]
  entries: ReportEntry[]
  clocked: ClockedDay[]
  studio: StudioTimeRow[]
  orders: OrderWithDesign[]
  pending: number | null
  calendar: CalendarStatus | null
}

/**
 * Today, the manager dashboard: who has logged today and who has not, open
 * orders by due date, pending approvals, and the places where tasks due today
 * (session 5) and the calendar sync status (session 8) will go.
 */
export default function TodayScreen() {
  const { state, reload } = useAsync<Data>(async () => {
    const today = todayChicago()
    const [accounts, entries, clocked, studio, orders, pending, calendar] = await Promise.all([
      loadAccounts(),
      loadEntriesBetween(today, today),
      loadClocked(today, today),
      loadStudioTime(today, today),
      loadOpenOrders(),
      countPendingPurchases(),
      loadCalendarStatus(),
    ])
    return { today, accounts, entries, clocked, studio, orders, pending, calendar }
  }, [])

  return (
    <>
      <h1>Today</h1>
      {state.kind === 'loading' && <Loading what="today" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && <Dashboard data={state.data} />}
    </>
  )
}

function Dashboard({ data }: { data: Data }) {
  const people = data.accounts.filter((a) => a.active)
  const loggedIds = new Set(data.entries.map((e) => e.artist_id))
  const summarize = (list: Account[]) => ({
    logged: list.filter((a) => loggedIds.has(a.id)),
    notLogged: list.filter((a) => !loggedIds.has(a.id)),
  })
  const artists = summarize(people.filter((a) => a.role === 'artist'))
  const managers = summarize(people.filter((a) => a.role === 'manager'))
  const late = data.orders.filter((o) => o.status === 'open' && o.due_date && o.due_date < data.today)

  return (
    <>
      <p className="muted">{formatLongDate(data.today)}</p>
      <div className="portal-columns">
        <section className="card" aria-labelledby="logged-heading" data-testid="logged-today">
          <h2 id="logged-heading" style={{ marginTop: 0 }}>
            Logged today
          </h2>
          <PeopleList title="Artists" group={artists} data={data} />
          <PeopleList title="Managers" group={managers} data={data} quiet />
          <p className="form-note">
            Clocked hours appear here once this week's uAttend export is uploaded; studio time, once that form exists. Reminders to artists with
            clocked hours and no entry are session 7.
          </p>
        </section>

        <section className="card" aria-labelledby="approvals-heading">
          <h2 id="approvals-heading" style={{ marginTop: 0 }}>
            Needs a manager
          </h2>
          <ul className="plain-list">
            <li>
              <span>Materials purchases waiting for a decision</span>
              <Link to="/manage/approvals" className="hours-pill">
                {data.pending === null ? 'Could not count' : data.pending === 0 ? 'None' : data.pending}
              </Link>
            </li>
            <li>
              <span>Tasks due today and overdue</span>
              <span className="muted">Coming in session 5</span>
            </li>
          </ul>

          <h2 id="calendar-heading">Google Calendar</h2>
          <CalendarLine status={data.calendar} />
        </section>
      </div>

      <section aria-labelledby="orders-heading">
        <div className="topbar">
          <h2 id="orders-heading">Open orders by due date</h2>
          <Link to="/manage/orders" className="small">
            All orders ›
          </Link>
        </div>
        {late.length > 0 && (
          <p className="notice warn">
            {late.length} open {late.length === 1 ? 'order is' : 'orders are'} past {late.length === 1 ? 'its' : 'their'} due date.
          </p>
        )}
        <table className="table" data-testid="open-orders">
          <thead>
            <tr>
              <th>Order</th>
              <th>Design</th>
              <th>Quantity</th>
              <th>Due</th>
              <th>Primary artist</th>
              <th>Logged today</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.orders.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No open orders.
                </td>
              </tr>
            )}
            {data.orders.map((o) => {
              const todays = data.entries.filter((e) => e.order_id === o.id)
              return (
                <tr key={o.id}>
                  <td data-label="Order">
                    <Link to={`/manage/orders/${o.id}`} className="row-title">
                      {o.name}
                    </Link>
                  </td>
                  <td data-label="Design">{o.design.name}</td>
                  <td data-label="Quantity">
                    {o.bottles_ordered} bottles
                    {o.design.has_dabber ? ` · ${o.dabbers_ordered} dabbers` : ''}
                  </td>
                  <td data-label="Due">
                    <DueDate date={o.due_date} status={o.status} bare />
                  </td>
                  <td data-label="Primary artist">
                    {(o.primary_artist_id && data.accounts.find((a) => a.id === o.primary_artist_id)?.full_name) || (
                      <span className="muted">Not assigned</span>
                    )}
                  </td>
                  <td data-label="Logged today">
                    {todays.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      todays.map((e) => data.accounts.find((a) => a.id === e.artist_id)?.full_name ?? 'Someone').join(', ')
                    )}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </>
  )
}

function PeopleList({ title, group, data, quiet = false }: { title: string; group: { logged: Account[]; notLogged: Account[] }; data: Data; quiet?: boolean }) {
  const minutesFor = (id: string) => data.entries.filter((e) => e.artist_id === id).reduce((sum, e) => sum + e.minutes, 0)
  const clockedFor = (id: string) => data.clocked.find((c) => c.artist_id === id)
  const studioFor = (id: string) => data.studio.filter((s) => s.artist_id === id).reduce((sum, s) => sum + s.minutes, 0)
  if (group.logged.length + group.notLogged.length === 0) return null
  return (
    <>
      <h3>{title}</h3>
      <ul className="plain-list">
        {group.logged.map((a) => (
          <li key={a.id}>
            <span>
              <span className="ok">✓</span> {a.full_name}
              {studioFor(a.id) > 0 && <span className="muted small"> · {formatMinutes(studioFor(a.id))} studio time</span>}
            </span>
            <span className="hours-pill">{formatMinutes(minutesFor(a.id))}</span>
          </li>
        ))}
        {group.notLogged.map((a) => {
          const clocked = clockedFor(a.id)
          const clockedIn = clocked && (clocked.missing_punch || (clocked.clocked_minutes ?? 0) > 0)
          return (
            <li key={a.id} className={quiet ? 'muted' : undefined}>
              <span>
                {a.full_name}
                {clockedIn && <span className="tag flag">clocked, no entry</span>}
                {studioFor(a.id) > 0 && <span className="muted small"> · {formatMinutes(studioFor(a.id))} studio time</span>}
              </span>
              <span className={quiet ? 'muted' : 'missing'}>Not logged</span>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function CalendarLine({ status }: { status: CalendarStatus | null }) {
  if (!status || status.status === 'disconnected') {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Not connected yet. The read-only calendar sync is built in session 8; Connect, Sync now and Reconnect will be in Settings.
      </p>
    )
  }
  return (
    <p style={{ margin: 0 }}>
      {status.status === 'error' ? <span className="missing">Sync problem</span> : <span className="ok">Connected</span>}
      {status.account_email && <> as {status.account_email}</>}
      {status.last_sync_at && <span className="muted"> · last sync {formatStamp(status.last_sync_at)}</span>}
      {status.last_error && <span className="small missing"> · {status.last_error}</span>}
    </p>
  )
}
