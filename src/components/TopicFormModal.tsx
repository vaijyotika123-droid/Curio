
import React, { useState } from 'react'
import { Modal } from './Modal'
import {
  createTopic,
  updateTopic,
  type Topic,
} from '../lib/topics'
import {
  createUrlResource,
  saveTopicResources,
} from '../lib/topicResources'

const MAX_NAME_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 500
const MAX_URL_LENGTH = 2048

interface TopicFormModalProps {
  userId: string
  topic?: Topic | null
  onClose: () => void
  onSaved: (topic: Topic) => void
}

export const TopicFormModal: React.FC<TopicFormModalProps> = ({
  userId,
  topic,
  onClose,
  onSaved,
}) => {
  const isEditing = Boolean(topic)

  const [name, setName] = useState(topic?.name ?? '')
  const [description, setDescription] = useState(topic?.description ?? '')
  const [sourceUrl, setSourceUrl] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Retain a successfully created topic if adding its URL fails.
  // This allows the user to retry without creating a duplicate topic.
  const [createdTopic, setCreatedTopic] = useState<Topic | null>(null)

  const validate = (): boolean => {
    const normalizedName = name.trim().replace(/\s+/g, ' ')
    const normalizedDescription = description.trim()
    const normalizedUrl = sourceUrl.trim()

    if (!normalizedName) {
      setNameError('Topic name is required.')
      return false
    }

    if (normalizedName.length > MAX_NAME_LENGTH) {
      setNameError(`Topic name cannot exceed ${MAX_NAME_LENGTH} characters.`)
      return false
    }

    if (normalizedDescription.length > MAX_DESCRIPTION_LENGTH) {
      setFormError(
        `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters.`
      )
      return false
    }

    if (normalizedUrl.length > MAX_URL_LENGTH) {
      setFormError(`URL cannot exceed ${MAX_URL_LENGTH} characters.`)
      return false
    }

    if (normalizedUrl) {
      try {
        const parsedUrl = new URL(normalizedUrl)

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          setFormError('Please enter a valid HTTP or HTTPS URL.')
          return false
        }
      } catch {
        setFormError('Please enter a valid URL.')
        return false
      }
    }

    setNameError(null)
    setFormError(null)
    return true
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (saving) return

    setFormError(null)

    if (!validate()) return

    setSaving(true)

    // Keep a local reference so the catch block knows whether
    // the topic was already created during this submission.
    let topicForRetry = createdTopic

    try {
      if (isEditing && topic) {
        const updatedTopic = await updateTopic(
          userId,
          topic.id,
          name,
          description
        )

        onSaved(updatedTopic)
        return
      }

      // Create the topic only once.
      if (!topicForRetry) {
        topicForRetry = await createTopic(
          userId,
          name,
          description
        )

        setCreatedTopic(topicForRetry)
      }

      // Add the optional URL and associate it with the topic.
      if (sourceUrl.trim()) {
        const resource = await createUrlResource(sourceUrl)

        await saveTopicResources(
          userId,
          topicForRetry.id,
          [resource.id]
        )
      }

      onSaved(topicForRetry)
    } catch (err: unknown) {
      console.error('Error saving topic:', err)

      if (topicForRetry) {
        setFormError(
          'Your topic has been created, but the URL could not be added to it. You can retry without creating the topic again.'
        )
      } else {
        setFormError(
          err instanceof Error
            ? err.message
            : 'Could not save this topic. Please try again.'
        )
      }

      setSaving(false)
    }
  }

  const isRetryingUrl = Boolean(createdTopic && !isEditing)

  return (
    <Modal
      title={isEditing ? 'Edit topic' : 'Create topic'}
      onClose={onClose}
      isBusy={saving}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            type="submit"
            form="topic-form"
            className="btn-primary"
            disabled={saving}
            style={{
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? 'Saving…'
              : isEditing
                ? 'Save changes'
                : isRetryingUrl
                  ? 'Retry adding URL'
                  : 'Create topic'}
          </button>
        </>
      }
    >
      <form id="topic-form" onSubmit={handleSubmit} noValidate>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div className="form-group">
            <label htmlFor="topic-name">Topic name</label>

            <input
              id="topic-name"
              type="text"
              className="form-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
                setFormError(null)
              }}
              placeholder="e.g. Artificial Intelligence"
              maxLength={MAX_NAME_LENGTH}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'topic-name-error' : undefined}
              disabled={saving || isRetryingUrl}
              autoFocus
            />

            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
              }}
            >
              {name.length}/{MAX_NAME_LENGTH} characters
            </span>

            {nameError && (
              <span
                id="topic-name-error"
                role="alert"
                style={{
                  color: 'var(--error-text)',
                  fontSize: '0.8125rem',
                }}
              >
                {nameError}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="topic-description">
              Description (optional)
            </label>

            <textarea
              id="topic-description"
              className="form-input"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                setFormError(null)
              }}
              placeholder="What kind of resources belong in this topic?"
              maxLength={MAX_DESCRIPTION_LENGTH}
              rows={4}
              disabled={saving || isRetryingUrl}
              style={{
                resize: 'vertical',
                fontFamily: 'inherit',
                lineHeight: 1.5,
              }}
            />

            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.75rem',
              }}
            >
              {description.length}/{MAX_DESCRIPTION_LENGTH} characters
            </span>
          </div>

          {!isEditing && (
            <div className="form-group">
              <label htmlFor="topic-resource-url">
                First resource URL (optional)
              </label>

              <input
                id="topic-resource-url"
                type="url"
                className="form-input"
                value={sourceUrl}
                onChange={(event) => {
                  setSourceUrl(event.target.value)
                  setFormError(null)
                }}
                placeholder="https://example.com/article"
                maxLength={MAX_URL_LENGTH}
                disabled={saving}
              />

              <span
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                }}
              >
                Add a URL now, or create the topic and add resources later.
              </span>
            </div>
          )}

          {formError && (
            <div className="auth-error-alert" role="alert">
              {formError}
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
