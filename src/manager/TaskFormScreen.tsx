import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { loadOpenOrders, loadPeople } from '../lib/queries.ts'
import { formatShortDate, formatStamp } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import { useFormState } from '../lib/useFormState.ts'
import {
  approvePersonalItem,
  deleteTask,
  loadPersonalItem,
  loadTask,
  personName,
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  saveTask,
  type PersonalItem,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
} from '../lib/tasks.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'

interface Data {
  task: Task | null
  item: PersonalItem | null
  people: Map<string, Person>
  orders: { id: string; name: string }[]
}

const BACK = '/tasks'

/**
 * New task, Edit task, or Approve a personal item into a task.  Managers only;
 * the database refuses these for an artist whatever the screen shows.
 */
export default function TaskFormScreen({ mode }: { mode: 'new' | 'edit' | 'approve' }) {
  const { taskId, itemId } = useParams()

  const { state, reload } = useAsync<Data>(async () => {
    const [task, item, people, openOrders] = await Promise.all([
      mode === 'edit' && taskId ? loadTask(taskId) : Promise.resolve(null),
      mode === 'approve' && itemId ? loadPersonalItem(itemId) : Promise.resolve(null),
      loadPeople(),
      loadOpenOrders(),
    ])
    const orders = openOrders.map((o) => ({ id: o.id, name: o.name }))
    // A task can stay linked to an order that has since closed.
    if (task?.order && !orders.some((o) => o.id === task.order!.id)) orders.push(task.order)
    return { task, item, people, orders }
  }, [mode, taskId, itemId])

  if (state.kind === 'loading') return <Loading what="the task" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  if (mode === 'edit' && !state.data.task) {
    return (
      <>
        <BackLink to={BACK} label="Tasks" />
        <p>This task could not be found. It may have been removed.</p>
      </>
    )
  }
  if (mode === 'approve' && !state.data.item) {
    return (
      <>
        <BackLink to={BACK} label="Tasks" />
        <p>This list item could not be found. Its owner may have removed it.</p>
      </>
    )
  }
  if (mode === 'approve' && state.data.item?.status === 'approved') {
    return (
      <>
        <BackLink to={`${BACK}?view=everyone`} label="Tasks" />
        <p className="notice warn">This item was already approved into a task.</p>
      </>
    )
  }
  return <TaskForm key={taskId ?? itemId ?? 'new'} mode={mode} data={state.data} />
}

