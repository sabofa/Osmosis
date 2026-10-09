import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import PdfLayer from './PdfLayer'
import SimplePdfPages from './SimplePdfPages'
import TextContent from './TextContent'
import { ZoomControl, SettingsMenu } from './Toolbar'
import { RemoveHighlightIcon } from './icons'
import { getSelectionOffsetRange, getSelectionRect } from './selectionUtils'
import { toggleHighlightRange, removeHighlightRange } from './highlightOps'
import { toInternalRange, fromInternalRange, resolveForPaint, resolveMarkersForPaint, attachQuotes } from './offsetBoundary'
import { HIGHLIGHT_PALETTE } from './highlightPalette'
import { EDIT_STUB_MESSAGE, capabilities, normalizeProps, resolveLayers, type LegacyViewerProps } from './viewerModel'
import type {
  DocumentViewerAsset,
  DocumentHighlight,
  DocumentLayer,
  Interaction,
  Chrome,
  DocumentRenderError,
} from './types'
import './DocumentViewer.css'

export interface DocumentViewerProps extends LegacyViewerProps {
  asset: DocumentViewerAsset
  // Initializes the viewer's theme; the built-in settings menu can then
  // flip it locally without the host having to re-render this prop (same
  // "initializes, doesn't dictate every frame" pattern highlights/
  // onHighlightsChange below uses).
  theme?: 'light' | 'dark'
  // What the reader may do: 'view' (select/search/zoom/theme only),
  // 'annotate' (default: view + highlights and the colour popover), 'edit'
  // (stub until editing lands; content stays read-only).
  interaction?: Interaction
  // 'full' (default): content, zoom, settings menu. 'embedded': content and
  // zoom buttons only — no settings menu, no highlighting, no layers.
  chrome?: Chrome
  // Layers compose over the viewer: each contributes an anchor and/or
  // clickable markers; marker activation goes to that layer's callback.
  layers?: DocumentLayer[]
  // User-created highlights (select text, pick a color). Uncontrolled-with-
  // callback: this prop seeds/re-syncs internal state, onHighlightsChange is
  // how the host persists further changes — the host doesn't have to echo
  // every edit back down for the UI to keep working.
  highlights?: DocumentHighlight[]
  onHighlightsChange?: (highlights: DocumentHighlight[]) => void
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

export default function DocumentViewer(props: DocumentViewerProps) {
  const { asset, theme, highlights, onHighlightsChange, onErrors } = props
  // TODO(T3.6): remove adapter — normalizeProps also maps the legacy
  // mode/anchor/markers/onJumpToQuestion props onto interaction/chrome/layers.
  const { interaction, chrome, layers } = normalizeProps(props)
  const caps = capabilities(interaction, chrome)
  const embedded = chrome === 'embedded'
  const resolved = useMemo(
    () => (caps.layers ? resolveLayers(layers) : { anchors: [], markers: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps.layers, JSON.stringify(layers.map((l) => [l.anchor, l.markers]))]
  )
  const { anchors: layerAnchors, markers: layerMarkers } = resolved
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

  // Public offsets are codepoints; the DOM-facing children (TextContent,
  // PdfLayer, highlightPainter) work in UTF-16. Convert once, here.
  // Quoted items are re-found in the current text first; ones whose quote is
  // gone are skipped (never painted at a stale place) and reported once.
  // Empty text means "not loaded yet": nothing to re-anchor against.
  const painted = useMemo(() => {
    if (!text) return { highlights: localHighlights, anchors: layerAnchors, markers: layerMarkers, failed: [] as string[] }
    const h = resolveForPaint(text, localHighlights)
    const a = resolveForPaint(text, layerAnchors)
    const m = resolveMarkersForPaint(text, layerMarkers)
    const failed: string[] = []
    if (h.failed.length) failed.push(`${h.failed.length} highlight(s)`)
    if (a.failed.length) failed.push(`${a.failed.length} anchor(s)`)
    if (m.failed.length) failed.push(`${m.failed.length} marker(s)`)
    return { highlights: h.resolved, anchors: a.resolved, markers: m.resolved, failed }
  }, [text, localHighlights, layerAnchors, layerMarkers])
  const { anchors, markers } = painted
  const failedMessage = painted.failed.length
    ? `Could not re-anchor ${painted.failed.join(', ')}: the quoted text is no longer in the document.`
    : null
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  useEffect(() => {
    if (failedMessage) onErrorsRef.current?.([{ message: failedMessage }])
  }, [failedMessage])
  const internalHighlights = useMemo(() => painted.highlights.map((h) => toInternalRange(text, h)), [painted.highlights, text])
  const internalAnchors = useMemo(() => anchors.map((a) => toInternalRange(text, a)), [anchors, text])

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
    if (!caps.highlightPopover || !contentRef.current) return
    const range = getSelectionOffsetRange(contentRef.current)
    const rect = range ? getSelectionRect() : null
    setPendingSelection(range && rect ? { ...fromInternalRange(text, range), rect } : null)
  }

  // Edits run against the RESOLVED positions (what the reader sees); highlights
  // whose quote is gone are carried through untouched, and anything the edit
  // creates (new or split) gets a fresh quote.
  function editHighlights(op: (resolved: DocumentHighlight[]) => DocumentHighlight[]): DocumentHighlight[] {
    if (!text) return op(localHighlights)
    const { resolved, failed } = resolveForPaint(text, localHighlights)
    const known = new Set(localHighlights.map((h) => h.id))
    return [...attachQuotes(text, op(resolved), known), ...failed]
  }

  function applyHighlight(colorId: string) {
    if (!caps.highlight || !pendingSelection) return
    const next = editHighlights((hs) => toggleHighlightRange(hs, pendingSelection.start, pendingSelection.end, colorId, makeHighlightId))
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
    if (!caps.highlight || !pendingSelection) return
    const next = editHighlights((hs) => removeHighlightRange(hs, pendingSelection.start, pendingSelection.end, makeHighlightId))
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
      // Text assets are treated as markdown natively — authored prose
      // routinely includes emphasis/lists, and .md is what an author would
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

  if (embedded) {
    if (isPdf && asset.url) body = <SimplePdfPages url={asset.url} onErrors={onErrors} />
    else if (isImage && asset.url) body = <img className="document-viewer-image" src={asset.url} alt="" draggable={false} />
    else if (isText) {
      // Reuses TextContent's markdown rendering (see markdown.ts) with
      // every interactive feature switched off — embedded chrome's whole
      // point is no anchors/markers/highlighting/click-handling, but there
      // is no reason its formatting should look worse than full chrome's.
      body = <TextContent text={text} anchors={[]} markers={[]} highlights={[]} showOverlays={false} groupPrefix={groupPrefix} />
    }
    else body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  } else if (isPdf && asset.url) {
    body = (
      <PdfLayer
        url={asset.url}
        anchors={internalAnchors}
        markers={markers}
        highlights={internalHighlights}
        showOverlays={showOverlays}
        groupPrefix={groupPrefix}
        onErrors={onErrors}
      />
    )
  } else if (isImage && asset.url) {
    body = <img className="document-viewer-image" src={asset.url} alt="" draggable={false} />
    if (text) {
      sidePanel = (
        <TextContent
          text={text}
          anchors={internalAnchors}
          markers={markers}
          highlights={internalHighlights}
          showOverlays={showOverlays}
          groupPrefix={groupPrefix}
        />
      )
    }
  } else if (isText) {
    body = (
      <TextContent
        text={text}
        anchors={internalAnchors}
        markers={markers}
        highlights={internalHighlights}
        showOverlays={showOverlays}
        groupPrefix={groupPrefix}
      />
    )
  } else {
    body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  }

  const canDownload = !!asset.url || (asset.type === 'text' && !!asset.content)

  return (
    <div className={`document-viewer document-viewer-${internalTheme} document-viewer-mode-${embedded ? 'simple' : 'full'}`}>
      {!embedded && <style>{highlightCss}</style>}
      {caps.editStub && (
        <div className="document-viewer-edit-stub" role="status">
          {EDIT_STUB_MESSAGE}
        </div>
      )}
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
        {caps.settingsMenu && (
          <SettingsMenu
            theme={internalTheme}
            onToggleTheme={() => setInternalTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            showOverlays={showOverlays}
            onToggleOverlays={() => setShowOverlays((v) => !v)}
            onDownload={canDownload ? handleDownload : null}
          />
        )}
      </div>

      {caps.highlightPopover && pendingSelection && (
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
