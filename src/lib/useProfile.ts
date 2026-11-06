import { createContext, useContext } from 'react'
import type { Profile } from './profile.ts'

/** The signed-in person's profile, available to every screen. */
export const ProfileContext = createContext<Profile | null>(null)

export function useProfile(): Profile {
  const profile = useContext(ProfileContext)
  if (!profile) throw new Error('useProfile must be used inside the signed-in app')
  return profile
}
