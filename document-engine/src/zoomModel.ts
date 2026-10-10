// Pure zoom maths for the document viewer (no DOM).
//
// A numeric zoom is a SCALE where 1 equals pdfjs viewport scale 1: one PDF
// point is one CSS pixel (so a US Letter page is 612 x 792 CSS px at "100%").
// Fit modes are resolved to a numeric scale from the container and page size.

export type ZoomMode = 'fit-width' | 'fit-page' | 'fit-height' | number

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 5

// Percentages the +/- buttons snap to (roughly 1.25x apart).
export const ZOOM_STOPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]

export interface Size {
  w: number
  h: number
}

export function clampZoom(scale: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  if (!Number.isFinite(scale)) return Math.min(max, Math.max(min, 1))
  return Math.min(max, Math.max(min, scale))
}

export function isFitMode(mode: ZoomMode): mode is 'fit-width' | 'fit-page' | 'fit-height' {
  return typeof mode === 'string'
}

// `padding` is the space kept free on every side of the page (CSS px).
// A degenerate container or page falls back to 1 rather than NaN/Infinity.
export function fitScale(mode: ZoomMode, container: Size, page: Size, padding = 0, min = ZOOM_MIN, max = ZOOM_MAX): number {
  if (!isFitMode(mode)) return clampZoom(mode, min, max)
  const availW = container.w - 2 * padding
  const availH = container.h - 2 * padding
  if (!(page.w > 0) || !(page.h > 0) || !(availW > 0) || !(availH > 0)) return clampZoom(1, min, max)
  const byW = availW / page.w
  const byH = availH / page.h
  const raw = mode === 'fit-width' ? byW : mode === 'fit-height' ? byH : Math.min(byW, byH)
  return clampZoom(raw, min, max)
}

// Next stop above (in) or below (out) the current scale, clamped to the range.
export function stepZoom(current: number, direction: 'in' | 'out', min = ZOOM_MIN, max = ZOOM_MAX): number {
  const eps = 0.004
  const cur = clampZoom(current, min, max)
  const stops = ZOOM_STOPS.filter((s) => s >= min - 1e-9 && s <= max + 1e-9)
  if (direction === 'in') {
    const next = stops.find((s) => s > cur + eps)
    return clampZoom(next ?? max, min, max)
  }
  let prev: number | undefined
  for (const s of stops) if (s < cur - eps) prev = s
  return clampZoom(prev ?? min, min, max)
}

// Scroll offsets that keep the content point under `cursor` (relative to the
// scroll container's visible box) fixed when the scale changes.
export function zoomAround(
  scale: number,
  newScale: number,
  cursor: { x: number; y: number },
  scroll: { left: number; top: number }
): { left: number; top: number } {
  if (!(scale > 0) || !(newScale > 0)) return { left: scroll.left, top: scroll.top }
  const k = newScale / scale
  return {
    left: Math.max(0, (scroll.left + cursor.x) * k - cursor.x),
    top: Math.max(0, (scroll.top + cursor.y) * k - cursor.y),
  }
}

// Ctrl+wheel / pinch: a smooth multiplicative factor from the wheel delta.
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.01)
}

// The page size a fit mode measures against. Fit-width uses the widest page so
// no page overflows sideways; page/height use the first page, which is what
// the reader lands on. Empty list: unknown (fitScale then falls back to 1).
export function fitReference(mode: ZoomMode, pages: readonly Size[]): Size {
  const first = pages[0]
  if (!first) return { w: 0, h: 0 }
  if (mode === 'fit-width') return { w: pages.reduce((m, p) => Math.max(m, p.w), 0), h: first.h }
  return first
}
