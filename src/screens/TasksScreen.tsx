import { useState, type FormEvent } from 'react'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { loadPeople } from '../lib/queries.ts'
import { formatShortDate, formatStamp } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import {
  addPersonalItem,
  completeTask,
  deletePersonalItem,
  loadItemOutcomes,
  loadNextOccurrence,
  loadOpenTasks,
  loadPersonalItems,
  loadRecentlyDone,
  sortTasks,
  updatePersonalItem,
  type ItemOutcome,
  type PersonalItem,
  type Task,
} from '../lib/tasks.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { nameList, TaskCard } from '../components/TaskCard.tsx'

interface Data {
  open: Task[]
  done: Task[]
  people: Map<string, Person>
  items: PersonalItem[]
  outcomes: Map<string, ItemOutcome>
}

/**
 * Tasks: the tasks assigned to me (overdue first, then priority, due date,
 * newest), then my own personal list.  Tasks are never part of logging an
 * entry (rule 12).
 */
export default function TasksScreen() {
  return (
    <>
      <h1>Tasks</h1>
      <MyTasks />
    </>
  )
}

function MyTasks() {
  const profile = useProfile()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  const { state, reload } = useAsync<Data>(async () => {
    const [open, done, people, items, outcomes] = await Promise.all([
      loadOpenTasks(),
      loadRecentlyDone(7),
      loadPeople(),
      loadPersonalItems(profile.id),
      loadItemOutcomes(),
    ])
    return { open, done, people, items, outcomes }
  }, [profile.id])

  async function markDone(task: Task) {
    if (busyId) return
    setBusyId(task.id)
    setMessage(null)
    try {
      await completeTask(task.id)
      let text = `Done: “${task.title}”. It is marked done for everyone on it.`
      if (task.recurrence) {
        const next = await loadNextOccurrence(task.id)
        if (next?.due_date) text += ` The next one is due ${formatShortDate(next.due_date)}.`
      }
      setMessage({ kind: 'ok', text })
    } catch (e) {
      setMessage({ kind: 'warn', text: (e as Error).message })
    } finally {
      setBusyId(null)
      reload()
    }
  }

  if (state.kind === 'loading') return <Loading what="your tasks" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />

  const { people, items, outcomes } = state.data
  const mine = sortTasks(state.data.open.filter((t) => t.assignees.includes(profile.id)))
  const doneMine = state.data.done.filter((t) => t.assignees.includes(profile.id))

  return (
    <>
      {message && (
        <p className={message.kind === 'ok' ? 'notice' : 'notice warn'} role="status">
          {message.text}
        </p>
      )}

      <h2>Assigned to you</h2>
      <ul className="list tasks">
        {mine.length === 0 && <li className="empty">Nothing assigned to you right now.</li>}
        {mine.map((t) => (
          <TaskCard key={t.id} task={t} people={people} viewerId={profile.id} onDone={markDone} doneBusy={busyId === t.id} />
        ))}
      </ul>

      {doneMine.length > 0 && (
        <details className="done-recently">
          <summary>Done in the last 7 days ({doneMine.length})</summary>
          <ul className="list tasks">
            {doneMine.map((t) => (
              <TaskCard key={t.id} task={t} people={people} viewerId={profile.id} />
            ))}
          </ul>
        </details>
      )}

      <PersonalList items={items} outcomes={outcomes} onChanged={reload} />
    </>
  )
}

/** The person's own list: one-line add, edit, delete; approved items show where they went. */
export function PersonalList({
  items,
  outcomes,
  onChanged,
}: {
  items: PersonalItem[]
  outcomes: Map<string, ItemOutcome>
  onChanged: () => void
}) {
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  async function add(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || adding) return
    setAdding(true)
    setError(null)
    setAdded(false)
    try {
      await addPersonalItem(value)
      setText('')
      setAdded(true)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <h2>Your list</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Things you notice need doing, by you or anyone at the studio. Managers can see this list; other artists cannot.
      </p>
      <form className="add-line" onSubmit={add}>
        <label htmlFor="personal-add" className="visually-hidden">
          Add to your list
        </label>
        <input
          id="personal-add"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setAdded(false)
            setError(null)
          }}
          placeholder="Add something to your list"
          autoComplete="off"
          enterKeyHint="done"
        />
        <button type="submit" disabled={adding || text.trim() === ''}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          Not added. {error} What you typed is still here.
        </p>
      )}
      {added && !error && (
        <p className="save-status saved" role="status">
          Added to your list
        </p>
      )}

      <ul className="list personal">
        {items.length === 0 && <li className="empty">Your list is empty.</li>}
        {items.map((item) => (
          <PersonalRow key={item.id} item={item} outcome={outcomes.get(item.id)} onChanged={onChanged} />
        ))}
      </ul>
    </>
  )
}

function PersonalRow({ item, outcome, onChanged }: { item: PersonalItem; outcome?: ItemOutcome; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm-delete'>('view')
  const [draft, setDraft] = useState(item.text)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const approved = item.status === 'approved'

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setMode('view')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return setError('An item needs some text. To remove it, use Delete.')
    if (value === item.text) return setMode('view')
    void run(() => updatePersonalItem(item.id, value))
  }

  return (
    <li className="personal-item" data-testid="personal-item">
      {mode === 'edit' ? (
        <form className="add-line" onSubmit={save}>
          <label htmlFor={`edit-${item.id}`} className="visually-hidden">
            Edit item
          </label>
          <input id={`edit-${item.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus autoComplete="off" />
          <button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setDraft(item.text)
              setError(null)
              setMode('view')
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="personal-text">{item.text}</div>
      )}

      {approved && (
        <div className="approved-line">
          <span className="tag">Approved → task</span>{' '}
          {outcome ? (
            <span className="muted small">
              Went to {outcome.assignee_names.length ? nameList(outcome.assignee_names) : 'no one yet'}
              {outcome.approved_by ? ` · approved by ${outcome.approved_by}` : ''} · {formatStamp(outcome.approved_at)}
              {outcome.task_status === 'done' ? ' · done' : ''}
            </span>
          ) : (
            <span className="muted small">The task it became has since been removed.</span>
          )}
        </div>
      )}

      {mode === 'view' && (
        <div className="personal-actions">
          {!approved && (
            <button type="button" className="link small" onClick={() => setMode('edit')}>
              Edit
            </button>
          )}
          <button type="button" className="link small" onClick={() => setMode('confirm-delete')}>
            Delete
          </button>
        </div>
      )}
      {mode === 'confirm-delete' && (
        <div className="personal-actions">
          <span className="small">Remove this item?</span>
          <button type="button" className="link small danger-text" disabled={busy} onClick={() => void run(() => deletePersonalItem(item.id))}>
            {busy ? 'Removing…' : 'Yes, remove'}
          </button>
          <button type="button" className="link small" onClick={() => setMode('view')}>
            Keep it
          </button>
        </div>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
