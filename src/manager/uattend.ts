/**
 * Reads uAttend's Timecard Report, exported as CSV, into clocked minutes per
 * person per day.  Built from a real export (session 4); the layout is:
 *
 *   Timecard Report - Ignite Glass Studios
 *   <Person's name>
 *   <Company>
 *   Pay Period: 11/01/2026 - 11/07/2026
 *   ,Day,Date,Department,,IN,,OUT,DED,,REG,OT1,OT2,VAC,HOL,SIC,OTH,,TOTAL
 *   ,Mon,11/02/26,IGS,,10:54 AM,,01:45 PM,,,,,,,,,,,        <- first punch of a day
 *   ,,,IGS,,02:02 PM,,04:06 PM,,,7:50,,,,,,,,7:50          <- last punch carries the day's total
 *   ,Thu,11/05/26,,,,,,,,,,,,,,,,                           <- a day with no punches
 *   ,,,,,,,Total Hours,,,27:46,,,,,,,,27:46                 <- the person's total, used as a check
 *   ,,,,,,,Gross Pay,,,0,,,,,,,,0.00                        <- never read
 *   (blank lines, then the next person)
 *
 * Clocked minutes are time worked: REG + OT1 + OT2.  Paid leave (VAC, HOL,
 * SIC) and OTH are kept apart and shown in the preview, but not counted as
 * clocked.  A punch with "------" for its clock-out (or clock-in) is a missing
 * punch: the day shows as missing, never as zero.
 */

export interface UattendDay {
  /** YYYY-MM-DD */
  date: string
  /** REG + OT1 + OT2.  Null when the day has a missing punch and uAttend gave no hours. */
  minutes: number | null
  /** VAC + HOL + SIC + OTH: shown, never counted as clocked. */
  leaveMinutes: number
  punches: number
  missingPunch: boolean
}

export interface UattendPerson {
  /** As uAttend spells it, with runs of spaces collapsed. */
  name: string
  /** Only days with punches or hours; the rest of the period had none. */
  days: UattendDay[]
  /** The "Total Hours" line, in minutes (worked plus leave), or null if the file had none. */
  reportedTotal: number | null
}

export interface UattendReport {
  periodFrom: string
  periodTo: string
  people: UattendPerson[]
}

export class UattendFormatError extends Error {}

/** Splits one CSV line, honouring quotes ("a, b" and doubled "" inside quotes). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells.map((c) => c.trim())
}

/** "7:13" -> 433, "15:17" -> 917, "7.25" -> 435, "" -> 0.  Null when it is not an amount of time. */
export function parseHours(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  const hm = /^(\d+):(\d{2})$/.exec(t)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2])
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60)
  return null
}

/** "11/02/26" or "11/02/2026" -> "2026-11-02". */
function parseDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text.trim())
  if (!m) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const month = Number(m[1])
  const day = Number(m[2])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/** "Joe  Waropay " -> "Joe Waropay" */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** The same comparison the database makes (app.uattend_key). */
export function nameKey(name: string): string {
  return cleanName(name).toLowerCase()
}

const WORKED = ['REG', 'OT1', 'OT2'] as const
const LEAVE = ['VAC', 'HOL', 'SIC', 'OTH'] as const
const NO_PUNCH = /^-+$/

interface Columns {
  date: number
  in: number
  out: number
  total: number
  worked: number[]
  leave: number[]
}

function isHeader(cells: string[]): boolean {
  return cells.includes('Day') && cells.includes('Date') && cells.includes('IN') && cells.includes('OUT') && cells.includes('TOTAL')
}

function readColumns(cells: string[]): Columns {
  const at = (name: string) => cells.indexOf(name)
  return {
    date: at('Date'),
    in: at('IN'),
    out: at('OUT'),
    total: at('TOTAL'),
    worked: WORKED.map(at).filter((i) => i >= 0),
    leave: LEAVE.map(at).filter((i) => i >= 0),
  }
}

/** Only the first cell has text: a title, a name or a company line. */
function soleText(cells: string[]): string | null {
  if (cells[0] === '' || cells.slice(1).some((c) => c !== '')) return null
  return cells[0]
}

/**
 * Reads the whole file.  Throws UattendFormatError with a plain-language
 * message when the file is not this report, or is the weekly-totals version.
 */
