import { Fragment, useEffect, useRef, useState } from 'react'
import { SubjectIcon, TagIcon, FolderIcon, ChevronRightIcon } from './icons'
import Heatmap from './Heatmap'
import TemplateDetail from './TemplateDetail'
import TagDetail from './TagDetail'
import FolderMenu from './FolderMenu'
import { useTemplateOrg } from '../hooks/useTemplateOrg'
import { useTagPopout } from '../hooks/useTagPopout'
import { FOLDER_ICON_LIBRARY } from '../lib/folderIcons'
import type { TemplateSummary } from '../data/templates'
import { getTemplates, getStatus, listAttempts, timeAgo, type AttemptSummary, type NodeStatus } from '../lib/api'
import { toViewTemplate } from '../lib/templateView'
import { attemptsHeatmap } from '../lib/activity'
import './Home.css'

const HEAT_WEEKS = 26
const HEAT_DAYS = 7

type DragSource = 'main' | 'quickaccess' | null

// Hoisted to module scope deliberately — defining this inline inside Home
// would make it a brand-new function (and therefore a brand-new component
// type, from React's perspective) on every render. Home re-renders on every
// drag-hover state change, so an inline version gets fully unmounted and
// remounted each time instead of having its className updated — the CSS
// transition never gets a "before" state to animate from, so it just snaps
// straight to the end value with no visible animation at all.
function DropGap({ grow = false, active = false, expanded = false }: { grow?: boolean; active?: boolean; expanded?: boolean }) {
  return <div className={`drop-gap${grow ? ' grow' : ''}${active ? ' active' : ''}${expanded ? ' expanded' : ''}`} />
}

