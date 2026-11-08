const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** "$116.00".  A missing figure is the caller's to show as missing, never zero (rule 6). */
export function formatMoney(value: number): string {
  return MONEY.format(value)
}

/** Reads "1,250.50" or "$300" as a number; null when blank or not a number. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100) / 100
}

/** A whole number of pieces, or null when blank or not a whole number. */
export function parseCount(text: string): number | null {
  const cleaned = text.trim()
  if (!/^\d+$/.test(cleaned)) return null
  return Number(cleaned)
}

/** A positive measurement such as a box side, or null when blank or invalid. */
export function parseMeasure(text: string): number | null {
  const cleaned = text.trim()
  if (cleaned === '') return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** One address per line (commas also work), lower-cased, with blanks and repeats removed. */
export function parseEmailList(text: string): string[] {
  const parts = text.split(/[\n,]+/).map((part) => part.trim().toLowerCase())
  return [...new Set(parts.filter((part) => part !== ''))]
}

export function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

/** The text a manager typed, or null when it was left blank. */
export function blankToNull(text: string): string | null {
  const cleaned = text.trim()
  return cleaned === '' ? null : cleaned
}
