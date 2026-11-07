
import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  fetchTopics,
  fetchResourceTopicLinks,
} from '../lib/topics'
import { AddResourceModal } from '../components/AddResourceModal'
import { EditResourceModal } from '../components/EditResourceModal'

interface Resource {
  id: string
  title: string
  input_method: 'url' | 'manual_text'
  source_url: string | null
  created_at: string
}

type ResourceFilter = 'all' | 'url' | 'manual_text'

export const Library: React.FC = () => {
  const navigate = useNavigate()

  const [activeModal, setActiveModal] = useState<'resource' | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [resourceTopics, setResourceTopics] = useState<Record<string, string[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [searchQuery, setSearchQuery] = useState('')
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all')

  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [openMenuResourceId, setOpenMenuResourceId] = useState<string | null>(null)

  const [resourceToEdit, setResourceToEdit] = useState<Resource | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const fetchLibraryData = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError || !user) {
          throw new Error('User not authenticated.')
        }

        const [resourceResult, topicData, resourceTopicLinks] =
          await Promise.all([
            supabase
              .from('resources')
              .select('id, title, input_method, source_url, created_at')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false }),
            fetchTopics(user.id),
            fetchResourceTopicLinks(user.id),
          ])

        const { data: resourceData, error: resourceError } = resourceResult

        if (resourceError) throw resourceError

        const topicNamesById = new Map(
          topicData.map((topic) => [topic.id, topic.name])
        )

        const topicsByResource: Record<string, string[]> = {}

        resourceTopicLinks.forEach((link) => {
          const topicName = topicNamesById.get(link.topic_id)
          if (!topicName) return

          if (!topicsByResource[link.resource_id]) {
            topicsByResource[link.resource_id] = []
          }

          topicsByResource[link.resource_id].push(topicName)
        })

        if (isMounted) {
          setResources((resourceData || []) as Resource[])
          setResourceTopics(topicsByResource)
          setError(null)
        }
      } catch (err: unknown) {
        if (isMounted) {
          console.error('Error loading library data:', err)
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to fetch library data.'
          )
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
          setIsRefreshing(false)
        }
      }
    }

    void fetchLibraryData()

    return () => {
      isMounted = false
    }
  }, [reloadKey])

  const handleRefreshResources = () => {
    setError(null)
    setIsRefreshing(true)
    setReloadKey((currentKey) => currentKey + 1)
  }

  useEffect(() => {
    if (!successMessage) return

    const timeoutId = window.setTimeout(
      () => setSuccessMessage(null),
      4000
    )

    return () => window.clearTimeout(timeoutId)
  }, [successMessage])

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()

  const filteredResources = resources.filter((resource) => {
    const matchesSearch = (resource.title || '')
      .toLowerCase()
      .includes(normalizedSearchQuery)

    const matchesType =
      resourceFilter === 'all' ||
      resource.input_method === resourceFilter

    return matchesSearch && matchesType
  })

  const openEditResource = (resource: Resource) => {
    setResourceToEdit(resource)
    setOpenMenuResourceId(null)
  }

  const handleResourceSaved = (updated: { id: string; title: string }) => {
    setResources((currentResources) =>
      currentResources.map((resource) =>
        resource.id === updated.id
          ? { ...resource, title: updated.title }
          : resource
      )
    )

    setResourceToEdit(null)
    setSuccessMessage('Resource updated.')
  }

  const confirmDeleteResource = (resource: Resource) => {
    setResourceToDelete(resource)
    setDeleteError(null)
    setOpenMenuResourceId(null)
  }

  const handleDeleteResource = async () => {
    if (!resourceToDelete || deleting) return

    setDeleting(true)
    setDeleteError(null)

    try {
      const { data, error: deleteQueryError } = await supabase.rpc(
        'delete_resource',
        { p_resource_id: resourceToDelete.id }
      )

      if (deleteQueryError) throw deleteQueryError

      if (!data) {
        throw new Error(
          "Resource not found or you don't have permission to delete it."
        )
      }

      setResources((currentResources) =>
        currentResources.filter(
          (resource) => resource.id !== resourceToDelete.id
        )
      )

      setResourceTopics((currentTopics) => {
        const updatedTopics = { ...currentTopics }
        delete updatedTopics[resourceToDelete.id]
        return updatedTopics
      })

      setResourceToDelete(null)
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

  return (
    <div className="page-view">
      <header className="page-header">
        <div className="header-titles">
          <h1 className="page-title">Your curiosity, organised.</h1>
          <p className="page-subtitle">
            Save resources, explore ideas and discover connections.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="btn-secondary"
            onClick={() => navigate('/app/topics')}
          >
            Create topic
          </button>

          <button
            className="btn-primary"
            onClick={() => setActiveModal('resource')}
          >
            Add resource
          </button>
        </div>
      </header>

      <section className="library-content" style={{ marginTop: '2rem' }}>
        {successMessage && (
          <div
            className="auth-info-alert"
            role="status"
            style={{ marginBottom: '1.25rem' }}
          >
            {successMessage}
          </div>
        )}

        {isRefreshing && (
          <div
            className="dashboard-message"
            role="status"
            style={{ marginBottom: '1rem' }}
          >
            Refreshing your resources...
          </div>
        )}

        {isLoading ? (
          <div
            className="loading-state"
            style={{
              textAlign: 'center',
              padding: '3rem',
              color: '#64748b',
            }}
          >
            <p>Loading your resources...</p>
          </div>
        ) : (
          <>
            {error && (
              <div
                className="error-state"
                role="alert"
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                  marginBottom: '1rem',
                }}
              >
                <p>Error loading library: {error}</p>
                <button
                  className="btn-secondary"
                  onClick={handleRefreshResources}
                  style={{ marginTop: '0.5rem' }}
                >
                  Try again
                </button>
              </div>
            )}

            {resources.length === 0 ? (
              !error && (
                <div className="empty-state">
                  <div className="empty-icon-wrapper">
                    <span className="empty-symbol">✦</span>
                  </div>
                  <h2 className="empty-heading">Your library is waiting.</h2>
                  <p className="empty-body">
                    Resources you save will appear here.
                  </p>
                </div>
              )
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                    maxWidth: '480px',
                  }}
                >
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search resources by title..."
                    aria-label="Search resources by title"
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0.5rem',
                      fontSize: '0.875rem',
                      backgroundColor: '#fff',
                      color: '#1e293b',
                    }}
                  />

                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="btn-secondary"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {[
                    { label: 'All', value: 'all' as const },
                    { label: 'URLs', value: 'url' as const },
                    { label: 'Notes', value: 'manual_text' as const },
                  ].map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      onClick={() => setResourceFilter(filter.value)}
                      aria-pressed={resourceFilter === filter.value}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '999px',
                        border: '1px solid #e2e8f0',
                        backgroundColor:
                          resourceFilter === filter.value ? '#1e293b' : '#fff',
                        color:
                          resourceFilter === filter.value ? '#fff' : '#475569',
                        cursor: 'pointer',
                        fontSize: '0.8125rem',
                        fontWeight: 500,
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <p
                  style={{
                    fontSize: '0.8125rem',
                    color: '#64748b',
                    marginBottom: '1rem',
                  }}
                >
                  {normalizedSearchQuery || resourceFilter !== 'all'
                    ? `${filteredResources.length} of ${resources.length} resources`
                    : `${resources.length} ${resources.length === 1 ? 'resource' : 'resources'}`}
                </p>

                {filteredResources.length === 0 ? (
                  <div className="empty-state">
                    <h2 className="empty-heading">
                      No matching resources found.
                    </h2>
                    <p className="empty-body">
                      Try changing your search or selecting a different filter.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        setSearchQuery('')
                        setResourceFilter('all')
                      }}
                      style={{ marginTop: '1rem' }}
                    >
                      Clear search and filters
                    </button>
                  </div>
                ) : (
                  <div
                    className="resources-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                      gap: '1.25rem',
                    }}
                  >
                    {filteredResources.map((resource) => {
                      const assignedTopics = resourceTopics[resource.id] || []

                      return (
                        <div
                          key={resource.id}
                          className="resource-card"
                          style={{
                            position: 'relative',
                            padding: '1.25rem',
                            borderRadius: '0.75rem',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#fff',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: '0.75rem',
                            }}
                          >
                            <h3
                              style={{
                                fontSize: '1rem',
                                fontWeight: 600,
                                margin: 0,
                                wordBreak: 'break-word',
                                flex: 1,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  navigate(`/app/library/${resource.id}`)
                                }
                                style={{
                                  border: 'none',
                                  padding: 0,
                                  background: 'transparent',
                                  color: '#1e293b',
                                  font: 'inherit',
                                  fontWeight: 'inherit',
                                  textAlign: 'left',
                                  cursor: 'pointer',
                                  lineHeight: 'inherit',
                                }}
                              >
                                {resource.title || 'Untitled Resource'}
                              </button>
                            </h3>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                flexShrink: 0,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.125rem 0.5rem',
                                  borderRadius: '9999px',
                                  backgroundColor:
                                    resource.input_method === 'url'
                                      ? '#eff6ff'
                                      : '#f0fdf4',
                                  color:
                                    resource.input_method === 'url'
                                      ? '#1d4ed8'
                                      : '#15803d',
                                  fontWeight: 500,
                                  textTransform: 'uppercase',
                                }}
                              >
                                {resource.input_method === 'url' ? 'URL' : 'Note'}
                              </span>

                              <button
                                type="button"
                                aria-label={`Actions for ${resource.title}`}
                                aria-expanded={openMenuResourceId === resource.id}
                                onClick={() =>
                                  setOpenMenuResourceId((currentId) =>
                                    currentId === resource.id ? null : resource.id
                                  )
                                }
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  cursor: 'pointer',
                                  fontSize: '1.25rem',
                                  lineHeight: 1,
                                  color: '#64748b',
                                  padding: '0 0.25rem',
                                  borderRadius: '0.25rem',
                                }}
                              >
                                ⋮
                              </button>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.4rem',
                              alignItems: 'center',
                            }}
                          >
                            {assignedTopics.length > 0 ? (
                              assignedTopics.map((topicName) => (
                                <span
                                  key={topicName}
                                  style={{
                                    display: 'inline-block',
                                    padding: '0.25rem 0.6rem',
                                    borderRadius: '9999px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                  }}
                                >
                                  {topicName}
                                </span>
                              ))
                            ) : (
                              <span
                                style={{
                                  fontSize: '0.75rem',
                                  color: '#94a3b8',
                                  fontStyle: 'italic',
                                }}
                              >
                                Unassigned
                              </span>
                            )}
                          </div>

                          {resource.source_url && (
                            <a
                              href={resource.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: '0.8125rem',
                                color: '#2563eb',
                                textDecoration: 'none',
                                wordBreak: 'break-all',
                              }}
                            >
                              {resource.source_url}
                            </a>
                          )}

                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: '#64748b',
                              marginTop: 'auto',
                              paddingTop: '0.5rem',
                              borderTop: '1px solid #f1f5f9',
                            }}
                          >
                            Added {new Date(resource.created_at).toLocaleDateString()}
                          </div>

                          {openMenuResourceId === resource.id && (
                            <div
                              style={{
                                position: 'absolute',
                                top: '3.5rem',
                                right: '1rem',
                                zIndex: 10,
                                minWidth: '150px',
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '0.5rem',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                padding: '0.35rem',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => openEditResource(resource)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#1e293b',
                                  padding: '0.65rem 0.75rem',
                                  borderRadius: '0.35rem',
                                  cursor: 'pointer',
                                  fontSize: '0.875rem',
                                }}
                              >
                                Edit resource
                              </button>

                              <button
                                type="button"
                                onClick={() => confirmDeleteResource(resource)}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  border: 'none',
                                  background: 'transparent',
                                  color: '#dc2626',
                                  padding: '0.65rem 0.75rem',
                                  borderRadius: '0.35rem',
                                  cursor: 'pointer',
                                  fontSize: '0.875rem',
                                }}
                              >
                                Delete resource
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      <AddResourceModal
        isOpen={activeModal === 'resource'}
        onClose={() => setActiveModal(null)}
        onResourceAdded={handleRefreshResources}
      />

      {resourceToEdit && (
        <EditResourceModal
          key={resourceToEdit.id}
          resource={resourceToEdit}
          onClose={() => setResourceToEdit(null)}
          onSaved={handleResourceSaved}
        />
      )}

      {resourceToDelete && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) {
              setResourceToDelete(null)
              setDeleteError(null)
            }
          }}
          style={{ zIndex: 1000 }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-resource-title"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: '440px', width: '90%' }}
          >
            <div className="modal-header">
              <h3 id="delete-resource-title">Delete resource?</h3>
              <button
                className="modal-close-btn"
                onClick={() => {
                  if (!deleting) {
                    setResourceToDelete(null)
                    setDeleteError(null)
                  }
                }}
                aria-label="Close confirmation"
                disabled={deleting}
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <p>
                Are you sure you want to delete{' '}
                <strong>
                  "{resourceToDelete.title || 'Untitled Resource'}"
                </strong>
                ?
              </p>

              <p style={{ color: '#64748b', fontSize: '0.875rem' }}>
                This will permanently delete the resource and its associated
                content, processing records, and topic associations. This
                action cannot be undone.
              </p>

              {deleteError && (
                <p
                  role="alert"
                  style={{
                    color: '#b91c1c',
                    backgroundColor: '#fee2e2',
                    padding: '0.75rem',
                    borderRadius: '0.375rem',
                    fontSize: '0.875rem',
                  }}
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
                className="btn-secondary"
                onClick={() => {
                  setResourceToDelete(null)
                  setDeleteError(null)
                }}
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
