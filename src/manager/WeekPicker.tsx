import { addDays, periodText, todayChicago, weekStart } from '../lib/dates.ts'
import type { Week } from '../lib/useWeek.ts'

/** Previous / This week / Next, with the dates shown between. */
export function WeekPicker({ week, onChange }: { week: Week; onChange: (sunday: string) => void }) {
  const today = todayChicago()
  return (
    <div className="week-picker" role="group" aria-label="Week">
      <button type="button" className="secondary" onClick={() => onChange(addDays(week.from, -7))} aria-label="Previous week">
        ‹
      </button>
      <span className="week-label">
        <strong>{periodText(week.from, week.to)}</strong>
        {week.isCurrent && <span className="tag quiet">This week</span>}
      </span>
      <button type="button" className="secondary" onClick={() => onChange(addDays(week.from, 7))} aria-label="Next week" disabled={week.from >= weekStart(today)}>
        ›
      </button>
      {!week.isCurrent && (
        <button type="button" className="link" onClick={() => onChange(weekStart(today))}>
          This week
        </button>
      )}
    </div>
  )
}
