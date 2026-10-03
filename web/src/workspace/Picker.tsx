import { useEffect, useState } from 'react'
import PlaceIn from './PlaceIn'
import { placeTargets, placeWithFallback, topTargets, type PlaceTarget } from './placing'
import TrashSection from './TrashSection'
import { Glyph } from './Tree'
import { createNode, getNodeDetail, getRoots, placeNode, searchUnder, type NodeSummary, type Roots } from './wsApi'
import type { Root } from './wsState'

// What shows while no workspace is open: every track, every course, the files
// and folders that are placed nowhere, and the trash. A track or a course opens
// as a workspace. An unplaced file opens in the scratch view, which has no
// container of its own, only tabs. Any of them can be placed in a track or a
// course from here ("Place in…"), and what was destroyed can be restored or
// purged.

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
  const [notice, setNotice] = useState<string | null>(null)
  // The node whose "Place in…" list is open.
  const [placing, setPlacing] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    getRoots()
      .then((r) => {
        if (!live) return
        setRoots(r)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [version])

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

  // The tracks and courses a node could go in, less where it already is and
  // anything inside it. (An unplaced file is in none and has nothing inside, so
  // for it that is every track and course the containment matrix allows.)
  async function topsFor(node: NodeSummary): Promise<PlaceTarget[]> {
    const [detail, rows] = await Promise.all([getNodeDetail(node.id), node.kind === 'file' ? Promise.resolve([]) : searchUnder(node.id)])
    const tops = topTargets([...(roots?.tracks ?? []), ...(roots?.courses ?? [])])
    return placeTargets(node, tops, { alreadyIn: detail.appears_in.map((a) => a.container.id), rows })
  }

  async function place(node: NodeSummary, target: PlaceTarget) {
    try {
      const out = await placeWithFallback(placeNode, target.id, node.id)
      setPlacing(null)
      setVersion((v) => v + 1)
      setNotice(
        out.fellBack
          ? `"${node.title}" is already taken in "${target.label}", so it was placed there as "${out.name}".`
          : `Placed "${node.title}" in "${target.label}".`
      )
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
                <div className="ws-pick-row">
                  <span className="ws-glyph">
                    <Glyph node={n} />
                  </span>
                  <span className="ws-pick-title">{n.title}</span>
                  {n.type && <span className="ws-pick-type">{n.type}</span>}
                  {n.kind === 'folder' && <span className="ws-pick-type">folder</span>}
                  <button className="ws-btn" aria-expanded={placing === n.id} onClick={() => setPlacing(placing === n.id ? null : n.id)}>
                    Place in…
                  </button>
                  <button className="ws-btn" onClick={() => open(n)}>
                    Open
                  </button>
                </div>
                {placing === n.id && <PlaceIn title={n.title} load={() => topsFor(n)} onPlace={(t) => void place(n, t)} onClose={() => setPlacing(null)} />}
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
        {notice && (
          <div className="ws-notice info" role="status">
            <span>{notice}</span>
            <button className="ws-link" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
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
        <TrashSection onRestored={() => setVersion((v) => v + 1)} />
      </div>
    </div>
  )
}
