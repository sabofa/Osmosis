import { useCallback, useEffect, useState } from 'react'
import Take from './Take'
import RichText from './RichText'
import {
  getLivePendingAttempt,
  getSessionDetail,
  sessionIsOpen,
  type AttemptDetail,
  type SessionDetail,
} from '../lib/api'
import { subscribeSession, canStreamSessionEvents, type StreamState } from '../lib/liveEvents'
import { notifyItemPresented } from '../lib/notify'
import './LiveItem.css'

// No stream available at all (an old runtime without EventSource): exactly the
// behaviour this screen had before push existed.
const POLL_MS = 3000
// A stream exists but is down. Slower on purpose — the stream reconnects on
// its own every 2s, so this is a safety net, not the mechanism.
const FALLBACK_POLL_MS = 15000

// Mounted when Ben opens a session's "Live session" row. There's no
// create-attempt flow here — the tutor hands off an item over MCP by
// creating an `app_live` adhoc attempt, and this component's only job is to
// notice it. It subscribes to the session's event stream and re-reads
// `live-pending` the moment an item is presented (well under a second on
// LAN); a poll stays behind it for whenever the stream is down. Once
// `live-pending` returns a real attempt it hands that straight to the
// existing Take component (unmodified — Take is already generic over
// `attempt.responses`), and once Take's onFinish fires it goes back to
// waiting for whatever the tutor serves up next.
export default function LiveItem({ sessionId, onExit }: { sessionId: string; onExit: () => void }) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<StreamState | null>(null)
  // Set once the session is closed. Without this the screen waits for an item
  // that can never arrive — an open-ended "Waiting for the next item…" is a
  // lie as soon as the tutor has gone.
  const [ended, setEnded] = useState<SessionDetail | null>(null)

  // Reads the session itself rather than trusting the event: the summary is
  // written as part of ending, and this is also how a screen opened *after*
  // the session closed learns that it did.
  const checkEnded = useCallback(async () => {
    try {
      const detail = await getSessionDetail(sessionId)
      if (!sessionIsOpen(detail)) setEnded(detail)
    } catch {
      // A failed read leaves the screen waiting, which the poll below and the
      // next event will both correct.
    }
  }, [sessionId])

  useEffect(() => {
    void checkEnded()
  }, [checkEnded])

  // Only runs while nothing is pending — once `attempt` is set, Take owns
  // that attempt's lifecycle (via setAttempt) and this effect tears itself
  // down, so a stream nudge or a poll response can never stomp an
  // in-progress answer.
  useEffect(() => {
    if (attempt || ended) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      try {
        const { attempt: pending } = await getLivePendingAttempt(sessionId)
        if (cancelled) return
        setError(null)
        if (pending) setAttempt(pending)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    function setPolling(ms: number | null) {
      if (timer) clearInterval(timer)
      timer = ms === null ? null : setInterval(poll, ms)
    }

    poll()

    if (!canStreamSessionEvents()) {
      setStreamState(null)
      setPolling(POLL_MS)
      return () => {
        cancelled = true
        setPolling(null)
      }
    }

    // Until the stream says it is open, assume it isn't.
    setPolling(FALLBACK_POLL_MS)
    const off = subscribeSession(
      sessionId,
      (event) => {
        // Everything else on this channel concerns an item already on screen,
        // which is Take's business, not this screen's.
        if (event.type === 'item_presented') {
          notifyItemPresented()
          void poll()
        }
        if (event.type === 'session_ended') {
          void poll()
          void checkEnded()
        }
      },
      (state) => {
        if (cancelled) return
        setStreamState(state)
        if (state === 'connected') {
          // The stream can only tell us what happens from now on, so read
          // once on connect to catch anything handed off while it was down.
          setPolling(null)
          void poll()
        } else {
          setPolling(FALLBACK_POLL_MS)
        }
      }
    )

    return () => {
      cancelled = true
      setPolling(null)
      off()
    }
  }, [sessionId, attempt, ended, checkEnded])

  function handleFinish() {
    setAttempt(null)
  }

  if (attempt) {
    // The stage is what gives the live page its two columns at width (§7.8).
    // All Take exposes for it is a data-panel marker on its side column; the
    // layout itself lives in LiveItem.css, so Take is unchanged everywhere else.
    return (
      <div className="live-item-stage">
        <Take attempt={attempt} setAttempt={setAttempt} onExit={onExit} onFinish={handleFinish} />
      </div>
    )
  }

  if (ended) {
    return (
      <div className="live-item-waiting">
        <button className="live-item-back" onClick={onExit}>
          &larr; Back to sessions
        </button>
        <div className="live-item-waiting-body">
          <div className="live-item-ended">
            <div className="live-item-ended-title">This session has ended</div>
            {ended.summary ? (
              <RichText text={ended.summary} className="live-item-ended-summary" />
            ) : (
              <div className="live-item-waiting-text">The tutor left no summary.</div>
            )}
            <button className="live-item-ended-btn" onClick={onExit}>
              Back to sessions
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="live-item-waiting">
      <button className="live-item-back" onClick={onExit}>
        &larr; Back to session
      </button>
      <div className="live-item-waiting-body">
        <div className={`live-item-pulse${streamState === 'reconnecting' ? ' stalled' : ''}`} />
        <div className="live-item-waiting-text">
          {streamState === 'reconnecting' ? 'Reconnecting…' : 'Waiting for the next item…'}
        </div>
        {error && <div className="live-item-error">Could not reach the local node: {error}</div>}
      </div>
    </div>
  )
}
