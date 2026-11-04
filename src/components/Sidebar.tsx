import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const Sidebar: React.FC = () => {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const displayName = user?.user_metadata?.full_name || user?.email || 'Explorer'
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

  return (
    <>
      {/* Mobile top bar & menu toggle */}
      <div className="mobile-header">
        <div className="brand-heading">
          <span className="brand-mark">C</span>
          <span className="brand-title">Curio</span>
        </div>
        <button
          className="mobile-toggle-btn"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle Navigation Menu"
        >
          <span className="hamburger-icon" />
        </button>
      </div>

      {/* Backdrop overlay for mobile */}
      {mobileOpen && <div className="sidebar-backdrop" onClick={closeMobile} />}

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-mark">C</span>
          <span className="brand-title">Curio</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <span className="nav-section-title">Workspace</span>
            <NavLink
              to="/app/library"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-icon text-icon">R</span>
              <span>Resource Library</span>
            </NavLink>
            <NavLink
              to="/app/topics"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-icon text-icon">T</span>
              <span>Topics</span>
            </NavLink>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Thinking Space</span>
            <NavLink
              to="/app/connect"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-icon text-icon">C</span>
              <span>Connect</span>
            </NavLink>
            <NavLink
              to="/app/challenge"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-icon text-icon">CH</span>
              <span>Challenge</span>
            </NavLink>
            <NavLink
              to="/app/apply"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="nav-icon text-icon">A</span>
              <span>Apply</span>
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">{userInitial}</div>
            <div className="user-info">
              <span className="user-name" title={displayName}>
                {displayName}
              </span>
              <span className="user-role">Member</span>
            </div>
          </div>
          <button
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