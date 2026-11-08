import { Link, useSearchParams } from 'react-router-dom'
import { chicagoDateOf, formatFullDate, formatMinutes } from '../lib/dates.ts'
import { useAsync } from '../lib/useAsync.ts'
import type { Design } from '../lib/types.ts'
import { BackLink, ErrorNote, Loading } from '../components/ui.tsx'
import { loadAccounts, loadArtistDesignHours, loadDesigns, type Account, type ArtistDesignRun } from './queries.ts'

interface Data {
  accounts: Account[]
  designs: Design[]
  runs: ArtistDesignRun[] | null
}

/**
 * Artist by design: one artist's minutes per bottle on one design, run by
 * run, beside the studio figure for the same run (brief: Reports and views).
 * Comparisons are per design because designs differ in difficulty, and only
 * managers can see them.  No score is produced.
 */
export default function ArtistByDesignScreen() {
  const [params, setParams] = useSearchParams()
  const artistId = params.get('artist') ?? ''
  const designId = params.get('design') ?? ''

  const { state, reload } = useAsync<Data>(async () => {
    const [accounts, designs] = await Promise.all([loadAccounts(), loadDesigns()])
    const runs = artistId && designId ? await loadArtistDesignHours(artistId, designId) : null
    return { accounts, designs, runs }
  }, [artistId, designId])

  const pick = (key: 'artist' | 'design', value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <>
      <BackLink to="/manage/reports" label="Reports" />
      <h1>Artist by design</h1>
      <p className="muted">
        How long one person takes per bottle on one design, run by run, next to the whole studio's figure for the same run. Designs differ in difficulty, so
        this is only ever shown per design.
      </p>
      {state.kind === 'loading' && <Loading what="people and designs" />}
      {state.kind === 'error' && <ErrorNote message={state.message} onRetry={reload} />}
      {state.kind === 'ready' && (
        <>
          <div className="two-up">
            <div>
              <label htmlFor="abd-artist">Person</label>
              <select id="abd-artist" value={artistId} onChange={(e) => pick('artist', e.target.value)}>
                <option value="">Choose a person…</option>
                {state.data.accounts
                  .filter((a) => a.active || a.id === artistId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                      {a.role === 'manager' ? ' (manager)' : ''}
                      {a.active ? '' : ' (switched off)'}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="abd-design">Design</label>
              <select id="abd-design" value={designId} onChange={(e) => pick('design', e.target.value)}>
                <option value="">Choose a design…</option>
                {state.data.designs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.active ? '' : ' (retired)'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {state.data.runs && <Runs runs={state.data.runs} artist={state.data.accounts.find((a) => a.id === artistId)} design={state.data.designs.find((d) => d.id === designId)} />}
        </>
      )}
    </>
  )
}

function perBottle(minutes: number | null): string {
  return minutes === null ? '—' : `${Math.round(Number(minutes) * 10) / 10} min`
}

function Runs({ runs, artist, design }: { runs: ArtistDesignRun[]; artist?: Account; design?: Design }) {
  const worked = runs.filter((r) => r.artist_minutes > 0)
  const delivered = (list: ArtistDesignRun[]) => list.reduce((sum, r) => sum + (r.bottles_delivered ?? 0), 0)
  const artistAll = worked.reduce((sum, r) => sum + r.artist_minutes, 0)
  const studioAll = runs.reduce((sum, r) => sum + r.studio_minutes, 0)
  const artistAvg = delivered(worked) > 0 ? artistAll / delivered(worked) : null
  const studioAvg = delivered(runs) > 0 ? studioAll / delivered(runs) : null

  if (runs.length === 0) {
    return (
      <div className="card">
        <p className="incomplete">No closed runs of {design?.name ?? 'this design'} yet</p>
        <p className="form-note">Only closed orders are compared, because hours per bottle needs the delivered quantity.</p>
      </div>
    )
  }
  return (
    <>
      <div className="card" data-testid="abd-summary">
        <h3 style={{ marginTop: 0 }}>
          {artist?.full_name ?? 'This person'} on {design?.name ?? 'this design'}
        </h3>
        <dl className="facts money">
          <dt>
            {artist?.full_name ?? 'Artist'}, per bottle, over the {worked.length} {worked.length === 1 ? 'run' : 'runs'} they worked on
          </dt>
          <dd className="strong">{worked.length === 0 ? <span className="muted">Did not work on this design</span> : perBottle(artistAvg)}</dd>
          <dt>
            Studio, per bottle, over all {runs.length} {runs.length === 1 ? 'run' : 'runs'}
          </dt>
          <dd className="strong">{perBottle(studioAvg)}</dd>
        </dl>
        <p className="form-note" style={{ marginBottom: 0 }}>
          The artist's figure is their own minutes over the bottles delivered on runs they logged on; the studio figure is everyone's minutes over all bottles
          delivered. Dabber hours are not separated.
        </p>
      </div>

      <h2>Run by run, oldest first</h2>
      <div className="table-scroll">
        <table className="table" data-testid="abd-runs">
          <thead>
            <tr>
              <th>Order</th>
              <th>Closed</th>
              <th className="num">Delivered</th>
              <th className="num">{artist?.full_name ?? 'Artist'}: hours</th>
              <th className="num">{artist?.full_name ?? 'Artist'}: per bottle</th>
              <th className="num">Studio: hours</th>
              <th className="num">Studio: per bottle</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.order_id} className={r.artist_minutes === 0 ? 'skipped' : undefined}>
                <td data-label="Order">
                  <Link to={`/manage/reports/order-cost/${r.order_id}`} className="row-title">
                    {r.order_name}
                  </Link>
                </td>
                <td data-label="Closed">{formatFullDate(chicagoDateOf(r.closed_at))}</td>
                <td className="num" data-label="Delivered">
                  {r.bottles_delivered ?? <span className="missing">Missing</span>}
                </td>
                <td className="num" data-label="Artist hours">
                  {r.artist_minutes === 0 ? <span className="muted">Not on this run</span> : formatMinutes(r.artist_minutes)}
                </td>
                <td className="num" data-label="Artist per bottle">
                  {r.artist_minutes === 0 ? <span className="muted">—</span> : perBottle(r.artist_minutes_per_bottle)}
                </td>
                <td className="num" data-label="Studio hours">
                  {formatMinutes(r.studio_minutes)}
                </td>
                <td className="num" data-label="Studio per bottle">
                  {perBottle(r.studio_minutes_per_bottle)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
