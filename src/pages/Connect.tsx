
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Resource {
  id: string
  title: string
  source_url: string | null
  input_method: 'url' | 'manual_text'
}

interface ConnectionEvidence {
  resource_id: string
  excerpt: string
}

interface ConnectionItem {
  title: string
  explanation: string
  relationship_type: string
  resource_ids: string[]
  evidence: ConnectionEvidence[]
}

interface ConnectionOutput {
  summary: string
  shared_themes: string[]
  connections: ConnectionItem[]
  unconnected_resource_ids: string[]
}

interface SavedDiscovery {
  id: string
  created_at: string
  output_data: ConnectionOutput
  resource_ids: string[]
}

const colors = {
  ink: '#17243b',
  muted: '#66758c',
  subtle: '#94a3b8',
  border: '#e5eaf2',
  background: '#f8faff',
  purple: '#6955d8',
  purpleDark: '#5140b4',
  purpleLight: '#f1efff',
  blueLight: '#edf5ff',
  white: '#ffffff',
}

const relationshipLabels: Record<string, string> = {
  reinforces: 'Reinforces',
  complements: 'Complements',
  contrasts: 'Contrasts',
  applies: 'Applies',
  extends: 'Extends',
}

const relationshipDescriptions: Record<string, string> = {
  reinforces: 'One idea provides support for another.',
  complements: 'Different perspectives build a fuller picture.',
  contrasts: 'The sources reveal a meaningful difference.',
  applies: 'An idea helps interpret another context.',
  extends: 'One idea develops another further.',
}

const relationshipColors: Record<string, string> = {
  reinforces: '#0f766e',
  complements: '#6955d8',
  contrasts: '#b45309',
  applies: '#2563eb',
  extends: '#be185d',
}

const panel: React.CSSProperties = {
  background: colors.white,
  border: `1px solid ${colors.border}`,
  borderRadius: 20,
  boxShadow: '0 8px 30px rgba(31,45,82,0.035)',
}

const smallLabel: React.CSSProperties = {
  color: colors.muted,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
}

function getSourceLabel(resource: Resource): string {
  if (resource.input_method === 'manual_text') return 'Saved note'
  if (!resource.source_url) return 'Saved resource'

  try {
    return new URL(resource.source_url).hostname.replace(/^www\./, '')
  } catch {
    return 'Web resource'
  }
}

