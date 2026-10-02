// Picking thin things by screen distance (plan E6): curves within 8 px,
// points within half their size plus 4 px, arrows within 6 px of their shaft.
// Pure. Only what is drawn is picked: a candidate outside the axis box (the
// shader clips it) is not one.
//
// A curve's hit is the closest point on its projected polyline; its t is
// interpolated from the curve's parameters and the point re-evaluated from
// pick.r(t), so the readout is the true curve. A polyline with no parameter
// (a segment, a traced implicit curve) reports the interpolated point.

import { project, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { ArrowMark, Box3, LineMark, PointMark, SpaceScene, Vec3 } from '../scene/types'
import { arrowReadout, curveReadout, pointReadout } from './readout'
import type { Hit } from './types'

export const CURVE_TOLERANCE_PX = 8
export const POINT_TOLERANCE_EXTRA_PX = 4
export const ARROW_TOLERANCE_PX = 6

export interface Candidate {
  // Thin (a curve, point or arrow picked by screen distance) or a surface.
  thin: boolean
  // CSS px from the cursor; 0 for a surface under it.
  distance: number
  // NDC depth of the hit.
  depth: number
  // CSS px a point is lifted toward the eye by for the depth test (its
  // radius, as the point shader draws it); 0 for everything else.
  radiusPx: number
  hit: Hit
}

export function inBox(p: Vec3, box: Box3): boolean {
  const ranges = [box.x, box.y, box.z]
  return ranges.every((r, a) => {
    const tol = 1e-6 * (r.max - r.min)
    return p[a] >= r.min - tol && p[a] <= r.max + tol
  })
}

// The closest point to (px, py) on the segment a-b: its fraction along it and
// its distance.
export function closestOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): { f: number; d: number } {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  const f = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0
  return { f, d: Math.hypot(ax + f * vx - px, ay + f * vy - py) }
}

function lerp(a: Vec3, b: Vec3, f: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function vertex(a: Float64Array, i: number): Vec3 {
  return [a[3 * i], a[3 * i + 1], a[3 * i + 2]]
}

interface Projector {
  (p: Vec3): { x: number; y: number; depth: number }
}

function lineCandidate(mark: LineMark, screen: Projector, px: number, py: number, box: Box3): Candidate | null {
  const count = Math.floor(mark.positions.length / 3)
  const s = Array.from({ length: count }, (_, i) => screen(vertex(mark.positions, i)))
  let best: { i: number; f: number; d: number } | null = null
  for (let p = 0; p < mark.starts.length; p++) {
    const begin = mark.starts[p]
    const end = p + 1 < mark.starts.length ? mark.starts[p + 1] : count
    for (let i = begin; i + 1 < end; i++) {
      const a = s[i]
      const b = s[i + 1]
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue
      const c = closestOnSegment(a.x, a.y, b.x, b.y, px, py)
      if (c.d <= CURVE_TOLERANCE_PX && (!best || c.d < best.d)) best = { i, ...c }
    }
  }
  if (!best) return null
  const { i, f, d } = best
  let position: Vec3
  let hit: Hit
  if (mark.pick && mark.params) {
    const t = mark.params[i] + f * (mark.params[i + 1] - mark.params[i])
    position = mark.pick.r(t)
    hit = { source: mark.source, kind: 'curve', position, values: curveReadout(position, mark.pick.param, t, mark.pick.dr(t)), at: { kind: 'curve', t, point: position } }
  } else {
    position = lerp(vertex(mark.positions, i), vertex(mark.positions, i + 1), f)
    hit = { source: mark.source, kind: 'curve', position, values: curveReadout(position, null, null, null), at: { kind: 'curve', t: null, point: position } }
  }
  if (!inBox(position, box)) return null
  return { thin: true, distance: d, depth: screen(position).depth, radiusPx: 0, hit }
}

function pointCandidate(scene: SpaceScene, mark: PointMark, screen: Projector, px: number, py: number, box: Box3): Candidate | null {
  const count = Math.floor(mark.positions.length / 3)
  const tolerance = mark.style.size / 2 + POINT_TOLERANCE_EXTRA_PX
  let best: { index: number; d: number; depth: number } | null = null
  for (let index = 0; index < count; index++) {
    const p = vertex(mark.positions, index)
    if (!inBox(p, box)) continue
    const s = screen(p)
    const d = Math.hypot(s.x - px, s.y - py)
    if (d <= tolerance && (!best || d < best.d)) best = { index, d, depth: s.depth }
  }
  if (!best) return null
  const position = vertex(mark.positions, best.index)
  const label = best.index === 0 ? (scene.labels.find((l) => l.source.object === `${mark.source.object}.label`)?.text ?? null) : null
  return {
    thin: true,
    distance: best.d,
    depth: best.depth,
    radiusPx: mark.style.size / 2,
    hit: { source: mark.source, kind: 'point', position, values: pointReadout(position, label), at: { kind: 'point', index: best.index } },
  }
}

function arrowCandidate(mark: ArrowMark, screen: Projector, px: number, py: number, box: Box3): Candidate | null {
  const count = Math.floor(Math.min(mark.tails.length, mark.vectors.length) / 3)
  let best: { index: number; d: number; depth: number } | null = null
  for (let index = 0; index < count; index++) {
    const tail = vertex(mark.tails, index)
    const vector = vertex(mark.vectors, index)
    const tip: Vec3 = [tail[0] + vector[0], tail[1] + vector[1], tail[2] + vector[2]]
    const a = screen(tail)
    const b = screen(tip)
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue
    const c = closestOnSegment(a.x, a.y, b.x, b.y, px, py)
    const on = lerp(tail, tip, c.f)
    if (c.d <= ARROW_TOLERANCE_PX && inBox(on, box) && (!best || c.d < best.d)) best = { index, d: c.d, depth: screen(on).depth }
  }
  if (!best) return null
  const tail = vertex(mark.tails, best.index)
  const vector = vertex(mark.vectors, best.index)
  const position: Vec3 = [tail[0] + vector[0], tail[1] + vector[1], tail[2] + vector[2]]
  return {
    thin: true,
    distance: best.d,
    depth: best.depth,
    radiusPx: 0,
    hit: { source: mark.source, kind: 'arrow', position, values: arrowReadout(tail, vector), at: { kind: 'arrow', index: best.index } },
  }
}

// Every thin mark within its tolerance of (px, py), CSS px in the viewport.
export function thinCandidates(scene: SpaceScene, camera: CameraMatrices, world: WorldMap, px: number, py: number): Candidate[] {
  const screen: Projector = (p) => project(camera, world.toWorld(p))
  const out: Candidate[] = []
  for (const mark of scene.marks) {
    let c: Candidate | null = null
    if (mark.kind === 'lines') c = lineCandidate(mark, screen, px, py, world.box)
    else if (mark.kind === 'points') c = pointCandidate(scene, mark, screen, px, py, world.box)
    else if (mark.kind === 'arrows') c = arrowCandidate(mark, screen, px, py, world.box)
    if (c) out.push(c)
  }
  return out
}
