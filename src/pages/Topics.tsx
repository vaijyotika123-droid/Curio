
import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTopicData } from '../hooks/useTopicData'
import type { Topic } from '../lib/topics'
import { TopicFormModal } from '../components/TopicFormModal'
import { DeleteTopicModal } from '../components/DeleteTopicModal'
import { TopicResourcesModal } from '../components/TopicResourcesModal'

export const Topics: React.FC = () => {
  const { user } = useAuth()
  const { topics, loading, error, refreshTopics } = useTopicData()

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null)
  const [deletingTopic, setDeletingTopic] = useState<Topic | null>(null)
  const [managingTopic, setManagingTopic] = useState<Topic | null>(null)

  const openCreateModal = () => {
    setEditingTopic(null)
    setIsFormOpen(true)
  }

  const openEditModal = (topic: Topic) => {
    setEditingTopic(topic)
    setIsFormOpen(true)
  }

  const closeFormModal = () => {
    setIsFormOpen(false)
    setEditingTopic(null)
  }

  const handleTopicSaved = () => {
    closeFormModal()
    void refreshTopics()
  }

  const handleTopicDeleted = () => {
    setDeletingTopic(null)
    void refreshTopics()
  }

  const handleResourcesSaved = () => {
    setManagingTopic(null)
    void refreshTopics()
  }

  return (
    <div className="page-view">
      <header className="page-header">
        <div className="header-titles">
          <h1 className="page-title">Topics</h1>
          <p className="page-subtitle">
            Organise your saved resources into meaningful subject areas.
          </p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={openCreateModal}
            disabled={!user}
          >
            + Create topic
          </button>
        </div>
      </header>

      <section className="topics-content">
        {loading ? (
          <div className="topics-message">
            Loading your topics...
          </div>
        ) : error ? (
          <div className="topics-error-state">
            <div className="auth-error-alert" role="alert">
              {error}
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => void refreshTopics()}
            >
              Try again
            </button>
          </div>
        ) : topics.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon-wrapper">
              <span className="empty-symbol">T</span>
            </div>

            <h2 className="empty-heading">No topics yet</h2>

            <p className="empty-body">
              Create your first topic to start organising your saved
              resources into meaningful collections.
            </p>

            <button
              type="button"
              className="btn-primary"
              onClick={openCreateModal}
            >
              Create your first topic
            </button>
          </div>
        ) : (
          <div className="topics-grid">
            {topics.map((topic) => (
              <article className="topic-card" key={topic.id}>
                <div className="topic-card-header">
                  <div className="topic-card-title-group">
                    <h2 className="topic-card-name">{topic.name}</h2>

                    <span className="topic-card-count">
                      {topic.resourceCount}{' '}
                      {topic.resourceCount === 1 ? 'resource' : 'resources'}
                    </span>
                  </div>
                </div>

                <p className="topic-card-description">
                  {topic.description || 'No description added yet.'}
                </p>

                <div className="topic-card-actions">
                  <button
                    type="button"
                    className="topic-action-btn"
                    onClick={() => setManagingTopic(topic)}
                  >
                    Manage resources
                  </button>

                  <button
                    type="button"
                    className="topic-action-btn"
                    onClick={() => openEditModal(topic)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="topic-action-btn topic-delete-btn"
                    onClick={() => setDeletingTopic(topic)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {user && isFormOpen && (
        <TopicFormModal
          key={editingTopic?.id ?? 'new-topic'}
          userId={user.id}
          topic={editingTopic}
          onClose={closeFormModal}
          onSaved={handleTopicSaved}
        />
      )}

      {user && deletingTopic && (
        <DeleteTopicModal
          userId={user.id}
          topic={deletingTopic}
          onClose={() => setDeletingTopic(null)}
          onDeleted={handleTopicDeleted}
        />
      )}

      {user && managingTopic && (
        <TopicResourcesModal
          key={managingTopic.id}
          userId={user.id}
          topic={managingTopic}
          onClose={() => setManagingTopic(null)}
          onSaved={handleResourcesSaved}
        />
      )}
    </div>
  )
}
