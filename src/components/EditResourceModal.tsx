import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_LENGTH = 100000;

// Error codes raised by the update_resource database function.
// Their messages are written for users, so they are safe to display.
const USER_FACING_ERROR_CODES = ['22000', '22023', 'P0002', '28000'];

export interface EditableResource {
  id: string;
  title: string;
  input_method: 'url' | 'manual_text';
  source_url: string | null;
}

interface EditResourceModalProps {
  resource: EditableResource;
  onClose: () => void;
  onSaved: (updated: { id: string; title: string }) => void;
}

/**
 * Edit form for one resource.
 * - URL resources: title only (the URL is shown but locked).
 * - Manual-text resources: title and content.
 * Render it only while editing and give it key={resource.id} so state starts fresh.
 */
export const EditResourceModal: React.FC<EditResourceModalProps> = ({
  resource,
  onClose,
  onSaved,
}) => {
  const isManual = resource.input_method === 'manual_text';

  const [title, setTitle] = useState(resource.title);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [contentLoading, setContentLoading] = useState(isManual);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Manual content lives in resource_contents, so load it when the form opens.
  useEffect(() => {
    if (!isManual) return;
    let cancelled = false;

    const loadContent = async () => {
      const { data, error } = await supabase
        .from('resource_contents')
        .select('content_text')
        .eq('resource_id', resource.id)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data) {
        console.error('Error loading resource content:', error);
        setLoadError('Could not load this resource’s content. Close the form and try again.');
      } else {
        setContent(data.content_text);
        setOriginalContent(data.content_text);
      }
      setContentLoading(false);
    };

    loadContent();
    return () => {
      cancelled = true;
    };
  }, [isManual, resource.id]);

  // Close with Escape (but not while a save is in progress)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [saving, onClose]);

  const isDirty =
    title.trim() !== resource.title.trim() || (isManual && content !== originalContent);
  const canSave = isDirty && !saving && !contentLoading && !loadError;

  const validate = (): boolean => {
    let valid = true;
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setTitleError('Title is required.');
      valid = false;
    } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      setTitleError(`Title cannot exceed ${MAX_TITLE_LENGTH} characters.`);
      valid = false;
    } else {
      setTitleError(null);
    }

    if (isManual) {
      if (!content.trim()) {
        setContentError('Content is required.');
        valid = false;
      } else if (content.length > MAX_CONTENT_LENGTH) {
        setContentError(`Content cannot exceed ${MAX_CONTENT_LENGTH.toLocaleString()} characters.`);
        valid = false;
      } else {
        setContentError(null);
      }
    }

    return valid;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;

    setFormError(null);
    if (!validate()) return;

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('update_resource', {
        p_resource_id: resource.id,
        p_title: title.trim(),
        // URL resources never send content: the database rejects it.
        ...(isManual ? { p_content_text: content } : {}),
      });

      if (error) throw error;

      const saved = data as { id: string; title: string } | null;
      if (!saved?.id) {
        throw new Error('The update did not return a result. Please try again.');
      }

      onSaved({ id: saved.id, title: saved.title });
    } catch (err: unknown) {
      console.error('Error updating resource:', err);
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      const message =
        err instanceof Error || (typeof err === 'object' && err !== null && 'message' in err)
          ? String((err as { message: unknown }).message)
          : '';

      setFormError(
        USER_FACING_ERROR_CODES.includes(code) && message
          ? message
          : 'Unable to save your changes. Please try again.'
      );
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" style={{ zIndex: 1000 }}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-resource-heading"
        style={{
          maxWidth: '640px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="modal-header">
          <h3 id="edit-resource-heading">Edit resource</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close edit form"
            disabled={saving}
          >
            ×
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
        >
          <div
            className="modal-body"
            style={{
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div className="form-group">
              <label htmlFor="edit-resource-title">Title</label>
              <input
                id="edit-resource-title"
                type="text"
                className="form-input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleError(null);
                }}
                maxLength={MAX_TITLE_LENGTH}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? 'edit-title-error' : undefined}
                disabled={saving}
                autoFocus
              />
              {titleError && (
                <span
                  id="edit-title-error"
                  role="alert"
                  style={{ color: 'var(--error-text)', fontSize: '0.8125rem' }}
                >
                  {titleError}
                </span>
              )}
            </div>

            {isManual ? (
              <div className="form-group">
                <label htmlFor="edit-resource-content">Content</label>
                <textarea
                  id="edit-resource-content"
                  className="form-input"
                  value={contentLoading ? '' : content}
                  placeholder={contentLoading ? 'Loading content…' : undefined}
                  onChange={(e) => {
                    setContent(e.target.value);
                    setContentError(null);
                  }}
                  rows={12}
                  aria-invalid={contentError ? true : undefined}
                  aria-describedby={contentError ? 'edit-content-error' : undefined}
                  disabled={saving || contentLoading || !!loadError}
                  style={{
                    minHeight: '220px',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    lineHeight: 1.5,
                  }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {content.length.toLocaleString()} / {MAX_CONTENT_LENGTH.toLocaleString()} characters
                </span>
                {contentError && (
                  <span
                    id="edit-content-error"
                    role="alert"
                    style={{ color: 'var(--error-text)', fontSize: '0.8125rem' }}
                  >
                    {contentError}
                  </span>
                )}
              </div>
            ) : (
              <div className="form-group">
                <label>Source URL</label>
                <div
                  style={{
                    padding: '0.75rem',
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-app)',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                    wordBreak: 'break-all',
                  }}
                >
                  {resource.source_url}
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  The URL can’t be changed yet. Only the title is editable for saved links.
                </span>
              </div>
            )}

            {loadError && (
              <div className="auth-error-alert" role="alert">
                {loadError}
              </div>
            )}
            {formError && (
              <div className="auth-error-alert" role="alert">
                {formError}
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ gap: '0.75rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={!canSave}
              style={{
                opacity: canSave ? 1 : 0.6,
                cursor: canSave ? 'pointer' : 'not-allowed',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
