import { useEffect, useState } from 'react'
import Take from './Take'
import { getLivePendingAttempt, type AttemptDetail } from '../lib/api'
import './LiveItem.css'

const POLL_MS = 3000

// Mounted when Ben opens a session's "Live session" row. There's no
// create-attempt flow here — the tutor hands off an item over MCP by
// creating an `app_live` adhoc attempt, and this component's only job is to
// notice it. While nothing is pending it polls; once `live-pending` returns
// a real attempt it hands that straight to the existing Take component
// (unmodified — Take is already generic over `attempt.responses`), and once
// Take's onFinish fires it goes back to polling for whatever the tutor
// serves up next.
export default function LiveItem({ sessionId, onExit }: { sessionId: string; onExit: () => void }) {
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Only polls while nothing is pending — once `attempt` is set, Take owns
  // that attempt's lifecycle (via setAttempt) and this effect tears itself
  // down, so a poll response can never stomp an in-progress answer.
  useEffect(() => {
    if (attempt) return
    let cancelled = false

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

    poll()
    const t = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [sessionId, attempt])

  function handleFinish() {
    setAttempt(null)
  }

  if (attempt) {
    return <Take attempt={attempt} setAttempt={setAttempt} onExit={onExit} onFinish={handleFinish} />
  }

  return (
    <div className="live-item-waiting">
      <button className="live-item-back" onClick={onExit}>
        &larr; Back to session
      </button>
      <div className="live-item-waiting-body">
        <div className="live-item-pulse" />
        <div className="live-item-waiting-text">Waiting for the next item&hellip;</div>
        {error && <div className="live-item-error">Could not reach the local node: {error}</div>}
      </div>
    </div>
  )
}
