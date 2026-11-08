import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { useProfile } from '../lib/useProfile.ts'
import { useMarkDone } from '../lib/useMarkDone.tsx'
import { loadOrderTasks, sortTasks } from '../lib/tasks.ts'
import type { Person } from '../lib/types.ts'
import { TaskCard } from './TaskCard.tsx'

/**
 * Open tasks linked to an order, on the order's page.  Row-level security
 * returns to an artist only the tasks assigned to them; a manager sees every
 * one.  The task never carries anything but the order's name (brief).
 */
export default function OrderTasks({
  orderId,
  people,
  heading = 'h2',
}: {
  orderId: string
  people: Map<string, Person>
  heading?: 'h2' | 'h3'
}) {
  const profile = useProfile()
  const isManager = profile.role === 'manager'
  const { state, reload } = useAsync(() => loadOrderTasks(orderId), [orderId])
  const { markDone, busyId, notice } = useMarkDone(reload)

  if (state.kind !== 'ready') return null // the order page itself shows loading and errors
  const tasks = sortTasks(state.data)
  // An artist with nothing open here sees no section, except right after ticking
  // off the last one, so the "Done" confirmation stays on screen.
  if (tasks.length === 0 && !isManager && !notice) return null
  const Heading = heading

  return (
    <section data-testid="order-tasks" aria-label="Open tasks for this order">
      <div className="topbar">
        <Heading style={heading === 'h3' ? { margin: '16px 0 0' } : undefined}>Open tasks</Heading>
        {isManager && (
          <Link to={`/manage/tasks/new?order=${orderId}`} className="small">
            + Task for this order
          </Link>
        )}
      </div>
      {notice}
      <ul className="list tasks">
        {tasks.length === 0 && <li className="empty">No open tasks for this order.</li>}
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            people={people}
            viewerId={profile.id}
            onDone={markDone}
            doneBusy={busyId === t.id}
            hideOrder
            allAssignees={isManager}
          />
        ))}
      </ul>
    </section>
  )
}
