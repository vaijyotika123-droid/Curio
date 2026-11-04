import React from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export const AppLayout: React.FC = () => {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-viewport">
        <div className="content-container">
          <Outlet />
        </div>
      </main>
    </div>
  )
}