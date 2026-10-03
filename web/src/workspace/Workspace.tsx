import { useEffect, useState } from 'react'
import { XIcon } from '../components/icons'
import CenterPane from './CenterPane'
import Picker from './Picker'
import Sidebar from './Sidebar'
import { closeTab, focusTab, openTab, retitleTab, type TabState } from './tabs'
import { WsError, getNodeDetail } from './wsApi'
import { SCRATCH, clearLast, readLast, readTabs, writeLast, writeTabs, type Root } from './wsState'
import './workspace.css'

// The workspace page: a full-window frame, entered from the rail's
// "Workspace" and left by its own Exit. With no workspace open it is the
// picker; with one open it is the shell (header, sidebar, tabs, centre).
//
// The stack is how Up works: opening a course (or another track) from inside a
// workspace replaces it and remembers where it came from, and Up goes back.
// Switch goes to the picker and forgets the stack.

const STACK_LIMIT = 20

export default function Workspace({ onExit }: { onExit: () => void }) {
  const [root, setRoot] = useState<Root | null>(null)
  const [stack, setStack] = useState<Root[]>([])
  // The unplaced file the picker opened the scratch view for.
  const [firstFile, setFirstFile] = useState<{ nodeId: string; title: string } | null>(null)
  const [restoring, setRestoring] = useState(true)

  // Pick up where Ben left off: the workspace that was open last, if it is
  // still there and not in the trash.
  useEffect(() => {
    const last = readLast()
    if (!last) {
      setRestoring(false)
      return
    }
    if (last.kind === 'scratch') {
      setRoot(SCRATCH)
      setRestoring(false)
      return
    }
    let live = true
    getNodeDetail(last.id)
      .then((d) => {
        if (live && !d.node.trashed_at && (d.node.kind === 'track' || d.node.kind === 'course')) {
          setRoot({ id: d.node.id, kind: d.node.kind, title: d.node.title })
        }
      })
      .catch(() => {})
      .finally(() => live && setRestoring(false))
    return () => {
      live = false
    }
  }, [])

  function enter(next: Root) {
    setRoot(next)
    writeLast(next)
  }

  // From the picker: a fresh start, nothing to go Up to.
  function openFromPicker(next: Root) {
    setStack([])
    setFirstFile(null)
    enter(next)
  }

  function openScratch(file: { nodeId: string; title: string } | null) {
    setStack([])
    setFirstFile(file)
    enter(SCRATCH)
  }

  // From inside a workspace: the one that was open goes on the stack.
  function descend(next: Root) {
    if (root) setStack((s) => [...s, root].slice(-STACK_LIMIT))
    setFirstFile(null)
    enter(next)
  }

  function up() {
    const prev = stack.at(-1)
    if (!prev) return
    setStack((s) => s.slice(0, -1))
    setFirstFile(null)
    enter(prev)
  }

  function toPicker() {
    setRoot(null)
    setStack([])
    setFirstFile(null)
    clearLast()
  }

  if (restoring) return <div className="ws"><div className="ws-note">Loading…</div></div>
  if (!root) return <Picker onOpen={openFromPicker} onOpenScratch={openScratch} onExit={onExit} />
  return (
    <Shell
      key={root.id}
      root={root}
      firstFile={firstFile}
      upTo={stack.at(-1) ?? null}
      onUp={up}
      onOpenWorkspace={descend}
      onSwitch={toPicker}
      onExit={onExit}
    />
  )
}

const gone = (title: string): string => `"${title}" is not there any more (it is in the trash or was removed). Use Switch to pick another workspace.`