export default function Home({
  onStart,
  onStartDaily,
  startError,
  starting,
}: {
  onStart: (templateId: string) => void
  onStartDaily: (kind: 'question' | 'quiz') => void
  startError?: string | null
  starting?: boolean
}) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [status, setStatus] = useState<NodeStatus | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const tagPopout = useTagPopout()
  const [menuFolder, setMenuFolder] = useState<string | null>(null)
  const [menuClosing, setMenuClosing] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragSource, setDragSource] = useState<DragSource>(null)
  // Stage 1: dragOverKey flips the instant a drop target is entered — a
  // lightweight signifier (thin line / outline) with no layout-affecting
  // resize, so it never lags. Stage 2: dragExpandKey only catches up to it
  // once dragOverKey has held the same value for a real beat, which is what
  // actually plays the size/scale animation — a target you only pass over
  // never gets far enough to trigger it, so no jitter.
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragExpandKey, setDragExpandKey] = useState<string | null>(null)
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirrors dragOverKey synchronously. React state updates (and functional
  // updaters especially) are batched/deferred, so a side effect like
  // clearTimeout can't safely live inside a setState callback — by the time
  // it actually runs, a later synchronous call may have already replaced
  // expandTimer.current with a newer timer, silently cancelling the wrong
  // one. Reading/writing this ref instead keeps all the timer bookkeeping
  // strictly synchronous.
  const dragOverKeyRef = useRef<string | null>(null)

  useEffect(() => {
    getTemplates()
      .then((r) => setTemplates(r.templates.map(toViewTemplate)))
      .catch((err) => setLoadError(String(err)))
    // A generous limit — with the whole local bank still small, this is
    // cheap and gives the heatmap a real multi-month window to draw from.
    listAttempts({ limit: 500 })
      .then((r) => setAttempts(r.attempts))
      .catch(() => {
        /* heatmap just shows all-zero activity if this fails; not fatal */
      })
    function refreshStatus() {
      getStatus()
        .then((s) => {
          setStatus(s)
          setLastSync(s.last_pull_at)
        })
        .catch(() => {
          /* sync pill just falls back to "never" if this fails; not fatal */
        })
    }
    refreshStatus()
    // Poll for connectivity changes while Home stays mounted (no navigation),
    // e.g. a local node coming back online — matching the ~30s cadence the
    // backend's own connectivity monitor already uses (see
    // startSyncBackground's connectivityTimer in server/src/sync/client.ts).
    const statusInterval = setInterval(refreshStatus, 30_000)
    return () => clearInterval(statusInterval)
  }, [])

  // A canonical node is always "online" to itself — it never needs a remote
  // to serve a daily draw, so it should never show the offline-greyed state.
  const dailyAvailable = !!(status?.canonical || status?.online)

  const org = useTemplateOrg((templates ?? []).map((t) => t.id))
  const templatesById = new Map((templates ?? []).map((t) => [t.id, t]))

  const selected: TemplateSummary | undefined = templatesById.get(selectedId ?? '')
  const opened: TemplateSummary | undefined = templatesById.get(openId ?? '')
  const heat = attemptsHeatmap(attempts, HEAT_WEEKS, HEAT_DAYS)

  const pinnedTemplates = org.pinned.map((id) => templatesById.get(id)).filter((t): t is TemplateSummary => !!t)

  function activateDragOver(key: string) {
    if (expandTimer.current) clearTimeout(expandTimer.current)
    dragOverKeyRef.current = key
    setDragOverKey(key)
    setDragExpandKey(null)
    expandTimer.current = setTimeout(() => {
      setDragExpandKey(key)
      expandTimer.current = null
    }, 200)
  }

  function clearDragOver(key: string) {
    if (dragOverKeyRef.current !== key) return
    if (expandTimer.current) {
      clearTimeout(expandTimer.current)
      expandTimer.current = null
    }
    dragOverKeyRef.current = null
    setDragOverKey(null)
    setDragExpandKey(null)
  }

  function endDrag() {
    if (expandTimer.current) {
      clearTimeout(expandTimer.current)
      expandTimer.current = null
    }
    dragOverKeyRef.current = null
    setDraggedId(null)
    setDragSource(null)
    setDragOverKey(null)
    setDragExpandKey(null)
  }

  // Closing the folder menu: click anywhere outside it, press Escape, or
  // delete/confirm from inside it. Plays an exit animation before actually
  // unmounting rather than just vanishing.
  function closeFolderMenu() {
    setMenuClosing((already) => {
      if (already) return already
      setTimeout(() => {
        setMenuFolder(null)
        setMenuClosing(false)
      }, 160)
      return true
    })
  }

  useEffect(() => {
    if (!menuFolder || menuClosing) return
    function handlePointer(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.folder-menu') && !target.closest('.folder-icon-trigger')) {
        closeFolderMenu()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeFolderMenu()
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuFolder, menuClosing])

  // --- Quick access (its own isolated drag scope) ---

  // Hit-testing by comparing the pointer's actual screen position against
  // each chip's current bounding rect — rather than relying on that chip's
  // own dragenter/dragleave — because growing a gap shifts every chip after
  // it. A resize-driven boundary can shift out from under a stationary
  // pointer and fire a real dragleave, which retriggers the resize in the
  // other direction: an infinite grow/shrink loop. Coordinates don't have
  // that problem — the pointer's position is unaffected by layout shifting
  // underneath it, so recomputing "nearest chip" fresh on every dragover
  // always converges instead of oscillating.
  function nearestPinIndex(containerEl: HTMLElement, clientX: number): number {
    const items = Array.from(containerEl.querySelectorAll<HTMLElement>('.quick-access-chip'))
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      if (clientX < rect.left + rect.width / 2) return i
    }
    return items.length
  }

  function quickAccessGap(index: number, grow = false) {
    const key = `qgap:${index}`
    return (
      <div
        key={key}
        className={`drop-gap vertical${index === 0 ? ' leading' : ''}${grow ? ' grow' : ''}${dragOverKey === key ? ' active' : ''}${dragExpandKey === key ? ' expanded' : ''}`}
      />
    )
  }

  // --- Main organized list (folders + templates, recursive) ---

  function renderTemplateRow(t: TemplateSummary, containerId: string, siblingIds: string[], stripeColor: string | null) {
    const mergeKey = `merge:${t.id}`
    return (
      <div
        className={`template-row-wrap${draggedId === t.id && dragSource === 'main' ? ' dragging' : ''}${dragOverKey === mergeKey ? ' drag-over' : ''}${dragExpandKey === mergeKey ? ' expanded' : ''}`}
        style={stripeColor ? { borderLeft: `3px solid ${stripeColor}` } : undefined}
        draggable
        onDragStart={() => {
          setDraggedId(t.id)
          setDragSource('main')
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (dragSource !== 'main') return
          e.preventDefault()
          e.stopPropagation()
        }}
        onDragEnter={(e) => {
          if (dragSource !== 'main') return
          e.stopPropagation()
          activateDragOver(mergeKey)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          clearDragOver(mergeKey)
        }}
        onDrop={(e) => {
          if (dragSource !== 'main' || !draggedId) return
          e.stopPropagation()
          org.mergeOnto(draggedId, t.id, containerId, siblingIds)
          endDrag()
        }}
      >
        <button
          className={`template-row${t.id === selectedId ? ' selected' : ''}`}
          onClick={() => setSelectedId((cur) => (cur === t.id ? null : t.id))}
          onDoubleClick={() => setOpenId(t.id)}
          title="Click to select, double-click for full details, drag to organize"
        >
          <span className="template-icon">
            <SubjectIcon icon={t.icon} />
          </span>
          <span>
            <div className="template-name">{t.name}</div>
            <div className="template-meta">{t.meta}</div>
          </span>
        </button>
      </div>
    )
  }

  function renderFolder(folderId: string, depth: number) {
    const folder = org.folders.find((f) => f.id === folderId)
    if (!folder) return null
    const mergeKey = `merge:${folderId}`
    const count = org.computeChildren(folderId).length
    const collapsed = org.isCollapsed(folderId)
    const IconComp = folder.icon ? FOLDER_ICON_LIBRARY[folder.icon] : null

    return (
      <div className="template-group" key={folderId}>
        <div
          className={`template-group-header${dragOverKey === mergeKey ? ' drag-over' : ''}${dragExpandKey === mergeKey ? ' expanded' : ''}${draggedId === folderId && dragSource === 'main' ? ' dragging' : ''}`}
          style={folder.color ? { borderLeftColor: folder.color } : undefined}
          draggable
          onDragStart={(e) => {
            e.stopPropagation()
            setDraggedId(folderId)
            setDragSource('main')
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            if (dragSource !== 'main') return
            e.preventDefault()
            e.stopPropagation()
          }}
          onDragEnter={(e) => {
            if (dragSource !== 'main') return
            e.stopPropagation()
            activateDragOver(mergeKey)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            clearDragOver(mergeKey)
          }}
          onDrop={(e) => {
            if (dragSource !== 'main' || !draggedId) return
            e.stopPropagation()
            org.mergeOnto(draggedId, folderId, 'root', [])
            endDrag()
          }}
          onClick={() => {
            // A click that's just closing an already-open menu for this
            // folder shouldn't also collapse/expand it underneath.
            if (menuFolder === folderId) {
              closeFolderMenu()
              return
            }
            org.toggleCollapse(folderId)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (menuFolder !== folderId) setMenuFolder(folderId)
          }}
          title="Click to collapse · drag to move or nest · double-click for options"
        >
          <span className={`template-group-chevron${collapsed ? ' collapsed' : ''}`}>
            <ChevronRightIcon size={10} />
          </span>
          <span className="folder-icon-trigger" onClick={(e) => e.stopPropagation()}>
            {IconComp ? <IconComp size={12} /> : <FolderIcon size={12} />}
          </span>
          <span className="template-group-name" style={folder.color ? { color: folder.color } : undefined}>
            {folder.name}
          </span>
          <span className="template-group-count">{count}</span>
        </div>

        {menuFolder === folderId && (
          <FolderMenu
            folder={folder}
            closing={menuClosing}
            onRename={(name) => org.renameFolder(folderId, name)}
            onChangeIcon={(icon) => org.setFolderStyle(folderId, icon, folder.color)}
            onChangeColor={(color) => org.setFolderStyle(folderId, folder.icon, color)}
            onDelete={() => {
              org.deleteFolder(folderId)
              closeFolderMenu()
            }}
            onClose={closeFolderMenu}
          />
        )}

        <div className={`folder-children-wrap${collapsed ? ' collapsed' : ''}`}>
          <div className="folder-children-inner">{renderContainer(folderId, depth + 1, folder.color)}</div>
        </div>
      </div>
    )
  }

  // Same reasoning as nearestPinIndex above, applied to the vertical list:
  // hit-test against each row/folder's live bounding rect rather than the
  // gap's own dragenter/dragleave, so a gap growing under a stationary
  // pointer can't fire a spurious leave and loop.
  function nearestGapIndex(containerEl: HTMLElement, clientY: number): number {
    const items = Array.from(containerEl.children).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && (el.classList.contains('template-row-wrap') || el.classList.contains('template-group'))
    )
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      if (clientY < rect.top + rect.height / 2) return i
    }
    return items.length
  }

  function renderContainer(containerId: string, depth: number, containerColor: string | null = null) {
    const ids = org.computeChildren(containerId)
    return (
      <div
        className={`org-list${depth === 0 ? ' root' : ''}`}
        style={depth > 0 ? { marginLeft: 18 } : undefined}
        onDragOver={(e) => {
          if (dragSource !== 'main') return
          e.preventDefault()
          e.stopPropagation()
          const index = nearestGapIndex(e.currentTarget, e.clientY)
          const key = `gap:${containerId}:${index}`
          if (dragOverKeyRef.current !== key) activateDragOver(key)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          if (dragOverKeyRef.current?.startsWith(`gap:${containerId}:`)) clearDragOver(dragOverKeyRef.current)
        }}
        onDrop={(e) => {
          if (dragSource !== 'main' || !draggedId) return
          e.stopPropagation()
          const index = nearestGapIndex(e.currentTarget, e.clientY)
          org.reorderInto(draggedId, containerId, index, ids)
          endDrag()
        }}
      >
        <DropGap
          grow={depth === 0 && ids.length === 0}
          active={dragOverKey === `gap:${containerId}:0`}
          expanded={dragExpandKey === `gap:${containerId}:0`}
        />
        {ids.map((id, i) => (
          <Fragment key={id}>
            {org.isFolder(id)
              ? renderFolder(id, depth)
              : renderTemplateRow(templatesById.get(id)!, containerId, ids, containerColor)}
            <DropGap
              grow={depth === 0 && i === ids.length - 1}
              active={dragOverKey === `gap:${containerId}:${i + 1}`}
              expanded={dragExpandKey === `gap:${containerId}:${i + 1}`}
            />
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <div className="home">
      <div className="panel templates-panel">
        <div className="templates-header">
          <h1>Templates</h1>
          <span className="templates-count">{templates ? `${templates.length} active` : '…'}</span>
        </div>
        {loadError && <div className="detail-desc" style={{ padding: '0 4px', color: 'var(--danger, #d33)' }}>Could not reach the local node: {loadError}</div>}
        {startError && <div className="detail-desc" style={{ padding: '0 4px', color: 'var(--danger, #d33)' }}>Couldn't start attempt: {startError}</div>}

        <div className="daily-cards">
          <button
            className="template-row daily-card"
            disabled={!dailyAvailable || !!starting}
            onClick={() => onStartDaily('question')}
            title={dailyAvailable ? 'Start today\'s daily question' : 'Unavailable offline'}
          >
            <span className="template-icon">
              <SubjectIcon icon="bolt" />
            </span>
            <span>
              <div className="template-name">Daily Question</div>
              <div className="template-meta">
                {!dailyAvailable ? 'Unavailable offline' : starting ? 'Starting…' : "Today's pick"}
              </div>
            </span>
          </button>
          <button
            className="template-row daily-card"
            disabled={!dailyAvailable || !!starting}
            onClick={() => onStartDaily('quiz')}
            title={dailyAvailable ? "Start today's daily quiz" : 'Unavailable offline'}
          >
            <span className="template-icon">
              <SubjectIcon icon="bolt" />
            </span>
            <span>
              <div className="template-name">Daily Quiz</div>
              <div className="template-meta">
                {!dailyAvailable ? 'Unavailable offline' : starting ? 'Starting…' : "Today's set"}
              </div>
            </span>
          </button>
        </div>

        <div className="quick-access">
          <div className="quick-access-label">Quick access</div>
          <div
            className="quick-access-row"
            onDragOver={(e) => {
              if (dragSource !== 'main' && dragSource !== 'quickaccess') return
              e.preventDefault()
              const index = nearestPinIndex(e.currentTarget, e.clientX)
              const key = `qgap:${index}`
              if (dragOverKeyRef.current !== key) activateDragOver(key)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              if (dragOverKeyRef.current?.startsWith('qgap:')) clearDragOver(dragOverKeyRef.current)
            }}
            onDrop={(e) => {
              if (!draggedId) return
              if (dragSource === 'quickaccess' || dragSource === 'main') {
                const index = nearestPinIndex(e.currentTarget, e.clientX)
                const list = org.pinned.filter((id) => id !== draggedId)
                list.splice(index, 0, draggedId)
                org.reorderPinned(list)
              }
              endDrag()
            }}
          >
            {quickAccessGap(0)}
            {pinnedTemplates.map((t, i) => (
              <span key={t.id} style={{ display: 'contents' }}>
                <button
                  className={`quick-access-chip${draggedId === t.id && dragSource === 'quickaccess' ? ' dragging' : ''}${t.id === selectedId ? ' selected' : ''}`}
                  draggable
                  onDragStart={() => {
                    setDraggedId(t.id)
                    setDragSource('quickaccess')
                  }}
                  onDragEnd={endDrag}
                  onClick={() => setSelectedId((cur) => (cur === t.id ? null : t.id))}
                  onDoubleClick={() => setOpenId(t.id)}
                  title="Click to select, double-click for full details, drag to reorder"
                >
                  <SubjectIcon icon={t.icon} size={13} />
                  {t.name}
                </button>
                {quickAccessGap(i + 1, i === pinnedTemplates.length - 1)}
              </span>
            ))}
          </div>
        </div>

        <div className="templates-list no-scrollbar">{renderContainer('root', 0)}</div>
      </div>

      <div className="right-col">
        {selected ? (
          <div className="panel detail-panel">
            <div className="detail-header">
              <span className="detail-icon">
                <SubjectIcon icon={selected.icon} size={19} />
              </span>
              <div>
                <div className="detail-kicker">Selected template</div>
                <div className="detail-title">{selected.name}</div>
                <div className="detail-desc">{selected.description}</div>
              </div>
            </div>
            <div className="detail-chips">
              <span className="detail-chip">{selected.questionCount} questions</span>
              <span className="detail-chip">calculator {selected.calculatorPolicy}</span>
              {selected.weighting && <span className="detail-chip">{selected.weighting}</span>}
            </div>
            <div className="detail-tags">
              {selected.tags.length === 0 ? (
                <span className="detail-tag whole-bank">
                  <TagIcon size={11} />
                  whole bank
                </span>
              ) : (
                selected.tags.map((t) => (
                  <span className="detail-tag" key={t}>
                    <TagIcon size={11} />
                    {t}
                  </span>
                ))
              )}
            </div>
            <div className="detail-spacer" />
            <div className="detail-footer">
              <button className="detail-more" onClick={() => setOpenId(selected.id)}>
                Full details
              </button>
              <button className="start-btn" onClick={() => onStart(selected.id)} disabled={!!starting}>
                {starting ? 'Starting…' : 'Start →'}
              </button>
            </div>
          </div>
        ) : (
          <div className="panel detail-panel prompt">
            <div className="detail-header">
              <span className="detail-icon">
                <SubjectIcon icon="bolt" size={19} />
              </span>
              <div>
                <div className="detail-kicker">Nothing picked yet</div>
                <div className="detail-title">Pick a template to get started</div>
                <div className="detail-desc">
                  {templates === null
                    ? 'Loading templates…'
                    : templates.length === 0
                      ? 'No templates yet — write some over MCP.'
                      : 'Select one from the list, or double-click for full details.'}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="panel heatmap-panel">
          <div className="heatmap-title">Activity, {HEAT_WEEKS} weeks</div>
          <div className="heatmap-fill">
            <Heatmap levels={heat} weeks={HEAT_WEEKS} days={HEAT_DAYS} />
          </div>
          <div className="sync-pill">
            <span className="sync-dot" />
            {status?.canonical
              ? `up to date${status.last_write_at ? ` · ${timeAgo(status.last_write_at)}` : ''}`
              : `synced ${timeAgo(lastSync)}`}
          </div>
        </div>
      </div>

      {opened && (
        <TemplateDetail
          template={opened}
          pinned={org.isPinned(opened.id)}
          canUnpin={true}
          onTogglePin={() => (org.isPinned(opened.id) ? org.unpinTemplate(opened.id) : org.pinTemplate(opened.id))}
          onClose={() => setOpenId(null)}
          onStart={() => {
            setOpenId(null)
            onStart(opened.id)
          }}
          onOpenTag={(slug) => {
            setOpenId(null)
            tagPopout.openTag(slug)
          }}
        />
      )}

      {tagPopout.openSlug && tagPopout.tag && (
        <TagDetail
          key={tagPopout.tag.slug}
          tag={tagPopout.tag}
          allTags={tagPopout.tags}
          onClose={tagPopout.closeTag}
          onOpenTag={tagPopout.openTag}
        />
      )}

      {tagPopout.openSlug && !tagPopout.loading && !tagPopout.tag && (
        <div className="tag-detail-backdrop" onClick={tagPopout.closeTag}>
          <div className="tag-detail" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Tag "{tagPopout.openSlug}" isn't in the bank.</div>
          </div>
        </div>
      )}
    </div>
  )
}
