/**
 * CSV writing, for the manager exports.  Every cell is quoted, so names with
 * commas, notes with line breaks and quotes inside text all survive a round
 * trip through Excel or Google Sheets.  A leading =, +, - or @ is prefixed
 * with an apostrophe so a note can never run as a spreadsheet formula.
 */

export type Cell = string | number | boolean | null | undefined

function cell(value: Cell): string {
  if (value === null || value === undefined) return '""'
  let text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** Header row plus one row per record, CRLF line endings, UTF-8 with a BOM so Excel reads accents. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Starts a download of `text` as `fileName` in the browser. */
export function downloadCsv(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
