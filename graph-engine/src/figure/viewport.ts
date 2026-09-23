import { fmt } from './svg'

// Navigation — pan and zoom over a rendered figure.
//
// **F4: navigation is a viewBox transform.** Nothing re-lays-out, nothing
// resamples and nothing is redrawn; the same markup is shown through a
// different window, so the figure stays crisp at any magnification. There is
// no plot camera here: no axes, no grid, no world-coordinate readout. This is
// "move and magnify the drawing", not "change the plotted window".
//
// Everything in this file is pure arithmetic on plain numbers, and it lives
// here rather than inside FigureView for one reason: the component cannot be
// render-tested in this package (vitest runs node-only, and the suite is
// `*.test.ts`). A decision that cannot be reached by a test is a decision
// that ships wrong, so the decisions live where a test can reach them and the
// component is left holding only the event plumbing.

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

// How far in and out navigation goes, as multiples of the fitted view.
//
// Out is deliberately tight: the fitted view already shows the whole figure,
// so pulling back further only shrinks it into the middle of an empty page.
// In is generous, because the point of the feature is reading a crowded
// corner of a competition figure.
export const MAX_ZOOM = 12
export const MIN_ZOOM = 0.5

// ---------------------------------------------------------------------------
// The attribute
// ---------------------------------------------------------------------------

export function viewBoxAttribute(view: ViewBox): string {
  return `${fmt(view.x)} ${fmt(view.y)} ${fmt(view.width)} ${fmt(view.height)}`
}

// The fitted view, read back out of the markup the renderer produced.
//
// Read rather than recomputed: the renderer already decided how the figure
// fits, through a two-pass auto-fit that consumes the placed labels and the
// givens box, and a second implementation of that decision here would be one
// more thing to keep in step for no gain.
export function parseViewBox(svg: string): ViewBox | null {
  const match = /viewBox="([^"]*)"/.exec(svg)
  if (!match) return null
  const parts = match[1].trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [x, y, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

// ---------------------------------------------------------------------------
// Pan
// ---------------------------------------------------------------------------

// Translate the window. Size is untouched: panning is not a zoom, and a pan
// that changed the scale by a rounding error would drift the figure's size
// over a long drag.
export function panView(view: ViewBox, dx: number, dy: number): ViewBox {
  return { x: view.x + dx, y: view.y + dy, width: view.width, height: view.height }
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

// Magnify by `factor` about `point`, in view coordinates, **holding that
// point still**.
//
// The point is held by rescaling its offset from the window's origin by the
// same ratio the window itself is rescaled by. The subtlety, and the usual
// bug, is that the ratio must be the one actually applied *after* clamping —
// computing the translation from the requested factor makes the figure lurch
// away from the cursor as soon as a zoom limit is reached, which is precisely
// when a reader is pushing hardest at it.
export function zoomAbout(view: ViewBox, point: { x: number; y: number }, factor: number, fitted: ViewBox): ViewBox {
  const narrowest = fitted.width / MAX_ZOOM
  const widest = fitted.width / MIN_ZOOM
  const wanted = view.width / factor
  const width = Math.min(widest, Math.max(narrowest, wanted))
  const ratio = width / view.width
  return {
    x: point.x - (point.x - view.x) * ratio,
    y: point.y - (point.y - view.y) * ratio,
    // Scaled by the same ratio rather than fitted independently: 1:1 aspect
    // is the one thing a figure cannot be allowed to get wrong.
    width,
    height: view.height * ratio,
  }
}

// How much one wheel notch magnifies by.
//
// Exponential in the wheel delta, so that scrolling by some amount and then
// back by the same amount lands exactly where it started — with a linear rule
// it would not, and a reader who over-shoots and corrects would find the
// figure slowly shrinking.
const WHEEL_SENSITIVITY = 0.0015

export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_SENSITIVITY)
}

// ---------------------------------------------------------------------------
// Screen to view
// ---------------------------------------------------------------------------

export interface ElementRect {
  left: number
  top: number
  width: number
  height: number
}

// Pixels per view unit, under `preserveAspectRatio="xMidYMid meet"`: the
// smaller of the two fits, because "meet" fits the whole box inside the
// element rather than filling it.
export function pixelsPerViewUnit(element: ElementRect, view: ViewBox): number {
  if (element.width <= 0 || element.height <= 0) return 1
  return Math.min(element.width / view.width, element.height / view.height)
}

// Where a screen point lands in the figure.
//
// The letterbox is the part that has to be right: "meet" centres the drawing
// inside the element and leaves bars along whichever axis has room spare, so
// mapping a pixel by the element's own width would be off by half a bar and
// the figure would slide away from the cursor as it zoomed. A click on a bar
// maps outside the drawing, which is the honest answer — clamping it would
// silently pretend the reader had clicked the edge.
export function clientToView(client: { x: number; y: number }, element: ElementRect, view: ViewBox): { x: number; y: number } {
  const scale = pixelsPerViewUnit(element, view)
  const drawnWidth = view.width * scale
  const drawnHeight = view.height * scale
  const offsetX = (element.width - drawnWidth) / 2
  const offsetY = (element.height - drawnHeight) / 2
  return {
    x: view.x + (client.x - element.left - offsetX) / scale,
    y: view.y + (client.y - element.top - offsetY) / scale,
  }
}

// ---------------------------------------------------------------------------
// Keeping labels the size they were
// ---------------------------------------------------------------------------

// What a label's size, written in view units, must be multiplied by to keep
// the same size on screen as the view zooms.
//
// A figure's text is written in the same units as its geometry, so it
// magnifies with the drawing by default — and a figure zoomed in four times
// would carry text four times too big, covering the very detail the reader
// zoomed in to see. Multiplying by the view's own share of the fitted width
// cancels the magnification exactly. This is the convention the plot renderer
// already uses for tick labels and markers.
export function viewScale(fitted: ViewBox, view: ViewBox): number {
  return view.width / fitted.width
}
