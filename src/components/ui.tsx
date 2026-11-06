import { Link } from 'react-router-dom'
import type { OrderStatus, OrderWithDesign, PurchaseStatus } from '../lib/types.ts'
import { formatShortDate, todayChicago } from '../lib/dates.ts'

export function StatusBadge({ status }: { status: OrderStatus }) {
  const label = status === 'open' ? 'Open' : status === 'finished' ? 'Finished' : 'Closed'
  return <span className={`badge status-${status}`}>{label}</span>
}

export function PurchaseBadge({ status }: { status: PurchaseStatus }) {
  const label = status === 'pending' ? 'Pending' : status === 'approved' ? 'Approved' : 'Rejected'
  return <span className={`badge purchase-${status}`}>{label}</span>
}

export function DueDate({ date, status }: { date: string | null; status: OrderStatus }) {
  if (!date) return <span className="muted">No due date</span>
  const today = todayChicago()
  const late = status === 'open' && date < today
  const soon = status === 'open' && !late && date <= today
  return (
    <span className={late ? 'due late' : soon ? 'due soon' : 'due'}>
      {late ? 'Was due ' : 'Due '}
      {formatShortDate(date)}
    </span>
  )
}

/** One tappable order in a list. */
export function OrderRow({ order, primaryName }: { order: OrderWithDesign; primaryName?: string | null }) {
  const quantity = order.design.has_dabber
    ? `${order.bottles_ordered} bottles · ${order.dabbers_ordered} dabbers`
    : `${order.bottles_ordered} bottles`
  return (
    <li>
      <Link to={`/orders/${order.id}`} className="row">
        <div className="row-main">
          <div className="row-title">{order.name}</div>
          <div className="row-sub">
            {order.design.name} · {quantity}
            {primaryName ? ` · ${primaryName}` : ''}
          </div>
          <div className="row-sub">
            <DueDate date={order.due_date} status={order.status} />
          </div>
        </div>
        <StatusBadge status={order.status} />
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  )
}

export function Loading({ what }: { what?: string }) {
  return <p className="muted loading">{what ? `Loading ${what}…` : 'Loading…'}</p>
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card error-card" role="alert">
      <p className="error">{message}</p>
      {onRetry && (
        <button type="button" className="btn secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back">
      ‹ {label}
    </Link>
  )
}
