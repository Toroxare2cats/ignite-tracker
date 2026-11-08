import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatStamp } from '../lib/dates.ts'
import { loadOpenOrders, loadPeople, signedUrls } from '../lib/queries.ts'
import { useAsync } from '../lib/useAsync.ts'
import { useFormState } from '../lib/useFormState.ts'
import type { OrderWithDesign, Person } from '../lib/types.ts'
import { ErrorNote, Loading, PurchaseBadge } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { blankToNull, formatMoney, parseMoney } from './format.ts'
import {
  addStockAllocation,
  decidePurchase,
  loadOpenPurchases,
  loadRecentDecisions,
  loadStockAllocations,
  removeStockAllocation,
  type ManagedPurchase,
  type StockAllocation,
} from './queries.ts'

type Tab = 'waiting' | 'stock' | 'decided'

interface Data {
  open: ManagedPurchase[]
  decided: ManagedPurchase[]
  allocations: StockAllocation[]
  orders: OrderWithDesign[]
  people: Map<string, Person>
  receipts: Map<string, string>
}

/** Money is added up in whole cents, so it never drifts by a fraction. */
function cents(amount: number): number {
  return Math.round(Number(amount) * 100)
}

function moneyOf(purchase: ManagedPurchase): string {
  return formatMoney(Number(purchase.amount))
}

/**
 * Approvals: purchases waiting for a decision, the stock list that approved
 * stock purchases land on, and the decisions made so far.  Row-level security
 * and the triggers on these tables enforce every rule here; artists can reach
 * neither the stock list nor anyone else's purchases.
 */
export default function ApprovalsScreen() {
  const [tab, setTab] = useState<Tab>('waiting')
  const [notice, setNotice] = useState<string | null>(null)
  const { state, reload } = useAsync<Data>(async () => {
    const [open, decided, allocations, orders, people] = await Promise.all([
      loadOpenPurchases(),
      loadRecentDecisions(),
      loadStockAllocations(),
      loadOpenOrders(),
      loadPeople(),
    ])
    const paths = [...open, ...decided].map((p) => p.receipt_path).filter((p): p is string => p !== null)
    const receipts = await signedUrls('receipts', [...new Set(paths)])
    return { open, decided, allocations, orders, people, receipts }
  }, [])

  function changed(message: string) {
    setNotice(message)
    reload()
  }

  const data = state.kind === 'ready' ? state.data : null
  const waiting = data?.open.filter((p) => p.status === 'pending') ?? []
  const stock = data?.open.filter((p) => p.status === 'approved') ?? []
  const name = (id: string | null) => (id ? (data?.people.get(id)?.full_name ?? 'Unknown') : 'Unknown')
  const receiptFor = (p: ManagedPurchase) => (p.receipt_path ? (data?.receipts.get(p.receipt_path) ?? null) : null)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'waiting', label: waiting.length > 0 ? `Waiting (${waiting.length})` : 'Waiting' },
    { key: 'stock', label: 'Stock' },
    { key: 'decided', label: 'Decided' },
  ]

  return (
    <>
      <div className="topbar">
        <h1>Approvals</h1>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Show">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {state.kind === 'loading' && <Loading what="purchases" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}

      {data && (
        <>
          {/* All three stay mounted, so a half-typed reason survives switching tabs. */}
          <div hidden={tab !== 'waiting'}>
            {waiting.length === 0 && <p className="muted">Nothing is waiting for a decision.</p>}
            {waiting.map((p) => (
              <PendingCard key={p.id} purchase={p} name={name(p.artist_id)} receipt={receiptFor(p)} onDecided={changed} />
            ))}
          </div>

          <div hidden={tab !== 'stock'}>
            <p className="muted">Approved stock purchases. Allocate portions to orders here; each portion adds to that order’s materials cost.</p>
            {stock.length === 0 && <p className="muted">No approved stock purchases yet.</p>}
            {stock.map((p) => (
              <StockCard
                key={p.id}
                purchase={p}
                name={name(p.artist_id)}
                receipt={receiptFor(p)}
                allocations={data.allocations.filter((a) => a.purchase_id === p.id)}
                orders={data.orders}
                onChanged={changed}
              />
            ))}
          </div>

          <div hidden={tab !== 'decided'}>
            <DecidedTable purchases={data.decided} name={name} receiptFor={receiptFor} />
          </div>
        </>
      )}
    </>
  )
}

function ReceiptLink({ purchase, receipt }: { purchase: ManagedPurchase; receipt: string | null }) {
  if (!purchase.receipt_path) return <span className="muted">No receipt</span>
  if (!receipt) return <span className="missing">Receipt could not be opened</span>
  return (
    <a href={receipt} target="_blank" rel="noreferrer">
      View receipt
    </a>
  )
}

