import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { EditorView } from '@codemirror/view'
import MarkdownEditor from './editor/MarkdownEditor'
import Ribbon from './ribbon/Ribbon'
import { buildEditorRibbon } from './ribbon/ribbonState'
import { ribbonToToolbarCommands } from './ribbon/ribbonModel'
import PdfLayer from './PdfLayer'
import SimplePdfPages from './SimplePdfPages'
import TextContent from './TextContent'
import { ZoomControl, SettingsMenu } from './Toolbar'
import {
  SCROLLBAR_ALLOWANCE,
  ZOOM_ANIM_MS,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitReference,
  isFitMode,
  settleContainer,
  settleFitScale,
  stableFitScale,
  stepZoom,
  wheelZoomFactor,
  zoomAround,
  zoomAroundPages,
  zoomTweenStart,
  type Size,
  type ZoomMode,
} from './zoomModel'
import { resolveIcon } from './iconSheet'
import { graphBlocks } from './graphFence'
import {
  INITIAL_EXPAND,
  clampExpand,
  expandGraph,
  collapseGraph,
  setActiveGraph,
  commandTarget,
  canExpandCommand,
  canCollapseCommand,
  escapeDecision,
  targetInMenu,
  menuOpenIn,
} from './expandModel'
import { useHostCommands } from './useHostCommands'
import { extractHeadings, headingBlockIndex, lineRangeAt, sameHeadings, type OutlineHeading } from './outline'
import { cpToUtf16 } from './core/offsets'
import { getSelectionOffsetRange, getSelectionRect } from './selectionUtils'
import { toggleHighlightRange, removeHighlightRange } from './highlightOps'
import { toInternalRange, fromInternalRange, resolveForPaint, resolveMarkersForPaint, attachQuotes } from './offsetBoundary'
import { HIGHLIGHT_PALETTE } from './highlightPalette'
import { DEFAULT_TOKENS, tokensToCssVars, highlightCss as buildHighlightCss } from './tokenVars'
import type { DocumentTokens } from 'theme-core'
import { EDIT_STUB_MESSAGE, engineLayers, capabilities, gatedPresentation, offsetText, awaitingPdfText, resolveLayers } from './viewerModel'
import type {
  DocumentViewerAsset,
  DocumentHighlight,
  DocumentLayer,
  Interaction,
  Chrome,
  DocumentRenderError,
  DocumentHost,
  RenderGraph,
} from './types'
import './DocumentViewer.css'

export interface DocumentViewerProps {
  asset: DocumentViewerAsset
  // Theme tokens (colours, fonts, scale). The host owns light/dark: the
  // tokens already say which mode they are. Absent: a neutral built-in set.
  // The viewer root is transparent; the host frame owns the sheet behind it.
  tokens?: DocumentTokens
  // Workspace host: the viewer publishes its layer list through it.
  host?: DocumentHost
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
  // Zoom the document opens at. Default: 'fit-width' for PDFs and images, 1
  // for text. Fit modes are ignored for text; numbers are clamped to the
  // asset's range.
  initialZoom?: ZoomMode
  // Edit mode over a text asset: with this set the viewer renders the
  // Markdown editor (instead of the edit stub) and reports every text change.
  // The asset's text stays the source of truth; hand the new text back down.
  onTextChange?: (text: string) => void
  // Keep the editor from changing the text (commands go disabled).
  editorReadOnly?: boolean
  // Render markdown in place while editing, revealing raw marks at the caret (default true).
  livePreview?: boolean
  // Text/markdown assets: the heading outline, called once on mount and again
  // (debounced) whenever the list of headings actually changes.
  onOutline?: (headings: OutlineHeading[]) => void
  // Scroll to a heading from the outline (ids from onOutline). A new nonce
  // scrolls again, even to the same id. Read mode puts the heading's block at
  // the top; edit mode moves the caret to the heading line and reveals it.
  scrollToHeadingId?: { id: string; nonce: number } | null
}

