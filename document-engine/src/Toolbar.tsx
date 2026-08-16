import { useEffect, useRef, useState } from 'react'
import { MenuIcon, ZoomInIcon, ZoomOutIcon, DownloadIcon, EyeIcon } from './icons'

export function ZoomControl({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  return (
    <div className="document-viewer-zoom-control">
      <button type="button" aria-label="Zoom out" onClick={onZoomOut}>
        <ZoomOutIcon size={14} />
      </button>
      <button type="button" className="document-viewer-zoom-pct" onClick={onReset} title="Reset zoom">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn}>
        <ZoomInIcon size={14} />
      </button>
    </div>
  )
}

// Full-mode-only: the hamburger button and its floating settings menu.
// Zoom lives in the always-present ZoomControl above, not duplicated here.
export function SettingsMenu({
  theme,
  onToggleTheme,
  showOverlays,
  onToggleOverlays,
  onDownload,
}: {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
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
      <button type="button" aria-label="Document settings" onClick={() => setOpen((o) => !o)}>
        <MenuIcon size={15} />
      </button>
      {open && (
        <div className="document-viewer-settings-menu">
          <button type="button" onClick={onToggleTheme}>
            {theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          </button>
          <button type="button" onClick={onToggleOverlays}>
            <EyeIcon size={13} off={!showOverlays} />
            {showOverlays ? 'Hide highlights' : 'Show highlights'}
          </button>
          {onDownload && (
            <button type="button" onClick={onDownload}>
              <DownloadIcon size={13} />
              Download
            </button>
          )}
        </div>
      )}
    </div>
  )
}
