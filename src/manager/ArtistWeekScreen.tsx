import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatDate, periodText, todayChicago } from '../lib/dates.ts'
import { useAsync } from '../lib/useAsync.ts'
import { useWeek } from '../lib/useWeek.ts'
import { COUNT_FIELDS, describeCounts, type Counts } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { loadAccounts, type Account } from './queries.ts'
import { Clocked, DayDetail, DayFlags, Gap, Minutes } from './ReconciliationScreen.tsx'
import { buildPersonWeek, loadCalendarItems, loadClocked, loadEntriesBetween, loadImportsCovering, loadStudioTime, type ImportCover, type PersonWeek } from './reportQueries.ts'
import { WeekPicker } from './WeekPicker.tsx'
import { loadTasksDoneFor, type Task } from '../lib/tasks.ts'
import { CompletedTasks } from '../components/CompletedTasks.tsx'

interface Data {
  accounts: Account[]
  week: PersonWeek | null
  imports: ImportCover[]
  tasksDone: Map<string, Task[]>
}

/**
 * Artist week: one person, one Sunday-to-Saturday week: each day's orders,
 * counts, logged hours, clocked hours (uAttend) and the unexplained gap, with
 * blank days flagged, and the tasks done each day that they were on (brief: Reports
 * and views).  Calendar events and studio time fill in with sessions 8 and later.
 * Each activity count is totalled on its own, never added together (rule 3).
 */
export default function ArtistWeekScreen() {
  const { personId } = useParams()
  const navigate = useNavigate()
  const [week, setWeek] = useWeek()

  const { state, reload } = useAsync<Data>(async () => {
    const accounts = await loadAccounts()
    const person = personId ? (accounts.find((a) => a.id === personId) ?? null) : null
    if (!person) return { accounts, week: null, imports: [], tasksDone: new Map() }
    const [clocked, entries, studio, calendar, imports, tasksDone] = await Promise.all([
      loadClocked(week.from, week.to, person.id),
      loadEntriesBetween(week.from, week.to, person.id),
      loadStudioTime(week.from, week.to, person.id),
      loadCalendarItems(week.from, week.to, person.id),
      loadImportsCovering(week.from, week.to),
      loadTasksDoneFor(person.id, week.from, week.to),
    ])
    return { accounts, week: buildPersonWeek(person, week.dates, { clocked, entries, studio, calendar }), imports, tasksDone }
  }, [personId, week.from])

  const go = (id: string) => navigate(`/manage/reports/artist-week/${id}${week.isCurrent ? '' : `?week=${week.from}`}`)

  return (
    <>
      <BackLink to="/manage/reports" label="Reports" />
      <h1>Artist week</h1>
      {state.kind === 'loading' && <Loading what="the week" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <div className="toolbar" style={{ marginTop: 0 }}>
            <label htmlFor="artist-week-person" className="sub" style={{ margin: 0 }}>
              Person
            </label>
            <select id="artist-week-person" value={personId ?? ''} onChange={(e) => go(e.target.value)} style={{ flex: '0 1 280px', width: 'auto' }}>
              <option value="" disabled>
                Choose a person…
              </option>
              <PersonOptions accounts={state.data.accounts} />
            </select>
            <WeekPicker week={week} onChange={setWeek} />
          </div>
          {personId && !state.data.week && <ErrorNote message="This person does not exist." />}
          {!personId && <p className="muted">Choose a person to see their week.</p>}
          {state.data.week && <WeekView week={state.data.week} imports={state.data.imports} tasksDone={state.data.tasksDone} accounts={state.data.accounts} from={week.from} to={week.to} />}
        </>
      )}
    </>
  )
}

