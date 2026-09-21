import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Take from './Take'
import RichText from './RichText'
import ShowCard from './ShowCard'
import {
  getAttempt,
  getSessionStream,
  type AttemptDetail,
  type SessionStreamData,
  type StreamEntry,
} from '../lib/api'
import {
  bannerText,
  contextAt,
  entryKey,
  isCollapsed,
  openItem,
  pendingShow,
  stateLine,
  stubLabel,
  stubReason,
  timerSecondsLeft,
} from '../lib/sessionStream'
import { subscribeSession, canStreamSessionEvents, type StreamState } from '../lib/liveEvents'
import { notifyItemPresented, notifyShowPresented } from '../lib/notify'
import { useKeyboard } from '../hooks/useKeyboard'
import { formatClock, timerClass } from '../lib/timeFormat'
import { ClockIcon } from './icons'
import './SessionStream.css'

// No stream available at all (an old runtime without EventSource): the pre-push
// polling interval, unchanged.
const POLL_MS = 3000
// A stream exists but is down. Slower on purpose — EventSource reconnects on
// its own every 2s, so this is a safety net, not the mechanism.
const FALLBACK_POLL_MS = 15000
// How often the banner's countdown redraws.
const TICK_MS = 1000

// ----------------------------------------------------------------------------
// The session stream (§5.3). Everything the tutor has put on the screen this
// session, oldest at the top, with the item it is currently waiting on
// rendered inline as a real Take at the bottom.
//
// Two things this screen must get right and the version before it did not:
//
//   1. The event subscription outlives whatever is on screen. Task 7's
//      LiveItem tore its subscription down the moment an item arrived, on the
//      grounds that Take owned the attempt from then on — which meant a show
//      presented while Ben was mid-item reached him only on the next poll.
//      Here the subscription depends on the session id alone.
//   2. The reveal gate (§5.5, lib/sessionStream.ts): while an item is open,
//      everything behind it collapses to a one-line stub, so an earlier
//      answer key is not sitting on the same page as the question being
//      answered.
// ----------------------------------------------------------------------------

