import React, { useState } from 'react'

export const Library: React.FC = () => {
  const [activeModal, setActiveModal] = useState<'resource' | 'topic' | null>(null)

  return (
    <div className="page-view">
      <header className="page-header">
        <div className="header-titles">
          <h1 className="page-title">Your curiosity, organised.</h1>
          <p className="page-subtitle">Save resources, explore ideas and discover connections.</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setActiveModal('topic')}>
            Create topic
          </button>
          <button className="btn-primary" onClick={() => setActiveModal('resource')}>
            Add resource
          </button>
        </div>
      </header>

      <section className="empty-state">
        <div className="empty-icon-wrapper">
          <span className="empty-symbol">✦</span>
        </div>
        <h2 className="empty-heading">Your library is waiting.</h2>
        <p className="empty-body">Resources you save will appear here.</p>
      </section>

      {/* Placeholder dialogs */}
      {activeModal && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{activeModal === 'resource' ? 'Add Resource' : 'Create Topic'}</h3>
              <button className="modal-close-btn" onClick={() => setActiveModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <p className="placeholder-note">
                <strong>Feature Preview:</strong> {activeModal === 'resource' ? 'Resource importing and URL saving functionality will be built here.' : 'Topic organization structures will be built here.'}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setActiveModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}