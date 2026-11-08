import { useState, type FormEvent } from 'react'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { useFormState } from '../lib/useFormState.ts'
import { formatStamp } from '../lib/dates.ts'
import { loadOpenOrders, loadOwnPurchases, signedUrl, submitPurchase, type OwnPurchase } from '../lib/queries.ts'
import type { OrderWithDesign } from '../lib/types.ts'
import { ErrorNote, Loading, PurchaseBadge } from '../components/ui.tsx'
import { SaveBar } from '../components/form.tsx'

interface Data {
  orders: OrderWithDesign[]
  purchases: OwnPurchase[]
}

/**
 * Materials purchase: what was bought, the amount, an optional receipt photo,
 * and whether it was for an order or studio stock.  Submissions start
 * pending; a manager approves or rejects them.  The list below shows only the
 * person's own submissions (row-level security returns nothing else).
 */
export default function MaterialsScreen() {
  const profile = useProfile()
  const { state, reload } = useAsync<Data>(async () => {
    const [orders, purchases] = await Promise.all([loadOpenOrders(), loadOwnPurchases(profile.id)])
    return { orders, purchases }
  }, [profile.id])

  const [saved, setSaved] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  return (
    <>
      <h1>Materials</h1>
      <p className="muted">Bought materials with a manager's okay? Record it here. It stays pending until a manager approves it.</p>

      {saved && <p className="notice">{saved}</p>}

      {!showForm && (
        <button type="button" className="btn block big" onClick={() => { setShowForm(true); setSaved(null) }}>
          Record a purchase
        </button>
      )}

      {showForm && (
        <PurchaseForm
          artistId={profile.id}
          orders={state.kind === 'ready' ? state.data.orders : null}
          onCancel={() => setShowForm(false)}
          onSaved={(what) => {
            setSaved(`Submitted: ${what}. A manager will approve or reject it.`)
            setShowForm(false)
            reload()
          }}
        />
      )}

      <h2>Your submissions</h2>
      {state.kind === 'loading' && <Loading what="your submissions" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <ul className="list">
          {state.data.purchases.length === 0 && <li className="empty">You have not recorded any purchases yet.</li>}
          {state.data.purchases.map((p) => (
            <PurchaseRow key={p.id} purchase={p} />
          ))}
        </ul>
      )}
    </>
  )
}

function PurchaseForm({
  artistId,
  orders,
  onCancel,
  onSaved,
}: {
  artistId: string
  orders: OrderWithDesign[] | null
  onCancel: () => void
  onSaved: (what: string) => void
}) {
  const form = useFormState({ description: '', amount: '', target: 'order' as 'order' | 'stock', orderId: '', receipt: null as File | null })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const what = values.description.trim()
    const amountNumber = Number(values.amount.replace(/[$,\s]/g, ''))
    if (what === '') return form.fail('Say what was bought.')
    if (!Number.isFinite(amountNumber) || amountNumber < 0 || values.amount.trim() === '') return form.fail('Enter the amount from the receipt.')
    if (values.target === 'order' && !values.orderId) return form.fail('Pick the order it was for, or choose Studio stock.')
    const ok = await form.submit(async (v) => {
      await submitPurchase({
        artist_id: artistId,
        description: what,
        amount: Math.round(amountNumber * 100) / 100,
        order_id: v.target === 'order' ? v.orderId : null,
        for_stock: v.target === 'stock',
        receipt: v.receipt,
      })
    })
    if (ok) onSaved(what)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <label htmlFor="description" style={{ marginTop: 0 }}>
        What was bought
      </label>
      <input id="description" type="text" value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. 2 lb silver fume wire" autoComplete="off" />

      <label htmlFor="amount">Amount paid ($)</label>
      <input id="amount" type="text" inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" autoComplete="off" />

      <label>For</label>
      <div className="radio-group">
        <label className={values.target === 'order' ? 'checked' : ''}>
          <input type="radio" name="target" checked={values.target === 'order'} onChange={() => set('target', 'order')} />
          An order
        </label>
        <label className={values.target === 'stock' ? 'checked' : ''}>
          <input type="radio" name="target" checked={values.target === 'stock'} onChange={() => set('target', 'stock')} />
          Studio stock
        </label>
      </div>

      {values.target === 'order' && (
        <>
          <label htmlFor="order">Which order</label>
          <select id="order" value={values.orderId} onChange={(e) => set('orderId', e.target.value)} disabled={orders === null}>
            <option value="">Choose an order…</option>
            {orders?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </>
      )}

      <label htmlFor="receipt">Receipt photo (optional)</label>
      <input id="receipt" type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => set('receipt', e.target.files?.[0] ?? null)} />
      {values.receipt && <p className="form-note">{values.receipt.name}</p>}

      <SaveBar form={form} saveLabel="Submit purchase" savingLabel="Submitting…" requireChanges={false} cleanText="Not saved yet">
        <button type="button" className="secondary" onClick={onCancel} disabled={form.status === 'saving'}>
          Cancel
        </button>
      </SaveBar>
    </form>
  )
}

function PurchaseRow({ purchase }: { purchase: OwnPurchase }) {
  const [opening, setOpening] = useState(false)
  async function openReceipt() {
    if (!purchase.receipt_path) return
    setOpening(true)
    const url = await signedUrl('receipts', purchase.receipt_path, 300)
    setOpening(false)
    if (url) window.open(url, '_blank', 'noopener')
  }
  return (
    <li className="log-entry">
      <div className="log-head">
        <span className="log-who">{purchase.description}</span>
        <span className="amount">${purchase.amount.toFixed(2)}</span>
      </div>
      <div className="log-meta" style={{ marginTop: 4 }}>
        <span>
          {purchase.for_stock ? 'Studio stock' : (purchase.order?.name ?? 'An order')} · {formatStamp(purchase.created_at)}
        </span>
        <PurchaseBadge status={purchase.status} />
      </div>
      {purchase.status === 'rejected' && purchase.decision_reason && <p className="log-note muted">Reason: {purchase.decision_reason}</p>}
      {purchase.receipt_path && (
        <button type="button" className="link small" style={{ marginTop: 6 }} onClick={openReceipt} disabled={opening}>
          {opening ? 'Opening…' : 'View receipt'}
        </button>
      )}
    </li>
  )
}
