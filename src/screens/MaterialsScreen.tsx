import { useRef, useState, type FormEvent } from 'react'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { formatStamp } from '../lib/dates.ts'
import { loadOpenOrders, loadOwnPurchases, signedUrl, submitPurchase } from '../lib/queries.ts'
import type { OrderWithDesign, Purchase } from '../lib/types.ts'
import { ErrorNote, Loading, PurchaseBadge } from '../components/ui.tsx'

interface Data {
  orders: OrderWithDesign[]
  purchases: Purchase[]
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

  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [target, setTarget] = useState<'order' | 'stock'>('order')
  const [orderId, setOrderId] = useState('')
  const [receipt, setReceipt] = useState<File | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setSaved(null)
    const amountNumber = Number(amount.replace(/[$,\s]/g, ''))
    if (description.trim() === '') return setError('Say what was bought.')
    if (!Number.isFinite(amountNumber) || amountNumber < 0 || amount.trim() === '') return setError('Enter the amount from the receipt.')
    if (target === 'order' && !orderId) return setError('Pick the order it was for, or choose Studio stock.')
    setBusy(true)
    try {
      await submitPurchase({
        artist_id: profile.id,
        description: description.trim(),
        amount: Math.round(amountNumber * 100) / 100,
        order_id: target === 'order' ? orderId : null,
        for_stock: target === 'stock',
        receipt,
      })
      setSaved(`Submitted: ${description.trim()}. A manager will approve or reject it.`)
      setDescription('')
      setAmount('')
      setReceipt(null)
      if (fileInput.current) fileInput.current.value = ''
      setShowForm(false)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
        <form onSubmit={handleSubmit} noValidate className="card">
          <label htmlFor="description" style={{ marginTop: 0 }}>
            What was bought
          </label>
          <input id="description" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 2 lb silver fume wire" autoComplete="off" />

          <label htmlFor="amount">Amount paid ($)</label>
          <input id="amount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" />

          <label>For</label>
          <div className="radio-group">
            <label className={target === 'order' ? 'checked' : ''}>
              <input type="radio" name="target" checked={target === 'order'} onChange={() => setTarget('order')} />
              An order
            </label>
            <label className={target === 'stock' ? 'checked' : ''}>
              <input type="radio" name="target" checked={target === 'stock'} onChange={() => setTarget('stock')} />
              Studio stock
            </label>
          </div>

          {target === 'order' && (
            <>
              <label htmlFor="order">Which order</label>
              <select id="order" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={state.kind !== 'ready'}>
                <option value="">Choose an order…</option>
                {state.kind === 'ready' &&
                  state.data.orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </>
          )}

          <label htmlFor="receipt">Receipt photo (optional)</label>
          <input id="receipt" ref={fileInput} type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          {receipt && <p className="form-note">{receipt.name}</p>}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn block big" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit purchase'}
          </button>
          <button type="button" className="btn secondary block" onClick={() => setShowForm(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      )}

      <h2>Your submissions</h2>
      {state.kind === 'loading' && <Loading what="your submissions" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <ul className="list">
          {state.data.purchases.length === 0 && <li className="empty">You have not recorded any purchases yet.</li>}
          {state.data.purchases.map((p) => (
            <PurchaseRow key={p.id} purchase={p} orderName={p.order_id ? state.data.orders.find((o) => o.id === p.order_id)?.name : undefined} />
          ))}
        </ul>
      )}
    </>
  )
}

function PurchaseRow({ purchase, orderName }: { purchase: Purchase; orderName?: string }) {
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
          {purchase.for_stock ? 'Studio stock' : (orderName ?? 'An order')} · {formatStamp(purchase.created_at)}
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
