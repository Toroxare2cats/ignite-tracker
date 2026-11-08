/**
 * The reconciliation formula (CLAUDE.md rule 13), in one place so Reconciliation
 * and Artist week can never disagree:
 *
 *   gap = clocked − order minutes − calendar minutes (capped at clocked) − studio minutes
 *
 * A negative result is "over-explained" and is shown, never hidden.  A day with
 * no clocked figure (not imported, or a missing punch) has no gap at all; the
 * screens show it as missing, never as zero.
 */

export interface DayInputs {
  /** From uAttend.  Null when not imported, or when the day has a missing punch. */
  clocked: number | null
  /** Minutes logged to orders. */
  order: number
  /** Minutes of calendar events the person was invited to (declined and all-day events already left out). */
  calendar: number
  /** Minutes of studio time entries. */
  studio: number
}

export interface DayResult {
  /** Calendar minutes after the cap. */
  calendarCounted: number
  /** Null when there is no clocked figure to compare with. */
  gap: number | null
  /** gap < 0 */
  overExplained: boolean
  /** Clocked hours but nothing logged to an order and no other explanation. */
  noEntry: boolean
}

export function reconcileDay(d: DayInputs): DayResult {
  if (d.clocked === null) {
    return { calendarCounted: d.calendar, gap: null, overExplained: false, noEntry: false }
  }
  const calendarCounted = Math.min(d.calendar, d.clocked)
  const gap = d.clocked - d.order - calendarCounted - d.studio
  return {
    calendarCounted,
    gap,
    overExplained: gap < 0,
    noEntry: d.clocked > 0 && d.order === 0,
  }
}

/** Minutes as a signed hours figure: 90 -> "1h 30m", -45 -> "−45m". */
export function formatGap(minutes: number): string {
  const sign = minutes < 0 ? '−' : ''
  const m = Math.abs(minutes)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${sign}${rest}m`
  if (rest === 0) return `${sign}${h}h`
  return `${sign}${h}h ${rest}m`
}
