import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, BoltIcon, TagIcon, ClockIcon } from './icons'
import SessionStream from './SessionStream'
import RichText from './RichText'
import {
  getStatus,
  type NodeStatus,
  getSessions,
  getSessionDetail,
  endSession,
  sessionIsOpen,
  timeAgo,
  type SessionSummary,
  type SessionDetail,
} from '../lib/api'
import './SessionList.css'

// The "Live" nav's landing view — a list of tutoring sessions (the tutor
// creates one per conversation over MCP), each expandable in place to show
// its templates, its past attempt history, and a distinguished "Live
// session" row (open sessions only — a closed one has nothing left to hand
// off). Clicking that row mounts SessionStream, which subscribes to the session's
// event stream. Sessions are typically created once per
// tutoring conversation and Ben navigates here deliberately, so this list
// just re-fetches on mount/manual refresh rather than polling continuously.
export default function SessionList({
  onStart,
  onLiveActiveChange,
  initialLiveSessionId,
}: {
  onStart: (templateId: string) => void
  // Lets App hide the nav rail while a live item is on screen, the same way
  // it already does for Take reached via the Library/Home flows — this is
  // the one moment on this page that deserves the same distraction-free
  // treatment, not the session list itself.
  onLiveActiveChange?: (active: boolean) => void
  // §7.7: App hands the newest open session down on load so the live screen,
  // not the list, is what Ben lands on while a session is running.
  initialLiveSessionId?: string | null
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [liveSessionId, setLiveSessionId] = useState<string | null>(initialLiveSessionId ?? null)
  // Which session's "Mark closed" is in flight, and what it said if it failed.
  const [closingId, setClosingId] = useState<string | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  // Live items are created on the canonical node by the tutor and never
  // sync down. A local node forwards this page's reads and writes to the
  // server (server/src/http/liveProxy.ts), so it works here as long as the
  // server is reachable; the pill says which it is.
  const [status, setStatus] = useState<NodeStatus | null>(null)
  useEffect(() => {
    getStatus().then(setStatus).catch(() => {})
  }, [])
  const serverAppUrl = status && !status.canonical ? status.remote_url : null

  // The prop normally arrives with the mount, but App's session read can also
  // land after Ben has already opened this page himself.
  useEffect(() => {
    if (initialLiveSessionId) setLiveSessionId(initialLiveSessionId)
  }, [initialLiveSessionId])

  useEffect(() => {
    onLiveActiveChange?.(liveSessionId !== null)
    return () => onLiveActiveChange?.(false)
  }, [liveSessionId, onLiveActiveChange])

  function load() {
    setError(null)
    getSessions({ limit: 100 })
      .then((r) => setSessions(r.sessions))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!expandedId) {
      setDetail(null)
      return
    }
    setDetail(null)
    setDetailError(null)
    getSessionDetail(expandedId)
      .then(setDetail)
      .catch((err) => setDetailError(err instanceof Error ? err.message : String(err)))
  }, [expandedId])

  if (liveSessionId) {
    return <SessionStream sessionId={liveSessionId} onExit={() => setLiveSessionId(null)} />
  }

  function toggle(id: string) {
    setExpandedId((cur) => (cur === id ? null : id))
  }

  // The tutor normally ends its own session; when it walked away without
  // doing so, this is how the session stops being "open" forever. Same
  // server-side path, so the counts and the ephemeral retirement match.
  async function markClosed(id: string) {
    setClosingId(id)
    setCloseError(null)
    try {
      await endSession(id)
      load()
      const fresh = await getSessionDetail(id)
      setDetail(fresh)
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : String(err))
    } finally {
      setClosingId(null)
    }
  }

  return (
    <div className="session-list">
      <div className="panel session-list-panel">
        <div className="session-list-header">
          <h1>Live</h1>
          <button className="session-list-refresh" onClick={load} title="Refresh">
            <ClockIcon size={13} />
            {sessions ? `${sessions.length} session${sessions.length === 1 ? '' : 's'}` : '…'}
          </button>
        </div>

        {serverAppUrl && !status?.online && (
          <div className="session-list-empty">
            Live sessions come from the server and this device is offline right now. Downloaded tests still work
            here; the sessions return when the connection does.{' '}
            <a href={serverAppUrl} target="_blank" rel="noreferrer">Open the server app</a>
          </div>
        )}
        {error && <div className="session-list-empty">Could not reach the local node: {error}</div>}
        {sessions === null && !error && <div className="session-list-empty">Loading…</div>}
        {sessions && sessions.length === 0 && (
          <div className="session-list-empty">No tutoring sessions yet — the tutor creates one over MCP.</div>
        )}

        <div className="session-list-rows no-scrollbar">
          {sessions?.map((s) => {
            const isExpanded = s.id === expandedId
            const isClosed = !sessionIsOpen(s)
            return (
              <div className="session-row-wrap" key={s.id}>
                <button
                  className={`session-row${isExpanded ? ' open' : ''}${isClosed ? ' closed' : ''}`}
                  onClick={() => toggle(s.id)}
                >
                  <span className="session-row-chevron">
                    {isExpanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                  </span>
                  <span className="session-row-name">{s.name}</span>
                  {s.tag_slug && (
                    <span className="session-row-tag">
                      <TagIcon size={10} />
                      {s.tag_slug}
                    </span>
                  )}
                  <span className="session-row-spacer" />
                  <span className={`session-row-status${isClosed ? ' ended' : ' active'}`}>
                    {isClosed ? `closed ${timeAgo(s.ended_at)}` : `open · started ${timeAgo(s.created_at)}`}
                  </span>
                </button>

                {isExpanded && (
                  <div className="session-detail">
                    {detailError && <div className="session-list-empty">Could not load session: {detailError}</div>}
                    {!detail && !detailError && <div className="session-list-empty">Loading…</div>}
                    {detail && (
                      <>
                        {/* The tutor's closing recap comes first: it is what
                            this session was, and the attempt list below is the
                            evidence for it. */}
                        {detail.summary && (
                          <div className="session-summary">
                            <div className="session-detail-label">Summary</div>
                            <RichText text={detail.summary} className="session-summary-body" />
                          </div>
                        )}

                        {/* Only an open session can receive an item, so a
                            closed one doesn't offer a screen that would wait
                            forever. */}
                        {!isClosed && (
                          <>
                            <button className="session-live-row" onClick={() => setLiveSessionId(s.id)}>
                              <span className="session-live-dot" />
                              <BoltIcon size={14} />
                              Live session
                              <span className="session-live-hint">jump in as the tutor hands off items</span>
                            </button>
                            <button
                              className="session-close-row"
                              disabled={closingId === s.id}
                              onClick={() => markClosed(s.id)}
                            >
                              {closingId === s.id ? 'Closing…' : 'Mark closed'}
                              <span className="session-close-hint">
                                if the tutor left without ending it
                              </span>
                            </button>
                            {closeError && <div className="session-list-empty">Could not close: {closeError}</div>}
                          </>
                        )}

                        {detail.templates.length > 0 && (
                          <div className="session-detail-section">
                            <div className="session-detail-label">Templates</div>
                            {detail.templates.map((t) => (
                              <button key={t.id} className="session-detail-item" onClick={() => onStart(t.id)}>
                                <span className="session-detail-item-name">{t.name}</span>
                                <span className="session-detail-item-meta">{t.question_count} questions</span>
                              </button>
                            ))}
                          </div>
                        )}

                        {detail.attempts.length > 0 && (
                          <div className="session-detail-section">
                            <div className="session-detail-label">Attempt history</div>
                            {detail.attempts.map((a) => (
                              <div key={a.id} className="session-detail-item static">
                                <span className="session-detail-item-name">
                                  {a.template_name ?? (a.delivery_mode === 'app_live' ? 'Live item' : 'Ad hoc')}
                                </span>
                                <span className="session-detail-item-meta">
                                  {a.submitted_at
                                    ? `submitted ${timeAgo(a.submitted_at)}${
                                        a.revealed === false
                                          ? ' · recorded, held until this session ends'
                                          : a.mean_score !== null
                                            ? ` · ${a.mean_score.toFixed(2)}`
                                            : ''
                                      }`
                                    : a.abandoned_at
                                      ? 'abandoned'
                                      : 'in progress'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {detail.templates.length === 0 && detail.attempts.length === 0 && (
                          <div className="session-list-empty">Nothing recorded in this session yet.</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
