// Dragging a point defined by parameters (plan E11, spec SP6 "Drag"). Pure.
//
// The cursor is a target on screen; the point is position(p) for its one or
// two bindings p. solveDrag finds the p that puts the point under the cursor
// by damped Gauss-Newton (Levenberg-Marquardt) on the screen residual
//   r(p) = project(position(p)) - cursor   (CSS px),
// with the Jacobian chained through the projection:
//   J = d(screen)/d(author) (2 x 3) . d(position)/dp (3 x k, from diff).
// It starts from the current values, runs at most 8 iterations, and clamps
// every step to the bindings' ranges. With one parameter the point runs along
// a curve; with two, across a surface.

import { solve2 } from '../../math/linalg'
import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { PointDrag, Range, Vec3 } from '../scene/types'

export const DRAG_MAX_ITERATIONS = 8
const LAMBDA_START = 1e-6
const LAMBDA_UP = 10
const LAMBDA_DOWN = 10
// A floor on the damping, relative to the largest diagonal of J^T J, so a
// parameter the point does not depend on here (a zero column of J: r at
// r = 0 for (r cos t, r sin t, 0)) leaves the system solvable and simply does
// not move, instead of freezing the other.
const DAMPING_FLOOR = 1e-9

export interface ScreenJacobian {
  x: number
  y: number
  // d(screen x, y)/d(author x, y, z), row-major 2 x 3.
  d: Float64Array
}

// A point's screen position (CSS px) and its derivative with respect to the
// author coordinates, through the world map and the camera's view-projection.
export function screenJacobian(camera: CameraMatrices, world: WorldMap, p: Vec3): ScreenJacobian {
  const m = camera.viewProj
  const w = world.toWorld(p)
  const k = world.scale
  const clip = [0, 1, 2, 3].map((i) => m[i] * w[0] + m[4 + i] * w[1] + m[8 + i] * w[2] + m[12 + i])
  const [cx, cy, , cw] = clip
  const { width, height } = camera.viewport
  const d = new Float64Array(6)
  for (let j = 0; j < 3; j++) {
    const dx = (m[4 * j] * cw - cx * m[4 * j + 3]) / (cw * cw)
    const dy = (m[4 * j + 1] * cw - cy * m[4 * j + 3]) / (cw * cw)
    d[j] = (width / 2) * dx * k[j]
    d[3 + j] = (-height / 2) * dy * k[j]
  }
  return { x: ((cx / cw + 1) / 2) * width, y: ((1 - cy / cw) / 2) * height, d }
}

export interface DragSolution {
  values: Float64Array
  iterations: number
  // CSS px from the cursor at the solution.
  residual: number
}

function clampTo(values: Float64Array, ranges: readonly Range[]): Float64Array {
  return values.map((v, i) => Math.min(ranges[i].max, Math.max(ranges[i].min, v)))
}

export function solveDrag(
  drag: PointDrag,
  start: ArrayLike<number>,
  cursor: { x: number; y: number },
  camera: CameraMatrices,
  world: WorldMap,
  ranges: readonly Range[],
): DragSolution {
  const k = drag.params.length
  const residual = (values: Float64Array) => {
    const s = screenJacobian(camera, world, drag.position(values))
    return { r: [s.x - cursor.x, s.y - cursor.y], s }
  }
  let values = clampTo(Float64Array.from(start), ranges)
  let current = residual(values)
  let cost = current.r[0] ** 2 + current.r[1] ** 2
  let lambda = LAMBDA_START
  let iterations = 0
  while (iterations < DRAG_MAX_ITERATIONS && Number.isFinite(cost) && cost > 0) {
    iterations++
    // J (2 x k) = D (2 x 3) . P (3 x k).
    const P = drag.jacobian(values)
    const D = current.s.d
    const J = new Float64Array(2 * k)
    for (let row = 0; row < 2; row++) for (let c = 0; c < k; c++) J[row * k + c] = D[3 * row] * P[c] + D[3 * row + 1] * P[k + c] + D[3 * row + 2] * P[2 * k + c]
    // (J^T J + lambda diag(J^T J)) step = -J^T r.
    const A = (a: number, b: number) => J[a] * J[b] + J[k + a] * J[k + b]
    const g = (a: number) => J[a] * current.r[0] + J[k + a] * current.r[1]
    let step: number[] | null
    const floor = DAMPING_FLOOR * Math.max(A(0, 0), k === 2 ? A(1, 1) : 0)
    if (k === 1) {
      const a = A(0, 0) * (1 + lambda) + floor
      step = a > 0 ? [-g(0) / a] : null
    } else {
      step = solve2(
        [
          [A(0, 0) * (1 + lambda) + floor, A(0, 1)],
          [A(1, 0), A(1, 1) * (1 + lambda) + floor],
        ],
        [-g(0), -g(1)],
      )
    }
    if (!step || !step.every(Number.isFinite)) break
    const next = clampTo(
      values.map((v, i) => v + step[i]),
      ranges,
    )
    const trial = residual(next)
    const trialCost = trial.r[0] ** 2 + trial.r[1] ** 2
    if (trialCost < cost) {
      const moved = next.some((v, i) => v !== values[i])
      values = next
      current = trial
      cost = trialCost
      lambda /= LAMBDA_DOWN
      if (!moved) break
    } else {
      lambda *= LAMBDA_UP
    }
  }
  return { values, iterations, residual: Math.sqrt(cost) }
}