function Shell({
  root,
  firstFile,
  upTo,
  onUp,
  onOpenWorkspace,
  onSwitch,
  onExit,
}: {
  root: Root
  firstFile: { nodeId: string; title: string } | null
  upTo: Root | null
  onUp(): void
  onOpenWorkspace(next: Root): void
  onSwitch(): void
  onExit(): void
}) {
  const [tabs, setTabs] = useState<TabState>(() => {
    const saved = readTabs(root.id)
    return firstFile ? openTab(saved, { nodeId: firstFile.nodeId, title: firstFile.title }) : saved
  })
  const [sidebar, setSidebar] = useState(true)
  const [parents, setParents] = useState<{ id: string; title: string }[]>([])
  // Why the workspace cannot be shown, if it cannot: it is gone, or the server
  // could not be asked.
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => writeTabs(root.id, tabs), [root.id, tabs])

  // Ctrl+B hides and shows the sidebar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebar((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The header's "in: …" (a course's parent tracks), and whether this
  // workspace is still there. The scratch view is neither a node nor in a track.
  useEffect(() => {
    if (root.kind === 'scratch') return
    let live = true
    getNodeDetail(root.id)
      .then((d) => {
        if (!live) return
        setProblem(d.node.trashed_at ? gone(root.title) : null)
        setParents(root.kind === 'course' ? d.parent_tracks : [])
      })
      .catch((err) => live && setProblem(err instanceof WsError && err.status === 404 ? gone(root.title) : err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [root.id, root.kind, root.title])

  const open = (nodeId: string, title: string) => setTabs((s) => openTab(s, { nodeId, title }))
  const active = tabs.tabs.find((t) => t.nodeId === tabs.active) ?? null

  return (
    <div className="ws">
      <header className="ws-head">
        <div className="ws-title">
          <strong>{root.title}</strong>
          <span className="ws-kind">{root.kind}</span>
        </div>
        {parents.length > 0 && (
          <div className="ws-parents">
            in:{' '}
            {parents.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ' · '}
                <button className="ws-link" onClick={() => onOpenWorkspace({ id: p.id, kind: 'track', title: p.title })}>
                  {p.title}
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ws-head-actions">
          <button className="ws-btn" onClick={() => setSidebar((v) => !v)} aria-pressed={sidebar} title="Show or hide the sidebar (Ctrl+B)">
            Sidebar
          </button>
          {upTo && (
            <button className="ws-btn" onClick={onUp} title={`Back to ${upTo.title}`}>
              Up
            </button>
          )}
          <button className="ws-btn" onClick={onSwitch}>
            Switch
          </button>
          <button className="ws-btn" onClick={onExit}>
            Exit
          </button>
        </div>
      </header>

      {problem && (
        <div className="ws-error" role="alert">
          {problem}
        </div>
      )}

      <div className="ws-body">
        {sidebar && (
          <Sidebar
            root={root}
            onOpenFile={open}
            onOpenWorkspace={onOpenWorkspace}
            onRenamed={(nodeId, title) => setTabs((s) => retitleTab(s, nodeId, title))}
            onGone={(ids) => setTabs((s) => ids.reduce((acc, id) => closeTab(acc, id), s))}
          />
        )}
        <main className="ws-main">
          <div className="ws-tabs" role="tablist" aria-label="Open files">
            {tabs.tabs.map((t) => (
              <div
                key={t.nodeId}
                role="tab"
                aria-selected={t.nodeId === tabs.active}
                tabIndex={0}
                className={`ws-tab${t.nodeId === tabs.active ? ' active' : ''}${t.directed ? ' directed' : ''}`}
                title={t.directed ? `${t.title} (opened for you by the tutor)` : t.title}
                onClick={() => setTabs((s) => focusTab(s, t.nodeId))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setTabs((s) => focusTab(s, t.nodeId))
                  }
                }}
                // Middle-click closes. Pressing the middle button would start
                // the browser's autoscroll, so that is cancelled on the way down.
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault()
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    setTabs((s) => closeTab(s, t.nodeId))
                  }
                }}
              >
                {t.directed && <span className="ws-directed-mark" aria-hidden="true" />}
                <span className="ws-tab-title">{t.title}</span>
                <button
                  className="ws-tab-x"
                  aria-label={`Close ${t.title}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setTabs((s) => closeTab(s, t.nodeId))
                  }}
                >
                  <XIcon size={10} />
                </button>
              </div>
            ))}
          </div>
          <CenterPane tab={active} onCloseTab={(nodeId) => setTabs((s) => closeTab(s, nodeId))} />
        </main>
      </div>
    </div>
  )
}
