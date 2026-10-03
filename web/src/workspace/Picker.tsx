import { useEffect, useState } from 'react'
import { Glyph } from './Tree'
import { createNode, getRoots, type NodeSummary, type Roots } from './wsApi'
import type { Root } from './wsState'

// What shows while no workspace is open: every track, every course, and the
// files and folders that are placed nowhere. A track or a course opens as a
// workspace. An unplaced file opens in the scratch view, which has no
// container of its own, only tabs.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export default function Picker({
  onOpen,
  onOpenScratch,
  onExit,
}: {
  onOpen(root: Root): void
  // The unplaced file to open in a tab, or null to just look at the scratch view.
  onOpenScratch(file: { nodeId: string; title: string } | null): void
  onExit(): void
}) {
  const [roots, setRoots] = useState<Roots | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRoots()
      .then((r) => live && setRoots(r))
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [])

  const asRoot = (n: NodeSummary): Root => ({ id: n.id, kind: n.kind === 'track' ? 'track' : 'course', title: n.title })

  async function create(kind: 'track' | 'course') {
    const title = window.prompt(`Name for the new ${kind}`)
    if (title === null || title.trim() === '') return
    try {
      const made = await createNode({ kind, title })
      onOpen({ id: made.node.id, kind, title: made.node.title })
    } catch (err) {
      setError(messageOf(err))
    }
  }

  function list(heading: string, items: NodeSummary[], open: (n: NodeSummary) => void, none: string) {
    return (
      <section className="ws-pick-section">
        <h2>{heading}</h2>
        {items.length === 0 ? (
          <div className="ws-note">{none}</div>
        ) : (
          <ul className="ws-pick-list">
            {items.map((n) => (
              <li key={n.id}>
                <span className="ws-glyph">
                  <Glyph node={n} />
                </span>
                <span className="ws-pick-title">{n.title}</span>
                {n.type && <span className="ws-pick-type">{n.type}</span>}
                {n.kind === 'folder' && <span className="ws-pick-type">folder</span>}
                <button className="ws-btn" onClick={() => open(n)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div className="ws ws-picker">
      <header className="ws-head">
        <div className="ws-title">
          <strong>Workspace</strong>
        </div>
        <div className="ws-head-actions">
          <button className="ws-btn" onClick={() => void create('track')}>
            New track
          </button>
          <button className="ws-btn" onClick={() => void create('course')}>
            New course
          </button>
          <button className="ws-btn" onClick={onExit}>
            Exit
          </button>
        </div>
      </header>
      <div className="ws-pick-body">
        {error && (
          <div className="ws-error" role="alert">
            {error}
          </div>
        )}
        {!roots && !error && <div className="ws-note">Loading…</div>}
        {roots && (
          <>
            {list('Tracks', roots.tracks, (n) => onOpen(asRoot(n)), 'No tracks yet.')}
            {list('Courses', roots.courses, (n) => onOpen(asRoot(n)), 'No courses yet.')}
            {list('Unplaced', roots.unplaced, (n) => onOpenScratch(n.kind === 'file' ? { nodeId: n.id, title: n.title } : null), 'Nothing is unplaced.')}
          </>
        )}
      </div>
    </div>
  )
}