export default function SessionStream({ sessionId, onExit }: { sessionId: string; onExit: () => void }) {
  const [stream, setStream] = useState<SessionStreamData | null>(null)
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [expanded, setExpanded] = useState<Record<string, AttemptDetail>>({})
  const [error, setError] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<StreamState | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const entries = useMemo(() => stream?.entries ?? [], [stream])
  const sessionOpen = stream?.session.status !== 'closed'
  const open = openItem(entries)
  const waiting = pendingShow(entries)

  const bottomRef = useRef<HTMLDivElement>(null)
  // The Space key's destination: whichever ShowCard is currently the newest
  // unacknowledged one sets this while it is mounted.
  const acknowledgeRef = useRef<(() => void) | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await getSessionStream(sessionId)
      setStream(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [sessionId])

  // The stream and the attempt are read separately on purpose: the stream is
  // cheap and re-read constantly, and the attempt (which carries the question,
  // the choices and possibly an answer key) is read only for the one item
  // actually on screen.
  useEffect(() => {
    if (!open || !open.response_id) return
    if (attempt && attempt.id === open.attempt_id) return
    let cancelled = false
    getAttempt(open.attempt_id)
      .then((detail) => {
        if (!cancelled) setAttempt(detail)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [open, attempt])

  // The one case where the stream may take an item off the screen: it was
  // abandoned under Ben (the session ended while he had it open). Answering
  // clears it through onFinish instead, so a mid-answer refresh can never
  // stomp what he is typing.
  useEffect(() => {
    if (!attempt) return
    const entry = entries.find((e) => e.kind === 'item' && e.attempt_id === attempt.id)
    if (entry && entry.kind === 'item' && entry.status === 'abandoned') setAttempt(null)
  }, [entries, attempt])

  // The push channel. Subscribed for as long as this screen is mounted,
  // whatever is currently on it.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    function setPolling(ms: number | null) {
      if (timer) clearInterval(timer)
      timer = ms === null ? null : setInterval(() => void refresh(), ms)
    }

    void refresh()

    if (!canStreamSessionEvents()) {
      setStreamState(null)
      setPolling(POLL_MS)
      return () => {
        cancelled = true
        setPolling(null)
      }
    }

    setPolling(FALLBACK_POLL_MS)
    const off = subscribeSession(
      sessionId,
      (event) => {
        if (event.type === 'item_presented') notifyItemPresented()
        if (event.type === 'show_presented') notifyShowPresented()
        // Every event on this channel means the stream is stale — an answer
        // recorded, a graph redrawn, the session closed. One re-read answers
        // all of them.
        void refresh()
      },
      (state) => {
        if (cancelled) return
        setStreamState(state)
        if (state === 'connected') {
          // The stream only tells us what happens from now on, so read once
          // on connect to catch anything that landed while it was down.
          setPolling(null)
          void refresh()
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
  }, [sessionId, refresh])

  // The banner's countdown, and nothing else — one interval for the whole
  // screen rather than one per entry.
  const context = stream?.session.context ?? null
  const hasTimer = typeof context?.timer_s === 'number'
  useEffect(() => {
    if (!hasTimer) return
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [hasTimer])

  // A newly landed entry scrolls itself into view. Keyed on the last entry
  // rather than the count so an entry replaced in place (a graph redrawn) does
  // not yank the page.
  const lastKey = entries.length > 0 ? entryKey(entries[entries.length - 1]) : null
  useEffect(() => {
    if (!lastKey) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lastKey])

  useKeyboard(
    { inTextField: false, kind: 'written', choiceCount: 0, recorded: false, showPending: waiting !== null },
    (action) => {
      if (action.type === 'acknowledge') acknowledgeRef.current?.()
    },
    // While an item is open, Take owns the keyboard — including Space, which
    // its recorded card uses to move on.
    open === null
  )

  async function expandItem(attemptId: string) {
    if (expanded[attemptId]) {
      setExpanded(({ [attemptId]: _dropped, ...rest }) => rest)
      return
    }
    try {
      const detail = await getAttempt(attemptId)
      setExpanded((prev) => ({ ...prev, [attemptId]: detail }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const banner = bannerText(context)
  const secondsLeft = timerSecondsLeft(context, contextAt(entries), now)

  function renderEntry(entry: StreamEntry, index: number) {
    const key = entryKey(entry)
    if (isCollapsed(entries, index)) {
      return (
        <div key={key} className="stream-stub">
          <span className="stream-stub-label">{stubLabel(entry)}</span>
          <span className="stream-stub-why">{stubReason(entries, index)}</span>
        </div>
      )
    }

    if (entry.kind === 'show') {
      return (
        <ShowCard
          key={key}
          entry={entry}
          sessionOpen={sessionOpen}
          acknowledgeRef={waiting?.show_id === entry.show_id ? acknowledgeRef : undefined}
          onChanged={() => void refresh()}
        />
      )
    }

    // The item currently being answered: the real thing, inline.
    if (attempt && attempt.id === entry.attempt_id) {
      return (
        <div key={key} className="stream-stage">
          <Take
            attempt={attempt}
            setAttempt={setAttempt}
            onExit={onExit}
            onFinish={() => {
              setAttempt(null)
              void refresh()
            }}
          />
        </div>
      )
    }

    // The open item, still being fetched (or a fetch that failed). It must not
    // fall through to the expandable row below: offering to "show" the item
    // Ben is supposed to be answering reads as history, not as a question.
    if (entry.status === 'pending' || entry.status === 'paused') {
      return (
        <div key={key} className="stream-waiting">
          <span className="stream-pulse" />
          <span className="stream-waiting-text">Loading the item…</span>
        </div>
      )
    }

    const detail = expanded[entry.attempt_id]
    return (
      <div key={key} className="stream-item">
        <button className="stream-item-head" onClick={() => void expandItem(entry.attempt_id)}>
          <span className="stream-item-label">{stubLabel(entry)}</span>
          <span className="stream-item-toggle">{detail ? 'Hide' : 'Show'}</span>
        </button>
        {detail && (
          <div className="stream-item-body">
            {detail.responses.map((r) => (
              <div key={r.id} className="stream-item-response">
                <RichText className="stream-item-prompt" text={r.question.prompt} />
                {r.response_text && <div className="stream-item-answer">You wrote: {r.response_text}</div>}
                {r.idk && <div className="stream-item-answer">You said you didn't know.</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="session-stream">
      <div className="stream-banner">
        <button className="stream-back" onClick={onExit}>
          &larr; Back to sessions
        </button>
        <div className="stream-banner-text">
          <div className="stream-banner-where">{banner || stream?.session.name || 'Live session'}</div>
          <div className="stream-banner-state">
            {sessionOpen ? (
              <>
                <span className={`stream-pulse${streamState === 'reconnecting' ? ' stalled' : ''}`} />
                {streamState === 'reconnecting' ? 'reconnecting…' : stateLine(entries)}
              </>
            ) : (
              'session ended'
            )}
          </div>
        </div>
        {/* A countdown on a session that has ended is a clock with nothing
            left to time. */}
        {sessionOpen && secondsLeft !== null && (
          <span className={`timer-badge ${timerClass(secondsLeft)}`} title="Time the tutor suggested">
            <ClockIcon size={13} />
            {formatClock(secondsLeft * 1000)}
          </span>
        )}
      </div>

      {error && <div className="stream-error">Could not reach the local node: {error}</div>}

      <div className="stream-body no-scrollbar">
        {entries.map(renderEntry)}

        {/* The session's ending is the last thing in the stream, not a screen
            that replaces it — the evidence for the tutor's summary is the
            stream above it. */}
        {!sessionOpen ? (
          <div className="stream-ended">
            <div className="stream-ended-title">This session has ended</div>
            {stream?.session.summary ? (
              <RichText text={stream.session.summary} className="stream-ended-summary" />
            ) : (
              <div className="stream-waiting-text">The tutor left no summary.</div>
            )}
            <button className="stream-ended-btn" onClick={onExit}>
              Back to sessions
            </button>
          </div>
        ) : (
          open === null && (
            <div className="stream-waiting">
              <span className={`stream-pulse${streamState === 'reconnecting' ? ' stalled' : ''}`} />
              <span className="stream-waiting-text">
                {entries.length === 0 ? 'Waiting for the tutor…' : 'Waiting for whatever comes next…'}
              </span>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
