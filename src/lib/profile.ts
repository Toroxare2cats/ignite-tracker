import { supabase } from './supabase.ts'

export type Role = 'artist' | 'manager'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: Role
  active: boolean
  home_screen: string
}

/** The signed-in person's own profile row (row-level security allows only that one). */
export async function loadOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, active, home_screen')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Profile | null) ?? null
}

export function roleLabel(role: Role): string {
  return role === 'manager' ? 'Manager' : 'Artist'
}
