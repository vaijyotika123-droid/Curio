
import React, { useEffect } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  maxWidth?: string
  isBusy?: boolean
}

export const Modal: React.FC<ModalProps> = ({
  title,
  onClose,
  children,
  footer,
  maxWidth = '460px',
  isBusy = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, isBusy])

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 1000 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onClose()
        }
      }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          maxWidth,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header">
          <h3>{title}</h3>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            disabled={isBusy}
          >
            ×
          </button>
        </div>

        <div
          className="modal-body"
          style={{
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {children}
        </div>

        {footer && (
          <div className="modal-footer" style={{ gap: '0.75rem' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
