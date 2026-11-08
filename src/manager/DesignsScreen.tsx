import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAsync } from '../lib/useAsync.ts'
import { todayChicago } from '../lib/dates.ts'
import type { Design } from '../lib/types.ts'
import { ErrorNote, Loading } from '../components/ui.tsx'
import { formatMoney } from './format.ts'
import { inForceOn, loadDesignPrices, loadDesigns, type DesignPrice } from './queries.ts'

type Filter = 'active' | 'retired' | 'all'

interface Data {
  designs: Design[]
  prices: DesignPrice[]
}

function includes(design: Design): string {
  const parts = [design.has_dabber && 'Dabber', design.is_fumed && 'Fuming'].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Bottle only'
}

/** Designs: every design with its current selling price, which shows as Missing until one is entered. */
export default function DesignsScreen() {
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const { state, reload } = useAsync<Data>(async () => {
    const [designs, prices] = await Promise.all([loadDesigns(), loadDesignPrices()])
    return { designs, prices }
  }, [])

  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    return state.data.designs.filter((d) => {
      if (filter === 'active' && !d.active) return false
      if (filter === 'retired' && d.active) return false
      return q === '' || d.name.toLowerCase().includes(q)
    })
  }, [state, filter, query])

  const today = todayChicago()

  return (
    <>
      <div className="topbar">
        <h1>Designs</h1>
        <Link to="/manage/designs/new" className="btn">
          New design
        </Link>
      </div>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Show">
          <button type="button" className={filter === 'active' ? 'active' : ''} aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>
            Active
          </button>
          <button type="button" className={filter === 'retired' ? 'active' : ''} aria-pressed={filter === 'retired'} onClick={() => setFilter('retired')}>
            Retired
          </button>
          <button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
        <input
          type="search"
          aria-label="Search designs"
          placeholder="Search by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {state.kind === 'loading' && <Loading what="designs" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <table className="table">
          <thead>
            <tr>
              <th>Design</th>
              <th>Includes</th>
              <th>Price per bottle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {query.trim() ? `No design matches “${query.trim()}”.` : 'No designs to show here.'}
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
                    <Link to={`/manage/designs/${d.id}`} className="row-title">
                      {d.name}
                    </Link>
                  </td>
                  <td data-label="Includes">{includes(d)}</td>
                  <td data-label="Price per bottle">{price ? formatMoney(price.price_per_bottle) : <span className="missing">Missing</span>}</td>
                  <td data-label="Status">{d.active ? 'Active' : 'Retired'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
