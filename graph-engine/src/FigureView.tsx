import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GivensPosition, GraphConfig } from './parser/config'
import { centreText, cursorText, focusLineFor, itemForId, toolCorner } from './figure/focusLine'
import { figureMapping, type FigureFrame } from './figure/frame'
import { highlightAccent, highlightOf, highlightOverlay, outermostMatches, selectedItems } from './figure/highlight'
import type { FigureHitItem, FigureTarget } from './figure/hitItems'
import { compensatedSize, parseViewBox } from './figure/viewport'
import { fittedCamera } from './view2d/camera'
import { applyOverscan, applySvgViewBox } from './view2d/dom/appliers'
import { CoordinateTool } from './view2d/dom/CoordinateTool'
import { toleranceInContent } from './view2d/dom/domInput'
import { startCamera } from './view2d/dom/startView'
import { useView2d } from './view2d/dom/useView2d'
import { focusCamera, formatFocus, type FocusSpec } from './view2d/focus'
import { OVERSCAN } from './view2d/feel'
import { growRect, liveTransformValue, type LiveTransform } from './view2d/liveTransform'
import { formatZoom } from './view2d/readout'
import type { Camera, Rect } from './view2d/types'
import './FigureView.css'

// What a click on the figure reports: the item picked, and what it names.
export interface FigureSelection {
  id: string
  targets: FigureTarget[]
  author?: FigureHitItem['author']
}

export interface FigureViewProps {
  // A complete <svg> document, as produced by figure/render.ts's
  // renderFigure. Passed as markup rather than as React elements because the
  // renderer's contract is *bytes* — byte-identical output across runs is
  // what makes a figure cacheable and diffable — and rebuilding that string
  // into a React tree would put a second, untested serialiser between the
  // renderer and the screen.
  svg: string
  theme: GraphConfig['theme']
  // What renderFigure reports beside the markup: where the author's
  // coordinates land (for @focus), and what can be pointed at. Optional, so a
  // caller that only has markup still gets a figure that moves.
  frame?: FigureFrame
  items?: FigureHitItem[]
  // The view the figure opens at, from the spec's @focus (config.focus).
  // Absent or unplaceable: the fitted view.
  startFocus?: FocusSpec | null
  // Runtime: animate to it whenever it changes.
  focus?: FocusSpec | null
  // The coordinate readout and its Copy button (the coordinate tool).
  coordinates?: boolean
  // Where the figure's givens table sits (config.givens), so the coordinate
  // tool can keep out of its way. Default: the directive's default.
  givens?: GivensPosition
  // Every selected item, in the order they were selected (a click selects one,
  // shift + click adds or removes); empty when nothing is selected.
  onSelect?(selection: FigureSelection[]): void
}

// Which attribute carries a size that must not grow with the view, and what
// it is written on. Labels and point dots keep their on-screen size as the
// figure magnifies — the same convention the plot renderer uses for tick
// labels and markers — because text that magnified with the drawing would
// cover the detail the reader zoomed in to read.
//
// Strokes are handled in CSS instead (`vector-effect: non-scaling-stroke`),
// which needs no bookkeeping at all.
const SCALED_ATTRIBUTES: [selector: string, attribute: string][] = [
  ['text', 'font-size'],
  ['[data-layer="points"] circle', 'r'],
]

// The elements whose size is compensated, with the size each was *written*
// with. Remembered here rather than read back from the element so that the
// scale is always computed from the renderer's own number and never from the
// last scaled value, which would compound. A fresh <svg> (a new spec) is a
// new root, so the list is simply collected again.
interface Compensation {
  root: SVGSVGElement
  entries: { element: Element; attribute: string; written: number }[]
}

function collect(root: SVGSVGElement): Compensation['entries'] {
  const entries: Compensation['entries'] = []
  for (const [selector, attribute] of SCALED_ATTRIBUTES) {
    root.querySelectorAll(selector).forEach((element) => {
      const written = element.getAttribute(attribute)
      if (written !== null && Number.isFinite(Number(written))) entries.push({ element, attribute, written: Number(written) })
    })
  }
  return entries
}

function compensate(root: SVGSVGElement, zoom: number, previous: Compensation | null): Compensation {
  const entries = previous && previous.root === root ? previous.entries : collect(root)
  for (const { element, attribute, written } of entries) element.setAttribute(attribute, String(compensatedSize(written, zoom)))
  return { root, entries }
}

const NONE: readonly string[] = []

