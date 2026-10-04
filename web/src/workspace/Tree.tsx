import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BookIcon, ChevronDownIcon, ChevronRightIcon, CompassIcon, FlagIcon, FolderIcon, PuzzleIcon } from '../components/icons'
import { removeNotice } from './archive'
import { createUnder } from './create'
import { listWebFileTypes, webFileType } from './fileTypes'
import { parseTagInput, tagChoices } from './kindTags'
import { newOptions, type NewOption } from './newMenu'
import PlaceIn from './PlaceIn'
import { placeWithFallback, type PlaceTarget } from './placing'
import { isWorkspaceKind, type RowModel } from './rows'
import { getChildren, getNodeDetail, placeNode, renamePlacement, setKindTag, trashPlacement, type ChildRow, type NodeSummary } from './wsApi'

// The tree of a container's children, loaded a level at a time as folders are
// opened. A row is one placement: the name it shows is the name of that
// placement (names live on placements, so the same file can be called two
// things in two places), and the row menu acts on that placement, which is why
// "Remove from …" and "Delete…" are different entries: one takes this
// placement away (trash), the other archives the node out of every place it
// appears (delete).

// A button in the sidebar's notice line (Undo after Remove from …).
export interface NoticeAction {
  label: string
  run(): void | Promise<void>
}

