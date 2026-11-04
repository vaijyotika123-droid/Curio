import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const Library: React.FC = () => {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  const displayName = user?.user_metadata?.full_name || user?.email || 'Explorer'

  const handleLogout = async () => {
    try {
      setLoggingOut(true)
      await signOut()
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to log out.'
      setError(msg)
      setLoggingOut(false)
    }
  }

  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="header-brand">
          <h1>Curio</h1>
        </div>
        <div className="header-actions">
          <span className="user-greeting">Welcome, {displayName}</span>
          <button onClick={handleLogout} className="btn-secondary" disabled={loggingOut}>
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <main className="app-content">
        <div className="placeholder-card">
          <h2>Resource Library</h2>
          <p>Your space to explore, understand, and connect ideas.</p>
          <div className="placeholder-notice">
            <p>The Resource Library modules will be built here.</p>
          </div>
        </div>
      </main>
    </div>
  )
}