// Input mapping as pure reducers over SpaceView (plan G2). The DOM side
// (ui/input.ts) turns pointer, wheel and key events into these calls.
//
// Grab semantics: the content turns and slides with the cursor, as if held.
// Dragging right decreases azimuth, dragging down increases elevation, and a
// pan moves the target so the point under the cursor follows it.

import type { Projection, SpaceView } from '../config'
import type { Vec3 } from '../scene/types'
import { cameraMatrices, type Viewport } from './projection'
import type { WorldMap } from './world'

export const ORBIT_DEG_PER_PX = 0.4
export const ELEVATION_LIMIT = 89.5
export const WHEEL_STEP = 1.1
export const ZOOM_MIN = 0.05
export const ZOOM_MAX = 50
export const INERTIA_TAU_MS = 120
// Inertia stops once it would turn less than this per 60 Hz frame.
export const INERTIA_STOP_DEG_PER_FRAME = 0.02
const FRAME_MS = 1000 / 60

// Into (-180, 180].
export function wrapAzimuth(degrees: number): number {
  let r = degrees % 360
  if (r <= -180) r += 360
  else if (r > 180) r -= 360
  // Normalise -0.
  return r === 0 ? 0 : r
}

export function clampElevation(degrees: number): number {
  return Math.min(ELEVATION_LIMIT, Math.max(-ELEVATION_LIMIT, degrees))
}

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

// Any view made safe to render: finite, elevation clamped, azimuth wrapped,
// zoom in range. setView runs every incoming view through this.
export function sanitizeView(view: SpaceView, fallback: SpaceView): SpaceView {
  const finite = (v: number, f: number) => (Number.isFinite(v) ? v : f)
  const target = view.target.every(Number.isFinite) ? view.target : fallback.target
  return {
    azimuth: wrapAzimuth(finite(view.azimuth, fallback.azimuth)),
    elevation: clampElevation(finite(view.elevation, fallback.elevation)),
    zoom: clampZoom(finite(view.zoom, fallback.zoom)),
    target: [target[0], target[1], target[2]],
  }
}

export function orbit(view: SpaceView, dx: number, dy: number): SpaceView {
  return {
    ...view,
    azimuth: wrapAzimuth(view.azimuth - dx * ORBIT_DEG_PER_PX),
    elevation: clampElevation(view.elevation + dy * ORBIT_DEG_PER_PX),
    target: [...view.target],
  }
}

// World displacement -> author displacement: divide by k per axis.
function moveTarget(view: SpaceView, world: WorldMap, delta: Vec3): SpaceView['target'] {
  const [kx, ky, kz] = world.scale
  return [view.target[0] + delta[0] / kx, view.target[1] + delta[1] / ky, view.target[2] + delta[2] / kz]
}

// Move the target so the content follows a cursor that moved (dx, dy) CSS px.
export function pan(view: SpaceView, dx: number, dy: number, viewport: Viewport, world: WorldMap, projection: Projection): SpaceView {
  const m = cameraMatrices(view, world, viewport, projection)
  const s = m.worldPerPixel
  const { right, up } = m.basis
  // The content moves with the cursor, so the target moves against it.
  const delta: Vec3 = [
    -right[0] * dx * s + up[0] * dy * s,
    -right[1] * dx * s + up[1] * dy * s,
    -right[2] * dx * s + up[2] * dy * s,
  ]
  return { ...view, target: moveTarget(view, world, delta) }
}

// Zoom by `factor` (> 1 zooms in) about the CSS pixel (px, py).
//
// The point p on the plane through the target facing the camera, under the
// cursor, stays under the cursor: the new target is p + (t - p) * z / z'.
// World-per-pixel on that plane scales by z / z' in both projections, so p's
// pixel offset from the centre is unchanged. In orthographic every point on
// the cursor's ray is therefore fixed; in perspective the eye dollies toward
// p.
export function zoomAt(
  view: SpaceView,
  factor: number,
  px: number,
  py: number,
  viewport: Viewport,
  world: WorldMap,
  projection: Projection,
): SpaceView {
  const zoom = clampZoom(view.zoom * factor)
  if (zoom === view.zoom) return view
  const m = cameraMatrices(view, world, viewport, projection)
  const s = m.worldPerPixel
  const { right, up } = m.basis
  const ox = (px - m.viewport.width / 2) * s
  const oy = (py - m.viewport.height / 2) * s
  // p - t on the target plane.
  const offset: Vec3 = [right[0] * ox - up[0] * oy, right[1] * ox - up[1] * oy, right[2] * ox - up[2] * oy]
  const keep = 1 - view.zoom / zoom
  const delta: Vec3 = [offset[0] * keep, offset[1] * keep, offset[2] * keep]
  return { ...view, zoom, target: moveTarget(view, world, delta) }
}

export function reset(authored: SpaceView): SpaceView {
  return { ...authored, target: [...authored.target] }
}

// S6 plan V9: double-click and 0 animate back to the authored view over 280
// ms, ease-out cubic, azimuth the shortest way round; none of this under
// prefers-reduced-motion (the caller checks that and calls reset() plainly
// instead of starting an Easing).
export const EASE_MS = 280

// 1 - (1 - t)^3.
export function easeOutCubic(t: number): number {
  const u = 1 - t
  return 1 - u * u * u
}

export interface Easing {
  from: SpaceView
  to: SpaceView
  // The shortest signed azimuth turn from `from` to `to`, in (-180, 180]:
  // wrapAzimuth applied to a difference gives the shortest delta the same
  // way it gives the shortest absolute angle.
  azimuthDelta: number
  startMs: number
}

export function startEase(from: SpaceView, to: SpaceView, startMs: number): Easing {
  return { from, to, azimuthDelta: wrapAzimuth(to.azimuth - from.azimuth), startMs }
}

// The eased view at `nowMs`, or null once it is done (t >= 1) — the caller
// then applies `easing.to` exactly and drops the Easing.
export function easeStep(easing: Easing, nowMs: number): SpaceView | null {
  const t = (nowMs - easing.startMs) / EASE_MS
  if (t >= 1) return null
  const e = easeOutCubic(Math.max(0, t))
  const { from, to } = easing
  return {
    azimuth: wrapAzimuth(from.azimuth + easing.azimuthDelta * e),
    elevation: from.elevation + (to.elevation - from.elevation) * e,
    zoom: from.zoom + (to.zoom - from.zoom) * e,
    target: [0, 1, 2].map((i) => from.target[i] + (to.target[i] - from.target[i]) * e) as SpaceView['target'],
  }
}

// Degrees per millisecond, as measured from the last moves of an orbit drag.
export interface OrbitVelocity {
  azimuth: number
  elevation: number
}

// One step of inertia after releasing an orbit drag: exponential decay with
// tau = 120 ms, or null once it would turn less than 0.02 degrees per frame.
export function inertiaStep(velocity: OrbitVelocity, dtMs: number): OrbitVelocity | null {
  const decay = Math.exp(-dtMs / INERTIA_TAU_MS)
  const next = { azimuth: velocity.azimuth * decay, elevation: velocity.elevation * decay }
  const perFrame = Math.hypot(next.azimuth, next.elevation) * FRAME_MS
  return perFrame < INERTIA_STOP_DEG_PER_FRAME ? null : next
}
