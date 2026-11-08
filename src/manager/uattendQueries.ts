/**
 * uAttend imports: the remembered name matches, the import history, and the
 * two database functions that save an upload and fix a match.  All of these
 * tables and functions are manager-only in the database.
 */
import { supabase } from '../lib/supabase.ts'
import { check, friendlyDbMessage } from '../lib/queries.ts'
import type { UattendReport } from './uattend.ts'

export interface UattendName {
  name_key: string
  uattend_name: string
  profile_id: string | null
  edited_at: string | null
  created_at: string
}

export async function loadUattendNames(): Promise<UattendName[]> {
  const rows = check(
    await supabase.from('uattend_names').select('name_key, uattend_name, profile_id, edited_at, created_at').order('uattend_name'),
  )
  return rows as UattendName[]
}

export interface UattendImport {
  id: string
  file_name: string | null
  period_from: string
  period_to: string
  row_count: number | null
  people_count: number | null
  skipped_names: string[]
  missing_punch_days: number
  uploaded_by: string | null
  uploaded_at: string
  /** Days from this upload still in use; 0 once a later upload has replaced them all. */
  days_in_use: number
}

/** Newest first. */
export async function loadImports(): Promise<UattendImport[]> {
  const rows = check(
    await supabase
      .from('uattend_imports')
      .select(
        'id, file_name, period_from, period_to, row_count, people_count, skipped_names, missing_punch_days, uploaded_by, uploaded_at, uattend_days(count)',
      )
      .order('uploaded_at', { ascending: false }),
  ) as (Omit<UattendImport, 'days_in_use'> & { uattend_days: { count: number }[] })[]
  return rows.map(({ uattend_days, ...rest }) => ({ ...rest, days_in_use: uattend_days[0]?.count ?? 0 }))
}

/** One person's choice in the preview: a tracker account's id, or null for "not in the tracker". */
export type Match = string | null

export async function importUattend(fileName: string, report: UattendReport, matches: Map<string, Match>): Promise<UattendImport> {
  const people = report.people.map((p) => ({
    name: p.name,
    profile_id: matches.get(p.name) ?? null,
    days: p.days.map((d) => ({ date: d.date, minutes: d.minutes, missing_punch: d.missingPunch })),
  }))
  const { data, error } = await supabase.rpc('import_uattend', {
    p_file_name: fileName,
    p_period_from: report.periodFrom,
    p_period_to: report.periodTo,
    p_people: people,
  })
  if (error) throw new Error(friendlyDbMessage(error.message))
  return { ...(data as Omit<UattendImport, 'days_in_use'>), days_in_use: (data as { row_count: number }).row_count }
}

export async function setUattendMatch(uattendName: string, profileId: Match): Promise<void> {
  const { error } = await supabase.rpc('set_uattend_match', { p_uattend_name: uattendName, p_profile_id: profileId })
  if (error) throw new Error(friendlyDbMessage(error.message))
}
