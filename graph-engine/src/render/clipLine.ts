import type { Bounds } from './marchingSquares'
import type { Vec2 } from '../scene/types'

// Clipping a construction line to the visible rectangle.
//
// This lives in the renderer, not in the scene builder, on purpose. A
// constructed line ("the line through P parallel to A-B", a perpendicular
// bisector, an angle bisector) is a locus: it is true everywhere along
// itself, and how much of it should be drawn is a fact about the current
// view, not about the figure. Keeping the scene object unclipped and doing
// this at draw time means panning and zooming reveal more of the same line
// rather than sliding a stale, fixed-length stick around the screen.
//
// Liang-Barsky: walk the parameter t along `through + t * direction` and
// narrow [tMin, tMax] against each of the four walls in turn. A ray simply
// starts that interval at 0 instead of -Infinity, which is the entire
// difference between the two extents.

export function clipLineToBounds(
  through: Vec2,
  direction: Vec2,
  extent: 'infinite' | 'ray',
  bounds: Bounds
): [Vec2, Vec2] | null {
  if (direction.x === 0 && direction.y === 0) return null

  let tMin = extent === 'ray' ? 0 : Number.NEGATIVE_INFINITY
  let tMax = Number.POSITIVE_INFINITY

  // Each wall as (p, q): the line is inside that wall while p*t <= q.
  const walls: [number, number][] = [
    [-direction.x, through.x - bounds.xMin],
    [direction.x, bounds.xMax - through.x],
    [-direction.y, through.y - bounds.yMin],
    [direction.y, bounds.yMax - through.y],
  ]

  for (const [p, q] of walls) {
    if (p === 0) {
      // Parallel to this wall: either always inside it or never.
      if (q < 0) return null
      continue
    }
    const t = q / p
    if (p < 0) tMin = Math.max(tMin, t)
    else tMax = Math.min(tMax, t)
    if (tMin > tMax) return null
  }

  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return null

  return [
    { x: through.x + tMin * direction.x, y: through.y + tMin * direction.y },
    { x: through.x + tMax * direction.x, y: through.y + tMax * direction.y },
  ]
}
