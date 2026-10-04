import { basePxPerUnit } from './camera'
import { PAN_MARGIN, ZOOM_MAX, ZOOM_MIN } from './feel'
import type { Camera, Rect, Size } from './types'

// Limits — how far a view may go, as a policy object.
//
// A policy rather than constants, because the engines differ (a table wants to
// stay near its box; a flowchart may want to wander) and each should override
// only what it must. The defaults are the numbers in feel.ts.
//
// The pan rule is what stops a reader from losing the content: some of it
// always stays on screen. It is "a fraction of the frame, or half the screen
// when zoomed in past that" because at high zoom the frame is far larger than
// the screen, and "keep 15% of the frame visible" would then demand more than
// the screen can show — which would pin the view with no room to move. Half the
// screen is the most that can always be honoured.
//
// This only says where a camera is allowed to be. The easing to a bound, and
// the stopping of a coast against one, live in motion.ts.

export interface LimitsPolicy {
  zoomMin: number
  zoomMax: number
  // The least of the frame kept in view, per axis, as a fraction of the frame.
  panMargin: number
}

export const DEFAULT_LIMITS: LimitsPolicy = { zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX, panMargin: PAN_MARGIN }

// The nearest camera that obeys the policy: zoom first (keeping the centre),
// then the centre against the bounds that zoom implies. A camera already
// inside the bounds is returned as it is.
export function clampCamera(camera: Camera, frame: Rect, screen: Size, limits: LimitsPolicy): Camera {
  const zoom = Math.min(limits.zoomMax, Math.max(limits.zoomMin, camera.zoom))
  // An unmeasured screen has no bounds to speak of; only the zoom is held.
  if (screen.width <= 0 || screen.height <= 0) return { cx: camera.cx, cy: camera.cy, zoom }
  const ppu = basePxPerUnit(frame, screen) * zoom
  return {
    cx: clampAxis(camera.cx, frame.x, frame.width, screen.width / ppu / 2, limits.panMargin),
    cy: clampAxis(camera.cy, frame.y, frame.height, screen.height / ppu / 2, limits.panMargin),
    zoom,
  }
}

// `half` is half the visible extent in this axis. The visible window is
// [c − half, c + half]; keeping `keep` of the frame inside it means the
// window's far edge can go no further than `keep` past the frame's near edge.
function clampAxis(c: number, min: number, size: number, half: number, margin: number): number {
  const keep = Math.min(margin * size, half)
  return Math.min(min + size + half - keep, Math.max(min - half + keep, c))
}
