import { fmt } from './svg'

// What is specific to a figure about being navigated.
//
// Moving, zooming, limits and the pointer are the view2d model's business
// (see ../view2d), and are the same for every 2D view. A figure's own part is
// small: reading the fitted view back out of its markup, and keeping its text
// the size it was drawn at as the view magnifies.
//
// Navigation is a viewBox transform. Nothing re-lays-out, nothing resamples
// and nothing is redrawn; the same markup is shown through a different window,
// so the figure stays crisp at any magnification.
//
// The arithmetic stays in plain functions, and out of FigureView, because the
// component cannot be render-tested in this package (vitest runs node-only,
// and the suite is `*.test.ts`). A decision that cannot be reached by a test
// is a decision that ships wrong.

export interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

export function viewBoxAttribute(view: ViewBox): string {
  return `${fmt(view.x)} ${fmt(view.y)} ${fmt(view.width)} ${fmt(view.height)}`
}

// The fitted view, read back out of the markup the renderer produced.
//
// Read rather than recomputed: the renderer already decided how the figure
// fits, through a two-pass auto-fit that consumes the placed labels and the
// givens box, and a second implementation of that decision here would be one
// more thing to keep in step for no gain. It is the content frame view2d
// moves around in.
export function parseViewBox(svg: string): ViewBox | null {
  const match = /viewBox="([^"]*)"/.exec(svg)
  if (!match) return null
  const parts = match[1].trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [x, y, width, height] = parts
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

// What a label's size, written in view units, becomes at `zoom` so that it
// keeps the same size on screen.
//
// A figure's text is written in the same units as its geometry, so it
// magnifies with the drawing by default — and a figure zoomed in four times
// would carry text four times too big, covering the very detail the reader
// zoomed in to see. Dividing by the zoom cancels the magnification exactly.
// This is the convention the plot renderer already uses for tick labels and
// markers. A degenerate zoom leaves the size as written.
export function compensatedSize(written: number, zoom: number): number {
  return Number.isFinite(zoom) && zoom > 0 ? written / zoom : written
}
