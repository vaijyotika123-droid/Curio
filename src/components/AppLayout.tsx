import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export const AppLayout: React.FC = () => {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar />
      <main id="main-content" className="main-viewport" tabIndex={-1}>
        <div className="content-container">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