function PurchaseFor({ purchase }: { purchase: ManagedPurchase }) {
  if (purchase.for_stock) return <>Studio stock</>
  if (!purchase.order) return <>An order</>
  return <Link to={`/manage/orders/${purchase.order.id}`}>{purchase.order.name}</Link>
}

function PurchaseHead({ purchase, name, receipt }: { purchase: ManagedPurchase; name: string; receipt: string | null }) {
  return (
    <>
      <div className="log-head">
        <span className="log-who">{purchase.description}</span>
        <span className="amount">{moneyOf(purchase)}</span>
      </div>
      <p className="purchase-facts">
        {name} · {formatStamp(purchase.created_at)}
      </p>
      <p className="purchase-facts">
        For <PurchaseFor purchase={purchase} /> · <ReceiptLink purchase={purchase} receipt={receipt} />
      </p>
    </>
  )
}

// --- Waiting ----------------------------------------------------------------

function PendingCard({
  purchase,
  name,
  receipt,
  onDecided,
}: {
  purchase: ManagedPurchase
  name: string
  receipt: string | null
  onDecided: (message: string) => void
}) {
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const closed = purchase.order?.status === 'closed'

  return (
    <div className="card">
      <PurchaseHead purchase={purchase} name={name} receipt={receipt} />
      {closed && (
        <p className="notice warn">
          This order is closed, so this purchase cannot be approved. <Link to={`/manage/orders/${purchase.order?.id}`}>Reopen the order</Link> first, or reject it.
        </p>
      )}
      {deciding === null ? (
        <div className="action-row">
          <button type="button" className="secondary" onClick={() => setDeciding('rejected')}>
            Reject
          </button>
          <button type="button" onClick={() => setDeciding('approved')} disabled={closed}>
            Approve
          </button>
        </div>
      ) : (
        <DecisionForm key={deciding} purchase={purchase} status={deciding} onDecided={onDecided} onCancel={() => setDeciding(null)} />
      )}
    </div>
  )
}

function DecisionForm({
  purchase,
  status,
  onDecided,
  onCancel,
}: {
  purchase: ManagedPurchase
  status: 'approved' | 'rejected'
  onDecided: (message: string) => void
  onCancel: () => void
}) {
  const form = useFormState({ reason: '' })
  const approving = status === 'approved'
  const effect = approving
    ? `This adds ${moneyOf(purchase)} to ${purchase.for_stock ? 'the stock list' : 'the order’s materials cost'}.`
    : 'This adds nothing to any cost.'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const reason = blankToNull(form.values.reason)
    if (!approving && reason === null) return form.fail('Enter a one-line reason for rejecting it.')
    const ok = await form.submit(() => decidePurchase(purchase.id, status, reason))
    if (ok) onDecided(`${approving ? 'Approved' : 'Rejected'}: ${purchase.description}.`)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor={`reason-${purchase.id}`}>{approving ? 'Reason (optional)' : 'Reason for rejecting'}</label>
      <input id={`reason-${purchase.id}`} value={form.values.reason} onChange={(e) => form.set('reason', e.target.value)} autoComplete="off" />
      <p className="form-note">
        {effect} A decision cannot be changed later. The person who submitted this can read the reason, so leave prices and costs out of it.
      </p>
      <SaveBar form={form} saveLabel={approving ? 'Yes, approve' : 'Reject purchase'} requireChanges={false} danger={!approving} cleanText="Not decided yet">
        <button type="button" className="secondary" onClick={onCancel} disabled={form.status === 'saving'}>
          Cancel
        </button>
      </SaveBar>
    </form>
  )
}

// --- Stock ------------------------------------------------------------------

