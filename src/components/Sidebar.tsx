import React, { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { CloseIcon, ConnectIcon, HomeIcon, LibraryIcon, MenuIcon, TopicsIcon } from './icons'

type IconComponent = React.FC<React.SVGProps<SVGSVGElement>>

interface NavDestination {
  to: string
  label: string
  Icon: IconComponent
}

interface NavSection {
  id: string
  title: string
  items: NavDestination[]
}

// Local icons for Challenge and Apply, drawn in the same style as ./icons
// (24x24 grid, 1.6 stroke, inherits colour via currentColor).
const SvgIcon: IconComponent = ({ children, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
)

// Challenge: a target
const ChallengeIcon: IconComponent = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.2" />
  </SvgIcon>
)

// Apply: an arrow heading out of a box (turning insight into output)
const ApplyIcon: IconComponent = (props) => (
  <SvgIcon {...props}>
    <path d="M13 5h6v6" />
    <path d="M19 5 10.5 13.5" />
    <path d="M17 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
  </SvgIcon>
)

// Single source of truth for the sidebar, grouped under section headings.
// Adding a destination later = adding one line to a section's items.
const NAV_SECTIONS: NavSection[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    items: [
      { to: '/app/home', label: 'Home', Icon: HomeIcon },
      { to: '/app/library', label: 'Resource Library', Icon: LibraryIcon },
      { to: '/app/topics', label: 'Topics', Icon: TopicsIcon },
    ],
  },
  {
    id: 'thinking-space',
    title: 'Thinking Space',
    items: [
      { to: '/app/connect', label: 'Connect', Icon: ConnectIcon },
      { to: '/app/challenge', label: 'Challenge', Icon: ChallengeIcon },
      { to: '/app/apply', label: 'Apply', Icon: ApplyIcon },
    ],
  },
]

// Section styling is inline because App.css has no .nav-section rules.
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.725rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  padding: '0.5rem 0.75rem',
}

// Must match the mobile breakpoint in App.css (max-width: 768px).
const DESKTOP_QUERY = '(min-width: 769px)'

export const Sidebar: React.FC = () => {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const fullName: string | undefined = user?.user_metadata?.full_name
  const displayName = fullName || user?.email || 'Explorer'
  const userInitial = displayName.charAt(0).toUpperCase()

  const handleLogout = async () => {
    try {
      setLoggingOut(true)
      await signOut()
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      console.error('Logout error:', err)
      setLoggingOut(false)
    }
  }

  const closeMobile = () => setMobileOpen(false)

  // Close the mobile drawer with the Escape key, and when the screen grows to desktop width.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    const mediaQuery = window.matchMedia(DESKTOP_QUERY)
    const handleBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    mediaQuery.addEventListener('change', handleBreakpointChange)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      mediaQuery.removeEventListener('change', handleBreakpointChange)
    }
  }, [])

  return (
    <>
      {/* Mobile top bar (hidden on desktop/tablet via CSS) */}
      <header className="mobile-header">
        <Link to="/app/home" className="brand-link" onClick={closeMobile}>
          <span className="brand-mark">C</span>
          <span className="brand-title">Curio</span>
        </Link>
        <button
          type="button"
          className="mobile-toggle-btn"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
        >
          {mobileOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* Backdrop behind the mobile drawer */}
      {mobileOpen && <div className="sidebar-backdrop" onClick={closeMobile} aria-hidden="true" />}

      <aside id="app-sidebar" className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <Link to="/app/home" className="brand-link">
            <span className="brand-mark">C</span>
            <span className="brand-title">Curio</span>
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_SECTIONS.map((section, index) => (
            <div
              key={section.id}
              className="nav-section"
              role="group"
              aria-labelledby={`nav-section-${section.id}`}
              style={{ ...sectionStyle, marginTop: index === 0 ? 0 : '1.5rem' }}
            >
              <span
                id={`nav-section-${section.id}`}
                className="nav-section-title"
                style={sectionTitleStyle}
              >
                {section.title}
              </span>
              {section.items.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={closeMobile}
                >
                  <Icon className="nav-icon" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar" aria-hidden="true">
              {userInitial}
            </div>
            <div className="user-info">
              <span className="user-name" title={displayName}>
                {displayName}
              </span>
              {fullName && user?.email && (
                <span className="user-email" title={user.email}>
                  {user.email}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="btn-logout"
            disabled={loggingOut}
            title="Log out"
          >
            {loggingOut ? '...' : 'Log Out'}
          </button>
        </div>
      </aside>
    </>
  )
}