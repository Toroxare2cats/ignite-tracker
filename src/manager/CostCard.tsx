import type { OrderWithDesign } from '../lib/types.ts'
import { formatMoney } from './format.ts'
import type { OrderCost } from './queries.ts'

/** A money figure, or "Missing".  Never zero for a missing input (rule 6). */
export function Money({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="missing">Missing</span>
  return <>{formatMoney(value)}</>
}

/**
 * Costs are shown only on a closed order.  Open and finished orders say
 * "financials incomplete" rather than a partial number (brief, Completion).
 */
export function CostCard({ order, cost }: { order: OrderWithDesign; cost: OrderCost | null }) {
  if (order.status !== 'closed') {
    const gaps = cost?.missing.filter((m) => m.startsWith('pay rate')) ?? []
    return (
      <div className="card" data-testid="cost-card">
        <h3 style={{ marginTop: 0 }}>Costs</h3>
        <p className="incomplete">Financials incomplete</p>
        <p className="form-note">Labor, recorded cost and amount remaining appear when this order is closed.</p>
        {gaps.length > 0 && <p className="form-note missing">Missing so far: {gaps.join(', ')}.</p>}
      </div>
    )
  }
  if (!cost) return null
  return (
    <div className="card" data-testid="cost-card">
      <h3 style={{ marginTop: 0 }}>Costs</h3>
      <dl className="facts money">
        <dt>Labor</dt>
        <dd data-testid="labor">
          <Money value={cost.labor_cost} />
        </dd>
        <dt>Materials</dt>
        <dd data-testid="materials">
          <Money value={cost.materials_cost} />
        </dd>
        <dt>Recorded cost</dt>
        <dd data-testid="recorded">
          <Money value={cost.recorded_cost} />
        </dd>
        <dt>Selling price</dt>
        <dd data-testid="price">
          <Money value={cost.selling_price} />
        </dd>
        <dt className="strong">Amount remaining</dt>
        <dd className="strong" data-testid="remaining">
          <Money value={cost.amount_remaining} />
        </dd>
      </dl>
      <h3>Per delivered bottle ({cost.bottles_delivered ?? 'missing'})</h3>
      <dl className="facts money">
        <dt>Recorded cost</dt>
        <dd>
          <Money value={cost.cost_per_bottle} />
        </dd>
        <dt>Price</dt>
        <dd>
          <Money value={cost.price_per_bottle} />
        </dd>
        <dt>Amount remaining</dt>
        <dd data-testid="remaining-per-bottle">
          <Money value={cost.remaining_per_bottle} />
        </dd>
        <dt>Logged time</dt>
        <dd data-testid="time-per-bottle">
          {cost.minutes_per_bottle === null ? <span className="missing">Missing</span> : `${Number(cost.minutes_per_bottle)} min`}
        </dd>
      </dl>
      {cost.missing.length > 0 && <p className="form-note missing">Missing: {cost.missing.join(', ')}.</p>}
      <p className="form-note">Recorded labor and materials against price. This is not net profit after rent, gas, oxygen or other overhead.</p>
    </div>
  )
}
