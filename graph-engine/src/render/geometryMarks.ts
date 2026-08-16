import type { Vec2 } from '../scene/types'

// Pure geometry for the three geometry-annotation marks (angle arc, right-
// angle square, congruence ticks) — kept separate from SceneRenderer.ts so
// the actual math is unit-testable without a canvas/WebGL context, same
// reasoning as camera2d.ts/hover.ts/grid.ts. Every function here works in
// plain world-unit coordinates; the caller is responsible for converting a
// target on-screen pixel size (radius/length/gap) to world units first (see
// SceneRenderer.ts's pixelToWorld) — these stay agnostic to zoom entirely.

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}

// The angle swept from the direction toward `from` to the direction toward
// `to`, both measured from `vertex` — normalized to (-pi, pi] so it always
// describes the *shorter* way around, i.e. the interior angle of whatever
// shape vertex/from/to came from (a triangle's own interior angle is always
// < 180 degrees, so this is the correct sweep for every ordinary geometry
// figure, not just a coincidentally-convenient one).
function angleSweep(vertex: Vec2, from: Vec2, to: Vec2): { start: number; delta: number } {
  const dirA = normalize({ x: from.x - vertex.x, y: from.y - vertex.y })
  const dirB = normalize({ x: to.x - vertex.x, y: to.y - vertex.y })
  const start = Math.atan2(dirA.y, dirA.x)
  const end = Math.atan2(dirB.y, dirB.x)
  let delta = end - start
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta <= -Math.PI) delta += 2 * Math.PI
  return { start, delta }
}

// Points tracing the interior-angle arc at `vertex`, from the ray toward
// `from` to the ray toward `to`, at a fixed `radius`.
export function angleArcPoints(vertex: Vec2, from: Vec2, to: Vec2, radius: number, segments = 20): Vec2[] {
  const { start, delta } = angleSweep(vertex, from, to)
  const points: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = start + (delta * i) / segments
    points.push({ x: vertex.x + radius * Math.cos(t), y: vertex.y + radius * Math.sin(t) })
  }
  return points
}

// Where an angle:'s optional label should sit — along the arc's own
// bisector direction, a bit further out than the arc itself so the text
// doesn't overlap the stroke.
export function angleBisectorPoint(vertex: Vec2, from: Vec2, to: Vec2, distance: number): Vec2 {
  const { start, delta } = angleSweep(vertex, from, to)
  const mid = start + delta / 2
  return { x: vertex.x + distance * Math.cos(mid), y: vertex.y + distance * Math.sin(mid) }
}

// The small "L" square marker for a right angle at `vertex`: two points
// offset by `size` along each ray, plus the corner between them — drawn as
// a 3-point polyline (vertex -> p1 -> corner -> p2, i.e. this function's
// [p1, corner, p2]) rather than a closed square, since the two existing rays
// through the vertex already cover that edge of the square.
export function rightAngleSquarePoints(vertex: Vec2, from: Vec2, to: Vec2, size: number): [Vec2, Vec2, Vec2] {
  const dirA = normalize({ x: from.x - vertex.x, y: from.y - vertex.y })
  const dirB = normalize({ x: to.x - vertex.x, y: to.y - vertex.y })
  const p1 = { x: vertex.x + dirA.x * size, y: vertex.y + dirA.y * size }
  const p2 = { x: vertex.x + dirB.x * size, y: vertex.y + dirB.y * size }
  const corner = { x: p1.x + dirB.x * size, y: p1.y + dirB.y * size }
  return [p1, corner, p2]
}

// `count` short perpendicular strokes centered on segment from->to's own
// midpoint, spaced `gap` apart along the segment — the standard textbook
// congruence-tick notation (one tick, two ticks, ... for matching groups of
// equal-length sides).
export function tickMarkSegments(from: Vec2, to: Vec2, count: number, tickLength: number, gap: number): [Vec2, Vec2][] {
  const dir = normalize({ x: to.x - from.x, y: to.y - from.y })
  const perp = { x: -dir.y, y: dir.x }
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const totalSpan = (count - 1) * gap
  const segments: [Vec2, Vec2][] = []
  for (let i = 0; i < count; i++) {
    const offset = -totalSpan / 2 + i * gap
    const cx = midX + dir.x * offset
    const cy = midY + dir.y * offset
    segments.push([
      { x: cx - perp.x * tickLength, y: cy - perp.y * tickLength },
      { x: cx + perp.x * tickLength, y: cy + perp.y * tickLength },
    ])
  }
  return segments
}
