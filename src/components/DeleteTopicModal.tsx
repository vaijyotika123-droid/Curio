
import React, { useState } from 'react'
import { Modal } from './Modal'
import { deleteTopic, type Topic } from '../lib/topics'

interface DeleteTopicModalProps {
  userId: string
  topic: Topic
  onClose: () => void
  onDeleted: () => void
}

export const DeleteTopicModal: React.FC<DeleteTopicModalProps> = ({
  userId,
  topic,
  onClose,
  onDeleted,
}) => {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    if (deleting) return

    setDeleting(true)
    setError(null)

    try {
      await deleteTopic(userId, topic.id)
      onDeleted()
    } catch (err: unknown) {
      console.error('Error deleting topic:', err)

      setError(
        err instanceof Error
          ? err.message
          : 'Could not delete this topic. Please try again.'
      )

      setDeleting(false)
    }
  }

  return (
    <Modal
      title="Delete topic"
      onClose={onClose}
      isBusy={deleting}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              backgroundColor: '#9B1C1C',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              padding: '0.65rem 1rem',
              fontWeight: 600,
              cursor: deleting ? 'not-allowed' : 'pointer',
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete topic'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p>
          Are you sure you want to delete <strong>{topic.name}</strong>?
        </p>

        <div className="auth-info-alert">
          This will remove the topic and its associations with saved resources.
          Your saved resources themselves will not be deleted.
        </div>

        {error && (
          <div className="auth-error-alert" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
