import { type FormEvent } from 'react'
import { formatFullDate, formatStamp, todayChicago } from '../lib/dates.ts'
import type { Person } from '../lib/types.ts'
import { SaveBar } from '../components/form.tsx'
import { useFormState } from '../lib/useFormState.ts'
import { formatMoney, parseMoney } from './format.ts'
import { inForceOn } from './queries.ts'

export interface DatedAmount {
  id: string
  amount: number
  effective_from: string
  created_by: string | null
  created_at: string
}

/**
 * A dated money figure that is only ever added to, never changed: a design's
 * selling price or a person's pay rate (rule 5).  A missing figure shows as
 * Missing, never zero (rule 6).  `rows` must be newest first, as loaded.
 */
export default function DatedAmountCard({
  title,
  noun,
  testId,
  newLabel,
  example,
  suffix = '',
  note,
  rows,
  people,
  frozen = null,
  onAdd,
  onSaved,
}: {
  title: string
  noun: string
  testId: string
  newLabel: string
  example: string
  suffix?: string
  note: string
  rows: DatedAmount[]
  people: Map<string, Person>
  frozen?: string | null
  onAdd: (amount: number, effectiveFrom: string) => Promise<void>
  onSaved: () => void
}) {
  const today = todayChicago()
  const current = inForceOn(rows, today)
  const form = useFormState({ amount: '', from: today })
  const { values, set } = form

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parseMoney(values.amount)
    if (amount === null || amount === 0) return form.fail(`Enter a ${noun} above zero, for example ${example}.`)
    if (!values.from) return form.fail(`Choose the date this ${noun} starts.`)
    const ok = await form.submit(async (v) => {
      await onAdd(amount, v.from)
      return { amount: '', from: today }
    })
    if (ok) onSaved()
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <p className="price-now" data-testid={`current-${testId}`}>
        {current ? (
          <>
            <strong>{formatMoney(current.amount)}</strong>
            {suffix} since {formatFullDate(current.effective_from)}
          </>
        ) : (
          <span className="missing">Missing</span>
        )}
      </p>

      {frozen ? (
        <p className="form-note">{frozen}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="two-up">
            <div>
              <label htmlFor={`${testId}-new`}>{newLabel}</label>
              <input id={`${testId}-new`} inputMode="decimal" value={values.amount} onChange={(e) => set('amount', e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor={`${testId}-from`}>Starts on</label>
              <input id={`${testId}-from`} type="date" value={values.from} onChange={(e) => set('from', e.target.value)} />
            </div>
          </div>
          <p className="form-note">{note}</p>
          <SaveBar form={form} saveLabel={`Add ${noun}`} requireChanges={false} cleanText="Nothing to save yet" />
        </form>
      )}

      {rows.length > 0 && (
        <>
          <h3>{noun === 'rate' ? 'Rate' : 'Price'} history</h3>
          <ul className="plain-list history" data-testid={`${testId}-history`}>
            {rows.map((r) => (
              <li key={r.id}>
                <div className="log-head">
                  <span className="log-who">
                    {formatMoney(r.amount)}
                    {r.id === current?.id ? ' (current)' : ''}
                  </span>
                  <span className="log-date">
                    {r.effective_from > today ? 'Starts ' : 'From '}
                    {formatFullDate(r.effective_from)}
                  </span>
                </div>
                <div className="muted small">
                  Added by {(r.created_by && people.get(r.created_by)?.full_name) || 'someone'} · {formatStamp(r.created_at)}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
