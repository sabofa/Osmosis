import { useEffect, useState } from 'react'
import ArchiveSection from './ArchiveSection'
import { deleteNotice } from './archive'
import DeleteDialog from './DeleteDialog'
import PlaceIn from './PlaceIn'
import { placeTargets, placeWithFallback, topTargets, type PlaceTarget } from './placing'
import { isWorkspaceKind } from './rows'
import { Glyph } from './Tree'
import { createNode, getNodeDetail, getRoots, getUnplaced, placeNode, retitleNode, searchUnder, type NodeSummary, type Roots } from './wsApi'
import type { Root } from './wsState'

// What shows while no workspace is open: every trajectory, track and course
// (the ones with no place yet are marked "top level", which is a normal state
// for them), the files and folders that are placed nowhere, and the Archive. A
// trajectory, a track or a course opens as a workspace. An unplaced file opens
// in the scratch view, which has no container of its own, only tabs. Any of
// them can be placed in a container from here ("Place in…"), renamed
// ("Rename…", which retitles) and deleted ("Delete…", which archives it), and
// what was deleted can be restored or purged. A trajectory has nothing to hold
// it, so for it and for any track or course at the top level this is the only
// place to rename or delete it.

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
  const [unplaced, setUnplaced] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The node whose "Place in…" list is open.
  const [placing, setPlacing] = useState<string | null>(null)
  // The node Delete… was pressed on.
  const [deleting, setDeleting] = useState<NodeSummary | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all([getRoots(), getUnplaced()])
      .then(([r, u]) => {
        if (!live) return
        setRoots(r)
        setUnplaced(u)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [version])

  // Made at the top level (no container), then opened.
  async function create(kind: 'trajectory' | 'track' | 'course') {
    const title = window.prompt(`Name for the new ${kind}`)
    if (title === null || title.trim() === '') return
    try {
      const made = await createNode({ kind, title })
      onOpen({ id: made.node.id, kind, title: made.node.title })
    } catch (err) {
      setError(messageOf(err))
    }
  }

  // The trajectories, tracks and courses a node could go in, less where it
  // already is and anything inside it. (An unplaced file is in none and has
  // nothing inside, so for it that is every container the containment matrix
  // allows.)
  async function topsFor(node: NodeSummary): Promise<PlaceTarget[]> {
    const [detail, rows] = await Promise.all([getNodeDetail(node.id), node.kind === 'file' ? Promise.resolve([]) : searchUnder(node.id)])
    const tops = topTargets([...(roots?.trajectories ?? []), ...(roots?.tracks ?? []), ...(roots?.courses ?? [])])
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

  // Rename…: the node's title, which is the name a container gives it when it
  // is placed without one and the name it has at the top level. A name in one
  // container is changed from that container's own row ("Rename here").
  async function rename(node: NodeSummary) {
    const title = window.prompt(`New title for "${node.title}"`, node.title)
    if (title === null || title.trim() === '' || title === node.title) return
    try {
      const out = await retitleNode(node.id, title)
      setError(null)
      setVersion((v) => v + 1)
      setNotice(`Renamed "${node.title}" to "${out.title}".`)
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
                  {n.top_level && <span className="ws-pick-type">top level</span>}
                  {n.format && <span className="ws-pick-type">{n.format}</span>}
                  {n.kind === 'folder' && <span className="ws-pick-type">folder</span>}
                  {/* Nothing holds a trajectory, so there is nowhere to place one. */}
                  {n.kind !== 'trajectory' && (
                    <button className="ws-btn" aria-expanded={placing === n.id} onClick={() => setPlacing(placing === n.id ? null : n.id)}>
                      Place in…
                    </button>
                  )}
                  <button className="ws-btn" onClick={() => void rename(n)}>
                    Rename…
                  </button>
                  <button className="ws-btn" onClick={() => setDeleting(n)}>
                    Delete…
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

  const openWorkspace = (n: NodeSummary) => {
    if (isWorkspaceKind(n.kind)) onOpen({ id: n.id, kind: n.kind, title: n.title })
  }

  return (
    <div className="ws ws-picker">
      <header className="ws-head">
        <div className="ws-title">
          <strong>Workspace</strong>
        </div>
        <div className="ws-head-actions">
          <button className="ws-btn" onClick={() => void create('trajectory')}>
            New trajectory
          </button>
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
        {roots && unplaced && (
          <>
            {list('Trajectories', roots.trajectories, openWorkspace, 'No trajectories yet.')}
            {list('Tracks', roots.tracks, openWorkspace, 'No tracks yet.')}
            {list('Courses', roots.courses, openWorkspace, 'No courses yet.')}
            {list('Unplaced', unplaced, (n) => onOpenScratch(n.kind === 'file' ? { nodeId: n.id, title: n.title } : null), 'Nothing is unplaced.')}
          </>
        )}
        <ArchiveSection onRestored={() => setVersion((v) => v + 1)} reloadKey={version} />
      </div>
      {deleting && (
        <DeleteDialog
          node={deleting}
          name={deleting.title}
          onDone={(archived) => {
            const { title } = deleting
            setDeleting(null)
            setPlacing(null)
            setError(null)
            setVersion((v) => v + 1)
            setNotice(deleteNotice(title, archived.length, true))
          }}
          onError={(message) => {
            setDeleting(null)
            setError(message)
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
