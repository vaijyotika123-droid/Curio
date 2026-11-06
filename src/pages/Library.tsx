
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { AddResourceModal } from '../components/AddResourceModal';
import { EditResourceModal } from '../components/EditResourceModal';

interface Resource {
  id: string;
  title: string;
  input_method: 'url' | 'manual_text';
  source_url: string | null;
  created_at: string;
}

export const Library: React.FC = () => {
  const [activeModal, setActiveModal] = useState<'resource' | 'topic' | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Resource deletion states
  const [resourceToDelete, setResourceToDelete] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openMenuResourceId, setOpenMenuResourceId] = useState<string | null>(null);

  // Resource editing states
  const [resourceToEdit, setResourceToEdit] = useState<Resource | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Reusable function for fetching and refreshing resources
  const loadUserResources = async () => {
    try {
      setError(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error('User not authenticated.');
      }

      const { data, error: queryError } = await supabase
        .from('resources')
        .select('id, title, input_method, source_url, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (queryError) {
        throw queryError;
      }

      setResources(data || []);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch resources.';

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch resources on initial mount
  useEffect(() => {
    let isMounted = true;

    const fetchInitialData = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw new Error('User not authenticated.');
        }

        const { data, error: queryError } = await supabase
          .from('resources')
          .select('id, title, input_method, source_url, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (queryError) {
          throw queryError;
        }

        if (isMounted) {
          setResources(data || []);
          setError(null);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to fetch resources.';

          setError(errorMessage);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchInitialData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Clear the success message automatically after a few seconds
  useEffect(() => {
    if (!successMessage) return;
    const timeoutId = window.setTimeout(() => setSuccessMessage(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [successMessage]);

  // Open the edit form for a resource
  const openEditResource = (resource: Resource) => {
    setResourceToEdit(resource);
    setOpenMenuResourceId(null);
  };

  // After a successful save, update just that card in the list
  const handleResourceSaved = (updated: { id: string; title: string }) => {
    setResources((currentResources) =>
      currentResources.map((resource) =>
        resource.id === updated.id ? { ...resource, title: updated.title } : resource
      )
    );
    setResourceToEdit(null);
    setSuccessMessage('Resource updated.');
  };

  // Open the delete confirmation dialog
  const confirmDeleteResource = (resource: Resource) => {
    setResourceToDelete(resource);
    setDeleteError(null);
    setOpenMenuResourceId(null);
  };

  // Delete a resource using the secure Supabase database function
  const handleDeleteResource = async () => {
    if (!resourceToDelete || deleting) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      const { data, error: deleteQueryError } = await supabase.rpc(
        'delete_resource',
        {
          p_resource_id: resourceToDelete.id,
        }
      );

      if (deleteQueryError) {
        throw deleteQueryError;
      }

      if (!data) {
        throw new Error(
          "Resource not found or you don't have permission to delete it."
        );
      }

      // Remove the deleted resource from the current UI
      setResources((currentResources) =>
        currentResources.filter(
          (resource) => resource.id !== resourceToDelete.id
        )
      );

      setResourceToDelete(null);
    } catch (err: unknown) {
      console.error('Error deleting resource:', err);

      const errorMessage =
        err instanceof Error
          ? err.message
          : 'Unable to delete this resource. Please try again.';

      setDeleteError(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

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
            onClick={() => setActiveModal('topic')}
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

      {/* Main Content Area */}
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
        ) : error ? (
          <div
            className="error-state"
            style={{
              padding: '1rem',
              borderRadius: '0.5rem',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
            }}
          >
            <p>Error loading library: {error}</p>

            <button
              className="btn-secondary"
              onClick={loadUserResources}
              style={{ marginTop: '0.5rem' }}
            >
              Try again
            </button>
          </div>
        ) : resources.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrapper">
              <span className="empty-symbol">✦</span>
            </div>

            <h2 className="empty-heading">Your library is waiting.</h2>

            <p className="empty-body">
              Resources you save will appear here.
            </p>
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
            {resources.map((resource) => (
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
                {/* Resource title and actions */}
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
                    {resource.title || 'Untitled Resource'}
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

                    {/* Three-dot action menu */}
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

                {/* Resource source URL */}
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

                {/* Added date */}
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

                {/* Action menu dropdown */}
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
            ))}
          </div>
        )}
      </section>

      {/* Add Resource Modal */}
      <AddResourceModal
        isOpen={activeModal === 'resource'}
        onClose={() => setActiveModal(null)}
        onResourceAdded={loadUserResources}
      />

      {/* Topic modal placeholder */}
      {activeModal === 'topic' && (
        <div
          className="modal-backdrop"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Create Topic</h3>

              <button
                className="modal-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <p className="placeholder-note">
                <strong>Feature Preview:</strong> Topic organization
                structures will be built here.
              </p>
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setActiveModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Resource Modal (remounted per resource so its form state starts fresh) */}
      {resourceToEdit && (
        <EditResourceModal
          key={resourceToEdit.id}
          resource={resourceToEdit}
          onClose={() => setResourceToEdit(null)}
          onSaved={handleResourceSaved}
        />
      )}

      {/* Delete confirmation dialog */}
      {resourceToDelete && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) {
              setResourceToDelete(null);
              setDeleteError(null);
            }
          }}
          style={{ zIndex: 1000 }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-resource-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '440px', width: '90%' }}
          >
            <div className="modal-header">
              <h3 id="delete-resource-title">Delete resource?</h3>

              <button
                className="modal-close-btn"
                onClick={() => {
                  if (!deleting) {
                    setResourceToDelete(null);
                    setDeleteError(null);
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
                  setResourceToDelete(null);
                  setDeleteError(null);
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
  );
};
