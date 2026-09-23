import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphConfig } from './parser/config'
import {
  clientToView,
  panView,
  parseViewBox,
  pixelsPerViewUnit,
  viewBoxAttribute,
  viewScale,
  wheelZoomFactor,
  zoomAbout,
  type ViewBox,
} from './figure/viewport'
import './FigureView.css'

export interface FigureViewProps {
  // A complete <svg> document, as produced by figure/render.ts's
  // renderFigure. Passed as markup rather than as React elements because the
  // renderer's contract is *bytes* — byte-identical output across runs is
  // what makes a figure cacheable and diffable — and rebuilding that string
  // into a React tree would put a second, untested serialiser between the
  // renderer and the screen.
  svg: string
  theme: GraphConfig['theme']
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

export default function FigureView({ svg, theme }: FigureViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Stable across renders, and that identity is load-bearing rather than a
  // micro-optimisation: React compares the dangerouslySetInnerHTML *object*,
  // not the string inside it, so a fresh literal re-writes the container's
  // innerHTML on every render. That replaces the <svg> element — throwing
  // away the compensated label sizes and detaching every node this component
  // is holding — on every single frame of a pan.
  const markup = useMemo(() => ({ __html: svg }), [svg])

  // The view the renderer fitted. Everything else is relative to it: the
  // zoom limits, the label scale, and what "reset" means.
  const fitted = useMemo(() => parseViewBox(svg), [svg])
  const [view, setView] = useState<ViewBox | null>(fitted)

  // A new figure is a new drawing, not a new angle on the same one, so it
  // starts at its own fitted view rather than inheriting the last one's.
  useEffect(() => setView(fitted), [fitted])

  const rect = useCallback(() => {
    const node = containerRef.current
    if (!node) return null
    const box = node.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }, [])

  // Apply the view: the window itself, and the compensation that keeps text
  // and dots the size they were drawn at.
  //
  // The size each element was *written* with is remembered on the element
  // itself rather than in a ref, so that the scale is computed from the
  // renderer's own number every time instead of from the last scaled value —
  // which would compound — and so that a fresh <svg> (a new spec, or a
  // remount) simply re-reads its own attributes rather than leaving this
  // component holding detached nodes.
  useEffect(() => {
    const root = containerRef.current?.querySelector('svg')
    if (!root || !view || !fitted) return
    root.setAttribute('viewBox', viewBoxAttribute(view))
    const scale = viewScale(fitted, view)
    for (const [selector, attribute] of SCALED_ATTRIBUTES) {
      root.querySelectorAll(selector).forEach((element) => {
        const remembered = element.getAttribute(`data-written-${attribute}`)
        const written = remembered ?? element.getAttribute(attribute)
        if (written === null || !Number.isFinite(Number(written))) return
        if (remembered === null) element.setAttribute(`data-written-${attribute}`, written)
        element.setAttribute(attribute, String(Number(written) * scale))
      })
    }
  }, [view, fitted, svg])

  const dragging = useRef<{ pointer: number; x: number; y: number } | null>(null)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !view) return
    dragging.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current
    const box = rect()
    if (!drag || drag.pointer !== event.pointerId || !view || !box) return
    // A drag moves the drawing with the cursor, which means moving the
    // *window* the other way — and by pixels converted into view units, so
    // that a drag tracks the cursor exactly at any magnification.
    const perUnit = pixelsPerViewUnit(box, view)
    setView(panView(view, -(event.clientX - drag.x) / perUnit, -(event.clientY - drag.y) / perUnit))
    dragging.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointer !== event.pointerId) return
    dragging.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const box = rect()
    if (!view || !fitted || !box) return
    event.preventDefault()
    // About the cursor, not about the centre: magnifying about the middle
    // moves whatever the reader is looking at off the screen.
    const at = clientToView({ x: event.clientX, y: event.clientY }, box, view)
    setView(zoomAbout(view, at, wheelZoomFactor(event.deltaY), fitted))
  }

  const fittedNow = view !== null && fitted !== null && view.width === fitted.width && view.x === fitted.x && view.y === fitted.y

  // The markup is produced entirely by this package's own emitter, which
  // escapes every label and attribute value it writes (see figure/svg.ts's
  // svgEscape) — spec text never reaches the DOM unescaped.
  return (
    <div className={`figure-view figure-view-${theme}`}>
      <div
        ref={containerRef}
        className="figure-view-surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        dangerouslySetInnerHTML={markup}
      />
      {!fittedNow && (
        <button type="button" className="figure-view-reset" onClick={() => setView(fitted)}>
          Reset view
        </button>
      )}
    </div>
  )
}
