import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { isFitMode, type ZoomMode } from './zoomModel'
import { initialMenuIndex, menuKeyAction } from './menuKeys'
import type { IconSheetRef } from 'theme-core'
import { resolveIcon } from './iconSheet'
import { useScrollbarWidth } from './useScrollbarWidth'
import { usePresence } from './ribbon/usePresence'
import './motion.css'
import './ViewerControls.css'

const DEFAULT_ICONS: IconSheetRef = { kind: 'default' }

const FIT_ITEMS: { mode: ZoomMode; label: string }[] = [
  { mode: 'fit-width', label: 'Fit width' },
  { mode: 'fit-page', label: 'Fit page' },
  { mode: 'fit-height', label: 'Fit height' },
]

// +/- buttons around a percentage button that opens a small menu of fit modes
// (when the content has pages/pixels to fit) and 100%.
export function ZoomControl({
  zoom,
  scale,
  allowFit,
  onZoomIn,
  onZoomOut,
  onSelect,
}: {
  /** Kept for API stability: the zoom control draws text glyphs, not sheet icons. */
  icons?: IconSheetRef
  zoom: ZoomMode
  scale: number
  allowFit: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onSelect: (mode: ZoomMode) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuRef = useRef<HTMLDivElement | null>(null)
  // the menu stays mounted (data-state="closed") while its exit animation plays
  const presence = usePresence(open, menuRef)
  useScrollbarWidth(rootRef)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const items = allowFit ? [...FIT_ITEMS, { mode: 1 as ZoomMode, label: '100%' }] : [{ mode: 1 as ZoomMode, label: '100%' }]
  // Fit modes are checked when active; 100% when the zoom is numerically 100%.
  // Any other numeric zoom has no item: the menu shows it as a header instead.
  const checked = items.map((item) => (isFitMode(item.mode) ? item.mode === zoom : !isFitMode(zoom) && Math.abs(scale - 1) < 0.005))
  const customPct = !isFitMode(zoom) && !checked.some(Boolean) ? Math.round(scale * 100) : null
  const initialIndex = initialMenuIndex(checked)

  // Focus the checked (or first) item as the menu opens.
  useEffect(() => {
    if (open) itemRefs.current[initialIndex]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const action = menuKeyAction(e.key, current, items.length)
    if (!action) return
    // Escape belongs to this menu alone: nothing above it may also react.
    if (e.key === 'Escape') e.stopPropagation()
    // Tab keeps its default so focus moves on from the trigger.
    if (e.key !== 'Tab') e.preventDefault()
    if (action.kind === 'focus') itemRefs.current[action.index]?.focus()
    else close(action.refocus)
  }

  return (
    <div className="document-viewer-zoom" ref={rootRef} data-component="viewer-control" data-open={open || undefined}>
      <div className="document-viewer-zoom-control" role="group" aria-label="Zoom controls">
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>
          {'−'}
        </button>
        <button
          type="button"
          ref={triggerRef}
          className="document-viewer-zoom-pct"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Zoom options"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            // Esc with the menu open but focus still on the trigger closes the menu only.
            if (e.key === 'Escape' && open) {
              e.stopPropagation()
              e.preventDefault()
              setOpen(false)
            }
          }}
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>
          +
        </button>
      </div>
      {presence.mounted && (
        <div key={presence.gen} ref={menuRef} data-state={presence.state} className="document-viewer-zoom-menu" role="menu" aria-label="Zoom" onKeyDown={onMenuKeyDown}>
          {customPct !== null && (
            <div role="presentation" className="document-viewer-zoom-current" aria-hidden="true">
              {customPct}%
            </div>
          )}
          {items.map((item, i) => (
            <button
              key={String(item.mode)}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitemradio"
              aria-checked={checked[i]}
              onClick={() => {
                onSelect(item.mode)
                close(true)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Full-mode-only: the hamburger button and its floating settings menu.
// Zoom lives in the always-present ZoomControl above, not duplicated here.
export function SettingsMenu({
  showOverlays,
  onToggleOverlays,
  onDownload,
  icons = DEFAULT_ICONS,
}: {
  icons?: IconSheetRef
  showOverlays: boolean
  onToggleOverlays: () => void
  onDownload: (() => void) | null
}) {
  const MenuIcon = resolveIcon('doc-menu', icons)
  const EyeIcon = resolveIcon(showOverlays ? 'doc-eye' : 'doc-eye-off', icons)
  const DownloadIcon = resolveIcon('doc-download', icons)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuRef = useRef<HTMLDivElement | null>(null)
  const presence = usePresence(open, menuRef)
  const count = onDownload ? 2 : 1
  useScrollbarWidth(rootRef)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  // Focus the first item as the menu opens.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  function close(refocus: boolean) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const action = menuKeyAction(e.key, current, count)
    if (!action) return
    if (e.key === 'Escape') e.stopPropagation()
    if (e.key !== 'Tab') e.preventDefault()
    if (action.kind === 'focus') itemRefs.current[action.index]?.focus()
    else close(action.refocus)
  }

  return (
    <div className="document-viewer-settings" ref={rootRef} data-component="viewer-control" data-open={open || undefined}>
      <button
        type="button"
        ref={triggerRef}
        aria-label="Document settings"
        title="Document settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            e.preventDefault()
            setOpen(false)
          }
        }}
      >
        <MenuIcon size={14} />
      </button>
      {presence.mounted && (
        <div key={presence.gen} ref={menuRef} data-state={presence.state} className="document-viewer-settings-menu" role="menu" aria-label="Document settings" onKeyDown={onMenuKeyDown}>
          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              itemRefs.current[0] = el
            }}
            onClick={onToggleOverlays}
          >
            <EyeIcon size={13} />
            {showOverlays ? 'Hide highlights' : 'Show highlights'}
          </button>
          {onDownload && (
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                itemRefs.current[1] = el
              }}
              onClick={onDownload}
            >
              <DownloadIcon size={13} />
              Download
            </button>
          )}
        </div>
      )}
    </div>
  )
}
