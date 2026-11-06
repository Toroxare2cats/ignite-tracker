import { Link, useParams } from 'react-router-dom'
import { useProfile } from '../lib/useProfile.ts'
import { useAsync } from '../lib/useAsync.ts'
import { formatMinutes, formatRelativeDate, formatStamp, todayChicago, withinEditWindow } from '../lib/dates.ts'
import {
  loadDesignPhotos,
  loadOrder,
  loadOrderEntries,
  loadPeople,
  signedUrl,
  signedUrls,
} from '../lib/queries.ts'
import { COUNT_FIELDS, describeCounts, type Counts, type DesignPhoto, type EntryWithTime, type OrderWithDesign, type Person } from '../lib/types.ts'
import { BackLink, DueDate, ErrorNote, Loading, StatusBadge } from '../components/ui.tsx'

interface Data {
  order: OrderWithDesign | null
  entries: EntryWithTime[]
  people: Map<string, Person>
  photos: DesignPhoto[]
  imageUrl: string | null
  photoUrls: Map<string, string>
}

/**
 * Order: what it is, the Resources for making it, the shared work log, and
 * the button that starts today's entry.
 */
export default function OrderScreen() {
  const { orderId = '' } = useParams()
  const profile = useProfile()

  const { state, reload } = useAsync<Data>(async () => {
    const order = await loadOrder(orderId)
    if (!order) return { order: null, entries: [], people: new Map(), photos: [], imageUrl: null, photoUrls: new Map() }
    const [entries, people, photos, imageUrl] = await Promise.all([
      loadOrderEntries(orderId),
      loadPeople(),
      loadDesignPhotos(order.design_id),
      order.design.product_image_path ? signedUrl('design-photos', order.design.product_image_path) : Promise.resolve(null),
    ])
    const photoUrls = await signedUrls(
      'design-photos',
      photos.map((p) => p.storage_path),
    )
    return { order, entries, people, photos, imageUrl, photoUrls }
  }, [orderId])

  if (state.kind === 'loading') {
    return (
      <>
        <BackLink to="/" label="My Work" />
        <Loading what="the order" />
      </>
    )
  }
  if (state.kind === 'error') {
    return (
      <>
        <BackLink to="/" label="My Work" />
        <ErrorNote message={state.message} onRetry={reload} />
      </>
    )
  }

  const { order, entries, people, photos, imageUrl, photoUrls } = state.data
  if (!order) {
    return (
      <>
        <BackLink to="/" label="My Work" />
        <p>This order could not be found. It may have been removed.</p>
      </>
    )
  }

  const design = order.design
  const today = todayChicago()
  const myToday = entries.find((e) => e.artist_id === profile.id && e.work_date === today)
  const primary = order.primary_artist_id ? people.get(order.primary_artist_id)?.full_name : null
  const finisher = order.finished_by ? people.get(order.finished_by)?.full_name : null
  const closed = order.status === 'closed'
  const hasResources = Boolean(order.spec_dimensions || order.spec_colors_finishes || order.spec_instructions || photos.length)

  return (
    <>
      <BackLink to="/" label="My Work" />
      <div className="topbar">
        <h1>{order.name}</h1>
        <StatusBadge status={order.status} />
      </div>

      {imageUrl && <img className="product-image" src={imageUrl} alt={`${design.name} product`} />}

      <div className="card">
        <dl className="facts">
          <dt>Design</dt>
          <dd>{design.name}</dd>
          <dt>Quantity</dt>
          <dd>
            {order.bottles_ordered} bottles
            {design.has_dabber ? ` · ${order.dabbers_ordered} dabbers` : ''}
          </dd>
          <dt>Due</dt>
          <dd>
            <DueDate date={order.due_date} status={order.status} />
          </dd>
          <dt>Primary artist</dt>
          <dd>{primary ?? <span className="muted">Not assigned</span>}</dd>
          {order.finished_at && (
            <>
              <dt>Finished</dt>
              <dd>
                {finisher ?? 'Someone'} · {formatStamp(order.finished_at)}
              </dd>
            </>
          )}
        </dl>
      </div>

      {closed ? (
        <p className="notice warn">This order is closed. A manager must reopen it before entries can be added or changed.</p>
      ) : (
        <Link to={myToday ? `/entries/${myToday.id}` : `/orders/${order.id}/entry`} className="btn block big cta">
          {myToday ? "Edit today's entry" : "Add today's entry"}
        </Link>
      )}

      <details className="resources">
        <summary>Resources</summary>
        <div className="body">
          {!hasResources && <p className="muted">No specifications or photos have been added for this design yet.</p>}
          {order.spec_dimensions && (
            <>
              <h3>Dimensions</h3>
              <p className="spec">{order.spec_dimensions}</p>
            </>
          )}
          {order.spec_colors_finishes && (
            <>
              <h3>Colors and finishes</h3>
              <p className="spec">{order.spec_colors_finishes}</p>
            </>
          )}
          {order.spec_instructions && (
            <>
              <h3>Instructions</h3>
              <p className="spec">{order.spec_instructions}</p>
            </>
          )}
          {photos.length > 0 && (
            <>
              <h3>Reference photos</h3>
              <div className="photos">
                {photos.map((p) => {
                  const url = photoUrls.get(p.storage_path)
                  if (!url) return null
                  return (
                    <figure key={p.id} style={{ margin: 0 }}>
                      <a href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={p.caption ?? 'Reference photo'} loading="lazy" />
                      </a>
                      {p.caption && <figcaption>{p.caption}</figcaption>}
                    </figure>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </details>

      <h2>Work log</h2>
      <LoggedSoFar entries={entries} />
      <ul className="list">
        {entries.length === 0 && <li className="empty">Nothing logged on this order yet.</li>}
        {entries.map((e) => (
          <LogEntry key={e.id} entry={e} people={people} meId={profile.id} isManager={profile.role === 'manager'} closed={closed} />
        ))}
      </ul>
    </>
  )
}

function LogEntry({
  entry,
  people,
  meId,
  isManager,
  closed,
}: {
  entry: EntryWithTime
  people: Map<string, Person>
  meId: string
  isManager: boolean
  closed: boolean
}) {
  const own = entry.artist_id === meId
  const who = own ? 'You' : (people.get(entry.artist_id)?.full_name ?? 'Someone')
  const counts = describeCounts(entry)
  const editor = entry.edited_by ? (entry.edited_by === meId ? 'you' : (people.get(entry.edited_by)?.full_name ?? 'someone')) : null
  const canOpen = !closed && (isManager || (own && withinEditWindow(entry.work_date)))

  const body = (
    <>
      <div className="log-head">
        <span className="log-who">{who}</span>
        <span className="log-date">{formatRelativeDate(entry.work_date)}</span>
      </div>
      <div className="log-counts">
        {counts.length === 0 && <span className="muted small">No counts</span>}
        {counts.map((c) => (
          <span key={c} className="count-pill">
            {c}
          </span>
        ))}
      </div>
      {entry.note && <p className="log-note">{entry.note}</p>}
      {(entry.minutes !== null || entry.edited_at) && (
        <div className="log-meta">
          {entry.minutes !== null && <span className="hours">{formatMinutes(entry.minutes)}</span>}
          {entry.edited_at && (
            <span>
              Edited by {editor} · {formatStamp(entry.edited_at)}
            </span>
          )}
        </div>
      )}
    </>
  )

  if (canOpen) {
    return (
      <li>
        <Link to={`/entries/${entry.id}`} className={own ? 'log-entry own' : 'log-entry'}>
          {body}
        </Link>
      </li>
    )
  }
  return <li className={own ? 'log-entry own' : 'log-entry'}>{body}</li>
}

/**
 * Running totals of what has been logged on the order, each activity kept
 * separate (rule 3).  These are counts logged by artists, not finished or
 * delivered bottles, so the wording says "logged" and there is no bar or
 * percentage against the ordered quantity.
 */
function LoggedSoFar({ entries }: { entries: EntryWithTime[] }) {
  if (entries.length === 0) return null
  const totals = {} as Counts
  for (const f of COUNT_FIELDS) totals[f.key] = entries.reduce((sum, e) => sum + (e[f.key] ?? 0), 0) || null
  const parts = describeCounts(totals)
  const artists = new Set(entries.map((e) => e.artist_id)).size
  return (
    <div className="card logged-so-far">
      <p className="small muted" style={{ margin: 0 }}>
        Logged so far · {entries.length} {entries.length === 1 ? 'entry' : 'entries'} by {artists} {artists === 1 ? 'artist' : 'artists'}
      </p>
      <div className="week-totals">
        {parts.length === 0 && <span className="muted small">No counts logged yet</span>}
        {parts.map((p) => (
          <span key={p} className="count-pill">
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}
