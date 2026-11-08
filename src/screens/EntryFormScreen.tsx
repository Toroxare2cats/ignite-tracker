import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { addDays, formatLongDate, formatMinutes, formatStamp, todayChicago, withinEditWindow } from '../lib/dates.ts'
import {
  createEntry,
  deleteEntry,
  findOwnEntry,
  loadEntry,
  loadOrder,
  loadPeople,
  updateEntry,
} from '../lib/queries.ts'
import { describeCounts, type Counts, type EntryWithTime, type OrderWithDesign, type Person } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { SaveStatusLine } from '../components/form.tsx'
import { useUnsavedWarning } from '../lib/useFormState.ts'

/** Quick totals, in minutes.  Every one is a multiple of 15. */
const CHIPS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480]

type CountKey = keyof Counts
const EMPTY_COUNTS: Record<CountKey, string> = {
  bottles: '',
  dabbers: '',
  points: '',
  color_tube_preps: '',
  blanks: '',
  fuming: '',
}

interface Loaded {
  order: OrderWithDesign
  entry: EntryWithTime | null
  people: Map<string, Person>
}

/**
 * The daily log form.  Opened from an order it creates today's entry; opened
 * from the work log it edits an existing one.  Fields follow the brief's
 * order: work date, bottles, dabbers (design permitting), prep counts under
 * one heading, fuming (design permitting), hours and minutes, note.
 */
export default function EntryFormScreen() {
  const { orderId, entryId } = useParams()
  const profile = useProfile()

  const { state, reload } = useAsync<Loaded | null>(async () => {
    const people = await loadPeople()
    if (entryId) {
      const entry = await loadEntry(entryId)
      if (!entry) return null
      const order = await loadOrder(entry.order_id)
      if (!order) return null
      return { order, entry, people }
    }
    const order = await loadOrder(orderId ?? '')
    if (!order) return null
    return { order, entry: null, people }
  }, [orderId, entryId])

  if (state.kind === 'loading') return <Loading what="the form" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  if (!state.data) {
    return (
      <>
        <BackLink to="/" label="My Work" />
        <p>This {entryId ? 'entry' : 'order'} could not be found.</p>
      </>
    )
  }

  return <EntryForm key={state.data.entry?.id ?? state.data.order.id} loaded={state.data} meId={profile.id} isManager={profile.role === 'manager'} />
}

