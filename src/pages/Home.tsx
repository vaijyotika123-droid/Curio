import React from 'react'
import { PageHeader } from '../components/PageHeader'

export const Home: React.FC = () => {
  return (
    <div className="page-view">
      <PageHeader title="Home" subtitle="Your starting point for what you've saved and learned." />

      <section className="placeholder-container">
        <div className="placeholder-card">
          <h2>Dashboard</h2>
          <p>
            This page will become your overview of Curio. For now, your saved resources live in
            the Library.
          </p>
          <div className="placeholder-badge">Placeholder: the dashboard has not been built yet.</div>
        </div>
      </section>
    </div>
  )
}