// Plain text/markdown keeps a narrower numeric range and no fit modes.
const TEXT_ZOOM_MIN = 0.5
const TEXT_ZOOM_MAX = 3
// Space kept around a page in the PDF/image views (matches the CSS padding).
const FIT_PADDING = 16
// Vertical gap between PDF pages (matches .document-viewer-pdf-pages gap).
const PAGE_GAP = 12

let highlightCounter = 0
function makeHighlightId(): string {
  highlightCounter += 1
  return `highlight-${Date.now()}-${highlightCounter}`
}

let instanceCounter = 0

// An image shown beside a text panel only gets half the width to fit into.
function sidePanelSized(sizes: Size[], split: boolean): Size[] {
  return split ? sizes.map((s) => ({ w: s.w * 2, h: s.h })) : sizes
}

export default function DocumentViewer(props: DocumentViewerProps) {
  const { asset, tokens = DEFAULT_TOKENS, highlights, onHighlightsChange, onErrors, gated, gatedLabel, renderGraph } = props
  const gate = gatedPresentation(gated, gatedLabel)
  const { host } = props
  // Publish the layer list once per host identity.
  useEffect(() => {
    host?.layers(engineLayers())
  }, [host?.layers])
  const { interaction = 'annotate', chrome = 'full', layers = [] } = props
  const caps = capabilities(interaction, chrome, !!host)
  const iconRef = host?.icons ?? { kind: 'default' as const }
  const RemoveHighlightIcon = resolveIcon('doc-highlight-remove', iconRef)
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
  const hasEditor = interaction === 'edit' && isText && !!props.onTextChange
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

  const paged = (isPdf && !!asset.url) || (isImage && !!asset.url)
  const zoomMin = paged ? ZOOM_MIN : TEXT_ZOOM_MIN
  const zoomMax = paged ? ZOOM_MAX : TEXT_ZOOM_MAX
  const defaultZoom: ZoomMode = props.initialZoom !== undefined && (paged || !isFitMode(props.initialZoom)) ? props.initialZoom : paged ? 'fit-width' : 1
  const [zoom, setZoomState] = useState<ZoomMode>(defaultZoom)
  const [pageSizes, setPageSizes] = useState<Size[]>([])
  const [container, setContainer] = useState<Size>({ w: 0, h: 0 })
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setZoomState(defaultZoom)
    setPageSizes([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.url, paged])

  // Fit modes measure the OUTER scroller box minus a constant scrollbar
  // allowance (see zoomModel.stableFitScale), and ignore sub-0.5% changes, so
  // a scrollbar toggling can never feed back into the scale.
  const lastFitScale = useRef<number | null>(null)
  const scale = isFitMode(zoom)
    ? settleFitScale(
        lastFitScale.current,
        stableFitScale(zoom, container, fitReference(zoom, sidePanelSized(pageSizes, isImage && !!text)), FIT_PADDING, SCROLLBAR_ALLOWANCE, zoomMin, zoomMax)
      )
    : clampZoom(zoom, zoomMin, zoomMax)
  lastFitScale.current = isFitMode(zoom) ? scale : null
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)

  // Tracks the scroll container so fit modes follow window/pane resizes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // offsetWidth/Height (border box) do not change when a scrollbar toggles.
    const measure = () => setContainer((c) => settleContainer(c, { w: el.offsetWidth, h: el.offsetHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Re-anchor the scroll position after a zoom so the point under the cursor
  // (or the viewport centre) stays put.
  //
  // Discrete steps (buttons, menu, fit modes) then ease the stretch: layout
  // is already at the new scale, so the one content wrapper is drawn at the
  // old look (transform about the anchor point) and transitions to 1. Only
  // that wrapper's transform animates (WAAPI): no per-frame layout. Continuous
  // ctrl+wheel/pinch asks for no tween (it is continuous already).
  const tweenRequest = useRef<{ x: number; y: number } | null>(null)
  const prevScale = useRef(scale)
  const tweenAnim = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const target = pendingScroll.current
    if (el && target) {
      el.scrollLeft = target.left
      el.scrollTop = target.top
    }
    pendingScroll.current = null
    const from = prevScale.current
    prevScale.current = scale
    const anchor = tweenRequest.current
    tweenRequest.current = null
    const content = contentRef.current
    if (!anchor || !el || !content || !paged || from === scale) return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let running = 1
    try {
      running = new DOMMatrixReadOnly(getComputedStyle(content).transform).a || 1
    } catch {
      /* no transform in flight */
    }
    if (typeof content.animate !== 'function') return
    // Web Animations: no forced reflow to commit a start state, and the
    // transform runs off the main thread where the browser can.
    tweenAnim.current?.cancel()
    content.style.transformOrigin = `${el.scrollLeft + anchor.x}px ${el.scrollTop + anchor.y}px`
    const anim = content.animate([{ transform: `scale(${zoomTweenStart(from, scale, running)})` }, { transform: 'scale(1)' }], {
      duration: ZOOM_ANIM_MS,
      easing: 'ease-out',
    })
    tweenAnim.current = anim
    const done = () => {
      if (tweenAnim.current !== anim) return
      tweenAnim.current = null
      content.style.transformOrigin = ''
    }
    anim.onfinish = done
    anim.oncancel = done
  }, [scale])
  useEffect(
    () => () => {
      tweenAnim.current?.cancel()
    },
    []
  )

  const setZoom = useCallback(
    (mode: ZoomMode, around?: { x: number; y: number }) => {
      const el = scrollRef.current
      const current = scaleRef.current
      // One source of truth for fit hysteresis: the render reads
      // lastFitScale too, so seed it with the scale actually on screen.
      if (isFitMode(mode)) lastFitScale.current = current
      const next = isFitMode(mode)
        ? settleFitScale(current, stableFitScale(mode, container, fitReference(mode, sidePanelSized(pageSizes, isImage && !!text)), FIT_PADDING, SCROLLBAR_ALLOWANCE, zoomMin, zoomMax))
        : clampZoom(mode, zoomMin, zoomMax)
      if (el && next !== current) {
        const cursor = around ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 }
        const base = pendingScroll.current ?? { left: el.scrollLeft, top: el.scrollTop }
        // PDF pages: padding and gaps do not scale, so anchor on the page
        // geometry. Images and text keep the proportional maths.
        pendingScroll.current =
          isPdf && pageSizes.length > 0
            ? zoomAroundPages(pageSizes, current, next, cursor, base, { w: el.clientWidth, h: el.clientHeight }, FIT_PADDING, PAGE_GAP)
            : zoomAround(current, next, cursor, base)
        scaleRef.current = next
        tweenRequest.current = around ? null : cursor
      } else {
        // No scale change: never leave a stale request for a later resize.
        tweenRequest.current = null
      }
      setZoomState(isFitMode(mode) ? mode : clampZoom(mode, zoomMin, zoomMax))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [container, pageSizes, zoomMin, zoomMax, isImage, isPdf, text]
  )

  // Ctrl+wheel (trackpad pinch arrives as ctrl+wheel) zooms around the
  // cursor; a plain wheel scrolls. Native listener: React's is passive.
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Events inside one frame are multiplied together and applied once per
    // animation frame, so a fast burst costs one relayout per frame.
    let raf = 0
    let factor = 1
    let cursor = { x: 0, y: 0 }
    const flush = () => {
      raf = 0
      const f = factor
      factor = 1
      setZoomRef.current(scaleRef.current * f, cursor)
    }
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // A discrete-zoom stretch may still be running: wheel zoom is
      // continuous, so drop it rather than fight the new layout.
      tweenAnim.current?.cancel()
      const box = el!.getBoundingClientRect()
      cursor = { x: e.clientX - box.left, y: e.clientY - box.top }
      factor *= wheelZoomFactor(e.deltaY)
      if (!raf) raf = requestAnimationFrame(flush)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  const [showOverlays, setShowOverlays] = useState(true)
  const [localHighlights, setLocalHighlights] = useState<DocumentHighlight[]>(highlights ?? [])
  useEffect(() => {
    if (highlights) setLocalHighlights(highlights)
  }, [highlights])

  // The editor's view, re-read (animation-frame throttled) on selection and
  // document changes so the published commands' enabled/active flags follow.
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [editorTick, setEditorTick] = useState(0)
  const editorRaf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(editorRaf.current), [])
  const onEditorViewUpdate = useCallback(() => {
    if (editorRaf.current) return
    editorRaf.current = requestAnimationFrame(() => {
      editorRaf.current = 0
      setEditorTick((n) => n + 1)
    })
  }, [])
  useEffect(() => {
    if (!hasEditor) setEditorView(null)
  }, [hasEditor])
  // True while an IME composition is open in the editor (read by D2b).
  const compositionActiveRef = useRef(false)

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
    setZoom(stepZoom(scaleRef.current, 'in', zoomMin, zoomMax))
  }
  function zoomOut() {
    setZoom(stepZoom(scaleRef.current, 'out', zoomMin, zoomMax))
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

  // Graph expand. Ordinals count graph fences in document order.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const graphCount = useMemo(() => (isText && renderGraph ? graphBlocks(text).length : 0), [isText, renderGraph, text])
  const [expandState, setExpandState] = useState(INITIAL_EXPAND)
  const expand = clampExpand(expandState, graphCount)
  const expandRef = useRef(expand)
  expandRef.current = expand
  const expandable = !embedded && graphCount > 0
  const expandedGraph = expandable ? expand.expanded : null
  const onExpandGraph = (ordinal: number | null) =>
    setExpandState((s) => (ordinal === null ? collapseGraph(s) : expandGraph(s, ordinal)))
  const onActiveGraph = (ordinal: number) => setExpandState((s) => setActiveGraph(s, ordinal))
  // Esc collapses an expanded graph before anything else (shell included) sees it.
  const anyExpanded = expandedGraph !== null
  // Listens on the document in the capture phase so Esc works wherever focus
  // is (body after a frame double-click or a host-driven expand included).
  useEffect(() => {
    if (!anyExpanded) return
    const onKey = (e: KeyboardEvent) => {
      if (escapeDecision(e.key, expandRef.current, targetInMenu(e.target) || menuOpenIn(rootRef.current)) !== 'collapse') return
      e.stopPropagation()
      e.preventDefault()
      setExpandState((s) => collapseGraph(s))
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [anyExpanded])

  const onGraphErrors = (msgs: string[]) => onErrorsRef.current?.(msgs.map((message) => ({ message })))

  const imageSize = pageSizes[0]
  const imageBody = asset.url ? (
    <img
      className={`document-viewer-image${imageSize ? ' document-viewer-image-scaled' : ''}`}
      src={asset.url}
      alt=""
      draggable={false}
      style={imageSize ? { width: imageSize.w * scale, height: imageSize.h * scale } : undefined}
      onLoad={(e) => setPageSizes([{ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }])}
    />
  ) : null

  let body: ReactNode
  let sidePanel: ReactNode = null

  if (hasEditor) {
    body = (
      <div className="document-viewer-editor">
        <MarkdownEditor
          key={props.editorReadOnly ? 'ro' : 'rw'}
          value={text}
          onChange={(t) => props.onTextChange?.(t)}
          onReady={setEditorView}
          onViewUpdate={onEditorViewUpdate}
          highlights={localHighlights}
          onHighlightsChange={(h) => {
            setLocalHighlights(h)
            onHighlightsChange?.(h)
          }}
          onCompositionChange={(c) => {
            compositionActiveRef.current = c
          }}
          readOnly={props.editorReadOnly}
          livePreview={props.livePreview}
          renderGraph={renderGraph}
          graphCtx={{ onErrors: onGraphErrors }}
        />
      </div>
    )
  } else if (embedded) {
    if (isPdf && asset.url) body = <SimplePdfPages url={asset.url} onErrors={onErrors} scale={scale} onPageSizes={setPageSizes} />
    else if (isImage && asset.url) body = imageBody
    else if (isText) {
      // Reuses TextContent's markdown rendering (see markdown.ts) with
      // every interactive feature switched off — embedded chrome's whole
      // point is no anchors/markers/highlighting/click-handling, but there
      // is no reason its formatting should look worse than full chrome's.
      body = <TextContent text={text} anchors={[]} markers={[]} highlights={[]} showOverlays={false} groupPrefix={groupPrefix} renderGraph={renderGraph} onGraphErrors={onGraphErrors} icons={iconRef} />
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
        scale={scale}
        onPageSizes={setPageSizes}
      />
    )
  } else if (isImage && asset.url) {
    body = imageBody
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
          expandedGraph={expandedGraph}
          onExpandGraph={onExpandGraph}
          onActiveGraph={onActiveGraph}
          icons={iconRef}
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
        expandedGraph={expandedGraph}
        onExpandGraph={onExpandGraph}
        onActiveGraph={onActiveGraph}
        icons={iconRef}
      />
    )
  } else {
    body = <div className="document-viewer-placeholder">Preview not available for this file type.</div>
  }

  // The editor's ribbon, rebuilt from the live editor state on every render
  // (which the rAF-throttled view-update tick drives). Hosted: it is flattened
  // to the ToolbarCommand list; unhosted: drawn in place below.
  const editorRibbon = useMemo(
    () => (hasEditor ? buildEditorRibbon(editorView, { readOnly: props.editorReadOnly }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasEditor, editorView, props.editorReadOnly, editorTick]
  )
  // After a ribbon command the editor takes focus back (unless a command
  // already moved it inside the editor, e.g. into the search panel).
  const focusEditor = useCallback(() => {
    if (editorView && !editorView.dom.contains(document.activeElement)) editorView.focus()
  }, [editorView])

  const canDownload = !!asset.url || (asset.type === 'text' && !!asset.content)

  // Commands for the host toolbar. `run` goes through a ref to the latest
  // callbacks, so it is never stale; the list is only republished when its
  // visible shape (ids/labels/icons/enabled/active) changes.
  const selectionTouchesHighlight =
    !!pendingSelection && painted.highlights.some((h) => h.start < pendingSelection.end && h.end > pendingSelection.start)
  const latest = {
    interaction,
    chrome,
    zoom,
    allowFit: paged,
    atMin: scale <= zoomMin + 1e-6,
    atMax: scale >= zoomMax - 1e-6,
    showOverlays,
    canRemoveHighlight: selectionTouchesHighlight && !gate.gated,
    canDownload: canDownload && !gate.gated,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onFit: (mode: ZoomMode) => setZoom(mode),
    onToggleOverlays: () => setShowOverlays((v) => !v),
    onRemoveHighlight: removeHighlight,
    onDownload: handleDownload,
    editorCommands: editorRibbon ? ribbonToToolbarCommands(editorRibbon) : null,
    graph: expandable
      ? {
          canExpand: canExpandCommand(expand, graphCount),
          canCollapse: canCollapseCommand(expand),
          onExpand: () => {
            const target = commandTarget(expandRef.current, graphCount)
            if (target !== null) onExpandGraph(target)
          },
          onCollapse: () => onExpandGraph(null),
        }
      : null,
  }
  useHostCommands(host, latest)

  // Outline: headings of a text asset, published on mount and (debounced)
  // when they change.
  const onOutlineRef = useRef(props.onOutline)
  onOutlineRef.current = props.onOutline
  const lastOutline = useRef<OutlineHeading[] | null>(null)
  const outlineTimer = useRef(0)
  useEffect(() => {
    const publish = (next: OutlineHeading[]) => {
      if (lastOutline.current && sameHeadings(lastOutline.current, next)) return
      lastOutline.current = next
      onOutlineRef.current?.(next)
    }
    if (!isText) {
      if (lastOutline.current && lastOutline.current.length > 0) publish([])
      return
    }
    if (lastOutline.current === null) {
      publish(extractHeadings(text))
      return
    }
    outlineTimer.current = window.setTimeout(() => publish(extractHeadings(text)), 150)
    return () => window.clearTimeout(outlineTimer.current)
  }, [text, isText])

  // Scroll to a heading. Read mode: the rendered block whose data-start range
  // holds the heading line goes to the top of the scroller (rect maths, so CSS
  // zoom is accounted for). Edit mode: caret to the heading line, revealed.
  const scrollTarget = props.scrollToHeadingId
  const scrollNonce = scrollTarget?.nonce
  useEffect(() => {
    if (!scrollTarget || !isText) return
    const heading = extractHeadings(text).find((x) => x.id === scrollTarget.id)
    if (!heading) return
    if (hasEditor) {
      if (!editorView) return
      const doc = editorView.state.doc.toString()
      const pos = Math.min(cpToUtf16(doc, heading.offset), doc.length)
      editorView.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) })
      editorView.focus()
      return
    }
    const root = contentRef.current?.querySelector<HTMLElement>('.document-viewer-text')
    const scroller = scrollRef.current
    if (!root || !scroller) return
    const blocks = Array.from(root.children) as HTMLElement[]
    const starts = blocks.map((b) => {
      const el = b.hasAttribute('data-start') ? b : b.querySelector<HTMLElement>('[data-start]')
      return el ? Number(el.getAttribute('data-start')) : null
    })
    const idx = headingBlockIndex(starts, lineRangeAt(text, heading.offset).end)
    if (idx < 0) return
    const top = blocks[idx].getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop += top - 8
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce, hasEditor && !!editorView])
  const showEditorBar = hasEditor && caps.editorBar
  const showZoomControl = caps.zoomControl && !hasEditor
  const showSettingsMenu = caps.settingsMenu && !hasEditor

  return (
    <div
      ref={rootRef}
      className={`document-viewer document-viewer-mode-${embedded ? 'simple' : 'full'}${showEditorBar ? ' document-viewer-with-bar' : ''}`}
      data-mode={tokens.mode}
      style={cssVars as CSSProperties}
    >
      {!embedded && <style>{highlightCss}</style>}
      {caps.editStub && !hasEditor && (
        <div className="document-viewer-edit-stub" data-component="well" role="status">
          {EDIT_STUB_MESSAGE}
        </div>
      )}
      {gate.placeholder && (
        <div className="document-viewer-gated" data-component="well" role="status">
          {gate.placeholder}
        </div>
      )}
      {showEditorBar && editorRibbon && <Ribbon ribbon={editorRibbon} icons={iconRef} onDone={focusEditor} />}
      <div className={`document-viewer-scroll${gate.gated ? ' document-viewer-scroll-gated' : ''}${paged ? ' document-viewer-scroll-fit' : ''}`} ref={scrollRef}>
        <div
          className={`document-viewer-content${sidePanel ? ' document-viewer-content-split' : ''}${gate.contentHidden ? ' document-viewer-content-hidden' : ''}`}
          style={paged || hasEditor ? undefined : { zoom: scale }}
          ref={contentRef}
          onMouseUp={handleMouseUp}
          aria-hidden={gate.contentHidden || undefined}
          inert={gate.contentHidden}
        >
          {body}
          {sidePanel && <div className="document-viewer-side-panel">{sidePanel}</div>}
        </div>
      </div>

      {(showZoomControl || showSettingsMenu) && (
      <div className="document-viewer-toolbar">
        {showZoomControl && <ZoomControl icons={iconRef} zoom={zoom} scale={scale} allowFit={paged} onZoomIn={zoomIn} onZoomOut={zoomOut} onSelect={(mode) => setZoom(mode)} />}
        {showSettingsMenu && (
          <SettingsMenu
            icons={iconRef}
            showOverlays={showOverlays}
            onToggleOverlays={() => setShowOverlays((v) => !v)}
            onDownload={canDownload && !gate.gated ? handleDownload : null}
          />
        )}
      </div>
      )}

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
