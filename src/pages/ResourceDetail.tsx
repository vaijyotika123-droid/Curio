
import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ResourceQuiz } from '../components/ResourceQuiz'
import {
  fetchTopics,
  fetchResourceTopicLinks,
} from '../lib/topics'
import {
  EditResourceModal,
  type EditableResource,
} from '../components/EditResourceModal'

interface ResourceOverview {
  quickOverview: string
  detailedSummary: string
  keyTakeaways: string[]
  evidence: {
    claim: string
    sourceExcerpt: string
  }[]
}

interface ResourceDetailData extends EditableResource {
  created_at: string
  ai_analysis_status: string | null
}

const POLL_INTERVAL_MS = 5000

export const ResourceDetail: React.FC = () => {
  const { resourceId } = useParams<{ resourceId: string }>()
  const navigate = useNavigate()

  const [resource, setResource] = useState<ResourceDetailData | null>(null)
  const [contentText, setContentText] = useState<string | null>(null)
  const [assignedTopics, setAssignedTopics] = useState<string[]>([])
  const [aiOverview, setAiOverview] = useState<ResourceOverview | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [isEditing, setIsEditing] = useState(false)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadResource = async () => {
      if (!resourceId) {
        setError('Resource not found.')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      setAiError(null)
      setAiOverview(null)

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          throw new Error(
            'Your session could not be verified. Please sign in again.'
          )
        }

        const [resourceResult, topicData, resourceTopicLinks] =
          await Promise.all([
            supabase
              .from('resources')
              .select(
                'id, title, input_method, source_url, created_at, ai_analysis_status'
              )
              .eq('id', resourceId)
              .eq('user_id', user.id)
              .maybeSingle(),
            fetchTopics(user.id),
            fetchResourceTopicLinks(user.id),
          ])

        const { data: resourceData, error: resourceError } = resourceResult

        if (resourceError) {
          throw new Error(resourceError.message)
        }

        if (!resourceData) {
          throw new Error('This resource could not be found in your library.')
        }

        const typedResource = resourceData as ResourceDetailData

        let savedContent: string | null = null

        if (typedResource.input_method === 'manual_text') {
          const { data: contentData, error: contentError } = await supabase
            .from('resource_contents')
            .select('content_text, content_version')
            .eq('resource_id', typedResource.id)
            .eq('user_id', user.id)
            .order('content_version', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (contentError) {
            throw new Error('Unable to load this resource’s saved content.')
          }

          if (!contentData) {
            throw new Error('The saved content for this note could not be found.')
          }

          savedContent = contentData.content_text
        }

        const { data: outputLinks, error: linkError } = await supabase
          .from('ai_output_resources')
          .select('output_id')
          .eq('resource_id', typedResource.id)
          .eq('user_id', user.id)

        let overview: ResourceOverview | null = null

        if (linkError) {
          console.error('Error loading AI output links:', linkError)
          if (!cancelled) {
            setAiError('Unable to load the AI overview. Please try again.')
          }
        } else if (outputLinks && outputLinks.length > 0) {
          const outputIds = outputLinks.map((link) => link.output_id)

          const { data: outputData, error: outputError } = await supabase
            .from('ai_outputs')
            .select('output_data, created_at')
            .in('id', outputIds)
            .eq('user_id', user.id)
            .eq('feature_type', 'overview')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (outputError) {
            console.error('Error loading AI overview:', outputError)
            if (!cancelled) {
              setAiError('Unable to load the AI overview. Please try again.')
            }
          } else if (outputData?.output_data) {
            overview = outputData.output_data as ResourceOverview
          }
        }

        const topicNamesById = new Map(
          topicData.map((topic) => [topic.id, topic.name])
        )

        const resourceTopicNames = resourceTopicLinks
          .filter((link) => link.resource_id === typedResource.id)
          .map((link) => topicNamesById.get(link.topic_id))
          .filter((name): name is string => Boolean(name))

        if (cancelled) return

        setResource(typedResource)
        setContentText(savedContent)
        setAssignedTopics(resourceTopicNames)
        setAiOverview(overview)
      } catch (err: unknown) {
        if (cancelled) return

        console.error('Error loading resource detail:', err)
        setError(
          err instanceof Error
            ? err.message
            : 'Something went wrong while loading this resource.'
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadResource()

    return () => {
      cancelled = true
    }
  }, [resourceId, reloadKey])

  useEffect(() => {
    if (
      !resourceId ||
      !resource ||
      aiOverview ||
      aiError ||
      resource.ai_analysis_status === 'failed'
    ) {
      return
    }

    let cancelled = false
    let polling = false

    const pollAiOverview = async () => {
      if (polling || cancelled) return

      polling = true

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user || cancelled) return

        const { data: resourceStatus, error: statusError } = await supabase
          .from('resources')
          .select('ai_analysis_status')
          .eq('id', resourceId)
          .eq('user_id', user.id)
          .maybeSingle()

        if (statusError) {
          throw statusError
        }

        if (!resourceStatus || cancelled) return

        const nextStatus = resourceStatus.ai_analysis_status

        if (nextStatus !== resource.ai_analysis_status) {
          setResource((current) =>
            current
              ? { ...current, ai_analysis_status: nextStatus }
              : current
          )
        }

        if (nextStatus !== 'completed') return

        const { data: outputLinks, error: linkError } = await supabase
          .from('ai_output_resources')
          .select('output_id')
          .eq('resource_id', resourceId)
          .eq('user_id', user.id)

        if (linkError) {
          throw linkError
        }

        if (!outputLinks || outputLinks.length === 0) return

        const outputIds = outputLinks.map((link) => link.output_id)

        const { data: outputData, error: outputError } = await supabase
          .from('ai_outputs')
          .select('output_data, created_at')
          .in('id', outputIds)
          .eq('user_id', user.id)
          .eq('feature_type', 'overview')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (outputError) {
          throw outputError
        }

        if (cancelled) return

        if (outputData?.output_data) {
          setAiOverview(outputData.output_data as ResourceOverview)
          setAiError(null)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          console.error('Error checking AI overview status:', err)
        }
      } finally {
        polling = false
      }
    }

    // Check immediately, then continue polling every five seconds.
    void pollAiOverview()

    const intervalId = window.setInterval(() => {
      void pollAiOverview()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [resourceId, resource, aiOverview, aiError])

  const handleResourceSaved = () => {
    setIsEditing(false)
    setReloadKey((currentKey) => currentKey + 1)
  }

  const handleDeleteResource = async () => {
    if (!resource || deleting) return

    setDeleting(true)
    setDeleteError(null)

    try {
      const { data, error: deleteQueryError } = await supabase.rpc(
        'delete_resource',
        {
          p_resource_id: resource.id,
        }
      )

      if (deleteQueryError) {
        throw deleteQueryError
      }

      if (!data) {
        throw new Error(
          "Resource not found or you don't have permission to delete it."
        )
      }

      navigate('/app/library', {
        replace: true,
        state: { message: 'Resource deleted successfully.' },
      })
    } catch (err: unknown) {
      console.error('Error deleting resource:', err)
      setDeleteError(
        err instanceof Error
          ? err.message
          : 'Unable to delete this resource. Please try again.'
      )
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="page-view">
        <div
          className="loading-state"
          style={{ padding: '3rem', textAlign: 'center' }}
        >
          <p>Loading resource...</p>
        </div>
      </div>
    )
  }

  if (error || !resource) {
    return (
      <div className="page-view">
        <Link
          to="/app/library"
          style={{
            display: 'inline-block',
            marginBottom: '1.5rem',
            color: '#2563eb',
            textDecoration: 'none',
          }}
        >
          ← Back to Library
        </Link>

        <div className="error-state" role="alert">
          <h2>Unable to open resource</h2>
          <p>{error || 'This resource could not be found.'}</p>
          <button
            className="btn-secondary"
            onClick={() => setReloadKey((currentKey) => currentKey + 1)}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-view">
      <Link
        to="/app/library"
        style={{
          display: 'inline-block',
          marginBottom: '1.5rem',
          color: '#2563eb',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        ← Back to Library
      </Link>

      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '1.75rem',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
              }}
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '999px',
                  backgroundColor:
                    resource.input_method === 'url' ? '#eff6ff' : '#f0fdf4',
                  color:
                    resource.input_method === 'url' ? '#1d4ed8' : '#15803d',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                {resource.input_method === 'url' ? 'URL Resource' : 'Manual Note'}
              </span>

              <span style={{ color: '#64748b', fontSize: '0.8125rem' }}>
                Saved on {new Date(resource.created_at).toLocaleDateString()}
              </span>
            </div>

            <h1
              className="page-title"
              style={{
                fontSize: 'clamp(1.5rem, 4vw, 2rem)',
                lineHeight: 1.3,
                overflowWrap: 'anywhere',
              }}
            >
              {resource.title || 'Untitled Resource'}
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              className="btn-secondary"
              onClick={() => setIsEditing(true)}
            >
              Edit
            </button>

            <button
              type="button"
              onClick={() => {
                setDeleteError(null)
                setShowDeleteConfirmation(true)
              }}
              style={{
                padding: '0.65rem 1rem',
                border: '1px solid #fecaca',
                borderRadius: '0.375rem',
                backgroundColor: '#fff',
                color: '#dc2626',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Delete
            </button>
          </div>
        </header>

        {/* AI Overview — primary learning experience */}
        <section
          aria-label="AI Overview"
          style={{
            border: '1px solid #c7d2fe',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            backgroundColor: '#fff',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap',
              marginBottom: '1.25rem',
            }}
          >
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>
              AI Overview
            </h2>

            <span
              role="status"
              style={{
                fontSize: '0.75rem',
                color: '#475569',
                backgroundColor: '#f1f5f9',
                padding: '0.3rem 0.65rem',
                borderRadius: '999px',
                fontWeight: 600,
              }}
            >
              {aiOverview
                ? 'Ready'
                : resource.ai_analysis_status === 'completed'
                  ? 'Preparing overview'
                  : resource.ai_analysis_status === 'processing'
                    ? 'Generating'
                    : resource.ai_analysis_status === 'queued' ||
                        resource.ai_analysis_status === 'pending'
                      ? 'Queued'
                      : resource.ai_analysis_status === 'failed'
                        ? 'Failed'
                        : 'Not available'}
            </span>
          </div>

          {aiError ? (
            <p role="alert" style={{ color: '#b91c1c', lineHeight: 1.6 }}>
              {aiError}
            </p>
          ) : aiOverview ? (
            <>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>
                Quick overview
              </h3>

              <p
                style={{
                  color: '#334155',
                  lineHeight: 1.8,
                  margin: '0 0 1.25rem',
                }}
              >
                {aiOverview.quickOverview}
              </p>

              <details
                style={{
                  borderTop: '1px solid #e2e8f0',
                  paddingTop: '1rem',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    color: '#4f46e5',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                >
                  Explore detailed analysis
                </summary>

                <div style={{ paddingTop: '1.25rem' }}>
                  <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>
                    Detailed summary
                  </h3>

                  <p
                    style={{
                      color: '#334155',
                      lineHeight: 1.8,
                      whiteSpace: 'pre-wrap',
                      margin: '0 0 1.5rem',
                    }}
                  >
                    {aiOverview.detailedSummary}
                  </p>

                  <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.75rem' }}>
                    Key takeaways
                  </h3>

                  <ul
                    style={{
                      color: '#334155',
                      lineHeight: 1.8,
                      paddingLeft: '1.25rem',
                      margin: '0 0 1.5rem',
                    }}
                  >
                    {aiOverview.keyTakeaways.map((takeaway, index) => (
                      <li key={index} style={{ marginBottom: '0.5rem' }}>
                        {takeaway}
                      </li>
                    ))}
                  </ul>

                  {aiOverview.evidence?.length > 0 && (
                    <>
                      <h3
                        style={{
                          fontSize: '0.95rem',
                          margin: '0 0 0.75rem',
                        }}
                      >
                        Source evidence
                      </h3>

                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        {aiOverview.evidence.map((item, index) => (
                          <div
                            key={index}
                            style={{
                              padding: '0.875rem',
                              borderRadius: '0.5rem',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            <p
                              style={{
                                margin: '0 0 0.5rem',
                                color: '#334155',
                                fontWeight: 600,
                                lineHeight: 1.6,
                              }}
                            >
                              {item.claim}
                            </p>

                            <p
                              style={{
                                margin: 0,
                                color: '#64748b',
                                fontSize: '0.875rem',
                                lineHeight: 1.7,
                              }}
                            >
                              "{item.sourceExcerpt}"
                            </p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </details>
            </>
          ) : (
            <p style={{ color: '#64748b', lineHeight: 1.7, margin: 0 }}>
              {resource.ai_analysis_status === 'processing'
                ? 'Curio is analysing your resource and preparing its key insights. Your overview will appear here automatically. You can explore the quiz below while you wait.'
                : resource.ai_analysis_status === 'queued' ||
                    resource.ai_analysis_status === 'pending'
                  ? 'Your resource is in the analysis queue. Curio will prepare your overview automatically. In the meantime, you can try the quiz below.'
                  : resource.ai_analysis_status === 'completed'
                    ? 'Your analysis is complete. Loading your overview...'
                    : resource.ai_analysis_status === 'failed'
                      ? 'Curio could not generate an overview for this resource.'
                      : 'An AI overview is not available for this resource yet.'}
            </p>
          )}
        </section>

        {/* Quiz — independent secondary learning activity */}
        <section
          aria-label="Test your understanding"
          style={{ marginBottom: '1.25rem' }}
        >
          <div style={{ marginBottom: '0.875rem' }}>
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 700,
                margin: '0 0 0.375rem',
              }}
            >
              Test your understanding
            </h2>

            <p
              style={{
                color: '#64748b',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Already familiar with this resource? Take a quiz to check
              what you've learned. You don't need to wait for the AI overview.
            </p>
          </div>

          <ResourceQuiz resourceId={resource.id} />
        </section>

        {/* Original source content */}
        <section
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            backgroundColor: '#fff',
            marginBottom: '1.25rem',
          }}
        >
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              margin: '0 0 1rem',
            }}
          >
            {resource.input_method === 'url' ? 'Source' : 'Saved content'}
          </h2>

          {resource.input_method === 'url' ? (
            resource.source_url ? (
              <a
                href={resource.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#2563eb',
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                  overflowWrap: 'anywhere',
                }}
              >
                {resource.source_url}
              </a>
            ) : (
              <p style={{ color: '#64748b', margin: 0 }}>
                No source URL is available.
              </p>
            )
          ) : (
            <div
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                color: '#334155',
                fontSize: '0.9375rem',
                lineHeight: 1.8,
              }}
            >
              {contentText}
            </div>
          )}
        </section>

        {/* Assigned topics */}
        <section
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: '0.75rem',
            padding: '1.25rem',
            backgroundColor: '#fff',
          }}
        >
          <h2
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              margin: '0 0 1rem',
            }}
          >
            Assigned topics
          </h2>

          {assignedTopics.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {assignedTopics.map((topicName) => (
                <span
                  key={topicName}
                  style={{
                    display: 'inline-block',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '999px',
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                  }}
                >
                  {topicName}
                </span>
              ))}
            </div>
          ) : (
            <p
              style={{
                color: '#94a3b8',
                fontSize: '0.875rem',
                fontStyle: 'italic',
                margin: 0,
              }}
            >
              This resource hasn't been assigned to a topic yet.
            </p>
          )}
        </section>
      </div>

      {isEditing && (
        <EditResourceModal
          key={resource.id}
          resource={resource}
          onClose={() => setIsEditing(false)}
          onSaved={handleResourceSaved}
        />
      )}

      {showDeleteConfirmation && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) setShowDeleteConfirmation(false)
          }}
          style={{ zIndex: 1000 }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-detail-title"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: '440px', width: '90%' }}
          >
            <div className="modal-header">
              <h3 id="delete-detail-title">Delete resource?</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={deleting}
                aria-label="Close confirmation"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <p>
                Are you sure you want to delete{' '}
                <strong>{resource.title || 'Untitled Resource'}</strong>?
              </p>
              <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                This permanently deletes the resource and its associated
                content and topic associations. This action cannot be undone.
              </p>

              {deleteError && (
                <p
                  role="alert"
                  style={{ color: '#b91c1c', fontSize: '0.875rem' }}
                >
                  {deleteError}
                </p>
              )}
            </div>

            <div
              className="modal-footer"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={deleting}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleDeleteResource}
                disabled={deleting}
                style={{
                  backgroundColor: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.375rem',
                  padding: '0.65rem 1rem',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                  opacity: deleting ? 0.65 : 1,
                  fontWeight: 500,
                }}
              >
                {deleting ? 'Deleting...' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