export const Connect: React.FC = () => {
  const [resources, setResources] = useState<Resource[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ConnectionOutput | null>(null)
  const [expandedEvidence, setExpandedEvidence] = useState<number[]>([])

  const [history, setHistory] = useState<SavedDiscovery[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [activeDiscoveryId, setActiveDiscoveryId] = useState<string | null>(null)

  const resourceMap = useMemo(
    () => new Map(resources.map(resource => [resource.id, resource])),
    [resources]
  )

  const resourceName = (id: string) =>
    resourceMap.get(id)?.title || 'Unknown resource'

  const filteredResources = useMemo(() => {
    const query = search.trim().toLowerCase()

    return resources.filter(resource =>
      resource.title.toLowerCase().includes(query) ||
      getSourceLabel(resource).toLowerCase().includes(query)
    )
  }, [resources, search])

  const loadHistory = async () => {
    setHistoryLoading(true)
    setHistoryError('')

    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser()

      if (authError || !authData.user) {
        throw new Error('Please sign in to view saved discoveries.')
      }

      const userId = authData.user.id

      const { data: outputs, error: outputsError } = await supabase
        .from('ai_outputs')
        .select('id, created_at, output_data')
        .eq('user_id', userId)
        .eq('feature_type', 'connection')
        .order('created_at', { ascending: false })
        .limit(50)

      if (outputsError) throw outputsError

      if (!outputs?.length) {
        setHistory([])
        return
      }

      const outputIds = outputs.map(item => item.id)

      const { data: links, error: linksError } = await supabase
        .from('ai_output_resources')
        .select('output_id, resource_id')
        .eq('user_id', userId)
        .in('output_id', outputIds)

      if (linksError) throw linksError

      const linksByOutput = new Map<string, string[]>()

      for (const link of links || []) {
        const current = linksByOutput.get(link.output_id) || []
        current.push(link.resource_id)
        linksByOutput.set(link.output_id, current)
      }

      setHistory(
        outputs.map(item => ({
          id: item.id,
          created_at: item.created_at,
          output_data: item.output_data as ConnectionOutput,
          resource_ids: linksByOutput.get(item.id) || [],
        }))
      )
    } catch (err) {
      setHistoryError(
        err instanceof Error
          ? err.message
          : 'Could not load saved discoveries.'
      )
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let active = true

    const loadResources = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('resources')
          .select('id, title, source_url, input_method')
          .order('created_at', { ascending: false })

        if (fetchError) throw fetchError

        if (active) {
          setResources((data || []) as Resource[])
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load your resources.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadResources()
    void loadHistory()

    return () => {
      active = false
    }
  }, [])

  const clearResults = () => {
    setResult(null)
    setActiveDiscoveryId(null)
    setExpandedEvidence([])
  }

  const toggleResource = (id: string) => {
    if (generating) return

    setError('')
    clearResults()

    setSelectedIds(current => {
      if (current.includes(id)) {
        return current.filter(resourceId => resourceId !== id)
      }

      if (current.length >= 5) {
        setError('You can select up to 5 resources.')
        return current
      }

      return [...current, id]
    })
  }

  const clearSelection = () => {
    if (generating) return

    setSelectedIds([])
    setError('')
    clearResults()
  }

  const toggleEvidence = (index: number) => {
    setExpandedEvidence(current =>
      current.includes(index)
        ? current.filter(item => item !== index)
        : [...current, index]
    )
  }

  const openDiscovery = (discovery: SavedDiscovery) => {
    setError('')
    setSelectedIds(discovery.resource_ids)
    setResult(discovery.output_data)
    setActiveDiscoveryId(discovery.id)
    setExpandedEvidence([])

    window.requestAnimationFrame(() => {
      document.getElementById('connect-results')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const generateConnections = async () => {
    if (selectedIds.length < 2 || generating) return

    setGenerating(true)
    setError('')
    clearResults()

    try {
      const { data, error: functionError } =
        await supabase.functions.invoke('generate-connections', {
          body: {
            resource_ids: selectedIds,
          },
        })

      if (functionError) {
        let message = functionError.message

        if (
          'context' in functionError &&
          functionError.context instanceof Response
        ) {
          try {
            const details = await functionError.context.json()

            message =
              details?.error?.message ||
              details?.error ||
              message
          } catch {
            // Preserve the original error.
          }
        }

        throw new Error(
          typeof message === 'string'
            ? message
            : 'Unable to generate connections.'
        )
      }

      if (!data?.success || !data?.output) {
        throw new Error('The server returned an invalid result.')
      }

      setResult(data.output as ConnectionOutput)
      setActiveDiscoveryId(data.output_id || null)
      setExpandedEvidence([])

      void loadHistory()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to generate connections.'
      )
    } finally {
      setGenerating(false)
    }
  }

  const canGenerate =
    selectedIds.length >= 2 && !generating && !loading

  return (
    <div className="page-view">
      <style>
        {`
          .curio-connect * {
            box-sizing: border-box;
          }

          .curio-connect button {
            font-family: inherit;
          }

          .curio-connect .resource-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .curio-connect .resource-card {
            width: 100%;
            min-width: 0;
            text-align: left;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 16px;
            border: 1px solid #e5eaf2;
            border-radius: 14px;
            background: #ffffff;
            cursor: pointer;
            transition:
              border-color 0.2s ease,
              background 0.2s ease,
              transform 0.2s ease;
          }

          .curio-connect .resource-card:hover:not(:disabled) {
            border-color: #aaa0ed;
            transform: translateY(-1px);
          }

          .curio-connect .resource-card.selected {
            background: #f5f3ff;
            border: 1.5px solid #6955d8;
          }

          .curio-connect .resource-card:disabled {
            cursor: not-allowed;
            opacity: 0.7;
          }

          .curio-connect .connect-primary {
            display: inline-flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            min-height: 46px;
            padding: 12px 24px;
            border: none;
            border-radius: 12px;
            background: #6955d8;
            color: #ffffff;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.2s ease;
          }

          .curio-connect .connect-primary:hover:not(:disabled) {
            background: #5140b4;
          }

          .curio-connect .connect-primary:disabled {
            opacity: 0.48;
            cursor: not-allowed;
          }

          .curio-connect .connect-secondary {
            background: transparent;
            border: none;
            color: #6955d8;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
          }

          .curio-connect .connect-secondary:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          .curio-connect .evidence-toggle {
            width: 100%;
            padding: 13px 0;
            border: none;
            background: transparent;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            color: #5140b4;
            font-size: 13px;
            font-weight: 700;
            text-align: left;
            cursor: pointer;
          }

          .curio-connect button:focus-visible,
          .curio-connect input:focus-visible {
            outline: 3px solid #c4b5fd;
            outline-offset: 3px;
          }

          .curio-connect .connection-card {
            background: #ffffff;
            border: 1px solid #e5eaf2;
            border-radius: 18px;
            padding: 24px;
          }

          .curio-connect .history-card {
            width: 100%;
            text-align: left;
            padding: 18px 20px;
            border: 1px solid #e5eaf2;
            border-radius: 14px;
            background: #ffffff;
            cursor: pointer;
            transition: border-color 0.2s ease,
              background 0.2s ease;
          }

          .curio-connect .history-card:hover {
            border-color: #aaa0ed;
            background: #faf9ff;
          }

          .curio-connect .history-card.active {
            border-color: #6955d8;
            background: #f5f3ff;
          }

          @keyframes curio-pulse {
            0%, 100% { opacity: 0.45; }
            50% { opacity: 1; }
          }

          .curio-connect .loading-pulse {
            animation: curio-pulse 1.6s ease-in-out infinite;
          }

          @media (max-width: 700px) {
            .curio-connect .resource-grid {
              grid-template-columns: 1fr;
            }

            .curio-connect .connect-action-row {
              flex-direction: column;
              align-items: stretch !important;
            }

            .curio-connect .connect-primary {
              width: 100%;
            }

            .curio-connect .connection-card {
              padding: 18px;
            }

            .curio-connect .selection-panel {
              padding: 20px !important;
            }

            .curio-connect .history-panel {
              padding: 20px !important;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .curio-connect .loading-pulse {
              animation: none;
            }

            .curio-connect .resource-card {
              transition: none;
            }
          }
        `}
      </style>

      <div
        className="curio-connect"
        style={{
          maxWidth: 1100,
          paddingBottom: 64,
        }}
      >
        {/* PAGE INTRODUCTION */}
        <header style={{ marginBottom: 30 }}>
          <div
            style={{
              ...smallLabel,
              color: colors.purple,
              marginBottom: 12,
            }}
          >
            CURIO / CONNECT
          </div>

          <h1
            style={{
              margin: '0 0 10px',
              fontSize: 'clamp(28px, 4vw, 38px)',
              fontWeight: 750,
              letterSpacing: '-0.04em',
              lineHeight: 1.2,
              color: colors.ink,
            }}
          >
            Connect the dots.
          </h1>

          <p
            style={{
              margin: 0,
              maxWidth: 630,
              fontSize: 15,
              lineHeight: 1.8,
              color: colors.muted,
            }}
          >
            Your best ideas don't exist in isolation.
            Bring together what you've saved and discover
            relationships you might not have noticed.
          </p>
        </header>

        {/* PREVIOUSLY DISCOVERED */}
        <section
          className="history-panel"
          aria-labelledby="connect-history-title"
          style={{
            ...panel,
            padding: 28,
            marginBottom: 25,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div>
              <div
                style={{
                  ...smallLabel,
                  color: colors.purple,
                  marginBottom: 9,
                }}
              >
                YOUR DISCOVERIES
              </div>

              <h2
                id="connect-history-title"
                style={{
                  margin: '0 0 7px',
                  fontSize: 21,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  color: colors.ink,
                }}
              >
                Previously discovered
              </h2>

              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: colors.muted,
                }}
              >
                Return to connections you've already explored.
              </p>
            </div>

            <button
              type="button"
              className="connect-secondary"
              disabled={historyLoading}
              onClick={() => void loadHistory()}
            >
              {historyLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {historyError ? (
            <div
              role="alert"
              style={{
                padding: 16,
                background: '#fff7f6',
                borderRadius: 12,
                color: '#a33b36',
                fontSize: 13,
              }}
            >
              {historyError}
            </div>
          ) : historyLoading ? (
            <p
              style={{
                color: colors.muted,
                fontSize: 13,
              }}
            >
              Loading your discoveries...
            </p>
          ) : history.length === 0 ? (
            <div
              style={{
                padding: '28px 20px',
                textAlign: 'center',
                background: colors.background,
                borderRadius: 14,
              }}
            >
              <div
                style={{
                  fontSize: 27,
                  color: colors.purple,
                  marginBottom: 10,
                }}
              >
                ◇
              </div>

              <h3
                style={{
                  margin: '0 0 8px',
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                Your discoveries start here.
              </h3>

              <p
                style={{
                  margin: 0,
                  color: colors.muted,
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                Connect a few resources and your discoveries
                will appear here for future reference.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gap: 11,
                maxHeight: 370,
                overflowY: 'auto',
                padding: 2,
              }}
            >
              {history.map(discovery => {
                const active = activeDiscoveryId === discovery.id

                const ids =
                  discovery.resource_ids.length > 0
                    ? discovery.resource_ids
                    : [
                        ...new Set(
                          discovery.output_data.connections.flatMap(
                            connection => connection.resource_ids
                          )
                        ),
                      ]

                return (
                  <button
                    key={discovery.id}
                    type="button"
                    className={`history-card ${active ? 'active' : ''}`}
                    disabled={generating}
                    onClick={() => openDiscovery(discovery)}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                        marginBottom: 10,
                      }}
                    >
                      <span
                        style={{
                          ...smallLabel,
                          color: colors.purple,
                          fontSize: 10,
                        }}
                      >
                        SAVED DISCOVERY
                      </span>

                      <span
                        style={{
                          fontSize: 11,
                          color: colors.subtle,
                        }}
                      >
                        {new Date(
                          discovery.created_at
                        ).toLocaleDateString()}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 7,
                        marginBottom: 12,
                      }}
                    >
                      {ids.map(id => (
                        <span
                          key={id}
                          style={{
                            padding: '6px 9px',
                            background: colors.purpleLight,
                            color: colors.purpleDark,
                            borderRadius: 8,
                            fontSize: 11,
                            fontWeight: 600,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {resourceName(id)}
                        </span>
                      ))}
                    </div>

                    <p
                      style={{
                        margin: '0 0 12px',
                        fontSize: 13,
                        color: colors.muted,
                        lineHeight: 1.7,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {discovery.output_data.summary}
                    </p>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: colors.subtle,
                        }}
                      >
                        {discovery.output_data.connections.length}
                        {' '}
                        connections
                      </span>

                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: colors.purple,
                        }}
                      >
                        {active ? 'Currently viewing' : 'View discovery →'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* RESOURCE SELECTION */}
        <section
          className="selection-panel"
          aria-labelledby="connect-selection-title"
          style={{
            ...panel,
            padding: 28,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: 14,
              marginBottom: 22,
            }}
          >
            <div>
              <div
                style={{
                  ...smallLabel,
                  marginBottom: 9,
                }}
              >
                STEP 01 / SELECT
              </div>

              <h2
                id="connect-selection-title"
                style={{
                  margin: '0 0 7px',
                  fontSize: 21,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  color: colors.ink,
                }}
              >
                Choose your resources
              </h2>

              <p
                style={{
                  margin: 0,
                  color: colors.muted,
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                Select 2 to 5 resources to explore together.
              </p>
            </div>

            <div
              style={{
                padding: '9px 13px',
                borderRadius: 10,
                background: colors.purpleLight,
                color: colors.purpleDark,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {selectedIds.length} / 5 selected
            </div>
          </div>

          {/* SEARCH */}
          <div
            style={{
              position: 'relative',
              marginBottom: 18,
            }}
          >
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search your library by title or source..."
              aria-label="Search saved resources"
              style={{
                width: '100%',
                height: 48,
                padding: '0 16px',
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                background: colors.background,
                color: colors.ink,
                fontSize: 14,
              }}
            />
          </div>

          {/* RESOURCE CARDS */}
          {loading ? (
            <div
              style={{
                padding: '42px 12px',
                textAlign: 'center',
                color: colors.muted,
              }}
            >
              Loading your library...
            </div>
          ) : resources.length === 0 ? (
            <div
              style={{
                padding: '44px 20px',
                textAlign: 'center',
                background: colors.background,
                borderRadius: 14,
              }}
            >
              <h3 style={{ color: colors.ink }}>
                Your library is waiting.
              </h3>
              <p style={{ color: colors.muted, fontSize: 14 }}>
                Save a few resources to start connecting ideas.
              </p>
            </div>
          ) : filteredResources.length === 0 ? (
            <div
              style={{
                padding: '36px 16px',
                textAlign: 'center',
                color: colors.muted,
                fontSize: 14,
              }}
            >
              No resources match your search.
            </div>
          ) : (
            <div
              className="resource-grid"
              style={{
                maxHeight: 350,
                overflowY: 'auto',
                padding: 3,
              }}
            >
              {filteredResources.map(resource => {
                const selected = selectedIds.includes(resource.id)

                return (
                  <button
                    key={resource.id}
                    type="button"
                    className={`resource-card ${selected ? 'selected' : ''}`}
                    aria-pressed={selected}
                    disabled={generating}
                    onClick={() => toggleResource(resource.id)}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 22,
                        height: 22,
                        flexShrink: 0,
                        borderRadius: 7,
                        border: selected
                          ? `1px solid ${colors.purple}`
                          : '1.5px solid #cbd5e1',
                        background: selected
                          ? colors.purple
                          : colors.white,
                        color: colors.white,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {selected ? '✓' : ''}
                    </span>

                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 14,
                          fontWeight: 650,
                          color: colors.ink,
                          lineHeight: 1.5,
                          overflowWrap: 'anywhere',
                          marginBottom: 7,
                        }}
                      >
                        {resource.title || 'Untitled resource'}
                      </span>

                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: colors.muted,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {getSourceLabel(resource)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {/* SELECTED RESOURCES */}
          {selectedIds.length > 0 && (
            <div
              style={{
                marginTop: 23,
                paddingTop: 20,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <span style={smallLabel}>Your selection</span>

                <button
                  type="button"
                  className="connect-secondary"
                  disabled={generating}
                  onClick={clearSelection}
                >
                  Clear all
                </button>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                {selectedIds.map(id => (
                  <button
                    key={id}
                    type="button"
                    disabled={generating}
                    onClick={() => toggleResource(id)}
                    aria-label={`Remove ${resourceName(id)} from selection`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 9,
                      maxWidth: '100%',
                      padding: '8px 11px',
                      borderRadius: 9,
                      border: '1px solid #ddd7fc',
                      background: colors.purpleLight,
                      color: colors.purpleDark,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {resourceName(id)}
                    </span>
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* DISCOVER ACTION */}
          <div
            className="connect-action-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 18,
              marginTop: 25,
              paddingTop: 22,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 650,
                  color: colors.ink,
                  marginBottom: 4,
                }}
              >
                {selectedIds.length < 2
                  ? 'Select at least 2 resources'
                  : 'Ready to explore'}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: colors.muted,
                  lineHeight: 1.6,
                }}
              >
                Curio will look for meaningful,
                source-supported relationships.
              </div>
            </div>

            <button
              type="button"
              className="connect-primary"
              disabled={!canGenerate}
              onClick={generateConnections}
            >
              <span aria-hidden="true">
                {generating ? '◌' : '✦'}
              </span>
              {generating
                ? 'Discovering...'
                : 'Discover connections'}
            </button>
          </div>
        </section>

        {/* ERROR */}
        {error && (
          <div
            role="alert"
            style={{
              marginTop: 18,
              padding: '17px 20px',
              background: '#fff7f6',
              border: '1px solid #f5d5d0',
              borderRadius: 13,
              color: '#a33b36',
              fontSize: 13,
              lineHeight: 1.7,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>
              Something interrupted the discovery.
            </strong>
            {error}
          </div>
        )}

        {/* GENERATING */}
        {generating && (
          <section
            aria-live="polite"
            style={{
              ...panel,
              marginTop: 24,
              padding: '45px 24px',
              textAlign: 'center',
            }}
          >
            <div
              className="loading-pulse"
              aria-hidden="true"
              style={{
                width: 55,
                height: 55,
                margin: '0 auto 20px',
                borderRadius: 17,
                background: colors.purpleLight,
                color: colors.purple,
                fontSize: 29,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✦
            </div>

            <h3
              style={{
                margin: '0 0 10px',
                fontSize: 19,
                color: colors.ink,
              }}
            >
              Looking for the connections...
            </h3>

            <p
              style={{
                margin: 0,
                color: colors.muted,
                fontSize: 13,
                lineHeight: 1.8,
              }}
            >
              Reading across your selected resources,
              comparing ideas, and checking supporting evidence.
            </p>
          </section>
        )}

        {/* RESULTS */}
        {result && !generating && (
          <section
            id="connect-results"
            aria-label="Connection results"
            style={{ marginTop: 35, scrollMarginTop: 25 }}
          >
            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  ...smallLabel,
                  color: colors.purple,
                  marginBottom: 9,
                }}
              >
                STEP 02 / DISCOVER
              </div>

              <h2
                style={{
                  margin: 0,
                  fontSize: 26,
                  letterSpacing: '-0.035em',
                  color: colors.ink,
                }}
              >
                What connects these ideas?
              </h2>
            </div>

            {/* INSIGHT SUMMARY */}
            <div
              style={{
                ...panel,
                padding: '26px 28px',
                background:
                  'linear-gradient(135deg, #f7f5ff 0%, #ffffff 72%)',
                borderColor: '#e6e0ff',
              }}
            >
              <div
                style={{
                  ...smallLabel,
                  color: colors.purple,
                  marginBottom: 13,
                }}
              >
                THE BIG PICTURE
              </div>

              <p
                style={{
                  margin: 0,
                  color: colors.ink,
                  fontSize: 15,
                  lineHeight: 1.9,
                }}
              >
                {result.summary}
              </p>

              {result.shared_themes?.length > 0 && (
                <div
                  style={{
                    marginTop: 23,
                    paddingTop: 19,
                    borderTop: '1px solid #e8e3fa',
                  }}
                >
                  <div
                    style={{
                      ...smallLabel,
                      marginBottom: 13,
                    }}
                  >
                    SHARED THEMES
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 9,
                    }}
                  >
                    {result.shared_themes.map((theme, index) => (
                      <span
                        key={`${theme}-${index}`}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 9,
                          background: colors.white,
                          border: '1px solid #e4defa',
                          color: colors.purpleDark,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* CONNECTIONS */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                margin: '32px 0 15px',
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 19,
                  color: colors.ink,
                  letterSpacing: '-0.02em',
                }}
              >
                Discovered connections
              </h3>

              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: colors.muted,
                }}
              >
                {result.connections.length} found
              </span>
            </div>

            {result.connections.length === 0 && (
              <div
                style={{
                  ...panel,
                  padding: '34px 25px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 30,
                    color: colors.purple,
                    marginBottom: 12,
                  }}
                >
                  ◇
                </div>

                <h4
                  style={{
                    margin: '0 0 9px',
                    color: colors.ink,
                    fontSize: 17,
                  }}
                >
                  No clear connections yet
                </h4>

                <p
                  style={{
                    maxWidth: 460,
                    margin: '0 auto',
                    color: colors.muted,
                    lineHeight: 1.8,
                    fontSize: 13,
                  }}
                >
                  Curio couldn't establish a meaningful
                  relationship supported by these sources.
                  Try a different combination of resources.
                </p>
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gap: 15,
              }}
            >
              {result.connections.map((connection, index) => {
                const evidenceOpen = expandedEvidence.includes(index)

                const relationshipColor =
                  relationshipColors[connection.relationship_type] ||
                  colors.purple

                return (
                  <article
                    key={`${connection.title}-${index}`}
                    className="connection-card"
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        marginBottom: 19,
                      }}
                    >
                      <span
                        style={{
                          ...smallLabel,
                          color: colors.subtle,
                        }}
                      >
                        CONNECTION {String(index + 1).padStart(2, '0')}
                      </span>

                      <span
                        style={{
                          padding: '7px 11px',
                          borderRadius: 8,
                          background: colors.background,
                          color: relationshipColor,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {relationshipLabels[connection.relationship_type] ||
                          connection.relationship_type}
                      </span>
                    </div>

                    <h4
                      style={{
                        margin: '0 0 11px',
                        fontSize: 19,
                        fontWeight: 750,
                        letterSpacing: '-0.025em',
                        color: colors.ink,
                        lineHeight: 1.4,
                      }}
                    >
                      {connection.title}
                    </h4>

                    <p
                      style={{
                        margin: '0 0 18px',
                        fontSize: 14,
                        lineHeight: 1.85,
                        color: '#40516b',
                      }}
                    >
                      {connection.explanation}
                    </p>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: 13,
                      }}
                    >
                      {connection.resource_ids.map(id => (
                        <span
                          key={id}
                          style={{
                            maxWidth: '100%',
                            padding: '8px 11px',
                            borderRadius: 9,
                            background: colors.blueLight,
                            color: '#335b96',
                            fontSize: 12,
                            fontWeight: 600,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {resourceName(id)}
                        </span>
                      ))}
                    </div>

                    <p
                      style={{
                        margin: '0 0 17px',
                        fontSize: 12,
                        color: colors.muted,
                        lineHeight: 1.6,
                      }}
                    >
                      {relationshipDescriptions[connection.relationship_type] ||
                        'A relationship between these resources.'}
                    </p>

                    {/* EVIDENCE ACCORDION */}
                    {connection.evidence?.length > 0 && (
                      <div
                        style={{
                          borderTop: `1px solid ${colors.border}`,
                        }}
                      >
                        <button
                          type="button"
                          className="evidence-toggle"
                          aria-expanded={evidenceOpen}
                          onClick={() => toggleEvidence(index)}
                        >
                          <span>
                            {evidenceOpen
                              ? 'Hide source evidence'
                              : `View source evidence (${connection.evidence.length})`}
                          </span>

                          <span aria-hidden="true">
                            {evidenceOpen ? '−' : '+'}
                          </span>
                        </button>

                        {evidenceOpen && (
                          <div
                            style={{
                              display: 'grid',
                              gap: 12,
                              paddingBottom: 6,
                            }}
                          >
                            {connection.evidence.map(
                              (evidence, evidenceIndex) => (
                                <div
                                  key={`${evidence.resource_id}-${evidenceIndex}`}
                                  style={{
                                    padding: '16px 18px',
                                    background: colors.background,
                                    borderRadius: 12,
                                    borderLeft: `3px solid ${colors.purple}`,
                                  }}
                                >
                                  <div
                                    style={{
                                      ...smallLabel,
                                      fontSize: 10,
                                      marginBottom: 10,
                                      overflowWrap: 'anywhere',
                                    }}
                                  >
                                    {resourceName(evidence.resource_id)}
                                  </div>

                                  <blockquote
                                    style={{
                                      margin: 0,
                                      color: '#475569',
                                      fontSize: 13,
                                      lineHeight: 1.85,
                                      fontStyle: 'italic',
                                      overflowWrap: 'anywhere',
                                    }}
                                  >
                                    "{evidence.excerpt}"
                                  </blockquote>
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>

            {/* UNCONNECTED RESOURCES */}
            {result.unconnected_resource_ids?.length > 0 && (
              <div
                style={{
                  marginTop: 20,
                  padding: '20px 23px',
                  background: colors.background,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 14,
                }}
              >
                <h4
                  style={{
                    margin: '0 0 9px',
                    fontSize: 14,
                    color: colors.ink,
                  }}
                >
                  Ideas that didn't connect clearly
                </h4>

                <p
                  style={{
                    margin: '0 0 12px',
                    fontSize: 13,
                    lineHeight: 1.75,
                    color: colors.muted,
                  }}
                >
                  Curio didn't find enough supporting evidence
                  to connect these resources meaningfully
                  in this analysis.
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  {result.unconnected_resource_ids.map(id => (
                    <span
                      key={id}
                      style={{
                        padding: '7px 10px',
                        background: colors.white,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        fontSize: 12,
                        color: colors.muted,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {resourceName(id)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p
              style={{
                marginTop: 22,
                textAlign: 'center',
                fontSize: 12,
                lineHeight: 1.7,
                color: colors.subtle,
              }}
            >
              AI-generated interpretations can be imperfect.
              Review the supporting excerpts before relying
              on a connection.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
