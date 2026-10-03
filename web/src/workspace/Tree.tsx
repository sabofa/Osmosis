import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookIcon, ChevronDownIcon, ChevronRightIcon, CompassIcon, FolderIcon, PuzzleIcon } from '../components/icons'
import { webFileType } from './fileTypes'
import { createUnder } from './create'
import { getChildren, getNodeDetail, removePlacement, renamePlacement, type ChildRow, type NodeSummary } from './wsApi'

// The tree of a container's children, loaded a level at a time as folders are
// opened. A row is one placement: the name it shows is the name of that
// placement (names live on placements, so the same file can be called two
// things in two places), and the row menu acts on that placement, which is why
// "Remove from here" and "Destroy" are different entries: one takes this
// placement away, the other takes the file out of every place it appears.

// What a row shows and acts on. `placementId` and `container` are null where
// the row is not reached through a placement of a known container (the
// Courses list, the scratch view); those rows have no rename-here or remove.
export interface RowModel {
  key: string
  node: NodeSummary
  name: string
  // Shown in place of `name` (the Courses list shows the path).
  label?: string
  placementId: string | null
  container: { id: string; title: string } | null
}

// What the rows need from the sidebar that owns them.
export interface TreeCtx {
  // Bumped whenever the graph changed, so every open list reloads itself.
  version: number
  openFile(nodeId: string, title: string): void
  // A track or a course: the workspace becomes it.
  openWorkspace(node: NodeSummary): void
  changed(): void
  renamed(nodeId: string, title: string): void
  notify(text: string, kind?: 'error' | 'info'): void
  requestDestroy(node: NodeSummary, name: string): void
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function Glyph({ node }: { node: NodeSummary }): ReactNode {
  if (node.kind === 'track') return <CompassIcon size={14} />
  if (node.kind === 'course') return <BookIcon size={14} />
  if (node.kind === 'folder') return <FolderIcon size={14} />
  return (node.type && webFileType(node.type)?.icon) || <PuzzleIcon size={14} />
}

export function Tree({
  containerId,
  containerTitle,
  ctx,
  depth = 0,
  filter,
  empty = 'Nothing here yet.',
}: {
  containerId: string
  containerTitle: string
  ctx: TreeCtx
  depth?: number
  filter?: (row: ChildRow) => boolean
  empty?: string
}) {
  const [rows, setRows] = useState<ChildRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getChildren(containerId)
      .then((r) => {
        if (!live) return
        setRows(r)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [containerId, ctx.version])

  const shown = rows && (filter ? rows.filter(filter) : rows)
  const pad = { paddingLeft: 8 + depth * 14 }
  if (error) return <div className="ws-note ws-error-text" style={pad}>{error}</div>
  if (!shown) return <div className="ws-note" style={pad}>Loading…</div>
  if (shown.length === 0) return <div className="ws-note" style={pad}>{empty}</div>
  return (
    <ul className="ws-tree">
      {shown.map((r) => (
        <TreeRow
          key={r.placement_id}
          model={{ key: r.placement_id, node: r.node, name: r.name, placementId: r.placement_id, container: { id: containerId, title: containerTitle } }}
          ctx={ctx}
          depth={depth}
        />
      ))}
    </ul>
  )
}

export function TreeRow({ model, ctx, depth }: { model: RowModel; ctx: TreeCtx; depth: number }) {
  const { node } = model
  const shownName = model.label ?? model.name
  const isContainer = node.kind !== 'file'
  // A track or a course is a workspace of its own; only a folder opens in place.
  const isWorkspace = node.kind === 'track' || node.kind === 'course'
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [sharedTitle, setSharedTitle] = useState<string | null>(null)
  const sharedAsked = useRef(false)
  const menuRef = useRef<HTMLSpanElement>(null)

  // The menu closes on a click anywhere else and on Escape.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function click() {
    if (node.kind === 'file') ctx.openFile(node.id, shownName)
    else if (isWorkspace) ctx.openWorkspace(node)
    else setOpen((o) => !o)
  }

  // The containers a shared item appears in, fetched when the pointer first
  // rests on the badge and shown as its tooltip.
  function loadShared() {
    if (sharedAsked.current) return
    sharedAsked.current = true
    getNodeDetail(node.id)
      .then((d) => setSharedTitle(d.appears_in.map((a) => `${a.container.title} (as "${a.name}")`).join('\n')))
      .catch(() => {
        sharedAsked.current = false
      })
  }

  // Runs one menu action; a failure is shown in the sidebar's notice line.
  async function act(fn: () => Promise<void>) {
    setMenu(false)
    try {
      await fn()
    } catch (err) {
      ctx.notify(messageOf(err))
    }
  }

  const make = (kind: 'file' | 'folder') =>
    act(async () => {
      const made = await createUnder(node.id, kind)
      if (!made) return
      setOpen(true)
      ctx.changed()
      if (kind === 'file') ctx.openFile(made.id, made.title)
    })

  const renameHere = () =>
    act(async () => {
      if (!model.placementId) return
      const name = window.prompt('Rename here (this name is only used in this place)', model.name)
      if (name === null || name.trim() === '' || name === model.name) return
      const placement = await renamePlacement(model.placementId, name)
      ctx.renamed(node.id, placement.name)
      ctx.changed()
    })

  const removeHere = () =>
    act(async () => {
      if (!model.placementId) return
      const out = await removePlacement(model.placementId)
      ctx.changed()
      if (out.became_unplaced) ctx.notify(`"${shownName}" is not placed anywhere now. It is still in the picker, under Unplaced.`, 'info')
    })

  return (
    <li>
      <div className="ws-row" style={{ paddingLeft: 8 + depth * 14 }}>
        <button className="ws-row-main" onClick={click} aria-expanded={node.kind === 'folder' ? open : undefined}>
          <span className="ws-chev">{node.kind === 'folder' ? open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} /> : null}</span>
          <span className="ws-glyph">
            <Glyph node={node} />
          </span>
          <span className="ws-row-name">{shownName}</span>
        </button>
        {node.kind_tag && <span className={`ws-dot tag-${node.kind_tag}`} title={node.kind_tag} aria-label={node.kind_tag} />}
        {node.placement_count > 1 && (
          <span className="ws-shared" title={sharedTitle ?? `Placed in ${node.placement_count} containers`} onMouseEnter={loadShared}>
            ×{node.placement_count}
          </span>
        )}
        <span className="ws-menu-wrap" ref={menuRef}>
          <button className="ws-row-menu-btn" aria-label={`Menu for ${shownName}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <div className="ws-menu" role="menu">
              {isContainer && (
                <>
                  <button role="menuitem" onClick={() => void make('file')}>
                    New file
                  </button>
                  <button role="menuitem" onClick={() => void make('folder')}>
                    New folder
                  </button>
                </>
              )}
              {model.placementId && (
                <button role="menuitem" onClick={() => void renameHere()}>
                  Rename here
                </button>
              )}
              {(isContainer || model.placementId) && <div className="ws-menu-sep" role="separator" />}
              {model.placementId && model.container && (
                <button role="menuitem" onClick={() => void removeHere()}>
                  Remove from "{model.container.title}"
                </button>
              )}
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(false)
                  ctx.requestDestroy(node, shownName)
                }}
              >
                Destroy…
              </button>
            </div>
          )}
        </span>
      </div>
      {open && node.kind === 'folder' && <Tree containerId={node.id} containerTitle={shownName} ctx={ctx} depth={depth + 1} />}
    </li>
  )
}