function TaskForm({ mode, data }: { mode: 'new' | 'edit' | 'approve'; data: Data }) {
  const navigate = useNavigate()
  const { task, item, people, orders } = data
  const savedId = useRef('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const form = useFormState({
    title: task?.title ?? item?.text ?? '',
    note: task?.note ?? '',
    priority: (task?.priority ?? 'normal') as TaskPriority,
    dueDate: task?.due_date ?? '',
    orderId: task?.order_id ?? '',
    recurrence: (task?.recurrence ?? '') as TaskRecurrence | '',
    assignees: task?.assignees ?? [],
  })
  const { values, set } = form

  // Active people, plus anyone inactive who is still on this task.
  const choices = [...people.values()]
    .filter((p) => p.active || values.assignees.includes(p.id))
    .sort((a, b) => (a.role === b.role ? a.full_name.localeCompare(b.full_name) : a.role === 'artist' ? -1 : 1))

  function toggle(id: string, on: boolean) {
    set('assignees', on ? [...values.assignees, id] : values.assignees.filter((a) => a !== id))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (mode !== 'approve' && values.title.trim() === '') return form.fail('Give the task a title.')
    if (values.assignees.length === 0) return form.fail('Choose at least one person to assign it to.')
    if (mode !== 'approve' && values.recurrence && !values.dueDate) {
      return form.fail('A repeating task needs a first due date, so the schedule knows where to start.')
    }

    const ok = await form.submit(async () => {
      if (mode === 'approve' && item) {
        savedId.current = await approvePersonalItem(item.id, {
          assignees: values.assignees,
          priority: values.priority,
          due_date: values.dueDate || null,
        })
        return
      }
      savedId.current = await saveTask(task?.id ?? null, {
        title: values.title.trim(),
        note: values.note.trim() || null,
        priority: values.priority,
        due_date: values.dueDate || null,
        order_id: values.orderId || null,
        recurrence: values.recurrence || null,
        assignees: values.assignees,
      })
    })
    if (!ok) return
    const names = values.assignees.map((id) => personName(people, id)).sort()
    const text =
      mode === 'approve'
        ? `Approved. “${values.title}” is now a task for ${names.join(', ')}. ${personName(people, item!.owner_id)} will see where it went.`
        : mode === 'new'
          ? `Task created for ${names.join(', ')}.`
          : 'Task saved.'
    navigate(mode === 'edit' ? BACK : `${BACK}?view=everyone`, { replace: true, state: { saved: text, taskId: savedId.current } })
  }

  async function remove() {
    if (!task) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteTask(task.id)
      form.reset()
      navigate(BACK, { replace: true, state: { saved: `Task “${task.title}” removed.` } })
    } catch (e) {
      setDeleteError((e as Error).message)
      setDeleting(false)
    }
  }

  const heading = mode === 'new' ? 'New task' : mode === 'edit' ? 'Edit task' : 'Approve into a task'

  return (
    <>
      <BackLink to={mode === 'approve' ? `${BACK}?view=everyone` : BACK} label="Tasks" />
      <h1>{heading}</h1>
      {task?.status === 'done' && (
        <p className="notice warn">
          This task is done{task.completed_at ? ` (${formatStamp(task.completed_at)})` : ''}. Changes here do not reopen it; use Reopen on the Tasks list.
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate className="card form-card">
        {mode === 'approve' && item ? (
          <>
            <label style={{ marginTop: 0 }}>From {personName(people, item.owner_id)}’s list</label>
            <p className="plain-value">{item.text}</p>
            <p className="form-note">The task takes these words as its title. {personName(people, item.owner_id)} will see “Approved → task” and who it went to.</p>
          </>
        ) : (
          <>
            <label htmlFor="task-title" style={{ marginTop: 0 }}>
              Title
            </label>
            <input id="task-title" value={values.title} onChange={(e) => set('title', e.target.value)} autoComplete="off" />
            <label htmlFor="task-note">Note (optional)</label>
            <textarea id="task-note" value={values.note} onChange={(e) => set('note', e.target.value)} />
            <p className="form-note">Artists on the task can read the title and note. Leave money, rates and prices out of both.</p>
          </>
        )}

        <fieldset className="check-group">
          <legend>Assign to</legend>
          {choices.map((p) => (
            <label key={p.id} className="check-row">
              <input type="checkbox" checked={values.assignees.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
              {p.full_name}
              {p.role === 'manager' ? <span className="muted small"> · manager</span> : null}
              {!p.active ? <span className="muted small"> · switched off</span> : null}
            </label>
          ))}
        </fieldset>

        <div className="two-up">
          <div>
            <label htmlFor="task-priority">Priority</label>
            <select id="task-priority" value={values.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
              {(['high', 'normal', 'low'] as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="task-due">{values.recurrence ? 'First due date' : 'Due date (optional)'}</label>
            <input id="task-due" type="date" value={values.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>

        {mode !== 'approve' && (
          <div className="two-up">
            <div>
              <label htmlFor="task-order">Order (optional)</label>
              <select id="task-order" value={values.orderId} onChange={(e) => set('orderId', e.target.value)}>
                <option value="">No order</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="task-repeat">Repeats</label>
              <select id="task-repeat" value={values.recurrence} onChange={(e) => set('recurrence', e.target.value as TaskRecurrence | '')}>
                <option value="">Does not repeat</option>
                {(['daily', 'weekly', 'biweekly', 'monthly'] as TaskRecurrence[]).map((r) => (
                  <option key={r} value={r}>
                    {RECURRENCE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {mode !== 'approve' && values.recurrence && (
          <p className="form-note">
            When it is marked done, the next one appears on the next date of the schedule that has not passed
            {values.dueDate ? ` (counting from ${formatShortDate(values.dueDate)})` : ''}. Only one is open at a time. To stop it, set Repeats to
            “Does not repeat” or use Stop repeating on the list.
          </p>
        )}

        <SaveBar
          form={form}
          saveLabel={mode === 'new' ? 'Create task' : mode === 'edit' ? 'Save changes' : 'Approve as task'}
          requireChanges={mode === 'edit'}
          cleanText={mode === 'edit' ? 'No changes yet' : 'Not saved yet'}
        >
          <Link to={mode === 'approve' ? `${BACK}?view=everyone` : BACK} className="btn secondary">
            Cancel
          </Link>
        </SaveBar>
      </form>

      {mode === 'edit' && task && (
        <div className="card">
          {!confirmDelete ? (
            <button type="button" className="link danger-text" onClick={() => setConfirmDelete(true)}>
              Remove this task
            </button>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>Remove “{task.title}” for everyone on it? This cannot be undone. To keep a record, mark it done instead.</p>
              <div className="button-row">
                <button type="button" className="danger" onClick={remove} disabled={deleting}>
                  {deleting ? 'Removing…' : 'Yes, remove it'}
                </button>
                <button type="button" className="secondary" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            </>
          )}
          {deleteError && <p className="error">{deleteError}</p>}
        </div>
      )}
    </>
  )
}
