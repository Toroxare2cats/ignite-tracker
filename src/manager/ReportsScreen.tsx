import { Link } from 'react-router-dom'

const REPORTS = [
  {
    to: '/manage/reports/order-cost',
    name: 'Order cost',
    what: 'One order: its entries, hours by contributor, labor cost, materials, selling price and amount remaining. Missing inputs are shown as missing.',
  },
  {
    to: '/manage/reports/design-pricing',
    name: 'Design pricing',
    what: 'One design: every closed run in date order with quantity, hours per bottle, cost per bottle, price per bottle and amount remaining per bottle.',
  },
  {
    to: '/manage/reports/artist-week',
    name: 'Artist week',
    what: "One artist, one week: each day's orders, counts, logged hours, clocked hours (uAttend) and the unexplained gap, with blank days flagged.",
  },
  {
    to: '/manage/reports/artist-by-design',
    name: 'Artist by design',
    what: "One artist's hours per bottle on one design across its closed runs, beside the studio figure for the same runs.",
  },
  {
    to: '/manage/reports/reconciliation',
    name: 'Reconciliation',
    what: 'All artists for a week: clocked (uAttend), hours on orders, calendar, studio time and the unexplained gap per day. Clocked days with no entry are flagged.',
  },
]

/** The list of manager reports.  Each report is its own screen. */
export default function ReportsScreen() {
  return (
    <>
      <h1>Reports</h1>
      <p className="muted">Manager views of the data everyone logs. Figures here are recorded labor and materials against price, not profit after overhead.</p>
      <ul className="list">
        {REPORTS.map((r) => (
          <li key={r.to}>
            <Link to={r.to} className="row">
              <div className="row-main">
                <div className="row-title">{r.name}</div>
                <div className="row-sub">{r.what}</div>
              </div>
              <span className="chevron" aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
