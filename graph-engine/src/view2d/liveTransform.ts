import { COMMIT_DRIFT, COMMIT_THROTTLE_MS, SETTLE_MS } from './feel'
import type { Rect, Size } from './types'

// The cheap live view of a heavy drawing, as pure arithmetic.
//
// Redrawing an SVG (rewriting its viewBox) re-rasterises everything in it, and
// a figure with a chalk texture or paper noise is dear to rasterise. So while
// the view is moving the drawing is left as it was last *committed* and shown
// through the compositor instead: a translate and a scale on the element,
// relative to the committed view. When the motion stops (or has drifted too
// far; see commitDue) the viewBox is rewritten to the live window and the
// transform cleared. Nothing here touches the DOM or the clock.

// What to do to an element that shows `committed` so that it shows `live`,
// both being the window of content (the screen's own aspect) that the screen
// covers. The transform has its origin at the screen's top-left:
//   screen' = screen * scale + (tx, ty)
// An unmeasurable window answers the identity, never NaN.
export interface LiveTransform {
  tx: number
  ty: number
  scale: number
}

const IDENTITY: LiveTransform = { tx: 0, ty: 0, scale: 1 }

const finitePositive = (n: number): boolean => Number.isFinite(n) && n > 0

export function liveTransform(committed: Rect, live: Rect, screen: Size): LiveTransform {
  if (!finitePositive(committed.width) || !finitePositive(committed.height)) return IDENTITY
  if (!finitePositive(live.width) || !finitePositive(live.height)) return IDENTITY
  if (!finitePositive(screen.width) || !finitePositive(screen.height)) return IDENTITY
  // A content point at fraction u of the committed window is at u * screen.
  // In the live window it is at (u * committed.width + committed.x - live.x)
  // / live.width of the screen: the scale is the ratio of the widths and the
  // shift is the offset of the committed corner in the live window.
  const scale = committed.width / live.width
  const tx = ((committed.x - live.x) / live.width) * screen.width
  const ty = ((committed.y - live.y) / live.height) * screen.height
  const out = { tx, ty, scale }
  return Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(scale) ? out : IDENTITY
}

// Twelve significant digits: the translation can be tens of thousands of px at
// the highest zoom and must not creep.
const writeNumber = (n: number): string => String(Number(n.toPrecision(12)))

// The CSS `transform` value; empty for the identity, so the element then
// carries none.
export function liveTransformValue(t: LiveTransform): string {
  if (t.tx === 0 && t.ty === 0 && t.scale === 1) return ''
  return `translate(${writeNumber(t.tx)}px, ${writeNumber(t.ty)}px) scale(${writeNumber(t.scale)})`
}

// The rect grown by `fraction` of its own size on every side.
export function growRect(rect: Rect, fraction: number): Rect {
  const dx = rect.width * fraction
  const dy = rect.height * fraction
  return { x: rect.x - dx, y: rect.y - dy, width: rect.width + 2 * dx, height: rect.height + 2 * dy }
}

// Whether `outer` holds `inner`, to within rounding (the edges are computed
// from different cameras, and an ulp must not count as a blank strip).
export function coversRect(outer: Rect, inner: Rect): boolean {
  const eps = 1e-9 * Math.max(Math.abs(outer.width), Math.abs(outer.height), 1e-300)
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  )
}

// How far apart in scale two windows are, as a number of at least 1 whichever
// way round: ×2 for a window half as wide or twice as wide.
export function scaleDrift(a: Rect, b: Rect): number {
  if (!finitePositive(a.width) || !finitePositive(b.width)) return Infinity
  const r = a.width / b.width
  return r >= 1 ? r : 1 / r
}

export interface CommitInput {
  // The visible window of the last commit; null: nothing committed yet.
  committed: Rect | null
  // The visible window now.
  live: Rect
  // The fraction the committed drawing extends beyond the screen on each side.
  overscan: number
  // The motion is still moving (a smoothed zoom, an ease, a coast).
  moving: boolean
  // Milliseconds since the live window last changed, and since the last commit.
  idleMs: number
  sinceCommitMs: number
  reduced: boolean
  // The screen was resized since the last commit: its aspect no longer matches.
  screenChanged: boolean
}

// Whether to rewrite the drawing's viewBox now.
//   - the first view, a changed screen, or reduced motion (moves are instant):
//     at once;
//   - the view has come to rest: once it has been still for SETTLE_MS;
//   - mid-gesture: when the live scale has drifted beyond COMMIT_DRIFT, or the
//     screen is no longer covered by the overscanned drawing, but never more
//     often than COMMIT_THROTTLE_MS.
// Nothing to commit when the live window is the committed one.
export function commitDue(i: CommitInput): boolean {
  if (i.committed === null) return true
  const same =
    i.live.x === i.committed.x &&
    i.live.y === i.committed.y &&
    i.live.width === i.committed.width &&
    i.live.height === i.committed.height
  if (same) return false
  if (i.reduced || i.screenChanged) return true
  if (!i.moving && i.idleMs >= SETTLE_MS) return true
  if (i.sinceCommitMs < COMMIT_THROTTLE_MS) return false
  return scaleDrift(i.committed, i.live) > COMMIT_DRIFT || !coversRect(growRect(i.committed, i.overscan), i.live)
}
