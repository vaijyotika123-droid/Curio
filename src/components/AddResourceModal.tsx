
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResourceAdded: () => void;
}

type InputMethod = 'url' | 'manual_text';

type Feedback = {
  type: 'success' | 'duplicate' | 'error';
  message: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('error' in error) {
      return getErrorMessage(error.error);
    }
  }

  return 'An unexpected error occurred.';
}

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
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleReset = () => {
    setTitle('');
    setSourceUrl('');
    setContentText('');
    setFeedback(null);
  };

  const handleCloseModal = () => {
    if (isLoading) return;

    handleReset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isLoading) return;

    setIsLoading(true);
    setFeedback(null);

    try {
      // 1. Verify the active session.
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        setFeedback({
          type: 'error',
          message:
            'Your session has expired or you are not signed in. Please sign in again.',
        });
        return;
      }

      // 2. Construct the resource creation payload.
      const payload =
        inputMethod === 'url'
          ? {
              input_method: 'url',
              title: title.trim() || undefined,
              source_url: sourceUrl.trim(),
            }
          : {
              input_method: 'manual_text',
              title: title.trim(),
              content_text: contentText.trim(),
            };

      // 3. Create the resource.
      const {
        data,
        error: functionError,
      } = await supabase.functions.invoke('create-resource', {
        body: payload,
      });

      if (functionError) {
        throw new Error(getErrorMessage(functionError));
      }

      if (data?.error) {
        throw new Error(getErrorMessage(data.error));
      }

      // 4. Handle duplicate resources.
      // Never delete an existing duplicate resource.
      if (data?.is_duplicate === true) {
        setFeedback({
          type: 'duplicate',
          message: `This resource already exists in your library: "${
            data.data?.title || sourceUrl
          }"`,
        });

        onResourceAdded();
        return;
      }

      // 5. Get the newly created resource ID.
      const resourceId = data?.data?.id;

      if (!resourceId || typeof resourceId !== 'string') {
        throw new Error(
          'Resource creation did not return a valid resource ID.'
        );
      }

      let successMessage = 'Resource successfully added!';

      // 6. Process manual-text resources.
      if (inputMethod === 'manual_text') {
        const {
          data: analysisData,
          error: analysisError,
        } = await supabase.functions.invoke('process-resource', {
          body: {
            resource_id: resourceId,
          },
        });

        if (analysisError || analysisData?.success !== true) {
          console.error(
            'AI analysis could not be started:',
            analysisError || analysisData?.error
          );

          successMessage =
            'Resource saved, but AI analysis could not be completed. Please check the resource status.';
        } else {
          successMessage =
            'Resource saved and AI analysis started successfully!';
        }
      } else {
        // 7. Extract content for URL resources.
        const {
          data: extractionData,
          error: extractionError,
        } = await supabase.functions.invoke('extract-resource', {
          body: {
            resource_id: resourceId,
          },
        });

        const extractionSucceeded =
          !extractionError &&
          extractionData?.success === true;

        if (!extractionSucceeded) {
          const extractionMessage = extractionData?.error
            ? getErrorMessage(extractionData.error)
            : extractionError
              ? getErrorMessage(extractionError)
              : 'The extraction service did not return a successful result.';

          console.error(
            'Content extraction failed:',
            extractionMessage
          );

          // 8. Remove ONLY the resource created by this request.
          // The database RPC checks ownership before deletion.
          let cleanupSucceeded = false;
          let cleanupErrorMessage = '';

          try {
            const {
              data: deleted,
              error: deleteError,
            } = await supabase.rpc('delete_resource', {
              p_resource_id: resourceId,
            });

            if (deleteError) {
              cleanupErrorMessage = getErrorMessage(deleteError);
            } else if (deleted === true) {
              cleanupSucceeded = true;
            } else {
              cleanupErrorMessage =
                'The database did not confirm resource deletion.';
            }
          } catch (cleanupError: unknown) {
            cleanupErrorMessage = getErrorMessage(cleanupError);
          }

          // Refresh the library to reflect the cleanup outcome.
          onResourceAdded();

          if (!cleanupSucceeded) {
            console.error(
              'Resource cleanup failed:',
              cleanupErrorMessage
            );

            setFeedback({
              type: 'error',
              message:
                `Content extraction failed: ${extractionMessage}. ` +
                'The resource may still be in your library because cleanup failed.',
            });

            return;
          }

          setFeedback({
            type: 'error',
            message:
              `Could not extract content from this URL: ${extractionMessage}. ` +
              'The unsuccessful resource was removed from your library.',
          });

          // Keep the modal open so the user can try another URL.
          return;
        }

        // 9. Extraction succeeded. Start AI analysis.
        // Do NOT delete the resource if AI analysis fails.
        const {
          data: analysisData,
          error: analysisError,
        } = await supabase.functions.invoke('process-resource', {
          body: {
            resource_id: resourceId,
          },
        });

        if (analysisError || analysisData?.success !== true) {
          console.error(
            'AI analysis could not be started:',
            analysisError || analysisData?.error
          );

          successMessage =
            'Resource saved and content extracted, but AI analysis could not be started.';
        } else {
          successMessage =
            'Resource saved, content extracted, and AI analysis started successfully!';
        }
      }

      // 10. Successful resource creation.
      setFeedback({
        type: 'success',
        message: successMessage,
      });

      onResourceAdded();

      // Reset and close after showing success.
      setTimeout(() => {
        handleReset();
        onClose();
      }, 1800);
    } catch (err: unknown) {
      console.error('Failed to add resource:', err);

      setFeedback({
        type: 'error',
        message: getErrorMessage(err),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={handleCloseModal}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Add New Resource</h3>

          <button
            type="button"
            className="modal-close-btn"
            onClick={handleCloseModal}
            disabled={isLoading}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div
          className="modal-body"
          style={{ padding: '1.25rem' }}
        >
          {/* Input method tabs */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginBottom: '1.25rem',
              borderBottom:
                '1px solid var(--border-color, #e5e7eb)',
              paddingBottom: '0.75rem',
            }}
          >
            <button
              type="button"
              disabled={isLoading}
              className={
                inputMethod === 'url'
                  ? 'btn-primary'
                  : 'btn-secondary'
              }
              style={{
                fontSize: '0.875rem',
                padding: '0.375rem 0.75rem',
              }}
              onClick={() => {
                setInputMethod('url');
                setFeedback(null);
              }}
            >
              URL Link
            </button>

            <button
              type="button"
              disabled={isLoading}
              className={
                inputMethod === 'manual_text'
                  ? 'btn-primary'
                  : 'btn-secondary'
              }
              style={{
                fontSize: '0.875rem',
                padding: '0.375rem 0.75rem',
              }}
              onClick={() => {
                setInputMethod('manual_text');
                setFeedback(null);
              }}
            >
              Manual Text
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {inputMethod === 'url' ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    Target URL{' '}
                    <span style={{ color: '#ef4444' }}>
                      *
                    </span>
                  </label>

                  <input
                    type="url"
                    required
                    disabled={isLoading}
                    placeholder="https://example.com/article"
                    value={sourceUrl}
                    onChange={(e) =>
                      setSourceUrl(e.target.value)
                    }
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      border:
                        '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--input-bg, #fff)',
                      color: 'inherit',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    Title (Optional)
                  </label>

                  <input
                    type="text"
                    maxLength={300}
                    disabled={isLoading}
                    placeholder="Resource Title (auto-derived if blank)"
                    value={title}
                    onChange={(e) =>
                      setTitle(e.target.value)
                    }
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      border:
                        '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--input-bg, #fff)',
                      color: 'inherit',
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    Title{' '}
                    <span style={{ color: '#ef4444' }}>
                      *
                    </span>
                  </label>

                  <input
                    type="text"
                    required
                    maxLength={300}
                    disabled={isLoading}
                    placeholder="Note or Article Title"
                    value={title}
                    onChange={(e) =>
                      setTitle(e.target.value)
                    }
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      border:
                        '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--input-bg, #fff)',
                      color: 'inherit',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.375rem',
                  }}
                >
                  <label
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                    }}
                  >
                    Content Text{' '}
                    <span style={{ color: '#ef4444' }}>
                      *
                    </span>
                  </label>

                  <textarea
                    required
                    rows={5}
                    maxLength={100000}
                    disabled={isLoading}
                    placeholder="Paste or type your notes here..."
                    value={contentText}
                    onChange={(e) =>
                      setContentText(e.target.value)
                    }
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderRadius: '0.375rem',
                      border:
                        '1px solid var(--border-color, #cbd5e1)',
                      background: 'var(--input-bg, #fff)',
                      color: 'inherit',
                      resize: 'vertical',
                    }}
                  />
                </div>
              </>
            )}

            {/* Feedback message */}
            {feedback && (
              <div
                role="alert"
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  backgroundColor:
                    feedback.type === 'success'
                      ? '#dcfce7'
                      : feedback.type === 'duplicate'
                        ? '#fef9c3'
                        : '#fee2e2',
                  color:
                    feedback.type === 'success'
                      ? '#166534'
                      : feedback.type === 'duplicate'
                        ? '#854d0e'
                        : '#991b1b',
                }}
              >
                {feedback.message}
              </div>
            )}

            {/* Modal actions */}
            <div
              className="modal-footer"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                marginTop: '0.5rem',
                padding: 0,
                border: 'none',
              }}
            >
              <button
                type="button"
                className="btn-secondary"
                disabled={isLoading}
                onClick={handleCloseModal}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary"
                style={{
                  opacity: isLoading ? 0.6 : 1,
                  cursor: isLoading
                    ? 'not-allowed'
                    : 'pointer',
                }}
              >
                {isLoading
                  ? 'Saving...'
                  : 'Save Resource'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
