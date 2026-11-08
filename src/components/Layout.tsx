import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { countPendingPurchases, PURCHASES_CHANGED } from '../lib/queries.ts'
import { supabase } from '../lib/supabase.ts'
import { useProfile } from '../lib/useProfile.ts'

/** The frame around every signed-in screen.  The role decides which frame. */
export default function Layout() {
  const profile = useProfile()
  return profile.role === 'manager' ? <ManagerFrame /> : <ArtistFrame />
}

/** Artists: content on top, tabs along the bottom. */
function ArtistFrame() {
  const { pathname } = useLocation()
  // The entry form gets the whole screen so the keyboard never fights the tab bar.
  const hideTabs = /\/entry$/.test(pathname) || pathname.startsWith('/entries/')

  return (
    <div className={hideTabs ? 'app no-tabs' : 'app'}>
      <main className="screen">
        <Outlet />
      </main>
      {!hideTabs && (
        <nav className="tabs" aria-label="Main">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span className="tab-icon" aria-hidden="true">
              ▤
            </span>
            My Work
          </NavLink>
          <NavLink to="/week" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span className="tab-icon" aria-hidden="true">
              ▦
            </span>
            My Week
          </NavLink>
          <NavLink to="/materials" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span className="tab-icon" aria-hidden="true">
              ⬚
            </span>
            Materials
          </NavLink>
        </nav>
      )}
    </div>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'side-link active' : 'side-link')

/**
 * Managers: a sidebar on a desktop browser, a strip across the top on a phone.
 * Managers also log production work, so their own screens stay in the menu.
 */
function ManagerFrame() {
  const { pathname } = useLocation()
  const [signingOut, setSigningOut] = useState(false)
  const [pending, setPending] = useState<number | null>(null)
  const portal = pathname.startsWith('/manage')

  // Read again on every move between screens, so a new submission shows up.
  useEffect(() => {
    let active = true
    const refresh = () => {
      void countPendingPurchases().then((count) => {
        if (active) setPending(count)
      })
    }
    refresh()
    window.addEventListener(PURCHASES_CHANGED, refresh)
    return () => {
      active = false
      window.removeEventListener(PURCHASES_CHANGED, refresh)
    }
  }, [pathname])

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
  }

  return (
    <div className="app manager">
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar-brand">Ignite Tracker</div>
        <p className="sidebar-heading">Manage</p>
        <NavLink to="/manage/dashboard" className={linkClass}>
          Today
        </NavLink>
        <NavLink to="/manage/orders" className={linkClass}>
          Orders
        </NavLink>
        <NavLink to="/manage/designs" className={linkClass}>
          Designs
        </NavLink>
        <NavLink to="/manage/people" className={linkClass}>
          People
        </NavLink>
        <NavLink to="/manage/approvals" className={linkClass}>
          Approvals
          {pending !== null && pending > 0 && (
            <span className="side-count" aria-label={`${pending} waiting`}>
              {pending}
            </span>
          )}
        </NavLink>
        <NavLink to="/manage/reports" className={linkClass}>
          Reports
        </NavLink>
        <NavLink to="/manage/imports" className={linkClass}>
          Imports
        </NavLink>
        <NavLink to="/manage/settings" className={linkClass}>
          Settings
        </NavLink>
        <p className="sidebar-heading">My production work</p>
        <NavLink to="/" end className={linkClass}>
          My Work
        </NavLink>
        <NavLink to="/week" className={linkClass}>
          My Week
        </NavLink>
        <NavLink to="/materials" className={linkClass}>
          Materials
        </NavLink>
        <div className="sidebar-foot">
          <button type="button" className="side-link as-button" onClick={signOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </nav>
      <main className={portal ? 'screen wide' : 'screen'}>
        <Outlet />
      </main>
    </div>
  )
}
