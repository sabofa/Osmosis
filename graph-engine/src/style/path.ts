import type { Point } from './tokens'

// Abstract strokes: what every line type in lines/ takes as input, and the
// small geometry toolkit the line types share.
//
// A CHAIN is a run of pieces — straight lines, circular arcs, elliptical arcs
// and cubic Béziers — in drawing coordinates, each starting where the last
// one ended. A closed chain returns to its first point. Nothing here knows
// what drew the chain (a triangle's side, a cylinder's rim, a hatch line);
// that is the point: a line type is one algorithm over chains.
//
// Angles are radians in drawing coordinates, where y points DOWN (the SVG
// convention). An arc runs from `start` to `end`; the sign of `end - start`
// is its direction. An elliptical arc's angles are the ELLIPSE PARAMETER t,
// the point at t being center + rx cos t u + ry sin t v, with u the rx axis
// turned by `rotation` and v a quarter turn on from u.

export type Piece =
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'arc'; center: Point; radius: number; start: number; end: number }
  | { kind: 'ellipticalArc'; center: Point; rx: number; ry: number; rotation: number; start: number; end: number }
  | { kind: 'cubic'; from: Point; c1: Point; c2: Point; to: Point }

export interface Chain {
  pieces: Piece[]
  closed: boolean
}

// ---------------------------------------------------------------------------
// Points on pieces
// ---------------------------------------------------------------------------

