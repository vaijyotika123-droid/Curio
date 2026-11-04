import React from 'react'

export const Connect: React.FC = () => {
  return (
    <div className="page-view">
      <header className="page-header">
        <div className="header-titles">
          <h1 className="page-title">Connect</h1>
          <p className="page-subtitle">Synthesise connections across your saved resources.</p>
        </div>
      </header>

      <section className="placeholder-container">
        <div className="placeholder-card">
          <h2>Knowledge Intelligence & Graphing</h2>
          <p>
            Discover non-obvious relationships, overlapping concepts, and recurring themes across your saved library.
          </p>
          <div className="placeholder-badge">Knowledge graphing and synthesis tools coming soon.</div>
        </div>
      </section>
    </div>
  )
}