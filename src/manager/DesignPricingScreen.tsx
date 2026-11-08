import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatFullDate, formatMinutes, todayChicago } from '../lib/dates.ts'
import { useAsync } from '../lib/useAsync.ts'
import type { Design } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { Money } from './CostCard.tsx'
import { formatMoney } from './format.ts'
import { inForceOn, loadDesign, loadDesignPrices, loadDesignPricing, loadDesigns, type DesignPrice, type DesignRun } from './queries.ts'

/**
 * Design pricing: every closed run of one design in date order, with quantity,
 * hours per bottle, cost per bottle, price per bottle and amount remaining per
 * bottle (brief: Costs and pricing).  Only closed orders appear; a run with a
 * missing input shows the figure as missing (rule 6).  Hours per bottle are all
 * logged minutes over bottles delivered (rule 4), so designs with dabbers run
 * higher and compare only with their own past runs.
 */
export default function DesignPricingScreen() {
  const { designId } = useParams()
  return designId ? <DesignReport designId={designId} /> : <PickDesign />
}

function PickDesign() {
  const [query, setQuery] = useState('')
  const { state, reload } = useAsync(async () => {
    const [designs, prices] = await Promise.all([loadDesigns(), loadDesignPrices()])
    return { designs, prices }
  }, [])
  const today = todayChicago()
  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data.designs.filter((d) => q === '' || d.name.toLowerCase().includes(q))
  }, [state, query])

  return (
    <>
      <BackLink to="/manage/reports" label="Reports" />
      <h1>Design pricing</h1>
      <p className="muted">Choose a design to see every closed run and whether its price holds up against recorded labor and materials.</p>
      <div className="toolbar">
        <input type="search" aria-label="Search designs" placeholder="Search by design" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {state.kind === 'loading' && <Loading what="designs" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <table className="table">
          <thead>
            <tr>
              <th>Design</th>
              <th>Makes</th>
              <th className="num">Current price per bottle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No design matches.
                </td>
              </tr>
            )}
            {shown.map((d) => {
              const price = inForceOn(
                state.data.prices.filter((p) => p.design_id === d.id),
                today,
              )
              return (
                <tr key={d.id}>
                  <td data-label="Design">
                    <Link to={`/manage/reports/design-pricing/${d.id}`} className="row-title">
                      {d.name}
                    </Link>
                  </td>
                  <td data-label="Makes">{describeMakes(d)}</td>
                  <td className="num" data-label="Current price per bottle">
                    <Money value={price?.price_per_bottle ?? null} />
                  </td>
                  <td data-label="Status">{d.active ? 'Active' : <span className="muted">Retired</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function describeMakes(d: Design): string {
  const parts = ['bottles']
  if (d.has_dabber) parts.push('dabbers')
  if (d.is_fumed) parts.push('fumed')
  return parts.join(', ')
}

interface Data {
  design: Design | null
  runs: DesignRun[]
  prices: DesignPrice[]
}

function DesignReport({ designId }: { designId: string }) {
  const { state, reload } = useAsync<Data>(async () => {
    const design = await loadDesign(designId)
    if (!design) return { design: null, runs: [], prices: [] }
    const [runs, prices] = await Promise.all([loadDesignPricing(designId), loadDesignPrices(designId)])
    return { design, runs, prices }
  }, [designId])

  if (state.kind === 'loading') return <Loading what="the design" />
  if (state.kind === 'error') return <ErrorNote message={state.message} onRetry={reload} />
  const { design, runs, prices } = state.data
  if (!design) {
    return (
      <>
        <BackLink to="/manage/reports/design-pricing" label="Design pricing" />
        <ErrorNote message="This design does not exist, or it was removed." />
      </>
    )
  }
  const current = inForceOn(prices, todayChicago())
  const complete = runs.filter((r) => r.missing.length === 0 && r.remaining_per_bottle !== null)
  const latest = complete.length > 0 ? complete[complete.length - 1] : null

  return (
    <>
      <BackLink to="/manage/reports/design-pricing" label="Design pricing" />
      <div className="topbar">
        <h1>{design.name}</h1>
        {!design.active && <span className="tag quiet">Retired</span>}
      </div>
      <p className="muted">
        Makes {describeMakes(design)} · current selling price per bottle: <Money value={current?.price_per_bottle ?? null} />
        {current && <span> (since {formatFullDate(current.effective_from)})</span>} · <Link to={`/manage/designs/${design.id}`}>Open the design</Link>
      </p>

      {runs.length === 0 ? (
        <div className="card">
          <p className="incomplete">No closed runs yet</p>
          <p className="form-note">Only closed orders appear here. Open and finished orders show as “financials incomplete” until a manager closes them.</p>
        </div>
      ) : (
        <>
          {latest && (
            <div className="card" data-testid="latest-run">
              <h3 style={{ marginTop: 0 }}>Latest complete run: {latest.order_name}</h3>
              <dl className="facts money">
                <dt>Cost per bottle</dt>
                <dd>
                  <Money value={latest.cost_per_bottle} />
                </dd>
                <dt>Price per bottle</dt>
                <dd>
                  <Money value={latest.price_per_bottle} />
                </dd>
                <dt className="strong">Amount remaining per bottle</dt>
                <dd className="strong">
                  <Money value={latest.remaining_per_bottle} />
                </dd>
                <dt>Logged time per bottle</dt>
                <dd>{latest.minutes_per_bottle === null ? <span className="missing">Missing</span> : `${Number(latest.minutes_per_bottle)} min`}</dd>
              </dl>
              {current && latest.price_per_bottle !== null && Number(current.price_per_bottle) !== Number(latest.price_per_bottle) && (
                <p className="form-note">
                  That run sold at {formatMoney(Number(latest.price_per_bottle))} per bottle; the current price is {formatMoney(Number(current.price_per_bottle))}.
                </p>
              )}
            </div>
          )}

          <h2>Closed runs, oldest first</h2>
          <div className="table-scroll">
            <table className="table" data-testid="runs">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Closed</th>
                  <th className="num">Delivered</th>
                  <th className="num">Hours per bottle</th>
                  <th className="num">Cost per bottle</th>
                  <th className="num">Price per bottle</th>
                  <th className="num">Remaining per bottle</th>
                  <th>Missing</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.order_id}>
                    <td data-label="Order">
                      <Link to={`/manage/reports/order-cost/${r.order_id}`} className="row-title">
                        {r.order_name}
                      </Link>
                    </td>
                    <td data-label="Closed">{formatFullDate(r.closed_at.slice(0, 10))}</td>
                    <td className="num" data-label="Delivered">
                      {r.bottles_delivered ?? <span className="missing">Missing</span>}
                    </td>
                    <td className="num" data-label="Hours per bottle">
                      {r.minutes_per_bottle === null ? <span className="missing">Missing</span> : formatMinutes(Math.round(Number(r.minutes_per_bottle)))}
                      {r.minutes_per_bottle !== null && <div className="small muted">{formatMinutes(r.total_minutes)} in all</div>}
                    </td>
                    <td className="num" data-label="Cost per bottle">
                      <Money value={r.cost_per_bottle} />
                    </td>
                    <td className="num" data-label="Price per bottle">
                      <Money value={r.price_per_bottle} />
                    </td>
                    <td className="num" data-label="Remaining per bottle">
                      <Money value={r.remaining_per_bottle} />
                    </td>
                    <td data-label="Missing">{r.missing.length > 0 ? <span className="missing">{r.missing.join(', ')}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="form-note">
            Hours per bottle are all logged minutes on the run divided by bottles delivered. Dabber hours are not separated, so a design with dabbers runs higher and
            compares only with its own past runs. Recorded labor and materials against price; not net profit after overhead.
          </p>
        </>
      )}
    </>
  )
}
