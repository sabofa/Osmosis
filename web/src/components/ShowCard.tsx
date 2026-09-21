import { useCallback, useEffect, useRef, useState } from 'react'
import RichText from './RichText'
import GraphPanel from './GraphPanel'
import { acknowledgeShow, markShowSeen, type ShowEntry } from '../lib/api'
import { SHOW_KEY_HINT } from '../lib/keymap'
import './ShowCard.css'

// ----------------------------------------------------------------------------
// One thing the tutor put on the screen that isn't a question (§5.1). Text and
// markdown both go through RichText — the same renderer a question prompt
// uses, so a formula in a show looks like a formula in an item. That renderer
// does LaTeX and line breaks, not markdown emphasis, so a `**bold**` arrives
// with its asterisks showing; the tool description says so rather than
// promising something the app doesn't do. A graph goes through the same
// GraphPanel a graph question uses.
//
// The card keeps exactly one piece of state of its own: dwell, measured from
// its first paint. It reports that time twice for two different reasons — as
// `seen` when the card leaves the screen, unmounts, or the session closes
// under it, and as `acknowledge` when Ben says OK. The server keeps the larger
// of whatever it is told, so neither report can shorten the other.
//
// The `seen` report is not suppressed once the session closes, and the server
// does not refuse it: a show read right up to the moment the tutor ended the
// session is precisely the one whose dwell is worth having, and staying quiet
// there would leave it reading `pending` with no dwell forever. Acknowledging
// after the close is a different matter — that is an act, and the server
// refuses it with a 409.
// ----------------------------------------------------------------------------

export default function ShowCard({
  entry,
  sessionOpen,
  acknowledgeRef,
  onChanged,
}: {
  entry: ShowEntry
  sessionOpen: boolean
  // Set to this card's acknowledge function while it is the newest
  // unacknowledged show, so the stream's Space key reaches it without every
  // card listening for its own keystrokes.
  acknowledgeRef?: { current: (() => void) | null }
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const mountedAt = useRef(Date.now())
  const cardRef = useRef<HTMLDivElement>(null)
  // Whether this card has already told the server it was seen. One report per
  // mount is enough — dwell only grows, and the acknowledge carries the final
  // number anyway.
  const reportedSeen = useRef(false)
  const acknowledged = entry.acknowledged_at !== null
  // Read through a ref so `reportSeen` keeps one identity for the card's whole
  // life. Its identity is what the observer and the unmount cleanup below are
  // keyed on, and a `reportSeen` that changed would re-run both — turning
  // "acknowledged" into a spurious seen report.
  const acknowledgedRef = useRef(acknowledged)
  acknowledgedRef.current = acknowledged

  const dwell = useCallback(() => Date.now() - mountedAt.current, [])

  const reportSeen = useCallback(() => {
    // Never after an acknowledge: that already carried the final dwell, and a
    // seen behind it would be a second, smaller measurement of the same thing.
    if (reportedSeen.current || acknowledgedRef.current) return
    reportedSeen.current = true
    markShowSeen(entry.show_id, dwell()).catch(() => {
      // A failed seen costs the tutor a dwell number, not correctness — the
      // acknowledge, if it comes, carries the same measurement.
      reportedSeen.current = false
    })
  }, [entry.show_id, dwell])

  const acknowledge = useCallback(() => {
    if (busy || acknowledged || !sessionOpen) return
    setBusy(true)
    reportedSeen.current = true
    acknowledgeShow(entry.show_id, dwell())
      .then(() => onChanged())
      .catch((err) => window.alert(`Could not acknowledge: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setBusy(false))
  }, [busy, acknowledged, sessionOpen, entry.show_id, dwell, onChanged])

  // The stream's keyboard handler calls through this rather than through a
  // listener per card, so only the newest unacknowledged show ever answers
  // to Space.
  useEffect(() => {
    if (!acknowledgeRef) return
    acknowledgeRef.current = acknowledge
    return () => {
      if (acknowledgeRef.current === acknowledge) acknowledgeRef.current = null
    }
  }, [acknowledgeRef, acknowledge])

  // Seen is reported when the card leaves the viewport — not when it enters.
  // Entering is when dwell starts; leaving is when there is a number worth
  // sending. Unmount (the session ended, the page changed) sends it too.
  useEffect(() => {
    const node = cardRef.current
    if (!node || typeof IntersectionObserver !== 'function') return
    let wasVisible = false
    const observer = new IntersectionObserver((entries) => {
      for (const record of entries) {
        if (record.isIntersecting) wasVisible = true
        else if (wasVisible) reportSeen()
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [reportSeen])

  useEffect(() => {
    return () => reportSeen()
  }, [reportSeen])

  // The session ended under this card. Nothing unmounts and nothing scrolls,
  // so without this the dwell of the show Ben was reading when the tutor
  // wrapped up would never reach the server.
  useEffect(() => {
    if (!sessionOpen) reportSeen()
  }, [sessionOpen, reportSeen])

  return (
    <div
      ref={cardRef}
      className={`show-card${acknowledged ? ' acknowledged' : ''}`}
      data-show-kind={entry.show_kind}
    >
      <div className="show-card-body">
        {entry.show_kind === 'graph' ? (
          // Deliberately keyed on the show id and not on the spec: update_show
          // replaces the payload in place, and a key that changed with it
          // would tear the canvas down and build a new one, losing the frame
          // the spec's @bounds is there to hold.
          <GraphPanel key={entry.show_id} spec={entry.payload} />
        ) : (
          <RichText className="show-card-text" text={entry.payload} />
        )}
      </div>

      {entry.caption && <div className="show-card-caption">{entry.caption}</div>}

      <div className="show-card-foot">
        {acknowledged ? (
          <span className="show-card-done">Acknowledged</span>
        ) : sessionOpen ? (
          <>
            <span className="show-card-hint">{SHOW_KEY_HINT}</span>
            <button className="show-card-ok" onClick={acknowledge} disabled={busy}>
              OK
            </button>
          </>
        ) : (
          // The session closed before Ben got to this one. A disabled OK under
          // "Space to acknowledge" would be inviting him to do something the
          // server will refuse.
          <span className="show-card-done">Not acknowledged</span>
        )}
      </div>
    </div>
  )
}