export function ellipseAt(center: Point, rx: number, ry: number, rotation: number, t: number): Point {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = rx * Math.cos(t)
  const y = ry * Math.sin(t)
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

// The point a fraction `u` of the way along a piece, by its own parameter
// (angle for arcs, Bézier t for a cubic). Exact: an arc's points are ON its
// circle, which is what keeps a sketchy arc faithful at looseness 0.
export function pointOn(piece: Piece, u: number): Point {
  switch (piece.kind) {
    case 'line':
      return { x: piece.from.x + (piece.to.x - piece.from.x) * u, y: piece.from.y + (piece.to.y - piece.from.y) * u }
    case 'arc': {
      const angle = piece.start + (piece.end - piece.start) * u
      return { x: piece.center.x + piece.radius * Math.cos(angle), y: piece.center.y + piece.radius * Math.sin(angle) }
    }
    case 'ellipticalArc':
      return ellipseAt(piece.center, piece.rx, piece.ry, piece.rotation, piece.start + (piece.end - piece.start) * u)
    case 'cubic': {
      const v = 1 - u
      const a = v * v * v
      const b = 3 * v * v * u
      const c = 3 * v * u * u
      const d = u * u * u
      return {
        x: a * piece.from.x + b * piece.c1.x + c * piece.c2.x + d * piece.to.x,
        y: a * piece.from.y + b * piece.c1.y + c * piece.c2.y + d * piece.to.y,
      }
    }
  }
}

// The exact ends. Taken from the piece's own endpoints where it has them, so
// a line's end is its `to` to the last bit, not a recomputation.
export function pieceStart(piece: Piece): Point {
  return piece.kind === 'line' || piece.kind === 'cubic' ? piece.from : pointOn(piece, 0)
}

export function pieceEnd(piece: Piece): Point {
  return piece.kind === 'line' || piece.kind === 'cubic' ? piece.to : pointOn(piece, 1)
}

// A piece's length. Lines and circular arcs in closed form; an ellipse or a
// cubic by a fine polyline, which is plenty for choosing a sample spacing.
export function pieceLength(piece: Piece): number {
  switch (piece.kind) {
    case 'line':
      return Math.hypot(piece.to.x - piece.from.x, piece.to.y - piece.from.y)
    case 'arc':
      return Math.abs(piece.end - piece.start) * piece.radius
    default: {
      let length = 0
      let last = pointOn(piece, 0)
      for (let i = 1; i <= 48; i++) {
        const next = pointOn(piece, i / 48)
        length += Math.hypot(next.x - last.x, next.y - last.y)
        last = next
      }
      return length
    }
  }
}

export function chainLength(chain: Chain): number {
  return chain.pieces.reduce((sum, piece) => sum + pieceLength(piece), 0)
}

export function chainStart(chain: Chain): Point {
  return pieceStart(chain.pieces[0])
}

export function chainEnd(chain: Chain): Point {
  return pieceEnd(chain.pieces[chain.pieces.length - 1])
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

// Points along a chain, about `step` apart, with every piece's exact ends
// included (so a corner stays a corner) and the chain's first and last
// points exactly its own. Every sample of an arc lies on the arc.
export function sampleChain(chain: Chain, step: number): Point[] {
  const points: Point[] = []
  chain.pieces.forEach((piece, index) => {
    const count = Math.max(2, Math.ceil(pieceLength(piece) / Math.max(step, 1e-6)))
    if (index === 0) points.push(pieceStart(piece))
    for (let i = 1; i < count; i++) points.push(pointOn(piece, i / count))
    points.push(pieceEnd(piece))
  })
  return points
}

// Arc length from the first point to each point.
export function cumulative(points: readonly Point[]): number[] {
  const out = [0]
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  return out
}

// The unit normal at each point, to the LEFT of travel (in y-down drawing
// coordinates that is (dy, -dx)), from the neighbours on either side. A
// CLOSED run (its last point repeating its first) wraps round the seam, so
// the normal there is the same from both sides.
export function normalsOf(points: readonly Point[], closed = false): Point[] {
  const n = points.length
  return points.map((_, i) => {
    const a = closed && n > 2 && i === 0 ? points[n - 2] : points[Math.max(0, i - 1)]
    const b = closed && n > 2 && i === n - 1 ? points[1] : points[Math.min(n - 1, i + 1)]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    return length === 0 ? { x: 0, y: 0 } : { x: dy / length, y: -dx / length }
  })
}

// The unit direction of travel at each end.
export function endTangents(points: readonly Point[]): { start: Point; end: Point } {
  const unit = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    return length === 0 ? { x: 1, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  }
  const n = points.length
  return { start: unit(points[0], points[Math.min(1, n - 1)]), end: unit(points[Math.max(0, n - 2)], points[n - 1]) }
}

// ---------------------------------------------------------------------------
// Smoothing and dashing
// ---------------------------------------------------------------------------

// A smooth curve THROUGH every point: Catmull-Rom (uniform, tension ½)
// written as cubic Béziers. It passes through each sample, so a curve through
// samples of an arc stays on the arc at every sample; between them it bows by
// far less than a stroke width at the spacings the line types use.
//
// A CLOSED run (its last point repeating its first) takes its neighbours
// across the seam, so the curve leaves the start in the direction it arrives
// at the end: no corner where a loop closes.
export function smoothThrough(points: readonly Point[], closed = false): Piece[] {
  const pieces: Piece[] = []
  const n = points.length
  const wrap = closed && n > 3
  for (let i = 0; i + 1 < n; i++) {
    const p0 = wrap && i === 0 ? points[n - 2] : points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = wrap && i + 2 > n - 1 ? points[1] : points[Math.min(n - 1, i + 2)]
    pieces.push({
      kind: 'cubic',
      from: p1,
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    })
  }
  return pieces
}

// A polyline cut into dashes: `pattern` is on, off, on, off… in drawing
// units, repeated. Each dash is its own run of points, with its ends placed
// exactly on the polyline.
export function dashPolyline(points: readonly Point[], pattern: readonly number[]): Point[][] {
  if (pattern.length === 0 || pattern.every((p) => p <= 0)) return [points.slice()]
  const lengths = cumulative(points)
  const total = lengths[lengths.length - 1]
  const at = (s: number): Point => {
    let i = 1
    while (i < lengths.length - 1 && lengths[i] < s) i++
    const span = lengths[i] - lengths[i - 1]
    const f = span === 0 ? 0 : (s - lengths[i - 1]) / span
    return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * f, y: points[i - 1].y + (points[i].y - points[i - 1].y) * f }
  }
  const dashes: Point[][] = []
  let s = 0
  let k = 0
  while (s < total) {
    const on = pattern[k % pattern.length]
    const off = pattern[(k + 1) % pattern.length]
    const end = Math.min(total, s + on)
    if (end > s) {
      const dash = [at(s)]
      for (let i = 0; i < points.length; i++) if (lengths[i] > s && lengths[i] < end) dash.push(points[i])
      dash.push(at(end))
      dashes.push(dash)
    }
    s = end + off
    k += 2
  }
  return dashes
}

// A chain of straight pieces through `points`.
export function polylineChain(points: readonly Point[], closed = false): Chain {
  return { pieces: points.slice(1).map((to, i) => ({ kind: 'line' as const, from: points[i], to })), closed }
}
