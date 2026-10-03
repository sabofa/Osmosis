import { useEffect, useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { makePathResolver, orphansUnder } from './graphWalk'
import { createUnder } from './create'
import { Tree, TreeRow, type RowModel, type TreeCtx } from './Tree'
import type { Root } from './wsState'
import {
  KIND_TAGS,
  destroyNode,
  getChildren,
  getCourses,
  getNodeDetail,
  getRoots,
  searchByTag,
  type AppearsInRow,
  type CourseRow,
  type KindTag,
  type NodeSummary,
  type SearchRow,
} from './wsApi'

// The left side of the shell: a mode switcher (Files | Tools), the partition
// strip (one chip per kind tag), and the tree. In a course the tree is the
// course's children. In a track it has two sections: Planning (the track's
// children that are not courses) and Courses (every course under it, however
// deep, by the names on the way down). The scratch view lists what is unplaced.

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

interface DestroyReq {
  node: NodeSummary
  name: string
  appearsIn: AppearsInRow[]
  // How many items under it are placed nowhere else.
  orphans: number
  alsoOrphans: boolean
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
  // These nodes went to the trash; their tabs have nothing to show.
  onGone(nodeIds: string[]): void
}) {
  const [mode, setMode] = useState<'files' | 'tools'>('files')
  const [version, setVersion] = useState(0)
  const [chip, setChip] = useState<KindTag | null>(null)
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'info' } | null>(null)
  const [destroyReq, setDestroyReq] = useState<DestroyReq | null>(null)

  // Anything that changes the graph reloads the lists, and a message about an
  // earlier change is no longer news. (A notice is set after the refresh.)
  const refresh = () => {
    setVersion((v) => v + 1)
    setNotice(null)
  }

  async function startDestroy(node: NodeSummary, name: string) {
    try {
      const detail = await getNodeDetail(node.id)
      const orphans = node.kind === 'file' ? [] : await orphansUnder(node.id, getChildren)
      setDestroyReq({ node, name, appearsIn: detail.appears_in, orphans: orphans.length, alsoOrphans: false })
    } catch (err) {
      setNotice({ text: messageOf(err), kind: 'error' })
    }
  }

  async function confirmDestroy() {
    const req = destroyReq
    setDestroyReq(null)
    if (!req) return
    try {
      const out = await destroyNode(req.node.id, req.alsoOrphans)
      onGone(out.trashed)
      refresh()
      setNotice({ text: `"${req.name}" is in the trash${out.trashed.length > 1 ? ` with ${out.trashed.length - 1} more` : ''}.`, kind: 'info' })
    } catch (err) {
      setNotice({ text: messageOf(err), kind: 'error' })
    }
  }

  const ctx: TreeCtx = {
    version,
    openFile: onOpenFile,
    openWorkspace: (node) => onOpenWorkspace({ id: node.id, kind: node.kind === 'track' ? 'track' : 'course', title: node.title }),
    changed: refresh,
    renamed: onRenamed,
    notify: (text, kind = 'error') => setNotice({ text, kind }),
    requestDestroy: (node, name) => void startDestroy(node, name),
  }

  // New file / New folder straight into the workspace's own container, which
  // has no row to put a menu on.
  async function makeIn(kind: 'file' | 'folder') {
    try {
      const made = await createUnder(root.id, kind)
      if (!made) return
      refresh()
      if (kind === 'file') onOpenFile(made.id, made.title)
    } catch (err) {
      setNotice({ text: messageOf(err), kind: 'error' })
    }
  }

  const NewButtons = (
    <span className="ws-section-actions">
      <button className="ws-link" onClick={() => void makeIn('file')}>
        + File
      </button>
      <button className="ws-link" onClick={() => void makeIn('folder')}>
        + Folder
      </button>
    </span>
  )

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
          <button className="ws-link" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {mode === 'tools' ? (
        <div className="ws-note">No tools yet.</div>
      ) : (
        <div className="ws-side-scroll">
          {root.kind !== 'scratch' && (
            <>
              <div className="ws-chips" aria-label="Kinds">
                {KIND_TAGS.map((tag) => (
                  <button key={tag} className={`ws-chip${chip === tag ? ' active' : ''}`} aria-pressed={chip === tag} onClick={() => setChip(chip === tag ? null : tag)}>
                    <span className={`ws-dot tag-${tag}`} />
                    {tag}
                  </button>
                ))}
              </div>
              {chip && <Partition root={root} tag={chip} version={version} onOpenFile={onOpenFile} />}
            </>
          )}

          {root.kind === 'course' && (
            <section>
              <div className="ws-section-head">
                <span>Files</span>
                {NewButtons}
              </div>
              <Tree containerId={root.id} containerTitle={root.title} ctx={ctx} empty="This course is empty." />
            </section>
          )}

          {root.kind === 'track' && (
            <>
              <section>
                <div className="ws-section-head">
                  <span>Planning</span>
                  {NewButtons}
                </div>
                <Tree containerId={root.id} containerTitle={root.title} ctx={ctx} filter={(r) => r.node.kind !== 'course'} empty="Nothing in the plan yet." />
              </section>
              <section>
                <div className="ws-section-head">
                  <span>Courses</span>
                </div>
                <CourseList trackId={root.id} ctx={ctx} />
              </section>
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

      {destroyReq && (
        <ConfirmDialog
          title={`Destroy "${destroyReq.name}"?`}
          body={destroyBody(destroyReq)}
          confirmLabel="Destroy"
          danger
          onCancel={() => setDestroyReq(null)}
          onConfirm={() => void confirmDestroy()}
        >
          {destroyReq.orphans > 0 && (
            <label className="ws-check">
              <input
                type="checkbox"
                checked={destroyReq.alsoOrphans}
                onChange={(e) => setDestroyReq((r) => (r ? { ...r, alsoOrphans: e.target.checked } : r))}
              />
              <span>
                Also destroy {destroyReq.orphans} item{destroyReq.orphans === 1 ? '' : 's'} placed nowhere else
              </span>
            </label>
          )}
        </ConfirmDialog>
      )}
    </aside>
  )
}

// The dialog's text: where the node appears (destroying it takes it out of
// all of those, which is the difference from removing it from one), and what
// happens to what is under it.
function destroyBody(req: DestroyReq): string {
  const where =
    req.appearsIn.length === 0
      ? 'It is not placed anywhere.'
      : `It goes to the trash, so it disappears from every place it appears:\n${req.appearsIn.map((a) => `  • ${a.container.title}, as "${a.name}"`).join('\n')}`
  if (req.node.kind === 'file') return where
  return `${where}\nItems placed only inside it become unplaced, unless you destroy them with it.`
}

// The files of one kind in this workspace, each as "name — path", where the
// path is the names from the workspace down to the container it sits in.
function Partition({ root, tag, version, onOpenFile }: { root: Root; tag: KindTag; version: number; onOpenFile(nodeId: string, title: string): void }) {
  const [rows, setRows] = useState<{ row: SearchRow; path: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setRows(null)
    setError(null)
    ;(async () => {
      const found = await searchByTag(root.id, tag)
      const resolve = makePathResolver(root.id, async (id) => (await getNodeDetail(id)).appears_in)
      const withPaths = await Promise.all(
        found.map(async (row) => {
          const names = row.container_id ? await resolve(row.container_id) : null
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
        <li key={row.placement_id ?? row.node.id}>
          <button disabled={row.node.kind !== 'file'} onClick={() => onOpenFile(row.node.id, row.name)}>
            <span className="ws-row-name">{row.name}</span>
            <span className="ws-path"> — {path}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// The courses under a track, each shown by its path of names from the track.
function CourseList({ trackId, ctx }: { trackId: string; ctx: TreeCtx }) {
  const [courses, setCourses] = useState<CourseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getCourses(trackId)
      .then((c) => {
        if (!live) return
        setCourses(c)
        setError(null)
      })
      .catch((err) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [trackId, ctx.version])

  if (error) return <div className="ws-note ws-error-text">{error}</div>
  if (!courses) return <div className="ws-note">Loading…</div>
  if (courses.length === 0) return <div className="ws-note">No courses in this track.</div>
  return (
    <ul className="ws-tree">
      {courses.map(({ node, path }) => {
        const model: RowModel = { key: node.id, node, name: path.at(-1) ?? node.title, label: path.join(' / '), placementId: null, container: null }
        return <TreeRow key={node.id} model={model} ctx={ctx} depth={0} />
      })}
    </ul>
  )
}

// What is placed nowhere: the roots read's third list.
function Unplaced({ ctx }: { ctx: TreeCtx }) {
  const [items, setItems] = useState<NodeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    getRoots()
      .then((r) => {
        if (!live) return
        setItems(r.unplaced)
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
