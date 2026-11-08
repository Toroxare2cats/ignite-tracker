import { supabase } from '../lib/supabase.ts'

export interface CalendarStatus {
  status: 'disconnected' | 'connected' | 'error'
  account_email: string | null
  last_sync_at: string | null
  last_error: string | null
}

/** The Google Calendar connection's status (never the key).  Managers only. */
export async function loadCalendarStatus(): Promise<CalendarStatus | null> {
  const { data, error } = await supabase.from('calendar_connection').select('status, account_email, last_sync_at, last_error').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as CalendarStatus | null) ?? null
}
