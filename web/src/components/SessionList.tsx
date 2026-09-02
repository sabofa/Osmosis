import { useEffect, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, BoltIcon, TagIcon, ClockIcon } from './icons'
import LiveItem from './LiveItem'
import {
  getSessions,
  getSessionDetail,
  timeAgo,
  type SessionSummary,
  type SessionDetail,
} from '../lib/api'
import './SessionList.css'

// The "Live" nav's landing view — a list of tutoring sessions (the tutor
// creates one per conversation over MCP), each expandable in place to show
// its templates, its past attempt history, and a distinguished "Live
// session" row. Clicking that row mounts LiveItem, which polls for whatever
// the tutor hands off next. Sessions are typically created once per
// tutoring conversation and Ben navigates here deliberately, so this list
// just re-fetches on mount/manual refresh rather than polling continuously.
export default function SessionList({
  onStart,
  onLiveActiveChange,
}: {
  onStart: (templateId: string) => void
  // Lets App hide the nav rail while a live item is on screen, the same way
  // it already does for Take reached via the Library/Home flows — this is
  // the one moment on this page that deserves the same distraction-free
  // treatment, not the session list itself.
  onLiveActiveChange?: (active: boolean) => void
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)

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
    return <LiveItem sessionId={liveSessionId} onExit={() => setLiveSessionId(null)} />
  }

  function toggle(id: string) {
    setExpandedId((cur) => (cur === id ? null : id))
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

        {error && <div className="session-list-empty">Could not reach the local node: {error}</div>}
        {sessions === null && !error && <div className="session-list-empty">Loading…</div>}
        {sessions && sessions.length === 0 && (
          <div className="session-list-empty">No tutoring sessions yet — the tutor creates one over MCP.</div>
        )}

        <div className="session-list-rows no-scrollbar">
          {sessions?.map((s) => {
            const isOpen = s.id === expandedId
            return (
              <div className="session-row-wrap" key={s.id}>
                <button className={`session-row${isOpen ? ' open' : ''}`} onClick={() => toggle(s.id)}>
                  <span className="session-row-chevron">
                    {isOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                  </span>
                  <span className="session-row-name">{s.name}</span>
                  {s.tag_slug && (
                    <span className="session-row-tag">
                      <TagIcon size={10} />
                      {s.tag_slug}
                    </span>
                  )}
                  <span className="session-row-spacer" />
                  <span className={`session-row-status${s.ended_at ? ' ended' : ' active'}`}>
                    {s.ended_at ? `ended ${timeAgo(s.ended_at)}` : `started ${timeAgo(s.created_at)}`}
                  </span>
                </button>

                {isOpen && (
                  <div className="session-detail">
                    {detailError && <div className="session-list-empty">Could not load session: {detailError}</div>}
                    {!detail && !detailError && <div className="session-list-empty">Loading…</div>}
                    {detail && (
                      <>
                        <button className="session-live-row" onClick={() => setLiveSessionId(s.id)}>
                          <span className="session-live-dot" />
                          <BoltIcon size={14} />
                          Live session
                          <span className="session-live-hint">jump in as the tutor hands off items</span>
                        </button>

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
                                    ? `submitted ${timeAgo(a.submitted_at)}${a.mean_score !== null ? ` · ${a.mean_score.toFixed(2)}` : ''}`
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
