import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import PdfLayer from './PdfLayer'
import SimplePdfPages from './SimplePdfPages'
import TextContent from './TextContent'
import { ZoomControl, SettingsMenu } from './Toolbar'
import { RemoveHighlightIcon } from './icons'
import { getSelectionOffsetRange, getSelectionRect } from './selectionUtils'
import { toggleHighlightRange, removeHighlightRange } from './highlightOps'
import { toInternalRange, fromInternalRange, resolveForPaint, resolveMarkersForPaint, attachQuotes } from './offsetBoundary'
import { HIGHLIGHT_PALETTE } from './highlightPalette'
import { DEFAULT_TOKENS, tokensToCssVars, highlightCss as buildHighlightCss } from './tokenVars'
import type { DocumentTokens } from 'theme-core'
import { EDIT_STUB_MESSAGE, capabilities, gatedPresentation, offsetText, awaitingPdfText, resolveLayers } from './viewerModel'
import type {
  DocumentViewerAsset,
  DocumentHighlight,
  DocumentLayer,
  Interaction,
  Chrome,
  DocumentRenderError,
  RenderGraph,
} from './types'
import './DocumentViewer.css'

export interface DocumentViewerProps {
  asset: DocumentViewerAsset
  // Theme tokens (colours, fonts, scale). The host owns light/dark: the
  // tokens already say which mode they are. Absent: a neutral built-in set.
  // The viewer root is transparent; the host frame owns the sheet behind it.
  tokens?: DocumentTokens
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
  // Renders ```graph fences as an interactive plot in place. Absent: such
  // fences fall back to a plain code block.
  renderGraph?: RenderGraph
  // When true the content collapses to an unreadable placeholder (hidden from
  // sight and the accessibility tree). Zoom and scroll position are kept, so
  // reopening picks up where the reader was. The viewer does not know why.
  gated?: boolean
  gatedLabel?: string
}

const ZOOM_MIN = 1
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

let highlightCounter = 0
function makeHighlightId(): string {
  highlightCounter += 1
  return `highlight-${Date.now()}-${highlightCounter}`
}

let instanceCounter = 0

