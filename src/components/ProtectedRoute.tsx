import React from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export const ProtectedRoute: React.FC = () => {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading">
        <p>Loading session...</p>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

export const PublicOnlyRoute: React.FC = () => {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="auth-loading">
        <p>Loading session...</p>
      </div>
    )
  }

  if (session) {
    return <Navigate to="/app/library" replace />
  }

  return <Outlet />
}