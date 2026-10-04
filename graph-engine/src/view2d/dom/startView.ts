import { ARRIVE_LOG_ZOOM, ARRIVE_PX } from '../feel'
import { focusCamera, type AuthorMapping, type FocusSpec } from '../focus'
import type { Camera, Rect } from '../types'

// Where a view starts, and what reset means — as pure decisions.
//
// These live outside the hook for the usual reason: the hook is DOM plumbing
// and cannot be reached by a node test, and "what does reset do the second
// time" is exactly the kind of decision that ships wrong when it is only
// reachable by clicking.

// Whether two cameras are the same view to within what a reader could see.
// The tolerances are the motion's own arrival tolerances (a smoothed move
// snaps to its target below them), so a view that has arrived at the start
// counts as at the start. The pan tolerance is in screen pixels, which is why
// it needs the current pixels-per-unit; a degenerate scale (an unmeasured
// view) falls back to comparing content units directly.
export function sameView(a: Camera, b: Camera, pxPerUnit: number): boolean {
  const scale = Number.isFinite(pxPerUnit) && pxPerUnit > 0 ? pxPerUnit : 1
  const panPx = Math.hypot(a.cx - b.cx, a.cy - b.cy) * scale
  const logZoom = Math.abs(Math.log(a.zoom) - Math.log(b.zoom))
  return panPx < ARRIVE_PX && logZoom < ARRIVE_LOG_ZOOM
}

// What reset animates to: the start view, or the fitted view when the view is
// already at the start — so two resets in a row always end on everything.
// `start` should be the start view as the motion would clamp it, or a start
// past a limit could never be recognised as reached.
export function resetTarget(current: Camera, start: Camera, fitted: Camera, pxPerUnit = 1): Camera {
  return sameView(current, start, pxPerUnit) ? fitted : start
}

// The start view of a figure: the spec's `@focus` mapped into content, or the
// fitted view when there is none or the engine cannot place it.
export function startCamera(spec: FocusSpec | null | undefined, mapping: AuthorMapping, fitted: Camera): Camera {
  if (!spec) return fitted
  return focusCamera(spec, mapping) ?? fitted
}

// Identifies "this figure" by value: a rebuild that produces the same frame
// and start view is the same drawing, and must not throw the reader's view
// away. Null when there is nothing to handle.
export function viewKey(frame: Rect | null, start: Camera | null): string | null {
  if (!frame || !start) return null
  return [frame.x, frame.y, frame.width, frame.height, start.cx, start.cy, start.zoom].join(',')
}
