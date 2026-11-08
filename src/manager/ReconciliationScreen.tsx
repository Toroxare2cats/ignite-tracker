import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatMinutes, formatStamp, periodText, todayChicago } from '../lib/dates.ts'
import { formatGap } from '../lib/gap.ts'
import { useAsync } from '../lib/useAsync.ts'
import { describeCounts } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { loadAccounts } from './queries.ts'
import { loadWeekReport, type DayCell, type PersonWeek, type WeekReport } from './reportQueries.ts'
import { useWeek } from '../lib/useWeek.ts'
import { WeekPicker } from './WeekPicker.tsx'

/** A figure that may be missing.  Missing is shown as missing, never as zero (rule 6). */
export function Minutes({ value, missing = 'Missing' }: { value: number | null; missing?: string }) {
  if (value === null) return <span className="missing">{missing}</span>
  return <>{value === 0 ? <span className="muted">0</span> : formatMinutes(value)}</>
}

export function Gap({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>
  if (value < 0) return <span className="over">Over-explained by {formatGap(-value)}</span>
  if (value === 0) return <span className="muted">0</span>
  return <>{formatGap(value)}</>
}

/** What uAttend has for the day, with the reasons a figure is missing spelled out. */
export function Clocked({ day }: { day: DayCell }) {
  if (day.missingPunch) return <span className="missing">Missing punch</span>
  if (!day.imported) return <span className="muted">Not imported</span>
  return <Minutes value={day.clocked} />
}

export function DayFlags({ day }: { day: DayCell }) {
  return (
    <>
      {day.noEntry && <span className="tag flag">No entry</span>}
      {day.overExplained && <span className="tag warn">Over-explained</span>}
      {day.missingPunch && <span className="tag warn">Missing punch</span>}
    </>
  )
}

/**
 * Reconciliation: all artists for a pay period (one Sunday-to-Saturday week),
 * per day: clocked (uAttend), production, calendar, studio and the unexplained
 * gap.  Calendar and studio stay empty until sessions 8 and later; the columns
 * and the formula (rule 13) are already live.
 */
export default function ReconciliationScreen() {
  const [week, setWeek] = useWeek()
  const { state, reload } = useAsync<WeekReport>(async () => {
    const accounts = await loadAccounts()
    return loadWeekReport(week.from, week.to, week.dates, new Map(accounts.map((a) => [a.id, a])))
  }, [week.from])

  return (
    <>
      <BackLink to="/manage/reports" label="Reports" />
      <div className="topbar">
        <h1>Reconciliation</h1>
      </div>
      <WeekPicker week={week} onChange={setWeek} />
      <p className="muted">
        Clocked hours come from uAttend, which stays the timesheet. Unexplained gap = clocked − hours logged to orders − calendar events (capped at
        clocked; all-day events not counted) − studio time. Scheduled time is an explanation, not a measurement. A negative gap means more was
        explained than clocked and is shown as over-explained.
      </p>

      {state.kind === 'loading' && <Loading what="the week" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && <Report report={state.data} />}
    </>
  )
}

function ImportStatus({ report }: { report: WeekReport }) {
  if (report.imports.length === 0) {
    return (
      <p className="notice warn" data-testid="import-status">
        No uAttend upload covers {periodText(report.from, report.to)}. <Link to="/manage/imports">Upload it on Imports</Link> to see clocked hours and
        gaps.
      </p>
    )
  }
  const latest = report.imports[0]
  const partial = latest.period_from > report.from || latest.period_to < report.to
  return (
    <p className={partial ? 'notice warn' : 'notice'} data-testid="import-status">
      uAttend upload: {periodText(latest.period_from, latest.period_to)}, uploaded {formatStamp(latest.uploaded_at)}
      {partial && ' (covers only part of this week)'}. <Link to="/manage/imports">Imports</Link>
    </p>
  )
}

function Report({ report }: { report: WeekReport }) {
  const today = todayChicago()
  const flagged = report.people.reduce((n, p) => n + p.flaggedDays, 0)
  const over = report.people.reduce((n, p) => n + p.overExplainedDays, 0)
  return (
    <>
      <ImportStatus report={report} />
      <h2>Week totals</h2>
      <p className="muted small">
        {flagged > 0 ? `${flagged} clocked ${flagged === 1 ? 'day has' : 'days have'} no entry. ` : 'Every clocked day has an entry. '}
        {over > 0 && `${over} ${over === 1 ? 'day is' : 'days are'} over-explained.`}
      </p>
      <div className="table-scroll">
        <table className="table" data-testid="week-totals">
          <thead>
            <tr>
              <th>Person</th>
              <th className="num">Clocked</th>
              <th className="num">On orders</th>
              <th className="num">Calendar</th>
              <th className="num">Studio</th>
              <th className="num">Unexplained</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {report.people.map((p) => (
              <tr key={p.person.id}>
                <td data-label="Person">
                  <a href={`#person-${p.person.id}`} className="row-title">
                    {p.person.full_name}
                  </a>
                  {p.person.role === 'manager' && <span className="tag quiet">manager</span>}
                  {!p.person.active && <span className="tag quiet">switched off</span>}
                </td>
                <td className="num" data-label="Clocked">
                  <Minutes value={p.totals.clocked} missing={p.missingDays > 0 ? 'Missing punch' : 'Not imported'} />
                </td>
                <td className="num" data-label="On orders">
                  <Minutes value={p.totals.order} />
                </td>
                <td className="num" data-label="Calendar">
                  <Minutes value={p.totals.calendarCounted} />
                </td>
                <td className="num" data-label="Studio">
                  <Minutes value={p.totals.studio} />
                </td>
                <td className="num" data-label="Unexplained">
                  <Gap value={p.totals.gap} />
                </td>
                <td data-label="Flags">
                  {p.flaggedDays > 0 && (
                    <span className="tag flag">
                      {p.flaggedDays} {p.flaggedDays === 1 ? 'day' : 'days'} no entry
                    </span>
                  )}
                  {p.overExplainedDays > 0 && <span className="tag warn">{p.overExplainedDays} over-explained</span>}
                  {p.missingDays > 0 && <span className="tag warn">{p.missingDays} missing punch</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Day by day</h2>
      {report.people.map((p) => (
        <PersonDays key={p.person.id} week={p} report={report} today={today} />
      ))}
    </>
  )
}

function PersonDays({ week, report, today }: { week: PersonWeek; report: WeekReport; today: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const quiet = week.totals.clocked === 0 && week.totals.order === 0 && week.totals.studio === 0 && week.totals.calendarCounted === 0 && week.missingDays === 0
  return (
    <section className="card person-days" id={`person-${week.person.id}`} aria-label={`${week.person.full_name}, day by day`}>
      <div className="topbar" style={{ marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{week.person.full_name}</h3>
        <Link to={`/manage/reports/artist-week/${week.person.id}?week=${report.from}`} className="small">
          Artist week ›
        </Link>
      </div>
      {quiet ? (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing clocked or logged this week.
        </p>
      ) : (
        <table className="table days-table">
          <thead>
            <tr>
              <th>Day</th>
              <th className="num">Clocked</th>
              <th className="num">On orders</th>
              <th className="num">Calendar</th>
              <th className="num">Studio</th>
              <th className="num">Unexplained</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {week.days
              .filter((d) => d.date <= today || d.imported || d.entries.length > 0)
              .map((d) => (
                <Fragment key={d.date}>
                  <tr className={d.noEntry ? 'flagged' : d.overExplained ? 'over-row' : undefined}>
                    <td data-label="Day">
                      {d.entries.length > 0 || d.studioRows.length > 0 || d.calendarItems.length > 0 ? (
                        <button type="button" className="link" onClick={() => setOpen(open === d.date ? null : d.date)} aria-expanded={open === d.date}>
                          {formatDate(d.date)} {open === d.date ? '▾' : '▸'}
                        </button>
                      ) : (
                        formatDate(d.date)
                      )}
                    </td>
                    <td className="num" data-label="Clocked">
                      <Clocked day={d} />
                    </td>
                    <td className="num" data-label="On orders">
                      <Minutes value={d.order} />
                    </td>
                    <td className="num" data-label="Calendar">
                      {d.calendar !== d.calendarCounted ? (
                        <span title={`${formatMinutes(d.calendar)} scheduled, capped at clocked`}>{formatMinutes(d.calendarCounted)}*</span>
                      ) : (
                        <Minutes value={d.calendarCounted} />
                      )}
                    </td>
                    <td className="num" data-label="Studio">
                      <Minutes value={d.studio} />
                    </td>
                    <td className="num" data-label="Unexplained">
                      <Gap value={d.gap} />
                    </td>
                    <td data-label="Flags">
                      <DayFlags day={d} />
                    </td>
                  </tr>
                  {open === d.date && (
                    <tr className="detail-row">
                      <td colSpan={7}>
                        <DayDetail day={d} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const STUDIO_LABEL = {
  cleanup_maintenance: 'Cleanup and maintenance',
  general_prep: 'General prep (not tied to an order)',
  admin_teaching_other: 'Admin, teaching or other',
}

/** What was logged on one day: entries, studio time and calendar events. */
export function DayDetail({ day }: { day: DayCell }) {
  return (
    <ul className="plain-list day-detail">
      {day.entries.map((e) => (
        <li key={e.id}>
          <span>
            <Link to={`/manage/orders/${e.order_id}`}>{e.order?.name ?? 'Order'}</Link>
            {e.order?.design && <span className="muted"> · {e.order.design.name}</span>}
            {describeCounts(e).length > 0 && <span className="muted"> · {describeCounts(e).join(', ')}</span>}
            {e.note && <span className="muted"> · “{e.note}”</span>}
          </span>
          <span className="hours-pill">{formatMinutes(e.minutes)}</span>
        </li>
      ))}
      {day.studioRows.map((s, i) => (
        <li key={`s${i}`}>
          <span>
            Studio time: {STUDIO_LABEL[s.category]}
            {s.note && <span className="muted"> · “{s.note}”</span>}
          </span>
          <span className="hours-pill">{formatMinutes(s.minutes)}</span>
        </li>
      ))}
      {day.calendarItems.map((c, i) => (
        <li key={`c${i}`} className={c.declined ? 'muted' : undefined}>
          <span>
            Calendar: {c.title ?? 'Event'} <span className="muted">· {c.calendar_name}</span>
            {c.declined && <span className="tag quiet">declined, not counted</span>}
            {c.all_day && <span className="tag quiet">all day, not counted</span>}
          </span>
          <span className="hours-pill">{c.all_day ? 'All day' : formatMinutes(c.minutes)}</span>
        </li>
      ))}
    </ul>
  )
}
