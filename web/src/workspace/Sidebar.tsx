import { useEffect, useState } from 'react'
import { deleteNotice } from './archive'
import DeleteDialog from './DeleteDialog'
import { makePathResolver } from './graphWalk'
import { createUnder } from './create'
import { listWebFileTypes } from './fileTypes'
import { chipTags } from './kindTags'
import { newOptions, type NewKind } from './newMenu'
import { placeTargets, placeWithFallback, topTargets, workspaceTargets, type PlaceTarget } from './placing'
import { addableNodes, isWorkspaceKind, showsRow, sidebarSections, type Section, type WorkspaceKind } from './rows'
import { Tree, TreeRow, type NoticeAction, type TreeCtx } from './Tree'
import type { Root } from './wsState'
import { getByKindTag, getChildren, getNodeDetail, getRoots, getUnplaced, placeNode, searchUnder, type NodeSummary, type PlacedRow } from './wsApi'

// The left side of the shell: a mode switcher (Files | Tools), the partition
// strip (one chip per kind tag), and the tree. A workspace's container is shown
// in sections (rows.ts, sidebarSections): a course is one list of files and
// folders; a track has Planning (files and folders) and its Courses; a
// trajectory has Planning and its Tracks and courses, where a track or a course
// can be made in it or an existing one added to it. The scratch view lists what
// is unplaced.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// The row Delete… was pressed on: the node, and what the row calls it.
interface DeleteReq {
  node: NodeSummary
  name: string
}