function StockCard({
  purchase,
  name,
  receipt,
  allocations,
  orders,
  onChanged,
}: {
  purchase: ManagedPurchase
  name: string
  receipt: string | null
  allocations: StockAllocation[]
  orders: OrderWithDesign[]
  onChanged: (message: string) => void
}) {
  const allocated = allocations.reduce((sum, a) => sum + cents(a.amount), 0)
  const left = cents(purchase.amount) - allocated

  return (
    <div className="card">
      <PurchaseHead purchase={purchase} name={name} receipt={receipt} />
      <dl className="facts money">
        <dt>Allocated</dt>
        <dd>{formatMoney(allocated / 100)}</dd>
        <dt className="strong">Left</dt>
        <dd className="strong">{formatMoney(left / 100)}</dd>
      </dl>
      {allocations.length > 0 && (
        <ul className="plain-list">
          {allocations.map((a) => (
            <AllocationRow key={a.id} allocation={a} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {left > 0 ? <AllocateForm purchase={purchase} left={left} orders={orders} onChanged={onChanged} /> : <p className="form-note">Fully allocated.</p>}
    </div>
  )
}

function AllocationRow({ allocation, onChanged }: { allocation: StockAllocation; onChanged: (message: string) => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closed = allocation.order?.status === 'closed'
  const orderName = allocation.order?.name ?? 'An order'

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await removeStockAllocation(allocation.id)
      onChanged(`Removed ${formatMoney(Number(allocation.amount))} from ${orderName}.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <li>
      <span>
        <Link to={`/manage/orders/${allocation.order_id}`}>{orderName}</Link>
        {allocation.note ? <span className="muted"> · {allocation.note}</span> : null}
        {closed ? <span className="muted"> · closed</span> : null}
        {error && <span className="missing"> {error}</span>}
      </span>
      <span className="allocation-side">
        <span className="amount">{formatMoney(Number(allocation.amount))}</span>
        {!closed && !asking && (
          <button type="button" className="link small" onClick={() => setAsking(true)}>
            Remove
          </button>
        )}
        {!closed && asking && (
          <>
            <button type="button" className="link small" onClick={() => setAsking(false)} disabled={busy}>
              Keep
            </button>
            <button type="button" className="link small" onClick={remove} disabled={busy}>
              {busy ? 'Removing…' : 'Yes, remove'}
            </button>
          </>
        )}
      </span>
    </li>
  )
}

function AllocateForm({
  purchase,
  left,
  orders,
  onChanged,
}: {
  purchase: ManagedPurchase
  left: number
  orders: OrderWithDesign[]
  onChanged: (message: string) => void
}) {
  const blank = { orderId: '', amount: '', note: '' }
  const form = useFormState(blank)
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parseMoney(values.amount)
    if (values.orderId === '') return form.fail('Choose the order.')
    if (amount === null || amount === 0) return form.fail('Enter the amount to allocate, above zero.')
    if (cents(amount) > left) return form.fail('That is more than is left on this stock purchase.')
    const ok = await form.submit(async (v) => {
      await addStockAllocation(purchase.id, v.orderId, amount, blankToNull(v.note))
      return blank
    })
    if (ok) onChanged(`Allocated ${formatMoney(amount)} from ${purchase.description}.`)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="two-up">
        <div>
          <label htmlFor={`allocate-order-${purchase.id}`}>Order</label>
          <select id={`allocate-order-${purchase.id}`} value={values.orderId} onChange={(e) => set('orderId', e.target.value)}>
            <option value="">Choose an order…</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`allocate-amount-${purchase.id}`}>Amount ($)</label>
          <input id={`allocate-amount-${purchase.id}`} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} autoComplete="off" />
        </div>
      </div>
      <label htmlFor={`allocate-note-${purchase.id}`}>Note (optional)</label>
      <input id={`allocate-note-${purchase.id}`} value={values.note} onChange={(e) => set('note', e.target.value)} autoComplete="off" />
      <SaveBar form={form} saveLabel="Allocate" cleanText="Nothing to save yet" />
    </form>
  )
}

// --- Decided ----------------------------------------------------------------

function DecidedTable({
  purchases,
  name,
  receiptFor,
}: {
  purchases: ManagedPurchase[]
  name: (id: string | null) => string
  receiptFor: (purchase: ManagedPurchase) => string | null
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Purchase</th>
          <th>Amount</th>
          <th>For</th>
          <th>Bought by</th>
          <th>Decision</th>
          <th>Reason</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        {purchases.length === 0 && (
          <tr>
            <td colSpan={7} className="empty">
              No decisions yet.
            </td>
          </tr>
        )}
        {purchases.map((p) => (
          <tr key={p.id}>
            <td data-label="Purchase">{p.description}</td>
            <td data-label="Amount" className="amount">
              {moneyOf(p)}
            </td>
            <td data-label="For">
              <PurchaseFor purchase={p} />
            </td>
            <td data-label="Bought by">{name(p.artist_id)}</td>
            <td data-label="Decision">
              <div>
                <PurchaseBadge status={p.status} />
                <div className="muted small">
                  {name(p.decided_by)}
                  {p.decided_at ? `, ${formatStamp(p.decided_at)}` : ''}
                </div>
              </div>
            </td>
            <td data-label="Reason">{p.decision_reason ?? <span className="muted">None</span>}</td>
            <td data-label="Receipt">
              <ReceiptLink purchase={p} receipt={receiptFor(p)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