function EntryForm({ loaded, meId, isManager }: { loaded: Loaded; meId: string; isManager: boolean }) {
  const { order, entry, people } = loaded
  const navigate = useNavigate()
  const today = todayChicago()
  const design = order.design
  const editing = entry !== null
  const artistId = entry?.artist_id ?? meId
  const own = artistId === meId

  const [workDate, setWorkDate] = useState(entry?.work_date ?? today)
  const [counts, setCounts] = useState<Record<CountKey, string>>(() => {
    if (!entry) return EMPTY_COUNTS
    const out = { ...EMPTY_COUNTS }
    for (const key of Object.keys(EMPTY_COUNTS) as CountKey[]) {
      const v = entry[key]
      out[key] = v === null || v === undefined ? '' : String(v)
    }
    return out
  })
  const [minutes, setMinutes] = useState<number>(entry?.minutes ?? 0)
  const [note, setNote] = useState(entry?.note ?? '')
  const [phase, setPhase] = useState<'editing' | 'saving' | 'saved' | 'deleting'>('editing')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(entry?.id ?? null)
  const [savedSummary, setSavedSummary] = useState<string[]>([])

  const current = JSON.stringify({ workDate, counts, minutes, note })
  const [baseline] = useState(current)
  const dirty = current !== baseline
  useUnsavedWarning(dirty && phase !== 'saved')

  // Managers can change a design's options after work is logged, so a count
  // already on this entry stays visible and saved even if the option is now off.
  const showDabbers = design.has_dabber || (entry?.dabbers ?? null) !== null
  const showFuming = design.is_fumed || (entry?.fuming ?? null) !== null

  const closed = order.status === 'closed'
  const inWindow = isManager || withinEditWindow(entry?.work_date ?? workDate)
  const locked = closed || (editing && !inWindow)

  // New entry: if this person already logged this order on the chosen day,
  // switch to editing that entry instead of making a second one.
  useEffect(() => {
    if (editing) return
    let active = true
    findOwnEntry(order.id, meId, workDate)
      .then((existing) => {
        if (active && existing) navigate(`/entries/${existing.id}`, { replace: true })
      })
      .catch(() => {
        // A failed lookup is not fatal: the database refuses duplicates anyway.
      })
    return () => {
      active = false
    }
  }, [editing, order.id, meId, workDate, navigate])

  // Setting hours also clears the "add your hours" reminder.
  function chooseMinutes(next: number | ((m: number) => number)) {
    setMinutes((m) => {
      const value = typeof next === "function" ? next(m) : next
      if (value > 0) setError((current) => (current && /hours/.test(current) ? null : current))
      return value
    })
  }

  function setCount(key: CountKey, value: string) {
    if (value === '' || /^\d{0,4}$/.test(value)) setCounts((c) => ({ ...c, [key]: value }))
  }

  function bump(key: CountKey, delta: number) {
    setCounts((c) => {
      const current = c[key] === '' ? 0 : Number(c[key])
      const next = Math.max(0, current + delta)
      return { ...c, [key]: next === 0 && c[key] === '' ? '' : String(next) }
    })
  }

  function parsedCounts(): Counts {
    const out = {} as Counts
    for (const key of Object.keys(EMPTY_COUNTS) as CountKey[]) {
      const raw = counts[key].trim()
      out[key] = raw === '' ? null : Number(raw)
    }
    if (!showDabbers) out.dabbers = null
    if (!showFuming) out.fuming = null
    return out
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (phase !== 'editing') return
    setError(null)
    if (minutes <= 0) {
      setError('Add your hours before saving. Tap a chip or type them in.')
      return
    }
    if (minutes > 1440) {
      setError('Hours cannot be more than 24 for one day.')
      return
    }
    setPhase('saving')
    const parsed = parsedCounts()
    const trimmedNote = note.trim() === '' ? null : note.trim()
    try {
      let id: string
      if (editing && entry) {
        const changes = isManager ? { ...parsed, note: trimmedNote, work_date: workDate } : { ...parsed, note: trimmedNote }
        await updateEntry(entry.id, changes, minutes)
        id = entry.id
      } else {
        id = await createEntry({ ...parsed, order_id: order.id, artist_id: meId, work_date: workDate, note: trimmedNote, minutes })
      }
      setSavedId(id)
      setSavedSummary([...describeCounts(parsed), formatMinutes(minutes)])
      setPhase('saved')
    } catch (e) {
      // What was typed stays on screen for another try.
      setError((e as Error).message)
      setPhase('editing')
    }
  }

  async function handleDelete() {
    if (!entry || phase !== 'editing') return
    setPhase('deleting')
    setError(null)
    try {
      await deleteEntry(entry.id)
      navigate(`/orders/${order.id}`, { replace: true })
    } catch (e) {
      setError((e as Error).message)
      setPhase('editing')
      setConfirmDelete(false)
    }
  }

  const backTo = `/orders/${order.id}`
  const artistName = own ? 'your' : `${people.get(artistId)?.full_name ?? "someone's"}'s`

  if (phase === 'saved') {
    return (
      <div className="saved">
        <div className="tick" aria-hidden="true">
          ✓
        </div>
        <h1>{editing ? 'Changes saved' : 'Entry saved'}</h1>
        <p>
          <strong>{order.name}</strong> · {formatLongDate(workDate)}
        </p>
        <p className="muted">{savedSummary.join(' · ')}</p>
        <Link to="/" state={{ justSaved: true }} className="btn block big">
          Add another order
        </Link>
        <Link to={backTo} className="btn secondary block">
          Back to this order
        </Link>
        {savedId && (
          <p style={{ marginTop: 16 }}>
            <Link to={`/entries/${savedId}`} replace>
              Change this entry
            </Link>
          </p>
        )}
      </div>
    )
  }

  const busy = phase !== 'editing'
  const dateMin = isManager ? undefined : addDays(today, -7)

  return (
    <>
      <BackLink to={backTo} label={order.name} />
      <h1>{editing ? `Edit ${artistName} entry` : "Today's entry"}</h1>
      <p className="muted">
        {design.name}
        {editing && entry?.edited_at && (
          <>
            {' '}
            · last edited by {entry.edited_by === meId ? 'you' : (people.get(entry.edited_by ?? '')?.full_name ?? 'someone')} ·{' '}
            {formatStamp(entry.edited_at)}
          </>
        )}
      </p>

      {closed && <p className="notice warn">This order is closed. A manager must reopen it before entries can change.</p>}
      {!closed && editing && !inWindow && (
        <p className="notice warn">
          Entries can be edited for 7 days after the work date. This one is older, so it is read-only; ask a manager if it needs a change.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={locked || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <label htmlFor="work_date">Work date</label>
          <input
            id="work_date"
            type="date"
            value={workDate}
            max={today}
            min={dateMin}
            onChange={(e) => e.target.value && setWorkDate(e.target.value)}
            disabled={editing && !isManager}
          />
          {editing && !isManager && <p className="form-note">The date of an entry cannot be changed. Delete it and add a new one if it is on the wrong day.</p>}

          <h2>What you made</h2>
          <div className="count-grid">
            <CountField id="bottles" label="Bottles completed" value={counts.bottles} onChange={(v) => setCount('bottles', v)} onBump={(d) => bump('bottles', d)} />
            {showDabbers && (
              <CountField id="dabbers" label="Dabbers completed" value={counts.dabbers} onChange={(v) => setCount('dabbers', v)} onBump={(d) => bump('dabbers', d)} />
            )}
          </div>

          <details className="prep" open={counts.points !== '' || counts.color_tube_preps !== '' || counts.blanks !== ''}>
            <summary>Prep (points, color tube preps, blanks)</summary>
            <div className="count-grid">
              <CountField id="points" label="Points" value={counts.points} onChange={(v) => setCount('points', v)} onBump={(d) => bump('points', d)} />
              <CountField
                id="color_tube_preps"
                label="Color tube preps"
                value={counts.color_tube_preps}
                onChange={(v) => setCount('color_tube_preps', v)}
                onBump={(d) => bump('color_tube_preps', d)}
              />
              <CountField id="blanks" label="Blanks" value={counts.blanks} onChange={(v) => setCount('blanks', v)} onBump={(d) => bump('blanks', d)} />
            </div>
          </details>

          {showFuming && (
            <div className="count-grid" style={{ marginTop: 16 }}>
              <CountField id="fuming" label="Fuming completed" value={counts.fuming} onChange={(v) => setCount('fuming', v)} onBump={(d) => bump('fuming', d)} />
            </div>
          )}

          <h2>Hours on this order</h2>
          <div className="hours-display" aria-live="polite">
            {minutes > 0 ? formatMinutes(minutes) : <span className="muted">Not set</span>}
          </div>
          <div className="chips" role="group" aria-label="Quick hours">
            {CHIPS.map((m) => (
              <button type="button" key={m} className={minutes === m ? 'chip selected' : 'chip'} onClick={() => chooseMinutes(m)}>
                {formatMinutes(m)}
              </button>
            ))}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            <button type="button" className="chip adjust" onClick={() => chooseMinutes((m) => Math.max(0, m - 15))} aria-label="15 minutes less">
              −15m
            </button>
            <button type="button" className="chip adjust" onClick={() => chooseMinutes((m) => Math.min(1440, m + 15))} aria-label="15 minutes more">
              +15m
            </button>
          </div>
          <div className="time-free">
            <div>
              <label htmlFor="hours">Hours</label>
              <input
                id="hours"
                type="number"
                inputMode="numeric"
                min={0}
                max={24}
                value={Math.floor(minutes / 60) || ''}
                placeholder="0"
                onChange={(e) => chooseMinutes(clampMinutes(Number(e.target.value || 0) * 60 + (minutes % 60)))}
              />
            </div>
            <div>
              <label htmlFor="mins">Minutes</label>
              <input
                id="mins"
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={minutes % 60 || ''}
                placeholder="0"
                onChange={(e) => chooseMinutes(clampMinutes(Math.floor(minutes / 60) * 60 + Number(e.target.value || 0)))}
              />
            </div>
          </div>

          <label htmlFor="note">Note (optional)</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Packing details, problems, handoffs, unusual work"
            rows={3}
          />
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!locked && (
          <>
            <div className="entry-status">
              <SaveStatusLine
                form={{ status: phase === 'saving' ? 'saving' : 'idle', error: null, dirty, savedAt: null }}
                cleanText={editing ? 'No changes yet' : 'Not saved yet'}
              />
            </div>
            <button type="submit" className="btn block big" disabled={busy}>
              {phase === 'saving' ? 'Saving…' : editing ? 'Save changes' : 'Save entry'}
            </button>
          </>
        )}

        {editing && !locked && !confirmDelete && (
          <button type="button" className="btn danger block" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete this entry
          </button>
        )}
        {editing && !locked && confirmDelete && (
          <div className="card error-card">
            <p>Delete this entry? The counts, hours and note will be gone.</p>
            <div className="button-row">
              <button type="button" className="btn secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
                Keep it
              </button>
              <button type="button" className="btn danger" onClick={handleDelete} disabled={busy}>
                {phase === 'deleting' ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        )}
      </form>
    </>
  )
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(1440, Math.round(value))
}

function CountField({
  id,
  label,
  value,
  onChange,
  onBump,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBump: (delta: number) => void
}) {
  return (
    <div className="count-field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" onClick={() => onBump(-1)} aria-label={`One fewer ${label.toLowerCase()}`}>
          −
        </button>
        <input id={id} type="number" inputMode="numeric" min={0} placeholder="0" value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => onBump(1)} aria-label={`One more ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  )
}
