import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { isFitMode, type ZoomMode } from './zoomModel'
import { initialMenuIndex, menuKeyAction } from './menuKeys'
import { MenuIcon, ZoomInIcon, ZoomOutIcon, DownloadIcon, EyeIcon } from './icons'

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
    // Tab keeps its default so focus moves on from the trigger.
    if (e.key !== 'Tab') e.preventDefault()
    if (action.kind === 'focus') itemRefs.current[action.index]?.focus()
    else close(action.refocus)
  }

  return (
    <div className="document-viewer-zoom" ref={rootRef}>
      <div className="document-viewer-zoom-control" data-component="tool-row">
        <button type="button" data-component="pill" aria-label="Zoom out" onClick={onZoomOut}>
          <ZoomOutIcon size={14} />
        </button>
        <button
          type="button"
          ref={triggerRef}
          data-component="pill"
          className="document-viewer-zoom-pct"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Zoom options"
          onClick={() => setOpen((o) => !o)}
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" data-component="pill" aria-label="Zoom in" onClick={onZoomIn}>
          <ZoomInIcon size={14} />
        </button>
      </div>
      {open && (
        <div className="document-viewer-zoom-menu" data-component="menu" role="menu" aria-label="Zoom" onKeyDown={onMenuKeyDown}>
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
              data-component="menu-item"
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
}: {
  showOverlays: boolean
  onToggleOverlays: () => void
  onDownload: (() => void) | null
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div className="document-viewer-settings" ref={rootRef}>
      <button type="button" data-component="pill" aria-label="Document settings" onClick={() => setOpen((o) => !o)}>
        <MenuIcon size={15} />
      </button>
      {open && (
        <div className="document-viewer-settings-menu" data-component="menu">
          <button type="button" data-component="menu-item" onClick={onToggleOverlays}>
            <EyeIcon size={13} off={!showOverlays} />
            {showOverlays ? 'Hide highlights' : 'Show highlights'}
          </button>
          {onDownload && (
            <button type="button" data-component="menu-item" onClick={onDownload}>
              <DownloadIcon size={13} />
              Download
            </button>
          )}
        </div>
      )}
    </div>
  )
}
