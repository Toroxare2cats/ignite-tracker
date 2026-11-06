import { NavLink, Outlet, useLocation } from 'react-router-dom'

/** The frame around every signed-in screen: content on top, tabs along the bottom. */
export default function Layout() {
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
