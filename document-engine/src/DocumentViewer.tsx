import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import PdfLayer from './PdfLayer'
import SimplePdfPages from './SimplePdfPages'
import TextContent from './TextContent'
import { ZoomControl, SettingsMenu } from './Toolbar'
import { RemoveHighlightIcon } from './icons'
import { getSelectionOffsetRange, getSelectionRect } from './selectionUtils'
import { toggleHighlightRange, removeHighlightRange } from './highlightOps'
import { HIGHLIGHT_PALETTE } from './highlightPalette'
import type {
  DocumentViewerAsset,
  DocumentAnchor,
  DocumentHighlight,
  DocumentMarker,
  DocumentRenderError,
} from './types'
import './DocumentViewer.css'

export interface DocumentViewerProps {
  asset: DocumentViewerAsset
  // Initializes the viewer's theme; the built-in settings menu can then
  // flip it locally without the host having to re-render this prop (same
  // "initializes, doesn't dictate every frame" pattern highlights/
  // onHighlightsChange below uses).
  theme?: 'light' | 'dark'
  // 'full' (default): the complete engine — in-document anchor highlighting,
  // clickable question markers, selectable/highlightable PDF and image-panel
  // text, zoom controls, and a settings menu (theme, highlight visibility,
  // download). 'simple': bare rendering for inline embedding (e.g. a small
  // figure inside a question's description box) — just the content, native
  // scroll, and zoom +/- buttons. No anchors, no markers, no highlighting,
  // no settings menu.
  mode?: 'full' | 'simple'
  anchor?: DocumentAnchor | null
  markers?: DocumentMarker[]
  // User-created highlights (select text, pick a color). Uncontrolled-with-
  // callback: this prop seeds/re-syncs internal state, onHighlightsChange is
  // how the host persists further changes — the host doesn't have to echo
  // every edit back down for the UI to keep working.
  highlights?: DocumentHighlight[]
  onHighlightsChange?: (highlights: DocumentHighlight[]) => void
  onJumpToQuestion?: (questionId: string) => void
  onErrors?: (errors: DocumentRenderError[]) => void
}

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

// See the highlightCss comment below for why this can't be 1 (opaque).
const HIGHLIGHT_ALPHA = 0.55

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

let highlightCounter = 0
function makeHighlightId(): string {
  highlightCounter += 1
  return `highlight-${Date.now()}-${highlightCounter}`
}

let instanceCounter = 0

