
import React, { useEffect, useState } from 'react'
import { Modal } from './Modal'
import type { Topic } from '../lib/topics'
import {
  fetchUserResources,
  fetchTopicResourceIds,
  saveTopicResources,
  createUrlResource,
  type TopicResource,
} from '../lib/topicResources'

interface TopicResourcesModalProps {
  userId: string
  topic: Topic
  onClose: () => void
  onSaved: () => void
}

export const TopicResourcesModal: React.FC<TopicResourcesModalProps> = ({
  userId,
  topic,
  onClose,
  onSaved,
}) => {
  const [resources, setResources] = useState<TopicResource[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [resourceTitle, setResourceTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadData = async () => {
      try {
        const [resourceData, assignedIds] = await Promise.all([
          fetchUserResources(userId),
          fetchTopicResourceIds(userId, topic.id),
        ])

        if (cancelled) return

        setResources(resourceData)
        setSelectedIds(assignedIds)
      } catch (err: unknown) {
        if (cancelled) return

        console.error('Error loading topic resources:', err)
        setLoadError(true)
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load resources. Please try again.'
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      cancelled = true
    }
  }, [userId, topic.id])

  const toggleResource = (resourceId: string) => {
    setSelectedIds((currentIds) =>
      currentIds.includes(resourceId)
        ? currentIds.filter((id) => id !== resourceId)
        : [...currentIds, resourceId]
    )

    setError(null)
    setNotice(null)
  }

  const handleAddResource = async (event: React.FormEvent) => {
    event.preventDefault()

    if (adding || saving) return

    setAdding(true)
    setError(null)
    setNotice(null)

    try {
      const createdResource = await createUrlResource(
        sourceUrl,
        resourceTitle
      )

      const resourceData = await fetchUserResources(userId)
      setResources(resourceData)

      setSelectedIds((currentIds) =>
        currentIds.includes(createdResource.id)
          ? currentIds
          : [...currentIds, createdResource.id]
      )

      setSourceUrl('')
      setResourceTitle('')
      setShowAddForm(false)

      setNotice(
        createdResource.isDuplicate
          ? 'This URL was already in your Library and has been selected.'
          : 'URL added to your Library and selected for this topic.'
      )
    } catch (err: unknown) {
      console.error('Error adding topic resource:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not add this URL. Please try again.'
      )
    } finally {
      setAdding(false)
    }
  }

  const handleSave = async () => {
    if (saving || adding || loadError) return

    setSaving(true)
    setError(null)

    try {
      await saveTopicResources(userId, topic.id, selectedIds)
      onSaved()
    } catch (err: unknown) {
      console.error('Error saving topic resources:', err)
      setError(
        err instanceof Error
          ? err.message
          : 'Could not save your changes. Please try again.'
      )
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Manage resources"
      onClose={onClose}
      maxWidth="560px"
      isBusy={saving || adding}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving || adding}
          >
            Cancel
          </button>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={loading || loadError || saving || adding}
          >
            {saving ? 'Saving…' : `Save changes (${selectedIds.length})`}
          </button>
        </>
      }
    >
      <div className="topic-resources-modal">
        <div className="topic-resources-heading">
          <div>
            <strong>{topic.name}</strong>
            <p>Select the URLs and manual notes you want to include in this topic.</p>
          </div>

          {!loading && !loadError && (
            <span className="topic-selection-count">
              {selectedIds.length} selected
            </span>
          )}
        </div>

        <div className="topic-add-resource-area">
          {!showAddForm ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowAddForm(true)
                setError(null)
                setNotice(null)
              }}
              disabled={saving || adding}
            >
              + Add URL resource
            </button>
          ) : (
            <form
              className="topic-add-resource-form"
              onSubmit={handleAddResource}
            >
              <label htmlFor="topic-resource-url">Resource URL</label>

              <input
                id="topic-resource-url"
                type="url"
                required
                maxLength={2048}
                placeholder="https://example.com/article"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                disabled={adding}
              />

              <label htmlFor="topic-resource-title">
                Title (optional)
              </label>

              <input
                id="topic-resource-title"
                type="text"
                maxLength={300}
                placeholder="Resource title"
                value={resourceTitle}
                onChange={(event) => setResourceTitle(event.target.value)}
                disabled={adding}
              />

              <div className="topic-add-resource-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setShowAddForm(false)
                    setSourceUrl('')
                    setResourceTitle('')
                    setError(null)
                  }}
                  disabled={adding}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={adding || !sourceUrl.trim()}
                >
                  {adding ? 'Adding…' : 'Add URL'}
                </button>
              </div>
            </form>
          )}
        </div>

        {notice && (
          <div className="topic-resource-notice" role="status">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="topics-message">
            Loading your resources...
          </div>
        ) : loadError ? (
          <div className="auth-error-alert" role="alert">
            {error}
          </div>
        ) : resources.length === 0 ? (
          <div className="topic-resources-empty">
            <h4>No resources yet</h4>
            <p>
              Add a URL above or save a URL or manual note from your Library.
            </p>
          </div>
        ) : (
          <div className="topic-resources-list">
            {resources.map((resource) => {
              const isSelected = selectedIds.includes(resource.id)
              const resourceType =
                resource.input_method === 'url' ? 'URL' : 'Manual note'

              return (
                <label
                  key={resource.id}
                  className={`topic-resource-option ${
                    isSelected ? 'selected' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleResource(resource.id)}
                    disabled={saving || adding}
                  />

                  <span className="topic-resource-option-content">
                    <span className="topic-resource-title">
                      {resource.title || 'Untitled Resource'}
                    </span>

                    <span className="topic-resource-meta">
                      {resourceType} ·{' '}
                      {new Date(resource.created_at).toLocaleDateString()}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {error && !loadError && (
          <div className="auth-error-alert" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