// What the rows need from the sidebar that owns them.
export interface TreeCtx {
  // Bumped whenever the graph changed, so every open list reloads itself.
  version: number
  openFile(nodeId: string, title: string): void
  // A trajectory, a track or a course: the workspace becomes it.
  openWorkspace(node: NodeSummary): void
  changed(): void
  renamed(nodeId: string, title: string): void
  notify(text: string, kind?: 'error' | 'info', action?: NoticeAction): void
  requestDelete(node: NodeSummary, name: string): void
  // The containers this node could be placed in from here (the workspace root,
  // and its folders and tracks, or every trajectory, track and course in the
  // scratch view).
  placeTargets(node: NodeSummary): Promise<PlaceTarget[]>
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// Undo for Remove from …: the same node goes back into the same container
// under the name it had. If that name has been taken since, it goes in under the
// free name and the notice says so. It lives outside the row because the row is
// gone from the list by the time Undo is pressed.
async function undoRemove(ctx: TreeCtx, removed: { container_id: string; child_id: string; name: string }, shownName: string, containerTitle: string) {
  try {
    const out = await placeWithFallback(placeNode, removed.container_id, removed.child_id, removed.name)
    ctx.changed()
    ctx.notify(
      out.fellBack
        ? `"${shownName}" is back in "${containerTitle}", as "${out.name}": the name "${removed.name}" was taken in the meantime.`
        : `"${shownName}" is back in "${containerTitle}".`,
      'info'
    )
  } catch (err) {
    ctx.notify(messageOf(err))
  }
}

export function Glyph({ node }: { node: NodeSummary }): ReactNode {
  if (node.kind === 'trajectory') return <FlagIcon size={14} />
  if (node.kind === 'track') return <CompassIcon size={14} />
  if (node.kind === 'course') return <BookIcon size={14} />
  if (node.kind === 'folder') return <FolderIcon size={14} />
  return (node.format && webFileType(node.format)?.icon) || <PuzzleIcon size={14} />
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
  const shownName = model.name
  // What this row may be given from its menu: nothing for a file, and for a
  // container only what the containment matrix lets it hold.
  const options = newOptions(node.kind, listWebFileTypes())
  // A trajectory, a track or a course is a workspace of its own; only a folder
  // opens in place.
  const isWorkspace = isWorkspaceKind(node.kind)
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [tagMenu, setTagMenu] = useState(false)
  const [placing, setPlacing] = useState(false)
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

  // The tag list is part of the menu: it is folded again whenever the menu is.
  useEffect(() => {
    if (!menu) setTagMenu(false)
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

  const make = (option: NewOption) =>
    act(async () => {
      const made = await createUnder(node.id, option.kind, option.format)
      if (!made) return
      setOpen(true)
      ctx.changed()
      if (option.kind === 'file') ctx.openFile(made.id, made.title)
      // A track or a course does not open in place, so say where it went.
      else if (isWorkspace) ctx.notify(`Made "${made.title}" in "${shownName}".`, 'info')
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

  // Remove from this container: this one placement goes (trash) and the node
  // lives on, wherever else it is placed.
  const removeHere = () =>
    act(async () => {
      if (!model.placementId) return
      const out = await trashPlacement(model.placementId)
      ctx.changed()
      const from = model.container?.title ?? 'here'
      ctx.notify(removeNotice(shownName, from, node.kind, out.became_unplaced), 'info', {
        label: 'Undo',
        run: () => undoRemove(ctx, out.removed, shownName, from),
      })
    })

  // Put this same node somewhere else too (it can sit in several places). If
  // the name is taken there it goes in under the free one the server suggests.
  async function placeHere(target: PlaceTarget) {
    try {
      const out = await placeWithFallback(placeNode, target.id, node.id)
      setPlacing(false)
      ctx.changed()
      ctx.notify(
        out.fellBack
          ? `"${shownName}" is already taken in "${target.label}", so it was placed there as "${out.name}".`
          : `Placed "${shownName}" in "${target.label}".`,
        'info'
      )
    } catch (err) {
      ctx.notify(messageOf(err))
    }
  }

  // Tag a file: what it is for. The partition chips in the sidebar then list it.
  async function applyTag(tag: string | null) {
    if (tag === node.kind_tag) return
    await setKindTag(node.id, tag)
    ctx.changed()
  }
  const retag = (tag: string | null) => act(() => applyTag(tag))

  // A tag of Ben's own: asked for, and checked here against the tag rule so a
  // typo is refused before it goes to the server.
  const otherTag = () =>
    act(async () => {
      const raw = window.prompt('Tag (lowercase letters, digits, "_" and "-"; starts with a letter)')
      if (raw === null || raw.trim() === '') return
      const parsed = parseTagInput(raw)
      if (parsed.kind === 'refused') {
        ctx.notify(parsed.message)
        return
      }
      await applyTag(parsed.tag)
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
              {options.map((o) => (
                <button key={o.key} role="menuitem" onClick={() => void make(o)}>
                  {o.label}
                </button>
              ))}
              {model.placementId && (
                <button role="menuitem" onClick={() => void renameHere()}>
                  Rename here
                </button>
              )}
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false)
                  setPlacing(true)
                }}
              >
                Place in…
              </button>
              {node.kind === 'file' && (
                <>
                  <button role="menuitem" aria-haspopup="true" aria-expanded={tagMenu} onClick={() => setTagMenu((t) => !t)}>
                    Tag ▸
                  </button>
                  {tagMenu && (
                    <div className="ws-submenu" role="group" aria-label="Tag">
                      {tagChoices(node.kind_tag).map((tag) => (
                        <button key={tag ?? 'none'} role="menuitemradio" aria-checked={node.kind_tag === tag} onClick={() => void retag(tag)}>
                          <span className="ws-tick" aria-hidden="true">
                            {node.kind_tag === tag ? '✓' : ''}
                          </span>
                          {tag ?? 'none'}
                        </button>
                      ))}
                      <button role="menuitem" onClick={() => void otherTag()}>
                        <span className="ws-tick" aria-hidden="true" />
                        Other…
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className="ws-menu-sep" role="separator" />
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
                  ctx.requestDelete(node, shownName)
                }}
              >
                Delete…
              </button>
            </div>
          )}
        </span>
      </div>
      {placing && (
        <div style={{ paddingLeft: depth * 14 }}>
          <PlaceIn title={shownName} load={() => ctx.placeTargets(node)} onPlace={(t) => void placeHere(t)} onClose={() => setPlacing(false)} />
        </div>
      )}
      {open && node.kind === 'folder' && <Tree containerId={node.id} containerTitle={shownName} ctx={ctx} depth={depth + 1} />}
    </li>
  )
}