export default function DocumentViewer({
  asset,
  theme,
  mode = 'full',
  anchor = null,
  markers = [],
  highlights,
  onHighlightsChange,
  onJumpToQuestion,
  onErrors,
}: DocumentViewerProps) {
  const isPdf = asset.mime === 'application/pdf'
  const isImage = !!asset.mime?.startsWith('image/')
  const isText = asset.type === 'text' || asset.mime === 'text/plain' || asset.mime === 'text/markdown'
  const text = asset.extractedText ?? asset.content ?? ''

  // CSS.highlights is a single document-wide registry — namespace every
  // group name under a per-instance prefix so two mounted DocumentViewers
  // never overwrite each other's ranges.
  const instanceIdRef = useRef<string | null>(null)
  if (!instanceIdRef.current) {
    instanceCounter += 1
    instanceIdRef.current = `de${instanceCounter}`
  }
  const groupPrefix = instanceIdRef.current

  const [internalTheme, setInternalTheme] = useState<'light' | 'dark'>(theme ?? 'light')
  useEffect(() => {
    if (theme) setInternalTheme(theme)
  }, [theme])

  const [zoom, setZoom] = useState(1)
  const [showOverlays, setShowOverlays] = useState(true)
  const [localHighlights, setLocalHighlights] = useState<DocumentHighlight[]>(highlights ?? [])
  useEffect(() => {
    if (highlights) setLocalHighlights(highlights)
  }, [highlights])

  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number; rect: DOMRect } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // ::highlight() rules for this instance's groups — one per palette color
  // plus the anchor, re-generated when the theme changes. Literal hex/rgba
  // values rather than var(...): custom-highlight pseudo-elements aren't
  // guaranteed to resolve custom properties from this stylesheet's own
  // cascade context across browsers, so this sidesteps that entirely.
  //
  // Alpha is not optional here, and not just cosmetic: a PDF's text-layer
  // spans render with color:transparent (the visible glyphs are painted on
  // the canvas underneath, not by these DOM text nodes — see PdfLayer). An
  // opaque highlight background would sit *above* that transparent text and
  // fully block the canvas glyphs below it, i.e. exactly the "solid block,
  // no visible text underneath" bug. Translucent backgrounds let the canvas
  // show through, same as how a native PDF viewer's own selection/highlight
  // color is always translucent, never solid.
  const highlightCss = useMemo(() => {
    const rules = HIGHLIGHT_PALETTE.map(
      (c) => `::highlight(${groupPrefix}-${c.id}) { background-color: ${hexToRgba(internalTheme === 'dark' ? c.dark : c.light, HIGHLIGHT_ALPHA)}; }`
    )
    rules.push(
      `::highlight(${groupPrefix}-anchor) { background-color: ${hexToRgba(internalTheme === 'dark' ? '#8a6d1a' : '#f4d35e', HIGHLIGHT_ALPHA)}; }`
    )
    return rules.join('\n')
  }, [groupPrefix, internalTheme])

  function zoomIn() {
    setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))
  }
  function zoomOut() {
    setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))
  }
  function resetZoom() {
    setZoom(1)
  }

  function handleMouseUp() {
    if (mode !== 'full' || !contentRef.current) return
    const range = getSelectionOffsetRange(contentRef.current)
    const rect = range ? getSelectionRect() : null
    setPendingSelection(range && rect ? { ...range, rect } : null)
  }

  function applyHighlight(colorId: string) {
    if (!pendingSelection) return
    const next = toggleHighlightRange(localHighlights, pendingSelection.start, pendingSelection.end, colorId, makeHighlightId)
    setLocalHighlights(next)
    onHighlightsChange?.(next)
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  // Strips whatever highlight coverage exists in the current selection,
  // regardless of color — a one-click "dehighlight" alongside the color
  // swatches, instead of having to reselect and pick the matching color to
  // toggle it off.
  function removeHighlight() {
    if (!pendingSelection) return
    const next = removeHighlightRange(localHighlights, pendingSelection.start, pendingSelection.end, makeHighlightId)
    setLocalHighlights(next)
    onHighlightsChange?.(next)
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  function handleDownload() {
    if (asset.url) {
      const a = document.createElement('a')
      a.href = asset.url
      a.download = ''
      a.click()
      return
    }
    if (asset.content) {
      // Text assets are treated as markdown natively — questions/passages
      // routinely include emphasis/lists, and .md is what an author would
      // actually want to re-open this in an editor as.
      const blob = new Blob([asset.content], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'document.md'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  let body: ReactNode
  let sidePanel: ReactNode = null

  if (mode === 'simple') {
    if (isPdf && asset.url) body = <SimplePdfPages url={asset.url} onErrors={onErrors} />
    else if (isImage && asset.url) body = <img className="document-viewer-image" src={asset.url} alt="" draggable={false} />
    else if (isText) {
      // Reuses TextContent's markdown rendering (see markdown.ts) with
      // every interactive feature switched off — 'simple' mode's whole
      // point is no anchors/markers/highlighting/click-handling, but there
      // is no reason its formatting should look worse than 'full' mode's.
      body = <TextContent text={text} anchor={null} markers={[]} highlights={[]} showOverlays={false} groupPrefix={groupPrefix} />
    }
    else body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  } else if (isPdf && asset.url) {
    body = (
      <PdfLayer
        url={asset.url}
        anchor={anchor}
        markers={markers}
        highlights={localHighlights}
        showOverlays={showOverlays}
        groupPrefix={groupPrefix}
        onJumpToQuestion={onJumpToQuestion}
        onErrors={onErrors}
      />
    )
  } else if (isImage && asset.url) {
    body = <img className="document-viewer-image" src={asset.url} alt="" draggable={false} />
    if (text) {
      sidePanel = (
        <TextContent
          text={text}
          anchor={anchor}
          markers={markers}
          highlights={localHighlights}
          showOverlays={showOverlays}
          groupPrefix={groupPrefix}
          onJumpToQuestion={onJumpToQuestion}
        />
      )
    }
  } else if (isText) {
    body = (
      <TextContent
        text={text}
        anchor={anchor}
        markers={markers}
        highlights={localHighlights}
        showOverlays={showOverlays}
        groupPrefix={groupPrefix}
        onJumpToQuestion={onJumpToQuestion}
      />
    )
  } else {
    body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  }

  const canDownload = !!asset.url || (asset.type === 'text' && !!asset.content)

  return (
    <div className={`document-viewer document-viewer-${internalTheme} document-viewer-mode-${mode}`}>
      {mode === 'full' && <style>{highlightCss}</style>}
      <div className="document-viewer-scroll">
        <div
          className={`document-viewer-content${sidePanel ? ' document-viewer-content-split' : ''}`}
          style={{ zoom }}
          ref={contentRef}
          onMouseUp={handleMouseUp}
        >
          {body}
          {sidePanel && <div className="document-viewer-side-panel">{sidePanel}</div>}
        </div>
      </div>

      <div className="document-viewer-toolbar">
        <ZoomControl zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
        {mode === 'full' && (
          <SettingsMenu
            theme={internalTheme}
            onToggleTheme={() => setInternalTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            showOverlays={showOverlays}
            onToggleOverlays={() => setShowOverlays((v) => !v)}
            onDownload={canDownload ? handleDownload : null}
          />
        )}
      </div>

      {mode === 'full' && pendingSelection && (
        <div
          className="document-viewer-highlight-action"
          style={{ left: pendingSelection.rect.left + pendingSelection.rect.width / 2, top: pendingSelection.rect.top }}
        >
          {HIGHLIGHT_PALETTE.map((c) => (
            <button
              key={c.id}
              type="button"
              className="document-viewer-highlight-swatch"
              style={{ background: internalTheme === 'dark' ? c.dark : c.light }}
              title={`Highlight ${c.label.toLowerCase()}`}
              onClick={() => applyHighlight(c.id)}
            />
          ))}
          <button
            type="button"
            className="document-viewer-highlight-dismiss"
            title="Remove highlight"
            aria-label="Remove highlight"
            onClick={removeHighlight}
          >
            <RemoveHighlightIcon size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