function PersonOptions({ accounts }: { accounts: Account[] }) {
  const artists = accounts.filter((a) => a.role === 'artist' && a.active)
  const managers = accounts.filter((a) => a.role === 'manager' && a.active)
  const off = accounts.filter((a) => !a.active)
  return (
    <>
      <optgroup label="Artists">
        {artists.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Managers">
        {managers.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
          </option>
        ))}
      </optgroup>
      {off.length > 0 && (
        <optgroup label="Switched off">
          {off.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  )
}

function WeekView({
  week,
  imports,
  tasksDone,
  accounts,
  from,
  to,
}: {
  week: PersonWeek
  imports: ImportCover[]
  tasksDone: Map<string, Task[]>
  accounts: Account[]
  from: string
  to: string
}) {
  const people = new Map(accounts.map((a) => [a.id, a]))
  const tasksTotal = [...tasksDone.values()].reduce((n, list) => n + list.length, 0)
  const today = todayChicago()
  const entries = week.days.flatMap((d) => d.entries)
  const totals = {} as Counts
  for (const f of COUNT_FIELDS) totals[f.key] = entries.reduce((sum, e) => sum + (e[f.key] ?? 0), 0) || null
  const countParts = describeCounts(totals)
  const orders = new Set(entries.map((e) => e.order_id))
  const daysLogged = week.days.filter((d) => d.entries.length > 0).length
  const imported = week.days.some((d) => d.imported)

  return (
    <>
      <h2>{week.person.full_name}</h2>
      {!imported && (
        <p className="notice warn" data-testid="import-status">
          No uAttend hours for {week.person.full_name} in {periodText(from, to)}
          {imports.length > 0 ? ' (the upload for this week does not include them)' : ''}. <Link to="/manage/imports">Imports</Link>
        </p>
      )}
      <div className="portal-columns">
        <div className="card" data-testid="week-totals">
          <h3 style={{ marginTop: 0 }}>Week totals</h3>
          <dl className="facts money">
            <dt>Clocked (uAttend)</dt>
            <dd>
              <Minutes value={week.totals.clocked} missing={week.missingDays > 0 ? 'Missing punch' : 'Not imported'} />
            </dd>
            <dt>On orders</dt>
            <dd>
              <Minutes value={week.totals.order} />
            </dd>
            <dt>Calendar</dt>
            <dd>
              <Minutes value={week.totals.calendarCounted} />
            </dd>
            <dt>Studio time</dt>
            <dd>
              <Minutes value={week.totals.studio} />
            </dd>
            <dt className="strong">Unexplained</dt>
            <dd className="strong">
              <Gap value={week.totals.gap} />
            </dd>
          </dl>
          <p className="form-note" style={{ marginBottom: 0 }}>
            {week.flaggedDays > 0 ? (
              <span className="missing">
                {week.flaggedDays} clocked {week.flaggedDays === 1 ? 'day has' : 'days have'} no entry.
              </span>
            ) : (
              'Every clocked day has an entry.'
            )}
            {week.overExplainedDays > 0 && ` ${week.overExplainedDays} over-explained.`}
          </p>
        </div>
        <div className="card" data-testid="week-counts">
          <h3 style={{ marginTop: 0 }}>Produced</h3>
          {countParts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No counts logged this week.
            </p>
          ) : (
            <ul className="plain-list">
              {COUNT_FIELDS.filter((f) => totals[f.key]).map((f) => (
                <li key={f.key}>
                  <span>{f.label}</span>
                  <span className="hours-pill">{totals[f.key]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="form-note" style={{ marginBottom: 0 }}>
            {daysLogged} {daysLogged === 1 ? 'day' : 'days'} logged on {orders.size} {orders.size === 1 ? 'order' : 'orders'}. Each count is its own activity; they are never
            added together. {tasksTotal} {tasksTotal === 1 ? 'task' : 'tasks'} done.
          </p>
        </div>
      </div>

      <h2>Day by day</h2>
      {week.days
        .filter((d) => d.date <= today || d.imported || d.entries.length > 0 || tasksDone.has(d.date))
        .map((d) => (
          <section key={d.date} className={`card day-card${d.noEntry ? ' flagged' : d.overExplained ? ' over-row' : ''}`} aria-label={formatDate(d.date)}>
            <div className="day-head">
              <strong>{formatDate(d.date)}</strong>
              <span className="day-figures">
                <span>
                  Clocked <Clocked day={d} />
                </span>
                <span>
                  On orders <Minutes value={d.order} />
                </span>
                <span>
                  Gap <Gap value={d.gap} />
                </span>
                <DayFlags day={d} />
              </span>
            </div>
            {d.entries.length + d.studioRows.length + d.calendarItems.length === 0 && !tasksDone.has(d.date) ? (
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                {d.clocked !== null && d.clocked > 0 ? 'Clocked in, nothing logged.' : 'Nothing logged.'}
              </p>
            ) : (
              <DayDetail day={d} />
            )}
            <CompletedTasks tasks={tasksDone.get(d.date)} personId={week.person.id} people={people} />
          </section>
        ))}
      <p className="form-note">
        Unexplained = clocked − on orders − calendar (capped at clocked) − studio time. Clocked hours are from uAttend, which stays the timesheet; a negative figure is
        shown as over-explained.
      </p>
    </>
  )
}
