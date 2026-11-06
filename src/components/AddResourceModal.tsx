import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResourceAdded: () => void;
}

type InputMethod = 'url' | 'manual_text';

export const AddResourceModal: React.FC<AddResourceModalProps> = ({
  isOpen,
  onClose,
  onResourceAdded,
}) => {
  const [inputMethod, setInputMethod] = useState<InputMethod>('url');
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [contentText, setContentText] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'duplicate' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setFeedback(null);

    try {
      // 1. Verify active session and user ownership via Supabase client
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        setFeedback({ type: 'error', message: 'Your session has expired or you are not signed in. Please sign in again.' });
        setIsLoading(false);
        return;
      }

      // 2. Construct payload matching deployed Edge Function contract
      const payload = inputMethod === 'url' ? {
        input_method: 'url',
        title: title.trim() || undefined,
        source_url: sourceUrl.trim(),
      } : {
        input_method: 'manual_text',
        title: title.trim(),
        content_text: contentText.trim(),
      };

      // 3. Invoke Supabase Edge Function securely (JWT automatically attached by Supabase client)
      const { data, error: functionError } = await supabase.functions.invoke('create-resource', {
        body: payload,
      });

      if (functionError) {
        // Parse error message returned from Edge Function if available
        let errorMsg = 'Failed to create resource.';
        try {
          if (typeof functionError === 'object' && functionError !== null && 'message' in functionError) {
            errorMsg = String(functionError.message);
          }
        } catch {
          // fallback
        }
        throw new Error(errorMsg);
      }

      // 4. Handle backend response structure (is_duplicate flag check)
      if (data && data.is_duplicate === true) {
        setFeedback({
          type: 'duplicate',
          message: `This resource already exists in your library: "${data.data?.title || sourceUrl}"`,
        });
        // Still trigger refresh so collection is synchronized
        onResourceAdded();
      } else {
        setFeedback({
          type: 'success',
          message: 'Resource successfully added and queued for processing!',
        });
        onResourceAdded();
        
        // Reset form and close modal after brief confirmation display
        setTimeout(() => {
          handleReset();
          onClose();
        }, 1200);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setFeedback({ type: 'error', message: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setTitle('');
    setSourceUrl('');
    setContentText('');
    setFeedback(null);
  };

  const handleCloseModal = () => {
    handleReset();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleCloseModal}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add New Resource</h3>
          <button className="modal-close-btn" onClick={handleCloseModal} aria-label="Close modal">
            ×
          </button>
        </div>

        <div className="modal-body" style={{ padding: '1.25rem' }}>
          {/* Input Method Toggle Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color, #e5e7eb)', paddingBottom: '0.75rem' }}>
            <button
              type="button"
              className={inputMethod === 'url' ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
              onClick={() => { setInputMethod('url'); setFeedback(null); }}
            >
              URL Link
            </button>
            <button
              type="button"
              className={inputMethod === 'manual_text' ? 'btn-primary' : 'btn-secondary'}
              style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
              onClick={() => { setInputMethod('manual_text'); setFeedback(null); }}
            >
              Manual Text
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {inputMethod === 'url' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Target URL <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/article"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #fff)', color: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Title (Optional)</label>
                  <input
                    type="text"
                    maxLength={300}
                    placeholder="Resource Title (auto-derived if blank)"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #fff)', color: 'inherit' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Title <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    required
                    maxLength={300}
                    placeholder="Note or Article Title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #fff)', color: 'inherit' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Content Text <span style={{ color: '#ef4444' }}>*</span></label>
                  <textarea
                    required
                    rows={5}
                    maxLength={100000}
                    placeholder="Paste or type your notes here..."
                    value={contentText}
                    onChange={(e) => setContentText(e.target.value)}
                    style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', border: '1px solid var(--border-color, #cbd5e1)', background: 'var(--input-bg, #fff)', color: 'inherit', resize: 'vertical' }}
                  />
                </div>
              </>
            )}

            {feedback && (
              <div style={{
                padding: '0.75rem',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                backgroundColor: feedback.type === 'success' ? '#dcfce7' : feedback.type === 'duplicate' ? '#fef9c3' : '#fee2e2',
                color: feedback.type === 'success' ? '#166534' : feedback.type === 'duplicate' ? '#854d0e' : '#991b1b'
              }}>
                {feedback.message}
              </div>
            )}

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', padding: 0, border: 'none' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCloseModal}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary"
                style={{ opacity: isLoading ? 0.6 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
              >
                {isLoading ? 'Saving...' : 'Save Resource'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};