import { type FormEvent } from 'react'
import { finishOrder } from '../lib/queries.ts'
import { SaveBar } from './form.tsx'
import { useFormState } from '../lib/useFormState.ts'

function parseSide(text: string): number | null | 'bad' {
  const cleaned = text.trim()
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : 'bad'
}

/**
 * Marks an open order Finished, with an optional packing note, box dimensions
 * and package weight for the shipping label.  Finished never waits on any particular
 * activity, and the database records who did it and when.
 */
export default function FinishOrderForm({
  orderId,
  onDone,
  onCancel,
}: {
  orderId: string
  onDone: () => void
  onCancel: () => void
}) {
  const form = useFormState({ note: '', length: '', width: '', height: '', weight: '' })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const length = parseSide(values.length)
    const width = parseSide(values.width)
    const height = parseSide(values.height)
    const weight = parseSide(values.weight)
    if (length === 'bad' || width === 'bad' || height === 'bad' || weight === 'bad') {
      return form.fail('Box size and weight must be numbers above zero, or left blank.')
    }
    const ok = await form.submit(async () => {
      await finishOrder(orderId, {
        packingNote: values.note.trim() === '' ? null : values.note.trim(),
        boxLength: length,
        boxWidth: width,
        boxHeight: height,
        boxWeight: weight,
      })
    })
    if (ok) onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card">
      <h3 style={{ marginTop: 0 }}>Mark this order Finished</h3>
      <p className="form-note">Use this when production is done. A manager can reopen the order if it was a mistake.</p>
      <label htmlFor="finish-note">Packing note (optional)</label>
      <textarea id="finish-note" value={values.note} onChange={(e) => set('note', e.target.value)} />
      <label>Box dimensions in inches (optional)</label>
      <div className="three-up">
        <div>
          <label htmlFor="box-length" className="sub">
            Length
          </label>
          <input id="box-length" inputMode="decimal" value={values.length} onChange={(e) => set('length', e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="box-width" className="sub">
            Width
          </label>
          <input id="box-width" inputMode="decimal" value={values.width} onChange={(e) => set('width', e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor="box-height" className="sub">
            Height
          </label>
          <input id="box-height" inputMode="decimal" value={values.height} onChange={(e) => set('height', e.target.value)} autoComplete="off" />
        </div>
      </div>
      <label htmlFor="box-weight">Package weight in pounds (optional)</label>
      <div className="three-up">
        <div>
          <input id="box-weight" inputMode="decimal" value={values.weight} onChange={(e) => set('weight', e.target.value)} autoComplete="off" />
        </div>
      </div>
      <SaveBar form={form} saveLabel="Mark Finished" savingLabel="Saving…" requireChanges={false} cleanText="Your name and the time are recorded.">
        <button type="button" className="secondary" onClick={onCancel} disabled={form.status === 'saving'}>
          Cancel
        </button>
      </SaveBar>
    </form>
  )
}
