import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { loadPeople } from '../lib/queries.ts'
import type { OrderWithDesign, Person } from '../lib/types.ts'
import { DueDate, ErrorNote, Loading, StatusBadge } from '../components/ui.tsx'
import { loadAllOrders } from './queries.ts'

type Filter = 'active' | 'closed' | 'all'

interface Data {
  orders: OrderWithDesign[]
  people: Map<string, Person>
}

/** Orders: every order, soonest due date first, with its status. */
export default function OrdersScreen() {
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const { state, reload } = useAsync<Data>(async () => {
    const [orders, people] = await Promise.all([loadAllOrders(), loadPeople()])
    return { orders, people }
  }, [])

  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data.orders.filter((o) => {
      if (filter === 'active' && o.status === 'closed') return false
      if (filter === 'closed' && o.status !== 'closed') return false
      return q === '' || o.name.toLowerCase().includes(q) || o.design.name.toLowerCase().includes(q)
    })
  }, [state, filter, query])

  return (
    <>
      <div className="topbar">
        <h1>Orders</h1>
        <Link to="/manage/orders/new" className="btn">
          New order
        </Link>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" className={filter === 'active' ? 'active' : ''} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
            In progress
          </button>
          <button type="button" className={filter === 'closed' ? 'active' : ''} aria-pressed={filter === 'closed'} onClick={() => setFilter('closed')}>
            Closed
          </button>
          <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
        <input
          type="search"
          aria-label="Search orders"
          placeholder="Search by order or design"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {state.kind === 'loading' && <Loading what="orders" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Design</th>
              <th>Quantity</th>
              <th>Due</th>
              <th>Primary artist</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  {query.trim() ? `No order matches “${query.trim()}”.` : 'No orders to show here.'}
                </td>
              </tr>
            )}
            {shown.map((o) => (
              <tr key={o.id}>
                <td data-label="Order">
                  <Link to={`/manage/orders/${o.id}`} className="row-title">
                    {o.name}
                  </Link>
                </td>
                <td data-label="Design">{o.design.name}</td>
                <td data-label="Quantity">
                  {o.bottles_ordered} bottles
                  {o.design.has_dabber ? ` · ${o.dabbers_ordered} dabbers` : ''}
                </td>
                <td data-label="Due">
                  <DueDate date={o.due_date} status={o.status} bare />
                </td>
                <td data-label="Primary artist">
                  {(o.primary_artist_id && state.data.people.get(o.primary_artist_id)?.full_name) || <span className="muted">Not assigned</span>}
                </td>
                <td data-label="Status">
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
