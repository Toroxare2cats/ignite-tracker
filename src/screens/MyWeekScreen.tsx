import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { addDays, formatHours, formatMinutes, formatRelativeDate, formatShortDate, todayChicago, weekStart, withinEditWindow } from '../lib/dates.ts'
import { loadOwnEntries } from '../lib/queries.ts'
import { supabase } from '../lib/supabase.ts'
import { COUNT_FIELDS, describeCounts, type Counts, type EntryWithTime } from '../lib/types.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { CompletedTasks } from '../components/CompletedTasks.tsx'
import { loadTasksCompletedBy, type Task } from '../lib/tasks.ts'

interface Data {
  entries: EntryWithTime[]
  orderNames: Map<string, string>
  tasksDone: Map<string, Task[]>
}

/**
 * My Week: the person's own days, orders, counts and hours for this week and
 * last week (Sunday through Saturday).  Each activity is totalled on its own; they
 * are never added together (rule 3).  Tasks the person marked done show under
 * each day.  Calendar events join this screen in session 8.
 */
export default function MyWeekScreen() {
  const profile = useProfile()
  const [which, setWhich] = useState<'this' | 'last'>('this')

  const today = todayChicago()
  const thisSunday = weekStart(today)
  const lastSunday = addDays(thisSunday, -7)
  const from = which === 'this' ? thisSunday : lastSunday
  const to = addDays(from, 6)

  const { state, reload } = useAsync<Data>(async () => {
    const [entries, tasksDone] = await Promise.all([
      loadOwnEntries(profile.id, lastSunday, addDays(thisSunday, 6)),
      loadTasksCompletedBy(profile.id, lastSunday, addDays(thisSunday, 6)),
    ])
    const ids = [...new Set(entries.map((e) => e.order_id))]
    const orderNames = new Map<string, string>()
    if (ids.length) {
      const { data, error } = await supabase.from('orders').select('id, name').in('id', ids)
      if (error) throw new Error(error.message)
      for (const o of data as { id: string; name: string }[]) orderNames.set(o.id, o.name)
    }
    return { entries, orderNames, tasksDone }
  }, [profile.id, thisSunday])

  return (
    <>
      <h1>My Week</h1>
      <div className="segmented" role="tablist" aria-label="Week">
        <button type="button" role="tab" aria-selected={which === 'this'} className={which === 'this' ? 'active' : ''} onClick={() => setWhich('this')}>
          This week
        </button>
        <button type="button" role="tab" aria-selected={which === 'last'} className={which === 'last' ? 'active' : ''} onClick={() => setWhich('last')}>
          Last week
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        {formatShortDate(from)} – {formatShortDate(to)}
      </p>

      {state.kind === 'loading' && <Loading what="your week" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && <Week entries={state.data.entries.filter((e) => e.work_date >= from && e.work_date <= to)} orderNames={state.data.orderNames} tasksDone={state.data.tasksDone} from={from} />}
    </>
  )
}

function Week({
  entries,
  orderNames,
  tasksDone,
  from,
}: {
  entries: EntryWithTime[]
  orderNames: Map<string, string>
  tasksDone: Map<string, Task[]>
  from: string
}) {
  const tasksThisWeek = Array.from({ length: 7 }, (_, i) => tasksDone.get(addDays(from, i))?.length ?? 0).reduce((a, b) => a + b, 0)
  const totalMinutes = entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0)
  const totals = {} as Counts
  for (const f of COUNT_FIELDS) totals[f.key] = entries.reduce((sum, e) => sum + (e[f.key] ?? 0), 0) || null
  const totalParts = describeCounts(totals)
  const days = new Set(entries.map((e) => e.work_date))

  // Every day of the week, Sunday first, so blank days are visible too.
  const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => d <= todayChicago() || days.has(d) || tasksDone.has(d))

  return (
    <>
      <div className="card">
        <p style={{ margin: 0 }}>
          <strong>{formatHours(totalMinutes)}</strong> on orders across {days.size} {days.size === 1 ? 'day' : 'days'}
        </p>
        <div className="week-totals">
          {totalParts.length === 0 && <span className="muted small">No counts logged</span>}
          {totalParts.map((p) => (
            <span key={p} className="count-pill">
              {p}
            </span>
          ))}
        </div>
        {tasksThisWeek > 0 && (
          <p className="muted small" style={{ margin: '8px 0 0' }}>
            {tasksThisWeek} {tasksThisWeek === 1 ? 'task' : 'tasks'} marked done
          </p>
        )}
      </div>

      {dates.map((date) => {
        const dayEntries = entries.filter((e) => e.work_date === date)
        const dayMinutes = dayEntries.reduce((sum, e) => sum + (e.minutes ?? 0), 0)
        return (
          <section key={date} className="day">
            <div className="day-head">
              <strong>{formatRelativeDate(date)}</strong>
              <span className="hours">{dayEntries.length ? formatMinutes(dayMinutes) : 'Nothing logged'}</span>
            </div>
            <CompletedTasks tasks={tasksDone.get(date)} />
            {dayEntries.length > 0 && (
              <ul className="list">
                {dayEntries.map((e) => {
                  const counts = describeCounts(e)
                  const editable = withinEditWindow(e.work_date)
                  const body = (
                    <>
                      <div className="log-head">
                        <span className="log-who">{orderNames.get(e.order_id) ?? 'Order'}</span>
                        <span className="log-date">{e.minutes !== null ? formatMinutes(e.minutes) : ''}</span>
                      </div>
                      <div className="log-counts">
                        {counts.length === 0 && <span className="muted small">No counts</span>}
                        {counts.map((c) => (
                          <span key={c} className="count-pill">
                            {c}
                          </span>
                        ))}
                      </div>
                      {e.note && <p className="log-note">{e.note}</p>}
                    </>
                  )
                  return (
                    <li key={e.id}>
                      {editable ? (
                        <Link to={`/entries/${e.id}`} className="log-entry">
                          {body}
                        </Link>
                      ) : (
                        <div className="log-entry">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}
