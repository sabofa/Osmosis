// The turntable (plan G2): z is always up, and the camera sits on a sphere
// about the target at an azimuth (measured from +x toward +y) and an
// elevation above the xy-plane, both in degrees. Pure.

import type { CameraSpec } from '../config'
import type { Vec3 } from '../scene/types'

export const DEG = Math.PI / 180

export interface ScreenBasis {
  // World directions of screen right and screen up, and the view direction.
  right: Vec3
  up: Vec3
  forward: Vec3
}

// The unit direction from the target toward the eye, in world axes:
// d = (cos el cos az, cos el sin az, sin el).
export function eyeDirection(view: CameraSpec): Vec3 {
  const az = view.azimuth * DEG
  const el = view.elevation * DEG
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
}

// Screen right is normalise(-d_y, d_x, 0), which for cos(el) > 0 is exactly
// (-sin az, cos az, 0); it is computed in that closed form so it stays defined
// even at the poles. Screen up is right x forward, where forward = -d.
export function screenBasis(view: CameraSpec): ScreenBasis {
  const az = view.azimuth * DEG
  const d = eyeDirection(view)
  const right: Vec3 = [-Math.sin(az), Math.cos(az), 0]
  const forward: Vec3 = [-d[0], -d[1], -d[2]]
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  return { right, up, forward }
}
