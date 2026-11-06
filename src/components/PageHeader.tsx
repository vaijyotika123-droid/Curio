import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  /** Optional page-level actions (buttons) shown on the right on wider screens. */
  actions?: React.ReactNode
}

/**
 * Standard heading block for every page inside the app shell.
 * It renders the same markup/classes the Library page already uses,
 * so existing pages keep looking identical.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => {
  return (
    <header className="page-header">
      <div className="header-titles">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}
