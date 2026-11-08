/**
 * The screens a manager can choose to open the app on.  The Dashboard joins
 * this list when it is built; until then anyone whose saved choice is
 * 'dashboard' (the account default) opens on Orders, and picks up the
 * Dashboard automatically once it exists.
 */
export const LANDING_SCREENS = [
  { value: 'orders', label: 'Orders', path: '/manage/orders' },
  { value: 'designs', label: 'Designs', path: '/manage/designs' },
  { value: 'people', label: 'People', path: '/manage/people' },
  { value: 'approvals', label: 'Approvals', path: '/manage/approvals' },
  { value: 'my-work', label: 'My Work', path: '/' },
]

const FALLBACK = LANDING_SCREENS[0]

function screenFor(stored: string) {
  return LANDING_SCREENS.find((screen) => screen.value === stored) ?? FALLBACK
}

/** The choice to show in Settings for what is saved on the account. */
export function landingValue(stored: string): string {
  return screenFor(stored).value
}

export function landingPath(stored: string): string {
  return screenFor(stored).path
}

/*
 * The landing screen applies once each time the app is opened.  This note
 * lives only as long as the tab or installed app stays open, so a refresh
 * while on My Work stays on My Work.  Storage can be blocked (private
 * browsing), and then the worst case is landing again after a refresh.
 */
const OPENED = 'ignite-app-opened'

export function appAlreadyOpened(): boolean {
  try {
    return sessionStorage.getItem(OPENED) === '1'
  } catch {
    return false
  }
}

export function markAppOpened(): void {
  try {
    sessionStorage.setItem(OPENED, '1')
  } catch {
    // See above.
  }
}

/** After signing out, the next sign-in starts at the front door. */
export function resetToFrontDoor(): void {
  try {
    sessionStorage.removeItem(OPENED)
  } catch {
    // See above.
  }
  window.history.replaceState(null, '', '/')
}
