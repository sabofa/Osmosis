// Pointing: which thing is under the pointer, and which one is selected.
//
// An engine describes what can be pointed at as a flat list of `HitItem`s in
// *one* coordinate space (the caller converts the pointer into it and the
// tolerance from px into it) and this file answers "what is here?". It knows
// nothing of figures, labels or the DOM, so the geometry figure, the flowchart
// and the table can share it.
//
// The pick rule, in order:
//   1. Only items within the tolerance are candidates (areas: inside is 0).
//   2. The lowest rank wins. Points (0) beat lines (1) beat areas (2), so the
//      small, hard-to-hit thing is not shadowed by the big, easy-to-hit one
//      even when the pointer is nearer the latter's edge.
//   3. Within a rank the smallest distance wins.
//   4. On a tie the later item wins: it was drawn on top.

import type { Rect, Vec } from './types'

export type HitShape =
  | { kind: 'point'; at: Vec }
  | { kind: 'segment'; a: Vec; b: Vec }
  | { kind: 'polyline'; points: Vec[]; closed: boolean }
  | { kind: 'circle'; center: Vec; radius: number } // the outline, not the disc
  | {
      // Radians; the point at angle t is center + radius * (cos t, sin t). The
      // arc runs from `start` toward `end`: increasing angle when end > start,
      // decreasing when end < start. A sweep of a full turn or more is the
      // whole circle.
      kind: 'arc'
      center: Vec
      radius: number
      start: number
      end: number
    }
  | { kind: 'polygon'; points: Vec[] } // an area
  | { kind: 'rect'; rect: Rect } // an area

export interface HitItem {
  id: string
  shape: HitShape
  rank?: 0 | 1 | 2 // overrides shapeRank(shape); figure label rects use 0
}

const TWO_PI = Math.PI * 2

export function shapeRank(shape: HitShape): 0 | 1 | 2 {
  switch (shape.kind) {
    case 'point':
      return 0
    case 'segment':
    case 'polyline':
    case 'circle':
    case 'arc':
      return 1
    case 'polygon':
    case 'rect':
      return 2
  }
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
  return Math.hypot(p.x - (a.x + u * abx), p.y - (a.y + u * aby))
}

// The nearest edge of a chain of points; `closed` adds last -> first.
function distanceToChain(p: Vec, points: readonly Vec[], closed: boolean): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y)
  let best = Infinity
  for (let i = 0; i + 1 < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i], points[i + 1]))
  }
  if (closed) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]))
  return best
}

// Even-odd ray cast.
function insidePolygon(p: Vec, points: readonly Vec[]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distanceToArc(p: Vec, center: Vec, radius: number, start: number, end: number): number {
  const toCenter = Math.hypot(p.x - center.x, p.y - center.y)
  const rimDistance = Math.abs(toCenter - radius)
  const sweep = end - start
  if (Math.abs(sweep) >= TWO_PI) return rimDistance
  // How far round the sweep (in its own direction) the pointer's bearing is.
  const dir = sweep < 0 ? -1 : 1
  const bearing = Math.atan2(p.y - center.y, p.x - center.x)
  let along = (dir * (bearing - start)) % TWO_PI
  if (along < 0) along += TWO_PI
  if (along <= Math.abs(sweep)) return rimDistance
  const ends = [start, end].map((t) => ({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) }))
  return Math.min(...ends.map((e) => Math.hypot(p.x - e.x, p.y - e.y)))
}

// How far `p` is from the shape; 0 inside an area. Lines (circle included) are
// outlines: the centre of a circle is a radius away from it.
export function distanceToShape(p: Vec, shape: HitShape): number {
  switch (shape.kind) {
    case 'point':
      return Math.hypot(p.x - shape.at.x, p.y - shape.at.y)
    case 'segment':
      return distanceToSegment(p, shape.a, shape.b)
    case 'polyline':
      return distanceToChain(p, shape.points, shape.closed)
    case 'circle':
      return Math.abs(Math.hypot(p.x - shape.center.x, p.y - shape.center.y) - shape.radius)
    case 'arc':
      return distanceToArc(p, shape.center, shape.radius, shape.start, shape.end)
    case 'polygon':
      return insidePolygon(p, shape.points) ? 0 : distanceToChain(p, shape.points, true)
    case 'rect': {
      const { x, y, width, height } = shape.rect
      return Math.hypot(Math.max(x - p.x, 0, p.x - (x + width)), Math.max(y - p.y, 0, p.y - (y + height)))
    }
  }
}

export function hitTest(items: readonly HitItem[], at: Vec, tolerance: number): HitItem | null {
  let best: HitItem | null = null
  let bestRank = 3
  let bestDistance = Infinity
  for (const item of items) {
    const distance = distanceToShape(at, item.shape)
    if (!(distance <= tolerance)) continue
    const rank = item.rank ?? shapeRank(item.shape)
    // `<=` on distance: walking in drawing order, a tie goes to the later item.
    if (rank < bestRank || (rank === bestRank && distance <= bestDistance)) {
      best = item
      bestRank = rank
      bestDistance = distance
    }
  }
  return best
}

// One hovered id and a set of selected ids. Each call says whether anything
// changed, so the caller redraws only when it must.
//
// The selection rules (shift is "additive"):
//   - a plain click on an item selects only that item;
//   - shift + click on an item toggles it in the set;
//   - a plain click on empty space clears the set;
//   - shift + click on empty space does nothing, so a slip of the hand while
//     building a selection does not lose it;
//   - `clear()` empties it.
export class PointerSelection {
  private _hovered: string | null = null
  private _selected: readonly string[] = []

  get hovered(): string | null {
    return this._hovered
  }

  // In the order added. A new array on every change, so one handed out earlier
  // is never altered under its holder.
  get selected(): readonly string[] {
    return this._selected
  }

  // The one added last, null for an empty set.
  get primary(): string | null {
    return this._selected.length === 0 ? null : this._selected[this._selected.length - 1]
  }

  hover(id: string | null): boolean {
    if (id === this._hovered) return false
    this._hovered = id
    return true
  }

  // A click on `id` (null: on empty space). `additive`: shift was held.
  click(id: string | null, additive = false): boolean {
    if (id === null) return additive ? false : this.clear()
    if (additive) {
      this._selected = this._selected.includes(id) ? this._selected.filter((x) => x !== id) : [...this._selected, id]
      return true
    }
    if (this._selected.length === 1 && this._selected[0] === id) return false
    this._selected = [id]
    return true
  }

  clear(): boolean {
    if (this._selected.length === 0) return false
    this._selected = []
    return true
  }
}
