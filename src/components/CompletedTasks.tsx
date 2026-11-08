import { formatStamp } from '../lib/dates.ts'
import { personName, type Task } from '../lib/tasks.ts'

/**
 * "Tasks done" under a day in My Week and Artist week.  A task counts for
 * everyone on it; when someone else ticked it off, the line says who.
 */
export function CompletedTasks({
  tasks,
  personId,
  people,
}: {
  tasks: Task[] | undefined
  personId: string
  people: Map<string, { full_name: string }>
}) {
  if (!tasks || tasks.length === 0) return null
  return (
    <div className="tasks-done-day" data-testid="tasks-done-day">
      <span className="muted small">Tasks done</span>
      <ul>
        {tasks.map((t) => (
          <li key={t.id}>
            ✓ {t.title}
            {t.order ? <span className="muted small"> · {t.order.name}</span> : null}
            {t.completed_by && t.completed_by !== personId ? <span className="muted small"> · done by {personName(people, t.completed_by)}</span> : null}
            {t.completed_at ? <span className="muted small"> · {formatStamp(t.completed_at).replace(/^[A-Z][a-z]{2} \d+, /, '')}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
