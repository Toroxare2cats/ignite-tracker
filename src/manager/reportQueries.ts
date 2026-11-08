/**
 * Reads for the manager reports.  Everything here crosses people, so only a
 * manager account gets rows back: entry_time, studio_time, uattend_days and
 * the calendar tables all return nothing or only the caller's own rows to an
 * artist.
 */
import { supabase } from '../lib/supabase.ts'
import { check } from '../lib/queries.ts'
import type { Counts, Person } from '../lib/types.ts'
import { reconcileDay, type DayResult } from '../lib/gap.ts'

// --- Raw rows for a date range ---------------------------------------------

export interface ClockedDay {
  artist_id: string
  work_date: string
  clocked_minutes: number | null
  missing_punch: boolean
}

export async function loadClocked(from: string, to: string, artistId?: string): Promise<ClockedDay[]> {
  let q = supabase.from('uattend_days').select('artist_id, work_date, clocked_minutes, missing_punch').gte('work_date', from).lte('work_date', to)
  if (artistId) q = q.eq('artist_id', artistId)
  return check(await q) as ClockedDay[]
}

export interface ReportEntry extends Counts {
  id: string
  artist_id: string
  order_id: string
  work_date: string
  note: string | null
  minutes: number
  order: { name: string; design: { name: string } | null } | null
}

/** Entries with their hours and order names.  Managers see every person's hours. */
export async function loadEntriesBetween(from: string, to: string, artistId?: string): Promise<ReportEntry[]> {
  let q = supabase
    .from('entries')
    .select(
      'id, artist_id, order_id, work_date, bottles, dabbers, points, color_tube_preps, blanks, fuming, note, ' +
        'entry_time(minutes), order:orders(name, design:designs(name))',
    )
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
    .order('created_at')
  if (artistId) q = q.eq('artist_id', artistId)
  const rows = check(await q) as unknown as (Omit<ReportEntry, 'minutes'> & { entry_time: { minutes: number } | { minutes: number }[] | null })[]
  return rows.map(({ entry_time, ...e }) => {
    const t = Array.isArray(entry_time) ? entry_time[0] : entry_time
    return { ...e, minutes: t?.minutes ?? 0 }
  })
}

export interface StudioTimeRow {
  artist_id: string
  work_date: string
  minutes: number
  category: 'cleanup_maintenance' | 'general_prep' | 'admin_teaching_other'
  note: string | null
}

export async function loadStudioTime(from: string, to: string, artistId?: string): Promise<StudioTimeRow[]> {
  let q = supabase.from('studio_time').select('artist_id, work_date, minutes, category, note').gte('work_date', from).lte('work_date', to)
  if (artistId) q = q.eq('artist_id', artistId)
  return check(await q) as StudioTimeRow[]
}

export interface CalendarItem {
  profile_id: string
  /** The Chicago date the event starts on. */
  date: string
  title: string | null
  calendar_name: string
  minutes: number
  all_day: boolean
  declined: boolean
}

const CHICAGO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Calendar events the people were invited to, one item per person per event.
 * Declined and all-day items are returned so they can be shown, but they are
 * flagged so the formula leaves them out.  Empty until the calendar sync is
 * built (session 8).
 */
export async function loadCalendarItems(from: string, to: string, artistId?: string): Promise<CalendarItem[]> {
  const rows = check(
    await supabase
      .from('calendar_events')
      .select('title, calendar_name, starts_at, ends_at, all_day, cancelled, attendees:calendar_attendees(profile_id, response)')
      .gte('starts_at', `${from}T00:00:00-06:00`)
      .lte('starts_at', `${to}T23:59:59-05:00`)
      .eq('cancelled', false),
  ) as unknown as {
    title: string | null
    calendar_name: string
    starts_at: string
    ends_at: string
    all_day: boolean
    attendees: { profile_id: string | null; response: string }[]
  }[]
  const out: CalendarItem[] = []
  for (const ev of rows) {
    const date = CHICAGO_DATE.format(new Date(ev.starts_at))
    if (date < from || date > to) continue
    const minutes = Math.max(0, Math.round((new Date(ev.ends_at).getTime() - new Date(ev.starts_at).getTime()) / 60000))
    for (const a of ev.attendees) {
      if (!a.profile_id || (artistId && a.profile_id !== artistId)) continue
      out.push({ profile_id: a.profile_id, date, title: ev.title, calendar_name: ev.calendar_name, minutes, all_day: ev.all_day, declined: a.response === 'declined' })
    }
  }
  return out
}

export interface ImportCover {
  id: string
  period_from: string
  period_to: string
  uploaded_at: string
}

