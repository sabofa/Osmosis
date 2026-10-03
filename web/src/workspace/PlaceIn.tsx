import { useEffect, useRef, useState } from 'react'
import type { PlaceTarget } from './placing'

// The "Place in…" list: a plain list of the containers an existing node could
// be placed in, each with a button that places it there. Not drag-and-drop
// (Ben, no advanced UI). `load` works out the list (placing.ts has the rules
// and the sidebar and the picker each know where to look); `onPlace` does the
// placing and says what happened. It is shown under the row it is for, in the
// same box as "+ Existing course…".

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export default function PlaceIn({
  title,
  load,
  onPlace,
  onClose,
}: {
  // The name of what is being placed, for the heading.
  title: string
  load(): Promise<PlaceTarget[]>
  onPlace(target: PlaceTarget): void
  onClose(): void
}) {
  const [targets, setTargets] = useState<PlaceTarget[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Once, when the list opens: it is the answer for that moment, so a later
  // render's new `load` does not ask again.
  const loadOnce = useRef(load)
  useEffect(() => {
    let live = true
    loadOnce.current()
      .then((t) => live && setTargets(t))
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="ws-existing" role="group" aria-label={`Place "${title}" in`}>
      <div className="ws-existing-head">Place "{title}" in…</div>
      {error ? (
        <div className="ws-note ws-error-text">{error}</div>
      ) : !targets ? (
        <div className="ws-note">Loading…</div>
      ) : targets.length === 0 ? (
        <div className="ws-note">Nowhere else it can go from here.</div>
      ) : (
        <ul>
          {targets.map((t) => (
            <li key={t.id}>
              <span className="ws-row-name" title={t.label}>
                {t.label}
              </span>
              <span className="ws-pick-type">{t.kind}</span>
              <button className="ws-btn" onClick={() => onPlace(t)}>
                Place
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="ws-link" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
