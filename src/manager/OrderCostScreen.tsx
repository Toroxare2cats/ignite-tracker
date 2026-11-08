import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatFullDate, formatMinutes, formatStamp } from '../lib/dates.ts'
import { loadOrder, loadPeople } from '../lib/queries.ts'
import { useAsync } from '../lib/useAsync.ts'
import { describeCounts, type OrderWithDesign, type Person } from '../lib/types.ts'
import { BackLink, DueDate, ErrorNote, Loading, StatusBadge } from '../components/ui.tsx'
import { CostCard, Money } from './CostCard.tsx'
import { loadAllOrders, loadOrderCost, loadOrderCostByContributor, loadOrderFinancials, type ContributorCost, type OrderCost, type OrderFinancials } from './queries.ts'
import { loadOrderReportEntries, type ReportEntry } from './reportQueries.ts'

/**
 * Order cost: one order's entries, hours by contributor, labor cost,
 * materials, selling price and amount remaining (brief: Costs and pricing).
 * Every figure comes from the database's cost functions, which use the rate in
 * force on each entry's work date; a missing input shows as missing (rule 6).
 */
export default function OrderCostScreen() {
  const { orderId } = useParams()
  return orderId ? <OrderCostReport orderId={orderId} /> : <PickOrder />
}

function PickOrder() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { state, reload } = useAsync(async () => {
    const [orders, people] = await Promise.all([loadAllOrders(), loadPeople()])
    return { orders, people }
  }, [])
  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    const list = state.data.orders.filter((o) => q === '' || o.name.toLowerCase().includes(q) || o.design.name.toLowerCase().includes(q))
    // Closed orders first: they are the ones with complete figures.
    return [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === 'closed' ? -1 : b.status === 'closed' ? 1 : 0))
  }, [state, query])

  return (
    <>
      <BackLink to="/manage/reports" label="Reports" />
      <h1>Order cost</h1>
      <p className="muted">Choose an order. Closed orders have complete figures; open and finished ones show hours and what is still missing.</p>
      <div className="toolbar">
        <input type="search" aria-label="Search orders" placeholder="Search by order or design" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {state.kind === 'loading' && <Loading what="orders" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Design</th>
              <th>Due</th>
              <th>Primary artist</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No order matches.
                </td>
              </tr>
            )}
            {shown.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => navigate(`/manage/reports/order-cost/${o.id}`)}>
                <td data-label="Order">
                  <Link to={`/manage/reports/order-cost/${o.id}`} className="row-title">
                    {o.name}
                  </Link>
                </td>
                <td data-label="Design">{o.design.name}</td>
                <td data-label="Due">
                  <DueDate date={o.due_date} status={o.status} bare />
                </td>
                <td data-label="Primary artist">{(o.primary_artist_id && state.data.people.get(o.primary_artist_id)?.full_name) || <span className="muted">Not assigned</span>}</td>
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

interface Data {
  order: OrderWithDesign | null
  cost: OrderCost | null
  contributors: ContributorCost[]
  entries: ReportEntry[]
  financials: OrderFinancials | null
  people: Map<string, Person>
}

function OrderCostReport({ orderId }: { orderId: string }) {
  const { state, reload } = useAsync<Data>(async () => {
    const order = await loadOrder(orderId)
    if (!order) return { order: null, cost: null, contributors: [], entries: [], financials: null, people: new Map() }
    const [cost, contributors, entries, financials, people] = await Promise.all([
      loadOrderCost(orderId),
      loadOrderCostByContributor(orderId),
      loadOrderReportEntries(orderId),
      loadOrderFinancials(orderId),
      loadPeople(),
    ])
    return { order, cost, contributors, entries, financials, people }
  }, [orderId])

  if (state.kind === 'loading') return <Loading what="the order" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  const { order, cost, contributors, entries, financials, people } = state.data
  if (!order) {
    return (
      <>
        <BackLink to="/manage/reports/order-cost" label="Order cost" />
        <ErrorNote message="This order does not exist, or it was removed." />
      </>
    )
  }
  const name = (id: string | null) => (id && people.get(id)?.full_name) || 'Unknown'
  const totalMinutes = contributors.reduce((sum, c) => sum + c.minutes, 0)

  return (
    <>
      <BackLink to="/manage/reports/order-cost" label="Order cost" />
      <div className="topbar">
        <h1>{order.name}</h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="muted">
        {order.design.name} · {order.bottles_ordered} bottles ordered
        {order.design.has_dabber && ` · ${order.dabbers_ordered} dabbers ordered`} · <DueDate date={order.due_date} status={order.status} /> · primary artist{' '}
        {name(order.primary_artist_id)} · <Link to={`/manage/orders/${order.id}`}>Open the order</Link>
      </p>

      <div className="portal-columns">
        <div>
          <CostCard order={order} cost={cost} />
          {financials && order.status === 'closed' && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Closed</h3>
              <dl className="facts">
                <dt>Delivered</dt>
                <dd>
                  {financials.bottles_delivered ?? <span className="missing">Missing</span>} bottles
                  {order.design.has_dabber && <>, {financials.dabbers_delivered ?? <span className="missing">Missing</span>} dabbers</>}
                </dd>
                <dt>Closed by</dt>
                <dd>
                  {name(financials.closed_by)}
                  {financials.closed_at && <span className="muted"> · {formatStamp(financials.closed_at)}</span>}
                </dd>
                {financials.materials_note && (
                  <>
                    <dt>Materials note</dt>
                    <dd>{financials.materials_note}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
        </div>

        <div className="card" data-testid="contributors">
          <h3 style={{ marginTop: 0 }}>Hours by contributor</h3>
          {contributors.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No hours logged on this order yet.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Entries</th>
                  <th className="num">Hours</th>
                  <th className="num">Labor</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.artist_id}>
                    <td data-label="Person">{name(c.artist_id)}</td>
                    <td className="num" data-label="Entries">
                      {c.entry_count}
                    </td>
                    <td className="num" data-label="Hours">
                      {formatMinutes(c.minutes)}
                    </td>
                    <td className="num" data-label="Labor">
                      <Money value={c.labor_cost} />
                      {!c.rated && <div className="small missing">No pay rate on a work date</div>}
                    </td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td data-label="Total">Total</td>
                  <td className="num" data-label="Entries">
                    {entries.length}
                  </td>
                  <td className="num" data-label="Hours">
                    {formatMinutes(totalMinutes)}
                  </td>
                  <td className="num" data-label="Labor">
                    <Money value={cost?.labor_cost ?? null} />
                  </td>
                </tr>
              </tbody>
            </table>
          )}
          <p className="form-note">Labor uses each person's pay rate in force on the day of each entry, so a later rate change never alters this order.</p>
        </div>
      </div>

      <h2>Entries</h2>
      <table className="table" data-testid="entries">
        <thead>
          <tr>
            <th>Date</th>
            <th>Person</th>
            <th>Counts</th>
            <th className="num">Hours</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="empty">
                No entries on this order.
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.id}>
              <td data-label="Date">
                <Link to={`/entries/${e.id}`}>{formatFullDate(e.work_date)}</Link>
              </td>
              <td data-label="Person">{name(e.artist_id)}</td>
              <td data-label="Counts">{describeCounts(e).join(', ') || <span className="muted">No counts</span>}</td>
              <td className="num" data-label="Hours">
                {e.minutes > 0 ? formatMinutes(e.minutes) : <span className="missing">Missing</span>}
              </td>
              <td data-label="Note">{e.note ?? <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
