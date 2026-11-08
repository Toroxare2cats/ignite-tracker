import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { loadPeople } from '../lib/queries.ts'
import { formatStamp } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import {
  addPersonalItem,
  deletePersonalItem,
  loadItemOutcomes,
  loadOpenTasks,
  loadPersonalItems,
  loadRecentlyDone,
  nameList,
  reopenTask,
  RECURRENCE_LABEL,
  sortTasks,
  stopRecurrence,
  updatePersonalItem,
  type ItemOutcome,
  type PersonalItem,
  type Task,
} from '../lib/tasks.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { TaskCard } from '../components/TaskCard.tsx'
import { useMarkDone, type TaskMessage } from '../lib/useMarkDone.tsx'

// Managers only; loaded when a manager switches to Everyone.
const TasksEveryone = lazy(() => import('../manager/TasksEveryone.tsx'))

interface Data {
  open: Task[]
  done: Task[]
  people: Map<string, Person>
  items: PersonalItem[]
  outcomes: Map<string, ItemOutcome>
}

/**
 * Tasks: the tasks assigned to me (overdue first, then priority, due date,
 * newest), then my own personal list.  Managers also get Mine / Everyone and
 * the controls to create, edit, reopen and approve.  Tasks are never part of
 * logging an entry (rule 12).
 */
export default function TasksScreen() {
  const profile = useProfile()
  const isManager = profile.role === 'manager'
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const saved = (location.state as { saved?: string } | null)?.saved ?? null
  const view = isManager && params.get('view') === 'everyone' ? 'everyone' : 'mine'

  return (
    <>
      <div className="topbar">
        <h1>Tasks</h1>
        {isManager && (
          <Link to="/manage/tasks/new" className="btn">
            New task
          </Link>
        )}
      </div>
      {isManager && (
        <div className="segmented" role="tablist" aria-label="Whose tasks">
          <button type="button" role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'active' : ''} onClick={() => setParams({}, { replace: true })}>
            Mine
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'everyone'}
            className={view === 'everyone' ? 'active' : ''}
            onClick={() => setParams({ view: 'everyone' }, { replace: true })}
          >
            Everyone
          </button>
        </div>
      )}
      {saved && (
        <p className="notice" role="status" style={{ marginTop: 12 }}>
          {saved}
        </p>
      )}
      {view === 'everyone' ? (
        <Suspense fallback={<Loading what="everyone's tasks" />}>
          <TasksEveryone />
        </Suspense>
      ) : (
        <MyTasks />
      )}
    </>
  )
}

/** A manager's buttons under a task: Edit, Stop repeating, Reopen. */
export function ManagerTaskActions({
  task,
  onChanged,
  onMessage,
}: {
  task: Task
  onChanged: () => void
  onMessage: (m: TaskMessage) => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)

  async function run(action: () => Promise<void>, text: string) {
    setBusy(true)
    onMessage(null)
    try {
      await action()
      onMessage({ kind: 'ok', text })
    } catch (e) {
      onMessage({ kind: 'warn', text: (e as Error).message })
    } finally {
      setBusy(false)
      setConfirmStop(false)
      onChanged()
    }
  }

  return (
    <div className="task-actions">
      <button type="button" className="link small" onClick={() => navigate(`/manage/tasks/${task.id}`)}>
        Edit
      </button>
      {task.status === 'open' && task.recurrence && !confirmStop && (
        <button type="button" className="link small" onClick={() => setConfirmStop(true)}>
          Stop repeating
        </button>
      )}
      {confirmStop && task.recurrence && (
        <>
          <span className="small">Stop “{RECURRENCE_LABEL[task.recurrence].toLowerCase()}”? This one stays open; none come after it.</span>
          <button
            type="button"
            className="link small danger-text"
            disabled={busy}
            onClick={() => void run(() => stopRecurrence(task.id), `“${task.title}” will not repeat any more.`)}
          >
            Yes, stop
          </button>
          <button type="button" className="link small" onClick={() => setConfirmStop(false)}>
            Keep repeating
          </button>
        </>
      )}
      {task.status === 'done' && (
        <button
          type="button"
          className="link small"
          disabled={busy}
          onClick={() =>
            void run(
              () => reopenTask(task.id),
              task.recurrence
                ? `Reopened “${task.title}”. The next occurrence made when it was completed was taken back, so only one is open.`
                : `Reopened “${task.title}”.`,
            )
          }
        >
          {busy ? 'Reopening…' : 'Reopen'}
        </button>
      )}
    </div>
  )
}

function MyTasks() {
  const profile = useProfile()
  const isManager = profile.role === 'manager'

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
  const { markDone, busyId, setMessage, notice } = useMarkDone(reload)

  if (state.kind === 'loading') return <Loading what="your tasks" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />

  const { people, items, outcomes } = state.data
  const mine = sortTasks(state.data.open.filter((t) => t.assignees.includes(profile.id)))
  const doneMine = state.data.done.filter((t) => t.assignees.includes(profile.id))

  return (
    <>
      {notice}

      <h2>Assigned to you</h2>
      <ul className="list tasks">
        {mine.length === 0 && <li className="empty">Nothing assigned to you right now.</li>}
        {mine.map((t) => (
          <TaskCard key={t.id} task={t} people={people} viewerId={profile.id} onDone={markDone} doneBusy={busyId === t.id}>
            {isManager && <ManagerTaskActions task={t} onChanged={reload} onMessage={setMessage} />}
          </TaskCard>
        ))}
      </ul>

      {doneMine.length > 0 && (
        <details className="done-recently">
          <summary>Done in the last 7 days ({doneMine.length})</summary>
          <ul className="list tasks">
            {doneMine.map((t) => (
              <TaskCard key={t.id} task={t} people={people} viewerId={profile.id}>
                {isManager && <ManagerTaskActions task={t} onChanged={reload} onMessage={setMessage} />}
              </TaskCard>
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

/** One personal-list item.  `approveTo` (managers, Everyone view) adds an Approve link. */
export function PersonalRow({
  item,
  outcome,
  onChanged,
  approveTo,
}: {
  item: PersonalItem
  outcome?: ItemOutcome
  onChanged: () => void
  approveTo?: string
}) {
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
          {approveTo && !approved && (
            <Link to={approveTo} className="small">
              Approve as task
            </Link>
          )}
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
