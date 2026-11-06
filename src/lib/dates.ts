/**
 * Dates in the studio's time zone (America/Chicago).  The database's
 * app.today() and app.within_edit_window() use the same zone, so what the
 * screen allows and what the database allows agree at 11 pm as well as noon.
 */
const TZ = 'America/Chicago'

/** Today as YYYY-MM-DD in Chicago. */
export function todayChicago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/** Add (or subtract) whole days to a YYYY-MM-DD string. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/** Monday of the week that contains the given date. */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1
  return addDays(iso, -back)
}

/** Mirrors app.within_edit_window: today and the 7 days before it. */
export function withinEditWindow(workDate: string): boolean {
  const today = todayChicago()
  return workDate <= today && workDate >= addDays(today, -7)
}

const WEEKDAY_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
const LONG_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const STAMP = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function utcDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "Thu, Nov 6" */
export function formatDate(iso: string): string {
  return WEEKDAY_DATE.format(utcDate(iso))
}

/** "Thursday, November 6" */
export function formatLongDate(iso: string): string {
  return LONG_DATE.format(utcDate(iso))
}

/** "Nov 6" */
export function formatShortDate(iso: string): string {
  return SHORT_DATE.format(utcDate(iso))
}

/** "Today", "Yesterday" or the weekday date. */
export function formatRelativeDate(iso: string): string {
  const today = todayChicago()
  if (iso === today) return 'Today'
  if (iso === addDays(today, -1)) return 'Yesterday'
  return formatDate(iso)
}

/** A timestamp as "Nov 6, 3:42 PM" in Chicago time. */
export function formatStamp(timestamp: string): string {
  return STAMP.format(new Date(timestamp))
}

/** 90 -> "1h 30m", 45 -> "45m", 120 -> "2h" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** 90 -> "1.5 h" for totals. */
export function formatHours(minutes: number): string {
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(2).replace(/0$/, '')} h`
}
