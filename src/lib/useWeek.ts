import { useSearchParams } from 'react-router-dom'
import { addDays, datesBetween, todayChicago, weekStart } from './dates.ts'

export interface Week {
  /** Sunday */
  from: string
  /** Saturday */
  to: string
  dates: string[]
  isCurrent: boolean
}

/**
 * The week in the address (?week=YYYY-MM-DD, any day of the week), snapped to
 * its Sunday.  Weeks run Sunday through Saturday everywhere (rule 15).
 */
export function useWeek(): [Week, (sunday: string) => void] {
  const [params, setParams] = useSearchParams()
  const today = todayChicago()
  const asked = params.get('week')
  const from = weekStart(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today)
  const to = addDays(from, 6)
  const set = (sunday: string) => {
    const next = new URLSearchParams(params)
    if (sunday === weekStart(today)) next.delete('week')
    else next.set('week', sunday)
    setParams(next, { replace: true })
  }
  return [{ from, to, dates: datesBetween(from, to), isCurrent: from === weekStart(today) }, set]
}
