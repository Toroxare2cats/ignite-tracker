import { useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { formatMinutes, formatRelativeDate, formatStamp } from '../lib/dates.ts'
import { loadOrder, loadOrderEntries, loadPeople } from '../lib/queries.ts'
import { boxText, describeCounts, type EntryWithTime, type OrderWithDesign, type Person } from '../lib/types.ts'
import { BackLink, DueDate, ErrorNote, Loading, StatusBadge } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import FinishOrderForm from '../components/FinishOrderForm.tsx'
import { blankToNull, formatMoney, parseCount, parseMoney } from './format.ts'
import { CostCard, Money } from './CostCard.tsx'
import {
  closeOrder,
  loadFinancialHistory,
  loadOrderAllocations,
  loadOrderCost,
  loadOrderEvents,
  loadOrderFinancials,
  loadOrderPurchases,
  reopenOrder,
  saveMaterials,
  type FinancialHistoryRow,
  type OrderAllocation,
  type OrderCost,
  type OrderEvent,
  type OrderFinancials,
  type OrderPurchase,
} from './queries.ts'

interface Data {
  order: OrderWithDesign | null
  people: Map<string, Person>
  entries: EntryWithTime[]
  events: OrderEvent[]
  financials: OrderFinancials | null
  financialHistory: FinancialHistoryRow[]
  cost: OrderCost | null
  purchases: OrderPurchase[]
  allocations: OrderAllocation[]
}

type Panel = 'none' | 'finish' | 'close' | 'reopen'

/**
 * One order for a manager: its details, the actions its status allows, costs,
 * materials, the work log with all hours, and its full history.
 */
export default function ManageOrderScreen() {
  const { orderId = '' } = useParams()
  const location = useLocation()
  const [panel, setPanel] = useState<Panel>('none')
  const [notice, setNotice] = useState<string | null>((location.state as { saved?: string } | null)?.saved ?? null)

  const { state, reload } = useAsync<Data>(async () => {
    const order = await loadOrder(orderId)
    if (!order) {
      return {
        order: null,
        people: new Map(),
        entries: [],
        events: [],
        financials: null,
        financialHistory: [],
        cost: null,
        purchases: [],
        allocations: [],
      }
    }
    const [people, entries, events, financials, financialHistory, cost, purchases, allocations] = await Promise.all([
      loadPeople(),
      loadOrderEntries(orderId),
      loadOrderEvents(orderId),
      loadOrderFinancials(orderId),
      loadFinancialHistory(orderId),
      loadOrderCost(orderId),
      loadOrderPurchases(orderId),
      loadOrderAllocations(orderId),
    ])
    return { order, people, entries, events, financials, financialHistory, cost, purchases, allocations }
  }, [orderId])

  if (state.kind === 'loading') return <Loading what="the order" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  const data = state.data
  const { order, people } = data
  if (!order) {
    return (
      <>
        <BackLink to="/manage/orders" label="Orders" />
        <p>This order could not be found.</p>
      </>
    )
  }

  const name = (id: string | null | undefined) => (id ? (people.get(id)?.full_name ?? 'Someone') : 'Someone')

  function done(message: string) {
    setPanel('none')
    setNotice(message)
    reload()
  }

  return (
    <>
      <BackLink to="/manage/orders" label="Orders" />
      <div className="topbar">
        <h1>{order.name}</h1>
        <StatusBadge status={order.status} />
      </div>

      {notice && <p className="notice">{notice}</p>}

      <div className="portal-columns">
        <div>
          <div className="card">
            <dl className="facts">
              <dt>Design</dt>
              <dd>{order.design.name}</dd>
              <dt>Quantity</dt>
              <dd>
                {order.bottles_ordered} bottles
                {order.design.has_dabber ? ` · ${order.dabbers_ordered} dabbers` : ''}
              </dd>
              <dt>Due</dt>
              <dd>
                <DueDate date={order.due_date} status={order.status} bare />
              </dd>
              <dt>Primary artist</dt>
              <dd>{order.primary_artist_id ? name(order.primary_artist_id) : <span className="muted">Not assigned</span>}</dd>
              {order.finished_at && (
                <>
                  <dt>Finished</dt>
                  <dd>
                    {name(order.finished_by)} · {formatStamp(order.finished_at)}
                  </dd>
                </>
              )}
              {data.financials?.closed_at && (
                <>
                  <dt>Closed</dt>
                  <dd>
                    {name(data.financials.closed_by)} · {formatStamp(data.financials.closed_at)}
                  </dd>
                </>
              )}
              {order.packing_note && (
                <>
                  <dt>Packing note</dt>
                  <dd className="spec">{order.packing_note}</dd>
                </>
              )}
              {boxText(order) && (
                <>
                  <dt>Box</dt>
                  <dd>{boxText(order)}</dd>
                </>
              )}
            </dl>
            {panel === 'none' && (
              <div className="action-row">
                {order.status !== 'closed' && (
                  <Link to={`/manage/orders/${order.id}/edit`} className="btn secondary">
                    Edit or reassign
                  </Link>
                )}
                {order.status === 'open' && (
                  <button type="button" onClick={() => { setNotice(null); setPanel('finish') }}>
                    Mark Finished
                  </button>
                )}
                {order.status === 'finished' && (
                  <button type="button" onClick={() => { setNotice(null); setPanel('close') }}>
                    Close order
                  </button>
                )}
                {order.status !== 'open' && (
                  <button type="button" className="secondary" onClick={() => { setNotice(null); setPanel('reopen') }}>
                    Reopen
                  </button>
                )}
                {order.status !== 'closed' && (
                  <Link to={`/orders/${order.id}`} className="btn secondary">
                    Log my own work
                  </Link>
                )}
              </div>
            )}
          </div>

          {panel === 'finish' && <FinishOrderForm orderId={order.id} onCancel={() => setPanel('none')} onDone={() => done('Order marked Finished.')} />}
          {panel === 'close' && <CloseForm order={order} data={data} onCancel={() => setPanel('none')} onDone={() => done('Order closed.')} />}
          {panel === 'reopen' && <ReopenForm order={order} onCancel={() => setPanel('none')} onDone={() => done('Order reopened.')} />}

          <CostCard order={order} cost={data.cost} />
          <MaterialsCard order={order} data={data} name={name} locked={panel === 'close'} onSaved={reload} />
        </div>

        <div>
          <WorkLog entries={data.entries} name={name} closed={order.status === 'closed'} />
          <History events={data.events} financialHistory={data.financialHistory} name={name} />
        </div>
      </div>
    </>
  )
}

/** Approved purchases and stock allocated to the order, which add to the manager's total. */
function addedMaterials(data: Data): { purchases: number; allocations: number } {
  return {
    purchases: data.purchases.filter((p) => p.status === 'approved').reduce((sum, p) => sum + Number(p.amount), 0),
    allocations: data.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
  }
}

// --- Close ------------------------------------------------------------------

function CloseForm({ order, data, onDone, onCancel }: { order: OrderWithDesign; data: Data; onDone: () => void; onCancel: () => void }) {
  const f = data.financials
  const form = useFormState({
    bottles: f?.bottles_delivered != null ? String(f.bottles_delivered) : '',
    dabbers: f?.dabbers_delivered != null ? String(f.dabbers_delivered) : '',
    price: f?.selling_price != null ? String(f.selling_price) : '',
    materials: f?.materials_total != null ? String(f.materials_total) : '',
    note: f?.materials_note ?? '',
  })
  const { values, set } = form
  const hasDabber = order.design.has_dabber
  const added = addedMaterials(data)
  const addedTotal = added.purchases + added.allocations
  const waiting = data.purchases.filter((p) => p.status === 'pending').length
  const manager = parseMoney(values.materials)
  const price = parseMoney(values.price)
  const bottles = parseCount(values.bottles)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const dabbers = hasDabber ? parseCount(values.dabbers) : 0
    if (bottles === null) return form.fail('Enter the bottles delivered as a whole number.')
    if (dabbers === null) return form.fail('Enter the dabbers delivered as a whole number.')
    if (price === null) return form.fail('Enter the selling price. An order cannot close without it.')
    if (manager === null) return form.fail('Enter the materials cost. Use 0 if approved purchases and stock cover all of it.')
    const ok = await form.submit(async () => {
      await closeOrder(order.id, {
        bottlesDelivered: bottles,
        dabbersDelivered: dabbers,
        sellingPrice: price,
        materialsTotal: manager,
        materialsNote: blankToNull(values.note),
      })
    })
    if (ok) onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <h3 style={{ marginTop: 0 }}>Close this order</h3>
      <p className="form-note">Delivered quantities, selling price and materials cost are all required.</p>
      {waiting > 0 && (
        <p className="notice warn">
          {waiting} pending {waiting === 1 ? 'purchase is' : 'purchases are'} not counted in this order’s cost. Decide {waiting === 1 ? 'it' : 'them'} under{' '}
          <Link to="/manage/approvals">Approvals</Link> first. Once the order is closed, approving one means reopening it.
        </p>
      )}

      <div className="two-up">
        <div>
          <label htmlFor="close-bottles">Bottles delivered</label>
          <input id="close-bottles" inputMode="numeric" value={values.bottles} onChange={(e) => set('bottles', e.target.value)} autoComplete="off" />
        </div>
        {hasDabber && (
          <div>
            <label htmlFor="close-dabbers">Dabbers delivered</label>
            <input id="close-dabbers" inputMode="numeric" value={values.dabbers} onChange={(e) => set('dabbers', e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>

      <label htmlFor="close-price">Selling price, order total ($)</label>
      <input id="close-price" inputMode="decimal" value={values.price} onChange={(e) => set('price', e.target.value)} autoComplete="off" />
      {price !== null && bottles !== null && bottles > 0 && <p className="form-note">That is {formatMoney(price / bottles)} per delivered bottle.</p>}

      <label htmlFor="close-materials">Materials cost, manager total ($)</label>
      <input id="close-materials" inputMode="decimal" value={values.materials} onChange={(e) => set('materials', e.target.value)} autoComplete="off" />
      {addedTotal > 0 ? (
        <p className="form-note">
          Added on top of this: {formatMoney(added.purchases)} approved purchases and {formatMoney(added.allocations)} stock allocated
          {manager !== null ? `, for ${formatMoney(manager + addedTotal)} in total.` : '.'} Do not include them in the box above.
        </p>
      ) : (
        <p className="form-note">No approved purchases or stock are on this order, so this box is the whole materials cost.</p>
      )}

      <label htmlFor="close-note">Materials note (optional)</label>
      <input id="close-note" value={values.note} onChange={(e) => set('note', e.target.value)} autoComplete="off" />

      <SaveBar form={form} saveLabel="Close order" savingLabel="Closing…" requireChanges={false} cleanText="Your name and the time are recorded.">
        <button type="button" className="secondary" onClick={onCancel} disabled={form.status === 'saving'}>
          Cancel
        </button>
      </SaveBar>
    </form>
  )
}

// --- Reopen -----------------------------------------------------------------

function ReopenForm({ order, onDone, onCancel }: { order: OrderWithDesign; onDone: () => void; onCancel: () => void }) {
  const form = useFormState({ reason: '' })

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const ok = await form.submit(async () => {
      await reopenOrder(order.id, blankToNull(form.values.reason))
    })
    if (ok) onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <h3 style={{ marginTop: 0 }}>Reopen this order</h3>
      <p className="form-note">It goes back to Open. The completion details so far are kept in the history.</p>
      <label htmlFor="reopen-reason">Reason (optional)</label>
      <input id="reopen-reason" value={form.values.reason} onChange={(e) => form.set('reason', e.target.value)} autoComplete="off" />
      <p className="form-note">Artists can read order history, so leave prices and costs out of the reason.</p>
      <SaveBar form={form} saveLabel="Reopen order" savingLabel="Reopening…" requireChanges={false} cleanText="Your name and the time are recorded.">
        <button type="button" className="secondary" onClick={onCancel} disabled={form.status === 'saving'}>
          Cancel
        </button>
      </SaveBar>
    </form>
  )
}

// --- Costs ------------------------------------------------------------------

// --- Materials --------------------------------------------------------------

function MaterialsCard({
  order,
  data,
  name,
  locked,
  onSaved,
}: {
  order: OrderWithDesign
  data: Data
  name: (id: string) => string
  /** True while the Close form is open, so it is the one place materials are typed. */
  locked: boolean
  onSaved: () => void
}) {
  const readOnly = order.status === 'closed' || locked
  const approved = data.purchases.filter((p) => p.status === 'approved')
  const pending = data.purchases.filter((p) => p.status === 'pending')
  const f = data.financials

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Materials</h3>
      {readOnly ? (
        <dl className="facts money">
          <dt>Manager total</dt>
          <dd>
            <Money value={f?.materials_total} />
          </dd>
          {f?.materials_note && (
            <>
              <dt>Note</dt>
              <dd className="spec">{f.materials_note}</dd>
            </>
          )}
        </dl>
      ) : (
        <MaterialsForm key={`${f?.materials_total ?? ''}|${f?.materials_note ?? ''}`} orderId={order.id} financials={f} onSaved={onSaved} />
      )}

      <h3>Approved purchases</h3>
      {approved.length === 0 ? (
        <p className="muted small">None on this order.</p>
      ) : (
        <ul className="plain-list">
          {approved.map((p) => (
            <li key={p.id}>
              <span>
                {p.description} <span className="muted">· {name(p.artist_id)}</span>
              </span>
              <span className="amount">{formatMoney(Number(p.amount))}</span>
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <p className="form-note">
          {pending.length} pending {pending.length === 1 ? 'purchase is' : 'purchases are'} waiting for approval and not counted yet.{' '}
          <Link to="/manage/approvals">Go to Approvals</Link>
        </p>
      )}

      <h3>Stock allocated</h3>
      {data.allocations.length === 0 ? (
        <p className="muted small">None on this order.</p>
      ) : (
        <ul className="plain-list">
          {data.allocations.map((a) => (
            <li key={a.id}>
              <span>
                {a.purchase?.description ?? 'Stock purchase'}
                {a.note ? <span className="muted"> · {a.note}</span> : null}
              </span>
              <span className="amount">{formatMoney(Number(a.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MaterialsForm({ orderId, financials, onSaved }: { orderId: string; financials: OrderFinancials | null; onSaved: () => void }) {
  const form = useFormState({
    total: financials?.materials_total != null ? String(financials.materials_total) : '',
    note: financials?.materials_note ?? '',
  })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const blank = values.total.trim() === ''
    const total = parseMoney(values.total)
    if (!blank && total === null) return form.fail('Enter the materials total as a dollar amount.')
    const ok = await form.submit(async () => {
      await saveMaterials(orderId, blank ? null : total, blankToNull(values.note))
    })
    if (ok) onSaved()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="materials-total" style={{ marginTop: 0 }}>
        Manager total ($)
      </label>
      <input id="materials-total" inputMode="decimal" value={values.total} onChange={(e) => set('total', e.target.value)} placeholder="Blank until you know it" autoComplete="off" />
      <label htmlFor="materials-note">Note, for example how a bulk purchase was split</label>
      <input id="materials-note" value={values.note} onChange={(e) => set('note', e.target.value)} autoComplete="off" />
      <SaveBar form={form} saveLabel="Save materials" />
    </form>
  )
}

// --- Work log ---------------------------------------------------------------

function WorkLog({ entries, name, closed }: { entries: EntryWithTime[]; name: (id: string) => string; closed: boolean }) {
  const minutes = entries.reduce((sum, e) => sum + (e.minutes ?? 0), 0)
  return (
    <div className="card">
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Work log</h3>
        {entries.length > 0 && <span className="muted small">{formatMinutes(minutes)} logged</span>}
      </div>
      {entries.length === 0 && <p className="muted small">Nothing logged on this order yet.</p>}
      <ul className="plain-list log">
        {entries.map((e) => {
          const body = (
            <>
              <div className="log-head">
                <span className="log-who">{name(e.artist_id)}</span>
                <span className="log-date">{formatRelativeDate(e.work_date)}</span>
              </div>
              <div className="log-counts">
                {describeCounts(e).map((c) => (
                  <span key={c} className="count-pill">
                    {c}
                  </span>
                ))}
                {e.minutes !== null && <span className="count-pill hours-pill">{formatMinutes(e.minutes)}</span>}
              </div>
              {e.note && <p className="log-note">{e.note}</p>}
              {e.edited_at && (
                <p className="form-note">
                  Edited by {e.edited_by ? name(e.edited_by) : 'someone'} · {formatStamp(e.edited_at)}
                </p>
              )}
            </>
          )
          // Entries on a closed order cannot change until it is reopened.
          return (
            <li key={e.id}>
              {closed ? (
                body
              ) : (
                <Link to={`/entries/${e.id}`} className="log-link">
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// --- History ----------------------------------------------------------------

const EVENT_LABEL: Record<OrderEvent['event_type'], string> = {
  created: 'Created',
  finished: 'Marked Finished',
  closed: 'Closed',
  reopened: 'Reopened',
  reassigned: 'Primary artist changed',
}

function History({
  events,
  financialHistory,
  name,
}: {
  events: OrderEvent[]
  financialHistory: FinancialHistoryRow[]
  name: (id: string) => string
}) {
  return (
    <div className="card" data-testid="history">
      <h3 style={{ marginTop: 0 }}>History</h3>
      <ul className="plain-list history">
        {events.map((e) => {
          // reopen_order writes the event and the snapshot in one transaction,
          // so the two share a timestamp.
          const snapshot = financialHistory.find((h) => new Date(h.recorded_at).getTime() === new Date(e.occurred_at).getTime())?.snapshot
          return (
            <li key={e.id}>
              <div className="log-head">
                <span className="log-who">{EVENT_LABEL[e.event_type]}</span>
                <span className="log-date">{formatStamp(e.occurred_at)}</span>
              </div>
              <div className="muted small">by {e.actor_id ? name(e.actor_id) : 'the system'}</div>
              <EventDetails event={e} name={name} />
              {snapshot && <ClosedSnapshot snapshot={snapshot} name={name} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function EventDetails({ event, name }: { event: OrderEvent; name: (id: string) => string }) {
  const d = event.details
  if (event.event_type === 'reassigned') {
    return (
      <p className="small history-detail">
        {d.from ? name(d.from) : 'Nobody'} → {d.to ? name(d.to) : 'Nobody'}
      </p>
    )
  }
  if (event.event_type === 'finished') {
    const box = boxText(d)
    if (!d.packing_note && !box) return null
    return (
      <p className="small history-detail">
        {d.packing_note}
        {d.packing_note && box ? ' · ' : ''}
        {box && `Box ${box}`}
      </p>
    )
  }
  if (event.event_type === 'reopened') {
    return (
      <>
        {d.previous_status && <p className="small history-detail">Was {d.previous_status}.</p>}
        {event.reason && <p className="small history-detail">Reason: {event.reason}</p>}
        {d.finished_at && (
          <p className="small history-detail">
            Had been finished by {d.finished_by ? name(d.finished_by) : 'someone'} · {formatStamp(d.finished_at)}
          </p>
        )}
      </>
    )
  }
  return null
}

/** What the order's close looked like before it was reopened (managers only). */
function ClosedSnapshot({ snapshot: s, name }: { snapshot: FinancialHistoryRow['snapshot']; name: (id: string) => string }) {
  return (
    <p className="small history-detail">
      Had been closed{s.closed_by ? ` by ${name(s.closed_by)}` : ''}
      {s.closed_at ? ` · ${formatStamp(s.closed_at)}` : ''}: {s.bottles_delivered ?? '?'} bottles delivered, price{' '}
      {s.selling_price !== null ? formatMoney(Number(s.selling_price)) : 'missing'}, materials{' '}
      {s.materials_total !== null ? formatMoney(Number(s.materials_total)) : 'missing'}.
    </p>
  )
}
