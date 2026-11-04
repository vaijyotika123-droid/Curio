import React from 'react'

export const Topics: React.FC = () => {
  return (
    <div className="page-view">
      <header className="page-header">
        <div className="header-titles">
          <h1 className="page-title">Topics</h1>
          <p className="page-subtitle">Group saved knowledge into thematic structures.</p>
        </div>
      </header>

      <section className="placeholder-container">
        <div className="placeholder-card">
          <h2>Organise by Domain</h2>
          <p>
            Topics help you structure saved resources into coherent subject areas, enabling cross-cutting synthesis across articles, notes, and research.
          </p>
          <div className="placeholder-badge">Topic grouping and taxonomy management coming soon.</div>
        </div>
      </section>
    </div>
  )
}