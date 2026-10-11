// Camera matrices and screen mapping (plan G2). Pure.
//
// - Orthographic (the default): half-height H = R / zoom, where R is the
//   radius of the box's bounding sphere in world (|h|) times 1.35, a margin
//   for tick labels.
// - Perspective: vertical field of view 30 degrees, at the distance that fits
//   the same sphere, divided by zoom.
// - A portrait viewport fits the sphere across its width instead, so the box
//   never overflows the narrow side.
// - Near and far bracket the box sphere with a margin; there is never a fixed
//   0.1 .. 1000.
//
// `project` and `rayAt` take and return WORLD coordinates (see world.ts);
// callers holding author coordinates go through WorldMap.toWorld first.

import type { Projection, SpaceView } from '../config'
import type { Vec3 } from '../scene/types'
import { invert, lookFrom, multiply, ortho, perspective, transformPoint, transformVec4, type Mat4 } from './mat4'
import { DEG, eyeDirection, screenBasis, type ScreenBasis } from './turntable'
import type { WorldMap } from './world'

export interface Viewport {
  // CSS pixels.
  width: number
  height: number
}

export const FRAME_MARGIN = 1.35
export const PERSPECTIVE_FOV_Y = 30 * DEG

export interface CameraMatrices {
  view: Mat4
  proj: Mat4
  viewProj: Mat4
  invViewProj: Mat4
  viewport: Viewport
  projection: Projection
  basis: ScreenBasis
  // From the target toward the eye (world).
  direction: Vec3
  // The eye, in world. For orthographic it only fixes where depth is measured from.
  eye: Vec3
  // World units per CSS pixel on the plane through the target facing the camera.
  worldPerPixel: number
}

export interface ScreenPoint {
  // CSS pixels from the viewport's top-left.
  x: number
  y: number
  // NDC depth in [-1, 1] when between the near and far planes; +Infinity
  // when the point is behind a perspective eye.
  depth: number
}

export function cameraMatrices(view: SpaceView, world: WorldMap, viewport: Viewport, projection: Projection): CameraMatrices {
  const width = Math.max(1, viewport.width)
  const height = Math.max(1, viewport.height)
  const aspect = width / height
  const h = world.halfExtents
  const boxRadius = Math.hypot(h[0], h[1], h[2])
  const R = boxRadius * FRAME_MARGIN
  const basis = screenBasis(view)
  const d = eyeDirection(view)
  const back: Vec3 = d
  const t = world.toWorld(view.target)
  const tLen = Math.hypot(t[0], t[1], t[2])
  const zoom = view.zoom

  let proj: Mat4
  let eye: Vec3
  let worldPerPixel: number
  if (projection === 'perspective') {
    // Fit the sphere in the narrower field of view.
    const halfFov = PERSPECTIVE_FOV_Y / 2
    const fitHalf = aspect >= 1 ? halfFov : Math.atan(Math.tan(halfFov) * aspect)
    const distance = R / Math.sin(fitHalf) / zoom
    eye = [t[0] + d[0] * distance, t[1] + d[1] * distance, t[2] + d[2] * distance]
    // Depth of the world origin (the box centre) along the view direction.
    const centreDepth = -(back[0] * -eye[0] + back[1] * -eye[1] + back[2] * -eye[2])
    const far = centreDepth + 2 * R
    const near = Math.max(centreDepth - 2 * R, 0.01 * R)
    proj = perspective(PERSPECTIVE_FOV_Y, aspect, near, far)
    worldPerPixel = (2 * distance * Math.tan(halfFov)) / height
  } else {
    const halfHeight = aspect >= 1 ? R / zoom : R / (zoom * aspect)
    const halfWidth = halfHeight * aspect
    // Stand far enough back that the whole bracket is in front of the eye.
    const standoff = 4 * boxRadius + tLen
    eye = [t[0] + d[0] * standoff, t[1] + d[1] * standoff, t[2] + d[2] * standoff]
    const centreDepth = -(back[0] * -eye[0] + back[1] * -eye[1] + back[2] * -eye[2])
    proj = ortho(-halfWidth, halfWidth, -halfHeight, halfHeight, centreDepth - 2 * R, centreDepth + 2 * R)
    worldPerPixel = (2 * halfHeight) / height
  }

  const viewMatrix = lookFrom(eye, basis.right, basis.up, back)
  const viewProj = multiply(proj, viewMatrix)
  const invViewProj = invert(viewProj) ?? new Float64Array(16)
  return {
    view: viewMatrix,
    proj,
    viewProj,
    invViewProj,
    viewport: { width, height },
    projection,
    basis,
    direction: d,
    eye,
    worldPerPixel,
  }
}

// A world point to CSS pixels.
export function project(m: CameraMatrices, p: Vec3): ScreenPoint {
  const [x, y, z, w] = transformPoint(m.viewProj, p)
  if (w <= 0) return { x: Number.NaN, y: Number.NaN, depth: Number.POSITIVE_INFINITY }
  const { width, height } = m.viewport
  return {
    x: ((x / w + 1) / 2) * width,
    y: ((1 - y / w) / 2) * height,
    depth: z / w,
  }
}

// The world-space ray through a CSS pixel: its origin on the near plane and
// its unit direction away from the eye.
export function rayAt(m: CameraMatrices, px: number, py: number): { origin: Vec3; direction: Vec3 } {
  const { width, height } = m.viewport
  const nx = (px / width) * 2 - 1
  const ny = 1 - (py / height) * 2
  const a = transformVec4(m.invViewProj, nx, ny, -1, 1)
  const b = transformVec4(m.invViewProj, nx, ny, 1, 1)
  const near: Vec3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]
  const far: Vec3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]]
  const dx = far[0] - near[0]
  const dy = far[1] - near[1]
  const dz = far[2] - near[2]
  const len = Math.hypot(dx, dy, dz)
  return { origin: near, direction: [dx / len, dy / len, dz / len] }
}
