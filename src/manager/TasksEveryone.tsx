import { useMemo, useState } from 'react'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { loadPeople } from '../lib/queries.ts'
import { addDays, todayChicago, weekStart } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import {
  isOverdue,
  loadItemOutcomes,
  loadOpenTasks,
  loadPersonalItems,
  loadRecentlyDone,
  sortTasks,
  type ItemOutcome,
  type PersonalItem,
  type Task,
} from '../lib/tasks.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { TaskCard } from '../components/TaskCard.tsx'
import { ManagerTaskActions, PersonalRow } from '../screens/TasksScreen.tsx'
import { useMarkDone } from '../lib/useMarkDone.tsx'

interface Data {
  open: Task[]
  done: Task[]
  people: Map<string, Person>
  items: PersonalItem[]
  outcomes: Map<string, ItemOutcome>
}

type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none'

/**
 * Tasks — Everyone (managers): every open task in the studio, filterable by
 * person, order and due date; tasks done in the last 14 days with Reopen; and
 * every person's personal list, with Approve.
 */
export default function TasksEveryone() {
  const profile = useProfile()
  const [personId, setPersonId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [due, setDue] = useState<DueFilter>('all')

  const { state, reload } = useAsync<Data>(async () => {
    const [open, done, people, items, outcomes] = await Promise.all([
      loadOpenTasks(),
      loadRecentlyDone(14),
      loadPeople(),
      loadPersonalItems(),
      loadItemOutcomes(),
    ])
    return { open, done, people, items, outcomes }
  }, [])
  const { markDone, busyId, setMessage, notice } = useMarkDone(reload)

  const view = useMemo(() => {
    if (state.kind !== 'ready') return null
    const today = todayChicago()
    const weekEnd = addDays(weekStart(today), 6)
    const matchesPerson = (t: Task) => !personId || t.assignees.includes(personId)
    const matchesOrder = (t: Task) => !orderId || (orderId === 'none' ? !t.order_id : t.order_id === orderId)
    const matchesDue = (t: Task) => {
      switch (due) {
        case 'overdue':
          return isOverdue(t, today)
        case 'today':
          return t.due_date === today
        case 'week':
          return t.due_date !== null && t.due_date <= weekEnd
        case 'none':
          return t.due_date === null
        default:
          return true
      }
    }
    const open = sortTasks(state.data.open.filter((t) => matchesPerson(t) && matchesOrder(t) && matchesDue(t)))
    const done = state.data.done.filter((t) => matchesPerson(t) && matchesOrder(t))

    const orders = new Map<string, string>()
    for (const t of [...state.data.open, ...state.data.done]) if (t.order) orders.set(t.order.id, t.order.name)

    // Personal lists grouped by owner; open items first within each.
    const byOwner = new Map<string, PersonalItem[]>()
    for (const item of state.data.items) {
      if (personId && item.owner_id !== personId) continue
      const list = byOwner.get(item.owner_id) ?? []
      list.push(item)
      byOwner.set(item.owner_id, list)
    }
    const owners = [...byOwner.entries()]
      .map(([id, items]) => ({
        id,
        name: state.data.people.get(id)?.full_name ?? 'Someone',
        items: [...items].sort((a, b) => Number(a.status === 'approved') - Number(b.status === 'approved')),
        waiting: items.filter((i) => i.status !== 'approved').length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { open, done, orders: [...orders.entries()].sort((a, b) => a[1].localeCompare(b[1])), owners }
  }, [state, personId, orderId, due])

  if (state.kind === 'loading') return <Loading what="everyone's tasks" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  if (!view) return null

  const people = [...state.data.people.values()].filter((p) => p.active).sort((a, b) => a.full_name.localeCompare(b.full_name))

  return (
    <>
      {notice}

      <div className="filters">
        <div>
          <label htmlFor="filter-person">Person</label>
          <select id="filter-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-order">Order</label>
          <select id="filter-order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Any order</option>
            <option value="none">Not linked to an order</option>
            {view.orders.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-due">Due</label>
          <select id="filter-due" value={due} onChange={(e) => setDue(e.target.value as DueFilter)}>
            <option value="all">Any date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">Due by the end of this week</option>
            <option value="none">No due date</option>
          </select>
        </div>
      </div>

      <h2>Open tasks ({view.open.length})</h2>
      <ul className="list tasks" data-testid="everyone-open">
        {view.open.length === 0 && <li className="empty">No open tasks match.</li>}
        {view.open.map((t) => (
          <TaskCard key={t.id} task={t} people={state.data.people} viewerId={profile.id} allAssignees onDone={markDone} doneBusy={busyId === t.id}>
            <ManagerTaskActions task={t} onChanged={reload} onMessage={setMessage} />
          </TaskCard>
        ))}
      </ul>

      <details className="done-recently" data-testid="everyone-done">
        <summary>Done in the last 14 days ({view.done.length})</summary>
        <ul className="list tasks">
          {view.done.length === 0 && <li className="empty">Nothing done in the last 14 days matches.</li>}
          {view.done.map((t) => (
            <TaskCard key={t.id} task={t} people={state.data.people} viewerId={profile.id} allAssignees>
              <ManagerTaskActions task={t} onChanged={reload} onMessage={setMessage} />
            </TaskCard>
          ))}
        </ul>
      </details>

      <h2>Personal lists</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Each person’s own list. Only they and managers can see it. Approve an item to turn it into an assigned task.
      </p>
      {view.owners.length === 0 && (
        <ul className="list">
          <li className="empty">No one has anything on their list.</li>
        </ul>
      )}
      {view.owners.map((owner) => (
        <section key={owner.id} className="owner-list" data-testid="owner-list">
          <h3>
            {owner.name}
            {owner.waiting > 0 && <span className="tag">{owner.waiting} not yet approved</span>}
          </h3>
          <ul className="list personal">
            {owner.items.map((item) => (
              <PersonalRow
                key={item.id}
                item={item}
                outcome={state.data.outcomes.get(item.id)}
                onChanged={reload}
                approveTo={`/manage/tasks/approve/${item.id}`}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