export default function DocumentViewer(props: DocumentViewerProps) {
  const { asset, tokens = DEFAULT_TOKENS, highlights, onHighlightsChange, onErrors, gated, gatedLabel, renderGraph } = props
  const gate = gatedPresentation(gated, gatedLabel)
  const { interaction = 'annotate', chrome = 'full', layers = [] } = props
  const caps = capabilities(interaction, chrome)
  const embedded = chrome === 'embedded'
  const layersRef = useRef(layers)
  layersRef.current = layers
  const resolved = useMemo(
    () => (caps.layers ? resolveLayers(layers, () => layersRef.current) : { anchors: [], markers: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caps.layers, JSON.stringify(layers.map((l) => [l.anchor, l.markers]))]
  )
  const { anchors: layerAnchors, markers: layerMarkers } = resolved
  const isPdf = asset.mime === 'application/pdf'
  const isImage = !!asset.mime?.startsWith('image/')
  const isText = asset.type === 'text' || asset.mime === 'text/plain' || asset.mime === 'text/markdown'
  const usesPdfLayer = isPdf && !!asset.url && !embedded
  // null = the PDF layer's text has not arrived yet; '' = arrived, empty (scanned).
  const [pdfText, setPdfText] = useState<string | null>(null)
  useEffect(() => {
    setPdfText(null)
  }, [asset.url])
  const text = offsetText(usesPdfLayer, pdfText, asset.extractedText ?? asset.content ?? '')

  // CSS.highlights is a single document-wide registry — namespace every
  // group name under a per-instance prefix so two mounted DocumentViewers
  // never overwrite each other's ranges.
  const instanceIdRef = useRef<string | null>(null)
  if (!instanceIdRef.current) {
    instanceCounter += 1
    instanceIdRef.current = `de${instanceCounter}`
  }
  const groupPrefix = instanceIdRef.current

  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens])

  const [zoom, setZoom] = useState(1)
  const [showOverlays, setShowOverlays] = useState(true)
  const [localHighlights, setLocalHighlights] = useState<DocumentHighlight[]>(highlights ?? [])
  useEffect(() => {
    if (highlights) setLocalHighlights(highlights)
  }, [highlights])

  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number; rect: DOMRect } | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (gated) setPendingSelection(null)
  }, [gated])

  // Public offsets are codepoints; the DOM-facing children (TextContent,
  // PdfLayer, highlightPainter) work in UTF-16. Convert once, here.
  // Quoted items are re-found in the current text first; ones whose quote is
  // gone are skipped (never painted at a stale place) and reported once.
  // Empty text means "not loaded yet": nothing to re-anchor against.
  const painted = useMemo(() => {
    if (awaitingPdfText(usesPdfLayer, pdfText)) return { highlights: [], anchors: [], markers: [], failed: [] as string[] }
    if (!text) return { highlights: localHighlights, anchors: layerAnchors, markers: layerMarkers, failed: [] as string[] }
    const h = resolveForPaint(text, localHighlights)
    const a = resolveForPaint(text, layerAnchors)
    const m = resolveMarkersForPaint(text, layerMarkers)
    const failed: string[] = []
    if (h.failed.length) failed.push(`${h.failed.length} highlight(s)`)
    if (a.failed.length) failed.push(`${a.failed.length} anchor(s)`)
    if (m.failed.length) failed.push(`${m.failed.length} marker(s)`)
    return { highlights: h.resolved, anchors: a.resolved, markers: m.resolved, failed }
  }, [text, usesPdfLayer, pdfText, localHighlights, layerAnchors, layerMarkers])
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
  // plus the anchor, generated from the tokens (see tokenVars.highlightCss
  // for the palette -> token mapping and why alpha is not optional).
  const highlightCss = useMemo(() => buildHighlightCss(groupPrefix, tokens), [groupPrefix, tokens])

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

  const onGraphErrors = (msgs: string[]) => onErrorsRef.current?.(msgs.map((message) => ({ message })))

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
      body = <TextContent text={text} anchors={[]} markers={[]} highlights={[]} showOverlays={false} groupPrefix={groupPrefix} renderGraph={renderGraph} onGraphErrors={onGraphErrors} />
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
        onText={setPdfText}
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
          renderGraph={renderGraph}
          onGraphErrors={onGraphErrors}
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
        renderGraph={renderGraph}
        onGraphErrors={onGraphErrors}
      />
    )
  } else {
    body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  }

  const canDownload = !!asset.url || (asset.type === 'text' && !!asset.content)

  return (
    <div
      className={`document-viewer document-viewer-mode-${embedded ? 'simple' : 'full'}`}
      data-mode={tokens.mode}
      style={cssVars as CSSProperties}
    >
      {!embedded && <style>{highlightCss}</style>}
      {caps.editStub && (
        <div className="document-viewer-edit-stub" data-component="well" role="status">
          {EDIT_STUB_MESSAGE}
        </div>
      )}
      {gate.placeholder && (
        <div className="document-viewer-gated" data-component="well" role="status">
          {gate.placeholder}
        </div>
      )}
      <div className={`document-viewer-scroll${gate.gated ? ' document-viewer-scroll-gated' : ''}`}>
        <div
          className={`document-viewer-content${sidePanel ? ' document-viewer-content-split' : ''}${gate.contentHidden ? ' document-viewer-content-hidden' : ''}`}
          style={{ zoom }}
          ref={contentRef}
          onMouseUp={handleMouseUp}
          aria-hidden={gate.contentHidden || undefined}
          inert={gate.contentHidden}
        >
          {body}
          {sidePanel && <div className="document-viewer-side-panel">{sidePanel}</div>}
        </div>
      </div>

      <div className="document-viewer-toolbar" data-component="tool-row">
        <ZoomControl zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={resetZoom} />
        {caps.settingsMenu && (
          <SettingsMenu
            showOverlays={showOverlays}
            onToggleOverlays={() => setShowOverlays((v) => !v)}
            onDownload={canDownload && !gate.gated ? handleDownload : null}
          />
        )}
      </div>

      {caps.highlightPopover && pendingSelection && !gate.gated && (
        <div
          className="document-viewer-highlight-action"
          data-component="menu"
          style={{ left: pendingSelection.rect.left + pendingSelection.rect.width / 2, top: pendingSelection.rect.top }}
        >
          {HIGHLIGHT_PALETTE.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className="document-viewer-highlight-swatch"
              data-component="pill"
              style={{ background: `var(--de-highlight-${(i % 4) + 1})` }}
              title={`Highlight ${c.label.toLowerCase()}`}
              aria-label={`Highlight ${c.label.toLowerCase()}`}
              onClick={() => applyHighlight(c.id)}
            />
          ))}
          <button
            type="button"
            className="document-viewer-highlight-dismiss"
            data-component="menu-item"
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
