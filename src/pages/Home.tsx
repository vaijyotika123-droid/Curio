
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../contexts/AuthContext'
import { useTopicData } from '../hooks/useTopicData'
import { supabase } from '../lib/supabase'

interface RecentResource {
  id: string
  title: string
  input_method: 'url' | 'manual_text'
  created_at: string
}

export const Home: React.FC = () => {
  const { user } = useAuth()

  const {
    topics,
    loading: topicsLoading,
    error: topicsError,
    refreshTopics,
  } = useTopicData()

  const [resourceCount, setResourceCount] = useState(0)
  const [recentResources, setRecentResources] = useState<RecentResource[]>([])
  const [resourcesLoading, setResourcesLoading] = useState(true)
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const userId = user?.id

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    const loadDashboardResources = async () => {
      try {
        const [countResult, recentResult] = await Promise.all([
          supabase
            .from('resources')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),

          supabase
            .from('resources')
            .select('id, title, input_method, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5),
        ])

        if (countResult.error) {
          throw countResult.error
        }

        if (recentResult.error) {
          throw recentResult.error
        }

        if (cancelled) return

        setResourceCount(countResult.count ?? 0)
        setRecentResources(
          (recentResult.data ?? []) as RecentResource[]
        )
        setResourcesError(null)
      } catch (err: unknown) {
        if (cancelled) return

        console.error('Error loading dashboard resources:', err)

        setResourcesError(
          'Could not load your resource overview. Please try again.'
        )
      } finally {
        if (!cancelled) {
          setResourcesLoading(false)
        }
      }
    }

    void loadDashboardResources()

    return () => {
      cancelled = true
    }
  }, [userId, reloadKey])

  const handleRetry = () => {
    setResourcesLoading(true)
    setResourcesError(null)
    setReloadKey((previous) => previous + 1)

    void refreshTopics()
  }

  const formatDate = (date: string): string =>
    new Date(date).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })

  return (
    <div className="page-view">
      <PageHeader
        title="Your curiosity, organised."
        subtitle="A little overview of everything you're exploring."
      />

      {/* Quick actions */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginTop: '1.5rem',
        }}
      >
        <Link
          to="/app/library"
          className="btn-primary"
          style={{ textDecoration: 'none' }}
        >
          + Add resource
        </Link>

        <Link
          to="/app/topics"
          className="btn-secondary"
          style={{ textDecoration: 'none' }}
        >
          Create topic
        </Link>
      </div>

      {/* Overview statistics */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginTop: '2rem',
        }}
      >
        <div className="dashboard-stat-card">
          <span className="dashboard-stat-label">
            Saved resources
          </span>

          <strong className="dashboard-stat-value">
            {resourcesLoading ? '—' : resourceCount}
          </strong>

          <span className="dashboard-stat-description">
            Resources in your Library
          </span>
        </div>

        <div className="dashboard-stat-card">
          <span className="dashboard-stat-label">
            Your topics
          </span>

          <strong className="dashboard-stat-value">
            {topicsLoading ? '—' : topics.length}
          </strong>

          <span className="dashboard-stat-description">
            Collections you're exploring
          </span>
        </div>
      </section>

      {/* Recently added resources */}
      <section style={{ marginTop: '2.5rem' }}>
        <div className="dashboard-section-header">
          <div>
            <h2 className="dashboard-section-title">
              Recently added
            </h2>

            <p className="dashboard-section-subtitle">
              Pick up where you left off.
            </p>
          </div>

          <Link
            to="/app/library"
            className="dashboard-section-link"
          >
            View library
          </Link>
        </div>

        {resourcesLoading ? (
          <div className="dashboard-message">
            Loading recent resources...
          </div>
        ) : resourcesError ? (
          <div className="dashboard-message dashboard-error">
            <p>{resourcesError}</p>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleRetry}
            >
              Try again
            </button>
          </div>
        ) : recentResources.length === 0 ? (
          <div className="dashboard-empty">
            <h3>Your library is waiting.</h3>

            <p>
              Save your first resource and it will appear here.
            </p>

            <Link
              to="/app/library"
              className="dashboard-section-link"
            >
              Go to Library
            </Link>
          </div>
        ) : (
          <div className="dashboard-recent-list">
            {recentResources.map((resource) => (
              <div
                key={resource.id}
                className="dashboard-recent-item"
              >
                <div className="dashboard-recent-icon">
                  {resource.input_method === 'url' ? '↗' : '▤'}
                </div>

                <div className="dashboard-recent-info">
                  <strong>
                    {resource.title || 'Untitled Resource'}
                  </strong>

                  <span>
                    {resource.input_method === 'url'
                      ? 'URL resource'
                      : 'Saved note'}
                    {' · '}
                    {formatDate(resource.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Topics overview */}
      <section style={{ marginTop: '2.5rem' }}>
        <div className="dashboard-section-header">
          <div>
            <h2 className="dashboard-section-title">
              Your topics
            </h2>

            <p className="dashboard-section-subtitle">
              Explore the subjects you're collecting ideas around.
            </p>
          </div>

          <Link
            to="/app/topics"
            className="dashboard-section-link"
          >
            View all topics
          </Link>
        </div>

        {topicsLoading ? (
          <div className="dashboard-message">
            Loading your topics...
          </div>
        ) : topicsError ? (
          <div className="dashboard-message dashboard-error">
            <p>{topicsError}</p>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => void refreshTopics()}
            >
              Try again
            </button>
          </div>
        ) : topics.length === 0 ? (
          <div className="dashboard-empty">
            <h3>No topics yet.</h3>

            <p>
              Create a topic to start organising your saved resources.
            </p>

            <Link
              to="/app/topics"
              className="dashboard-section-link"
            >
              Explore topics
            </Link>
          </div>
        ) : (
          <div className="dashboard-topics-list">
            {topics.slice(0, 4).map((topic) => (
              <div
                key={topic.id}
                className="dashboard-topic-item"
              >
                <div>
                  <strong>{topic.name}</strong>

                  {topic.description && (
                    <p>{topic.description}</p>
                  )}
                </div>

                <span className="dashboard-topic-count">
                  {topic.resourceCount}{' '}
                  {topic.resourceCount === 1
                    ? 'resource'
                    : 'resources'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