export default function FigureView({ svg, theme, frame, items, startFocus, focus, coordinates, givens = 'top-left', onSelect }: FigureViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Stable across renders, and that identity is load-bearing rather than a
  // micro-optimisation: React compares the dangerouslySetInnerHTML *object*,
  // not the string inside it, so a fresh literal re-writes the container's
  // innerHTML on every render. That replaces the <svg> element — throwing
  // away the compensated label sizes and detaching every node this component
  // is holding — on every single frame of a pan.
  const markup = useMemo(() => ({ __html: svg }), [svg])

  // The content frame: the view the renderer fitted, in drawing coordinates.
  // Everything else is relative to it: the zoom, the limits, and what "reset"
  // means.
  const content = useMemo(() => parseViewBox(svg), [svg])

  // Where the figure opens: the spec's @focus when it places, else fitted.
  const start = useMemo<Camera | null>(() => {
    if (!content) return null
    const fitted = fittedCamera(content)
    return frame ? startCamera(startFocus, figureMapping(frame), fitted) : fitted
  }, [content, frame, startFocus])

  const itemsById = useMemo(() => new Map((items ?? []).map((item) => [item.id, item])), [items])
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<readonly string[]>(NONE)
  // The coordinate tool: whether its readout is open (the toggle itself is
  // there whenever the `coordinates` prop is on).
  const [toolOpen, setToolOpen] = useState(false)

  // Apply the camera: the window itself, and the compensation that keeps text
  // and dots the size they were drawn at. The last one applied is remembered
  // so that a new <svg> with the same view (a rebuilt spec) can be put back
  // where the reader was.
  // `window`: what the svg was committed over, the visible window and its overscan.
  const applied = useRef<{ zoom: number; visible: Rect; window: Rect; pxPerUnit: number } | null>(null)
  // How far the live view is scaled from the committed drawing (1 at a commit),
  // for what is measured against the live camera, not the drawing.
  const liveScale = useRef(1)
  // The elements the look is on now, so a change touches only those.
  const lit = useRef<Element[]>([])
  const compensation = useRef<Compensation | null>(null)

  // A commit: the svg is (re)drawn over `visible` and its overscan, clearing
  // the live transform; the label sizes follow. The only
  // place any of it is rewritten, so a move costs one of these every so often
  // (see view2d/liveTransform.ts's commitDue) and not one a frame.
  const paint = useCallback(
    (visible: Rect, zoom: number) => {
      const root = containerRef.current?.querySelector('svg')
      if (!root) return
      const window = growRect(visible, OVERSCAN)
      applyOverscan(root, OVERSCAN)
      applySvgViewBox(root, window)
      root.style.transform = ''
      root.style.willChange = ''
      liveScale.current = 1
      compensation.current = compensate(root, zoom, compensation.current)
    },
    [],
  )

  // Between commits: the committed drawing is moved on the compositor.
  const paintLive = useCallback((transform: LiveTransform) => {
    const root = containerRef.current?.querySelector('svg')
    if (!root) return
    root.style.willChange = 'transform'
    root.style.transform = liveTransformValue(transform)
    liveScale.current = transform.scale
  }, [])

  const view = useView2d({
    frame: content,
    start,
    items,
    onApply: (camera, visible, pxPerUnit) => {
      applied.current = { zoom: camera.zoom, visible, window: growRect(visible, OVERSCAN), pxPerUnit }
      paint(visible, camera.zoom)
    },
    onLive: paintLive,
    overscan: OVERSCAN,
    onHover: setHovered,
    onSelect: (ids) => {
      setSelected(ids)
      onSelect?.(selectedItems(items ?? [], ids))
    },
    // C does nothing, and is left to the page, unless the tool is on.
    onToggleCoordinates: coordinates ? () => setToolOpen((open) => !open) : undefined,
    // The pointer re-renders this view on every move; only the readout wants it.
    trackPointer: coordinates === true && toolOpen,
    trackCamera: coordinates === true && toolOpen,
  })

  useLayoutEffect(() => {
    const last = applied.current
    if (last) paint(last.visible, last.zoom)
  }, [markup, paint])

  // Hover and selection. The look itself is a clean overlay of plain lines
  // drawn from the items' hit shapes and laid over the figure (see
  // figure/highlight.ts's highlightOverlay), so it costs the same under every
  // style and never runs a filter over a texture. What is left on the markup is
  // a class on each outermost element that carries the identity (the markup
  // itself is never rewritten), which brings a label to full strength. The
  // givens panel has no statement, so it is matched by the item id.
  //
  // Outermost only: a styled figure puts the identity on a group and on every
  // path inside it. Every selected item shows the selection look.
  useLayoutEffect(() => {
    const root = containerRef.current?.querySelector('svg')
    if (!root) return
    root.querySelectorAll('[data-figure-highlight]').forEach((overlay) => overlay.remove())
    const clear = (element: Element) => element.classList.remove('figure-hovered', 'figure-selected')
    if (hovered === null && selected.length === 0) {
      lit.current.forEach(clear)
      lit.current = []
      return
    }
    const accent = highlightAccent(getComputedStyle(root).getPropertyValue('--accent'))
    root.insertAdjacentHTML('beforeend', highlightOverlay(items ?? [], hovered, selected, accent))
    const hot = hovered === null ? [] : (itemsById.get(hovered)?.targets ?? [])
    const picked = selected.flatMap((id) => itemsById.get(id)?.targets ?? [])
    const hoveredMatches: Element[] = []
    const selectedMatches: Element[] = []
    root.querySelectorAll('[data-statement], [data-object="givens"]').forEach((element) => {
      const match = highlightOf(element.getAttribute('data-statement'), element.getAttribute('data-object'), hot, picked, {
        hovered,
        selected,
      })
      if (match.hovered) hoveredMatches.push(element)
      if (match.selected) selectedMatches.push(element)
    })
    const parent = (element: Element): Element | null => {
      const up = element.parentElement
      return up === (root as Element) ? null : up
    }
    const looks = new Map<Element, { hovered: boolean; selected: boolean }>()
    for (const element of outermostMatches(hoveredMatches, parent)) looks.set(element, { hovered: true, selected: false })
    for (const element of outermostMatches(selectedMatches, parent)) {
      const look = looks.get(element)
      if (look) look.selected = true
      else looks.set(element, { hovered: false, selected: true })
    }
    // What was lit and is not now.
    for (const element of lit.current) if (!looks.has(element)) clear(element)
    for (const [element, look] of looks) {
      element.classList.toggle('figure-hovered', look.hovered)
      element.classList.toggle('figure-selected', look.selected)
    }
    lit.current = [...looks.keys()]
  }, [hovered, selected, items, itemsById, markup])

  // The runtime focus: a change of the spec moves the view there, animated.
  // Compared by value, so a parent that rebuilds an identical spec each render
  // does not keep restarting the move.
  const focusKey = focus ? formatFocus(focus) : null
  const wanted = useRef({ focus, frame })
  wanted.current = { focus, frame }
  const moveTo = view.focus
  useEffect(() => {
    const { focus: spec, frame: placed } = wanted.current
    if (!spec || !placed) return
    const camera = focusCamera(spec, figureMapping(placed))
    if (camera) moveTo(camera, true)
  }, [focusKey, moveTo])

  // The surface is the one element the gestures land on, so the hook gets it
  // as well as this component.
  const attachSurface = view.surfaceRef
  const setSurface = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element
      attachSurface(element)
    },
    [attachSurface],
  )

  // The coordinate tool's lines. Worked out only while it is open. The pixel
  // tolerance for "a vertex is under the centre" is turned into drawing units
  // with the scale of the frame the camera was last drawn at, which is the one
  // this render's camera belongs to (the hook publishes it right after), and
  // the live scale on top of that while the drawing is moved, not redrawn.
  let tool: ReactNode = null
  if (coordinates && frame) {
    const open = toolOpen && view.camera !== null
    const camera = view.camera
    const lines = { cursor: '', centre: '', zoom: '', copyText: '' }
    if (open && camera) {
      const all = items ?? []
      const tolerance = toleranceInContent('mouse', (applied.current?.pxPerUnit ?? 1) * liveScale.current)
      lines.cursor = cursorText(frame, view.pointer, itemForId(all, hovered))
      lines.centre = centreText(frame, camera, all, tolerance)
      lines.zoom = formatZoom(camera.zoom)
      lines.copyText = focusLineFor(frame, camera, all, tolerance)
    }
    tool = <CoordinateTool open={open} onToggle={() => setToolOpen((o) => !o)} theme={theme} corner={toolCorner(givens)} {...lines} />
  }

  // The markup is produced entirely by this package's own emitter, which
  // escapes every label and attribute value it writes (see figure/svg.ts's
  // svgEscape) — spec text never reaches the DOM unescaped.
  return (
    <div className={`figure-view figure-view-${theme}`}>
      <div ref={setSurface} className="figure-view-surface" dangerouslySetInnerHTML={markup} />
      {!view.atStart && (
        <button type="button" className="figure-view-reset" onClick={() => view.reset()}>
          Reset view
        </button>
      )}
      {tool}
    </div>
  )
}