export default function Sidebar({
  root,
  onOpenFile,
  onOpenWorkspace,
  onRenamed,
  onGone,
}: {
  root: Root
  onOpenFile(nodeId: string, title: string): void
  onOpenWorkspace(next: Root): void
  onRenamed(nodeId: string, title: string): void
  // These nodes went to the Archive; their tabs have nothing to show.
  onGone(nodeIds: string[]): void
}) {
  const [mode, setMode] = useState<'files' | 'tools'>('files')
  const [version, setVersion] = useState(0)
  const [chip, setChip] = useState<string | null>(null)
  // The kind tags in use under this workspace, so a tag of Ben's own gets a chip.
  const [tagsInUse, setTagsInUse] = useState<(string | null)[]>([])
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'info'; action?: NoticeAction } | null>(null)
  const [deleteReq, setDeleteReq] = useState<DeleteReq | null>(null)
  const container = root.kind === 'scratch' ? null : { id: root.id, kind: root.kind, title: root.title }

  // Anything that changes the graph reloads the lists, and a message about an
  // earlier change is no longer news. (A notice is set after the refresh.)
  const refresh = () => {
    setVersion((v) => v + 1)
    setNotice(null)
  }

  useEffect(() => {
    if (root.kind === 'scratch') return
    let live = true
    searchUnder(root.id)
      .then((rows) => live && setTagsInUse(rows.map((r) => r.node.kind_tag)))
      // The lists below say what went wrong; the chips are just the five suggestions.
      .catch(() => {})
    return () => {
      live = false
    }
  }, [root.id, root.kind, version])

  const tags = chipTags(tagsInUse)
  // A chip whose tag has gone from the workspace (the last such file was
  // retagged) is no longer pressed.
  const activeChip = chip !== null && tags.includes(chip) ? chip : null

  // Where a node could be placed from here, for a row's "Place in…": in a
  // workspace its root, and the folders and tracks reachable in it; in the
  // scratch view (which has no root of its own) every trajectory, track and
  // course. Never a container the node is already in, or one inside it.
  async function targetsFor(node: NodeSummary): Promise<PlaceTarget[]> {
    const detail = await getNodeDetail(node.id)
    const alreadyIn = detail.appears_in.map((a) => a.container.id)
    if (root.kind === 'scratch') {
      // No root to walk down from: what is inside the node itself is what it
      // cannot be placed in, and the places are the trajectories, tracks and courses.
      const [roots, rows] = await Promise.all([getRoots(), node.kind === 'file' ? Promise.resolve([]) : searchUnder(node.id)])
      return placeTargets(node, topTargets([...roots.trajectories, ...roots.tracks, ...roots.courses]), { alreadyIn, rows })
    }
    const rows = await searchUnder(root.id)
    return placeTargets(node, workspaceTargets({ id: root.id, kind: root.kind, title: root.title }, rows), { alreadyIn, rows })
  }

  const ctx: TreeCtx = {
    version,
    openFile: onOpenFile,
    openWorkspace: (node) => {
      if (isWorkspaceKind(node.kind)) onOpenWorkspace({ id: node.id, kind: node.kind, title: node.title })
    },
    changed: refresh,
    renamed: onRenamed,
    notify: (text, kind = 'error', action) => setNotice({ text, kind, action }),
    requestDelete: (node, name) => setDeleteReq({ node, name }),
    placeTargets: targetsFor,
  }

  // New things straight into the workspace's own container, which has no row to
  // put a menu on.
  async function makeIn(kind: NewKind, format?: string) {
    try {
      const made = await createUnder(root.id, kind, format)
      if (!made) return
      refresh()
      if (kind === 'file') onOpenFile(made.id, made.title)
    } catch (err) {
      setNotice({ text: messageOf(err), kind: 'error' })
    }
  }

  return (
    <aside className="ws-side" aria-label="Workspace sidebar">
      <div className="ws-modes" role="tablist">
        <button role="tab" aria-selected={mode === 'files'} className={mode === 'files' ? 'active' : ''} onClick={() => setMode('files')}>
          Files
        </button>
        <button role="tab" aria-selected={mode === 'tools'} className={mode === 'tools' ? 'active' : ''} onClick={() => setMode('tools')}>
          Tools
        </button>
      </div>

      {notice && (
        <div className={`ws-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <span className="ws-notice-actions">
            {notice.action && (
              <button
                className="ws-link"
                onClick={() => {
                  // One press: the notice goes, so Undo cannot be pressed twice.
                  const { run } = notice.action!
                  setNotice(null)
                  void run()
                }}
              >
                {notice.action.label}
              </button>
            )}
            <button className="ws-link" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </span>
        </div>
      )}

      {mode === 'tools' ? (
        <div className="ws-note">No tools yet.</div>
      ) : (
        <div className="ws-side-scroll">
          {container && (
            <>
              <div className="ws-chips" aria-label="Kinds">
                {tags.map((tag) => (
                  <button key={tag} className={`ws-chip${activeChip === tag ? ' active' : ''}`} aria-pressed={activeChip === tag} onClick={() => setChip(activeChip === tag ? null : tag)}>
                    <span className={`ws-dot tag-${tag}`} />
                    {tag}
                  </button>
                ))}
              </div>
              {activeChip && <Partition root={root} tag={activeChip} version={version} onOpenFile={onOpenFile} />}
              {sidebarSections(container.kind).map((section) => (
                <SectionView key={section.key} container={container} section={section} ctx={ctx} makeIn={makeIn} />
              ))}
            </>
          )}

          {root.kind === 'scratch' && (
            <section>
              <div className="ws-section-head">
                <span>Unplaced</span>
              </div>
              <Unplaced ctx={ctx} />
            </section>
          )}
        </div>
      )}

      {deleteReq && (
        <DeleteDialog
          node={deleteReq.node}
          name={deleteReq.name}
          onDone={(archived) => {
            const { name } = deleteReq
            setDeleteReq(null)
            onGone(archived)
            refresh()
            setNotice({ text: deleteNotice(name, archived.length), kind: 'info' })
          }}
          onError={(text) => {
            setDeleteReq(null)
            setNotice({ text, kind: 'error' })
          }}
          onCancel={() => setDeleteReq(null)}
        />
      )}
    </aside>
  )
}

// The files of one kind in this workspace, each as "name — path", where the
// path is the names from the workspace down to the container it sits in.
function Partition({ root, tag, version, onOpenFile }: { root: Root; tag: string; version: number; onOpenFile(nodeId: string, title: string): void }) {
  const [rows, setRows] = useState<{ row: PlacedRow; path: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    ;(async () => {
      const found = await getByKindTag(root.id, tag)
      const resolve = makePathResolver(root.id, async (id) => (await getNodeDetail(id)).appears_in)
      const withPaths = await Promise.all(
        found.map(async (row) => {
          const names = await resolve(row.container_id)
          return { row, path: [root.title, ...(names ?? [])].join(' / ') }
        })
      )
      if (live) setRows(withPaths)
    })().catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [root.id, root.title, tag, version])

  if (error) return <div className="ws-note ws-error-text">{error}</div>
  if (!rows) return <div className="ws-note">Loading…</div>
  if (rows.length === 0) return <div className="ws-note">Nothing tagged {tag} here.</div>
  return (
    <ul className="ws-partition">
      {rows.map(({ row, path }) => (
        <li key={row.placement_id}>
          <button disabled={row.node.kind !== 'file'} onClick={() => onOpenFile(row.node.id, row.name)}>
            <span className="ws-row-name">{row.name}</span>
            <span className="ws-path"> — {path}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// One section of a workspace's container (rows.ts says which): its head with the
// "+ …" links for what it holds and, for tracks and courses, "+ Existing …" to
// add one that already exists; below that the container's children of its kinds.
function SectionView({
  container,
  section,
  ctx,
  makeIn,
}: {
  container: { id: string; kind: WorkspaceKind; title: string }
  section: Section
  ctx: TreeCtx
  makeIn(kind: NewKind, format?: string): Promise<void>
}) {
  const [adding, setAdding] = useState<NewKind | null>(null)
  const links = newOptions(container.kind, listWebFileTypes()).filter((o) => section.kinds.includes(o.kind))
  return (
    <section>
      <div className="ws-section-head">
        <span>{section.title}</span>
        <span className="ws-section-actions">
          {links.map((o) => (
            <button key={o.key} className="ws-link" onClick={() => void makeIn(o.kind, o.format)}>
              + {o.short}
            </button>
          ))}
          {section.existing.map((kind) => (
            <button key={kind} className="ws-link" aria-expanded={adding === kind} onClick={() => setAdding(adding === kind ? null : kind)}>
              + Existing {kind}…
            </button>
          ))}
        </span>
      </div>
      {adding && <ExistingNodes container={container} kind={adding} ctx={ctx} onClose={() => setAdding(null)} />}
      <Tree containerId={container.id} containerTitle={container.title} ctx={ctx} filter={(r) => showsRow(section, r)} empty={section.empty} />
    </section>
  )
}

// The live tracks or courses the container does not hold yet, each with an Add
// that places it here. A node can sit in several places, so adding one does not
// move it from anywhere. If its name is already taken in the container it goes
// in under the free name the server suggests, and the notice says so.
function ExistingNodes({
  container,
  kind,
  ctx,
  onClose,
}: {
  container: { id: string; title: string }
  kind: NewKind
  ctx: TreeCtx
  onClose(): void
}) {
  const [options, setOptions] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([getRoots(), getChildren(container.id)])
      .then(([roots, children]) => {
        if (!live) return
        setOptions(addableNodes(kind === 'track' ? roots.tracks : roots.courses, [kind], children, container.id))
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [container.id, kind, ctx.version])

  async function add(node: NodeSummary) {
    try {
      const out = await placeWithFallback(placeNode, container.id, node.id)
      ctx.changed()
      if (out.fellBack) ctx.notify(`"${node.title}" is already taken in "${container.title}", so it was added as "${out.name}".`, 'info')
    } catch (err) {
      ctx.notify(messageOf(err))
    }
  }

  return (
    <div className="ws-existing">
      {error ? (
        <div className="ws-note ws-error-text">{error}</div>
      ) : !options ? (
        <div className="ws-note">Loading…</div>
      ) : options.length === 0 ? (
        <div className="ws-note">{`No other ${kind}s to add.`}</div>
      ) : (
        <ul>
          {options.map((n) => (
            <li key={n.id}>
              <span className="ws-row-name">{n.title}</span>
              <button className="ws-btn" onClick={() => void add(n)}>
                Add
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

// What is placed nowhere: files and folders (a trajectory, track or course with
// no place is at the top level, and in the picker's lists instead).
function Unplaced({ ctx }: { ctx: TreeCtx }) {
  const [items, setItems] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getUnplaced()
      .then((rows) => {
        if (!live) return
        setItems(rows)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [ctx.version])

  if (error) return <div className="ws-note ws-error-text">{error}</div>
  if (!items) return <div className="ws-note">Loading…</div>
  if (items.length === 0) return <div className="ws-note">Nothing is unplaced.</div>
  return (
    <ul className="ws-tree">
      {items.map((node) => (
        <TreeRow key={node.id} model={{ key: node.id, node, name: node.title, placementId: null, container: null }} ctx={ctx} depth={0} />
      ))}
    </ul>
  )
}