export function parseUattendReport(text: string): UattendReport {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  const rows = lines.map(splitCsvLine)

  if (rows.some((cells) => cells.includes('EMPLOYEE NAME') && cells.includes('TOTAL'))) {
    throw new UattendFormatError(
      'This is the weekly-totals version of the Timecard Report: one line per person, with no days in it. ' +
        'In uAttend, export the Timecard Report that lists each day (one block per person) and upload that file instead.',
    )
  }

  const people: UattendPerson[] = []
  let period: { from: string; to: string } | null = null
  let columns: Columns | null = null
  let expectName = true
  let person: UattendPerson | null = null
  let days = new Map<string, UattendDay>()
  let currentDate: string | null = null

  const finishPerson = () => {
    if (person) {
      person.days = [...days.values()]
        .filter((d) => d.punches > 0 || (d.minutes ?? 0) > 0 || d.leaveMinutes > 0 || d.missingPunch)
        .sort((a, b) => a.date.localeCompare(b.date))
      people.push(person)
    }
    person = null
    days = new Map()
    currentDate = null
  }

  const amount = (cells: string[], index: number, where: string): number => {
    const value = parseHours(cells[index] ?? '')
    if (value === null) throw new UattendFormatError(`Could not read the hours "${cells[index]}" ${where}.`)
    return value
  }

  for (let n = 0; n < rows.length; n++) {
    const cells = rows[n]
    if (cells.every((c) => c === '')) continue
    const lineNo = n + 1

    // Pay money is never read: skip the line before looking at anything in it.
    if (cells.some((c) => /^gross pay$/i.test(c))) continue

    const periodCell = cells.find((c) => /^pay period:/i.test(c))
    if (periodCell) {
      const m = /^pay period:\s*(\S+)\s*-\s*(\S+)$/i.exec(periodCell)
      const from = m ? parseDate(m[1]) : null
      const to = m ? parseDate(m[2]) : null
      if (!from || !to || from > to) throw new UattendFormatError(`Could not read the pay period on line ${lineNo}: "${periodCell}".`)
      if (period && (period.from !== from || period.to !== to)) {
        throw new UattendFormatError('People in this file have different pay periods. Export one pay period at a time.')
      }
      period = { from, to }
      continue
    }

    if (isHeader(cells)) {
      columns = readColumns(cells)
      continue
    }
    // The column names repeat just above each person's Total Hours line.
    if (cells.includes('REG') && cells.includes('TOTAL')) continue

    const text = soleText(cells)
    if (text !== null) {
      if (/^timecard report/i.test(text)) continue
      if (expectName) {
        finishPerson()
        person = { name: cleanName(text), days: [], reportedTotal: null }
        expectName = false
      }
      // Otherwise it is the company line under the name.
      continue
    }

    if (cells.some((c) => /^total hours$/i.test(c))) {
      if (person && columns && columns.total >= 0) {
        person.reportedTotal = amount(cells, columns.total, `on ${person.name}'s Total Hours line`)
      }
      expectName = true
      continue
    }

    // A day line or a further punch on the same day.
    if (!person || !columns) {
      throw new UattendFormatError(
        `Line ${lineNo} has hours but no person or column headings above it. This does not look like a uAttend Timecard Report.`,
      )
    }
    const dateText = cells[columns.date] ?? ''
    if (dateText !== '') {
      const date = parseDate(dateText)
      if (!date) throw new UattendFormatError(`Could not read the date "${dateText}" on line ${lineNo}.`)
      currentDate = date
    }
    if (!currentDate) {
      throw new UattendFormatError(`Line ${lineNo} has a punch with no day above it. This does not look like a uAttend Timecard Report.`)
    }
    const day = days.get(currentDate) ?? { date: currentDate, minutes: 0, leaveMinutes: 0, punches: 0, missingPunch: false }
    days.set(currentDate, day)

    const clockIn = cells[columns.in] ?? ''
    const clockOut = cells[columns.out] ?? ''
    if (clockIn !== '' || clockOut !== '') {
      day.punches += 1
      if (clockIn === '' || clockOut === '' || NO_PUNCH.test(clockIn) || NO_PUNCH.test(clockOut)) day.missingPunch = true
    }
    const where = `for ${person.name} on line ${lineNo}`
    const worked = columns.worked.map((i) => amount(cells, i, where)).reduce((a, b) => a + b, 0)
    const leave = columns.leave.map((i) => amount(cells, i, where)).reduce((a, b) => a + b, 0)
    day.minutes = (day.minutes ?? 0) + worked
    day.leaveMinutes += leave
  }
  finishPerson()

  if (!period) {
    throw new UattendFormatError('Could not find a "Pay Period" line. This does not look like a uAttend Timecard Report.')
  }
  if (people.length === 0) {
    throw new UattendFormatError('No people were found in this file. This does not look like a uAttend Timecard Report.')
  }

  const range = period
  for (const p of people) {
    for (const d of p.days) {
      // A missing punch with no hours from uAttend stays missing, never zero.
      if (d.missingPunch && d.minutes === 0) d.minutes = null
      if (d.date < range.from || d.date > range.to) {
        throw new UattendFormatError(`${p.name} has a day (${d.date}) outside the pay period ${range.from} to ${range.to}.`)
      }
    }
  }

  const seen = new Set<string>()
  for (const p of people) {
    const key = nameKey(p.name)
    if (seen.has(key)) throw new UattendFormatError(`${p.name} appears twice in this file.`)
    seen.add(key)
  }

  return { periodFrom: range.from, periodTo: range.to, people }
}

/** The person's clocked plus leave minutes, to compare with uAttend's Total Hours line. */
export function personTotal(person: UattendPerson): number {
  return person.days.reduce((sum, d) => sum + (d.minutes ?? 0) + d.leaveMinutes, 0)
}

export function personClocked(person: UattendPerson): number {
  return person.days.reduce((sum, d) => sum + (d.minutes ?? 0), 0)
}
