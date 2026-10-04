import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphConfig } from './parser/config'
import { figureMapping, type FigureFrame } from './figure/frame'
import { highlightOf } from './figure/highlight'
import type { FigureHitItem, FigureTarget } from './figure/hitItems'
import { compensatedSize, parseViewBox } from './figure/viewport'
import { fittedCamera } from './view2d/camera'
import { applySvgViewBox } from './view2d/dom/appliers'
import { startCamera } from './view2d/dom/startView'
import { useView2d } from './view2d/dom/useView2d'
import { focusCamera, formatFocus, type FocusSpec } from './view2d/focus'
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
  onSelect?(selection: FigureSelection | null): void
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

export default function FigureView({ svg, theme, frame, items, startFocus, focus, onSelect }: FigureViewProps) {
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
  const [selected, setSelected] = useState<string | null>(null)

  // Apply the camera: the window itself, and the compensation that keeps text
  // and dots the size they were drawn at. The last one applied is remembered
  // so that a new <svg> with the same view (a rebuilt spec) can be put back
  // where the reader was.
  const applied = useRef<{ zoom: number; visible: Rect } | null>(null)
  const compensation = useRef<Compensation | null>(null)
  const paint = useCallback((visible: Rect, zoom: number) => {
    const root = containerRef.current?.querySelector('svg')
    if (!root) return
    applySvgViewBox(root, visible)
    compensation.current = compensate(root, zoom, compensation.current)
  }, [])

  const view = useView2d({
    frame: content,
    start,
    items,
    onApply: (camera, visible) => {
      applied.current = { zoom: camera.zoom, visible }
      paint(visible, camera.zoom)
    },
    onHover: setHovered,
    onSelect: (id) => {
      setSelected(id)
      const item = id === null ? undefined : itemsById.get(id)
      onSelect?.(item ? { id: item.id, targets: item.targets, author: item.author } : null)
    },
  })

  useLayoutEffect(() => {
    const last = applied.current
    if (last) paint(last.visible, last.zoom)
  }, [markup, paint])

  // Hover and selection are classes on the elements that already carry the
  // identity; the markup itself is never rewritten.
  useLayoutEffect(() => {
    const root = containerRef.current?.querySelector('svg')
    if (!root) return
    const hot = hovered === null ? [] : (itemsById.get(hovered)?.targets ?? [])
    const picked = selected === null ? [] : (itemsById.get(selected)?.targets ?? [])
    if (hot.length === 0 && picked.length === 0) {
      root.querySelectorAll('.figure-hovered, .figure-selected').forEach((element) => {
        element.classList.remove('figure-hovered', 'figure-selected')
      })
      return
    }
    root.querySelectorAll('[data-statement]').forEach((element) => {
      const lit = highlightOf(element.getAttribute('data-statement'), element.getAttribute('data-object'), hot, picked)
      element.classList.toggle('figure-hovered', lit.hovered)
      element.classList.toggle('figure-selected', lit.selected)
    })
  }, [hovered, selected, itemsById, markup])

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
    </div>
  )
}