/** Uploads whose period touches the range and still have days in use. */
export async function loadImportsCovering(from: string, to: string): Promise<ImportCover[]> {
  const rows = check(
    await supabase
      .from('uattend_imports')
      .select('id, period_from, period_to, uploaded_at, uattend_days(count)')
      .lte('period_from', to)
      .gte('period_to', from)
      .order('uploaded_at', { ascending: false }),
  ) as (ImportCover & { uattend_days: { count: number }[] })[]
  return rows.filter((r) => (r.uattend_days[0]?.count ?? 0) > 0).map(({ uattend_days: _d, ...r }) => r)
}

// --- Put together per person per day ----------------------------------------

export interface DayCell extends DayResult {
  date: string
  /** Null when no uAttend row exists for the day, or it has a missing punch. */
  clocked: number | null
  /** True when a uAttend row exists for the day (even with 0 or a missing punch). */
  imported: boolean
  missingPunch: boolean
  order: number
  calendar: number
  studio: number
  entries: ReportEntry[]
  studioRows: StudioTimeRow[]
  calendarItems: CalendarItem[]
}

export interface PersonWeek {
  person: Person
  days: DayCell[]
  totals: { clocked: number | null; order: number; calendarCounted: number; studio: number; gap: number | null }
  flaggedDays: number
  overExplainedDays: number
  missingDays: number
}

function emptyTotals(): PersonWeek['totals'] {
  return { clocked: 0, order: 0, calendarCounted: 0, studio: 0, gap: 0 }
}

/** Build one person's cells for every date given.  Pure: no reads. */
export function buildPersonWeek(
  person: Person,
  dates: string[],
  rows: { clocked: ClockedDay[]; entries: ReportEntry[]; studio: StudioTimeRow[]; calendar: CalendarItem[] },
): PersonWeek {
  const totals = emptyTotals()
  let flaggedDays = 0
  let overExplainedDays = 0
  let missingDays = 0
  const days = dates.map((date) => {
    const clockedRow = rows.clocked.find((c) => c.artist_id === person.id && c.work_date === date) ?? null
    const entries = rows.entries.filter((e) => e.artist_id === person.id && e.work_date === date)
    const studioRows = rows.studio.filter((s) => s.artist_id === person.id && s.work_date === date)
    const calendarItems = rows.calendar.filter((c) => c.profile_id === person.id && c.date === date)
    const clocked = clockedRow && !clockedRow.missing_punch ? clockedRow.clocked_minutes : null
    const order = entries.reduce((sum, e) => sum + e.minutes, 0)
    const calendar = calendarItems.filter((c) => !c.declined && !c.all_day).reduce((sum, c) => sum + c.minutes, 0)
    const studio = studioRows.reduce((sum, s) => sum + s.minutes, 0)
    const result = reconcileDay({ clocked, order, calendar, studio })

    totals.order += order
    totals.studio += studio
    totals.calendarCounted += result.calendarCounted
    if (clocked === null) {
      // A week with a day that cannot be compared has no total clocked or gap either (rule 6).
      if (clockedRow?.missing_punch) missingDays += 1
      if (clockedRow) {
        totals.clocked = null
        totals.gap = null
      }
    } else {
      if (totals.clocked !== null) totals.clocked += clocked
      if (totals.gap !== null && result.gap !== null) totals.gap += result.gap
    }
    if (result.noEntry) flaggedDays += 1
    if (result.overExplained) overExplainedDays += 1

    return {
      ...result,
      date,
      clocked,
      imported: clockedRow !== null,
      missingPunch: clockedRow?.missing_punch ?? false,
      order,
      calendar,
      studio,
      entries,
      studioRows,
      calendarItems,
    }
  })
  // No uAttend row at all for the week: nothing to compare with.
  if (!days.some((d) => d.imported)) {
    totals.clocked = null
    totals.gap = null
  }
  return { person, days, totals, flaggedDays, overExplainedDays, missingDays }
}

export interface WeekReport {
  from: string
  to: string
  dates: string[]
  people: PersonWeek[]
  imports: ImportCover[]
}

/**
 * Everyone's week.  Every active account is listed (managers log production
 * work too), plus anyone switched off who still has hours in the range.
 */
export async function loadWeekReport(from: string, to: string, dates: string[], people: Map<string, Person>): Promise<WeekReport> {
  const [clocked, entries, studio, calendar, imports] = await Promise.all([
    loadClocked(from, to),
    loadEntriesBetween(from, to),
    loadStudioTime(from, to),
    loadCalendarItems(from, to),
    loadImportsCovering(from, to),
  ])
  const withHours = new Set([...clocked.map((c) => c.artist_id), ...entries.map((e) => e.artist_id), ...studio.map((s) => s.artist_id)])
  const listed = [...people.values()]
    .filter((p) => p.active || withHours.has(p.id))
    .sort((a, b) => (a.role === b.role ? a.full_name.localeCompare(b.full_name) : a.role === 'artist' ? -1 : 1))
  return {
    from,
    to,
    dates,
    people: listed.map((p) => buildPersonWeek(p, dates, { clocked, entries, studio, calendar })),
    imports,
  }
}
