import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatShortDate, formatStamp, todayChicago } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import { isOverdue, nameList, personName, PRIORITY_LABEL, RECURRENCE_LABEL, type Task } from '../lib/tasks.ts'

/** Overdue, due today, a date, or no date. */
export function TaskDue({ task }: { task: Pick<Task, 'status' | 'due_date'> }) {
  const today = todayChicago()
  if (!task.due_date) return <span className="muted">No due date</span>
  if (isOverdue(task, today)) return <span className="due late">Overdue · was due {formatShortDate(task.due_date)}</span>
  if (task.due_date === today && task.status === 'open') return <span className="due soon">Due today</span>
  return <span className="due">Due {formatShortDate(task.due_date)}</span>
}

export function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABEL[priority]}</span>
}

/**
 * One task: title, note, priority, due date, linked order (name only),
 * recurrence and who it is assigned to.  `viewerId` decides the wording:
 * an assignee sees "With Freddy"; anyone else sees "Assigned to …".
 */
export function TaskCard({
  task,
  people,
  viewerId,
  onDone,
  doneBusy = false,
  allAssignees = false,
  hideOrder = false,
  children,
}: {
  task: Task
  people: Map<string, Person>
  viewerId: string
  onDone?: (task: Task) => void
  doneBusy?: boolean
  /** List everyone by name (the managers' Everyone view), even when the viewer is on it. */
  allAssignees?: boolean
  /** On the order's own page the order line would only repeat itself. */
  hideOrder?: boolean
  children?: ReactNode
}) {
  const mine = !allAssignees && task.assignees.includes(viewerId)
  const others = task.assignees
    .filter((id) => id !== viewerId)
    .map((id) => personName(people, id))
    .sort((a, b) => a.localeCompare(b))
  const everyone = task.assignees.map((id) => personName(people, id)).sort((a, b) => a.localeCompare(b))
  const overdue = isOverdue(task)

  return (
    <li className={overdue ? 'task overdue' : 'task'} data-testid="task">
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        {task.note && <div className="task-note">{task.note}</div>}
        <div className="task-meta">
          <PriorityBadge priority={task.priority} />
          {task.status === 'open' && <TaskDue task={task} />}
          {task.recurrence && <span className="muted">↻ {RECURRENCE_LABEL[task.recurrence]}</span>}
        </div>
        {task.order && !hideOrder && (
          <div className="task-sub">
            Order: <Link to={`/orders/${task.order.id}`}>{task.order.name}</Link>
          </div>
        )}
        <div className="task-sub">
          {mine
            ? others.length > 0
              ? `With ${nameList(others)}`
              : 'Just you'
            : everyone.length > 0
              ? `Assigned to ${nameList(everyone)}`
              : 'Not assigned to anyone'}
        </div>
        {task.status === 'done' && (
          <div className="task-sub">
            Done by {personName(people, task.completed_by)}
            {task.completed_at ? ` · ${formatStamp(task.completed_at)}` : ''}
          </div>
        )}
        {children}
      </div>
      {task.status === 'open' && onDone && (
        <button
          type="button"
          className="task-done"
          onClick={() => onDone(task)}
          disabled={doneBusy}
          aria-label={`Mark “${task.title}” done`}
        >
          {doneBusy ? '…' : '✓ Done'}
        </button>
      )}
    </li>
  )
}
