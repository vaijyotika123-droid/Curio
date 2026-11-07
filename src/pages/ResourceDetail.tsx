
import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  fetchTopics,
  fetchResourceTopicLinks,
} from '../lib/topics'
import {
  EditResourceModal,
  type EditableResource,
} from '../components/EditResourceModal'

interface ResourceDetailData extends EditableResource {
  created_at: string
}

export const ResourceDetail: React.FC = () => {
  const { resourceId } = useParams<{ resourceId: string }>()
  const navigate = useNavigate()

  const [resource, setResource] = useState<ResourceDetailData | null>(null)
  const [contentText, setContentText] = useState<string | null>(null)
  const [assignedTopics, setAssignedTopics] = useState<string[]>([])
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

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          throw new Error('Your session could not be verified. Please sign in again.')
        }

        const [resourceResult, topicData, resourceTopicLinks] =
          await Promise.all([
            supabase
              .from('resources')
              .select('id, title, input_method, source_url, created_at')
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
