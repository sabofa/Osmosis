import type { Vec2 } from '../types'
import type { Arc } from './circles'
import { GEOM_EPS, type GeometryCircle } from './types'

// Shaded regions (Geometry v2, phase 12): the exact 2D region engine behind
// "find the area of the shaded region".
//
// A region is a set of closed LOOPS whose pieces are line segments and
// circular arcs — the only boundaries a plane-geometry shading problem draws.
// Outer loops run counter-clockwise and holes clockwise (F1), so the interior
// is always on the LEFT of a piece's direction of travel. Everything below
// leans on that one invariant: a winding number is 1 inside and 0 outside,
// two coincident pieces bound their regions on the same side exactly when
// they run the same way, and an area is a signed sum with no case analysis.
//
// Booleans are exact and closed form (F2), in four steps:
//   1. split both regions' boundaries at every mutual intersection — closed
//      form segment×segment, segment×arc and arc×arc, plus every endpoint of
//      one lying on the other (which is what finds coincident overlaps);
//   2. classify each piece against the other region by its MIDPOINT. No piece
//      crosses the other boundary any more, so one point decides the piece,
//      exactly: inside or outside by an exact winding number over segments and
//      arcs, or ON it — which only a coincident piece can be;
//   3. keep the pieces the operator needs;
//   4. chain them back into loops, merging what the splitting cut apart.
// There is no sampling anywhere: no piece is ever approximated by a polyline,
// and no answer is ever read off one.
//
// Area is exact given exact pieces (F3): the shoelace sum over each piece's
// chord, plus each arc's circular-segment term ½r²(θ − sin θ).
//
// Pure: it knows 2D points, circles and arcs, and nothing about names,
// statements or drawing.

export interface SegmentPiece {
  kind: 'segment'
  a: Vec2
  b: Vec2
}

// An arc of the circle (center, radius), from the angle `from` to the angle
// `to` (world radians). `ccw` is the direction of travel, and `to - from` is
// the signed sweep: positive counter-clockwise, never zero, never more than a
// full turn. `a` and `b` are its two ends, kept as points so that a piece
// split at an intersection shares that point, to the bit, with the piece of
// the other boundary it was split against.
export interface ArcPiece {
  kind: 'arc'
  center: Vec2
  radius: number
  from: number
  to: number
  ccw: boolean
  a: Vec2
  b: Vec2
}

export type Piece = SegmentPiece | ArcPiece

// A closed chain of pieces: each piece's `b` is the next one's `a`, and the
// last one's `b` is the first one's `a`.
export type Loop = Piece[]

export interface Region {
  loops: Loop[]
}

export type RegionOperator = 'union' | 'intersection' | 'difference'

const TURN = 2 * Math.PI

// ---------------------------------------------------------------------------
// Small vector arithmetic
// ---------------------------------------------------------------------------

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function unit(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y)
  return length === 0 ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length }
}

function onCircle(center: Vec2, radius: number, angle: number): Vec2 {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function segmentPiece(a: Vec2, b: Vec2): SegmentPiece {
  return { kind: 'segment', a, b }
}

function arcPiece(center: Vec2, radius: number, from: number, to: number, a?: Vec2, b?: Vec2): ArcPiece {
  return {
    kind: 'arc',
    center,
    radius,
    from,
    to,
    ccw: to > from,
    a: a ?? onCircle(center, radius, from),
    b: b ?? onCircle(center, radius, to),
  }
}

export function sweepOf(piece: ArcPiece): number {
  return piece.to - piece.from
}

function reversed(piece: Piece): Piece {
  if (piece.kind === 'segment') return segmentPiece(piece.b, piece.a)
  return { ...piece, from: piece.to, to: piece.from, ccw: !piece.ccw, a: piece.b, b: piece.a }
}

function reversedLoop(loop: Loop): Loop {
  return [...loop].reverse().map(reversed)
}

// The point halfway along a piece — for an arc, at its middle angle.
function midpoint(piece: Piece): Vec2 {
  if (piece.kind === 'segment') return { x: (piece.a.x + piece.b.x) / 2, y: (piece.a.y + piece.b.y) / 2 }
  return onCircle(piece.center, piece.radius, (piece.from + piece.to) / 2)
}

// The unit direction of travel along an arc at the angle `angle`.
function arcTangent(piece: ArcPiece, angle: number): Vec2 {
  const t = { x: -Math.sin(angle), y: Math.cos(angle) }
  return piece.ccw ? t : { x: -t.x, y: -t.y }
}

function startDirection(piece: Piece): Vec2 {
  return piece.kind === 'segment' ? unit(sub(piece.b, piece.a)) : arcTangent(piece, piece.from)
}

function endDirection(piece: Piece): Vec2 {
  return piece.kind === 'segment' ? unit(sub(piece.b, piece.a)) : arcTangent(piece, piece.to)
}

// How far round an arc's own direction of travel the angle `angle` lies,
// wrapped into [0, 2π).
function alongArc(piece: ArcPiece, angle: number): number {
  const raw = piece.ccw ? angle - piece.from : piece.from - angle
  return ((raw % TURN) + TURN) % TURN
}

// The exact extremes of a piece: its ends, and — for an arc — each of the
// four cardinal points of its circle that its sweep passes through. A bound
// on where the piece is, never a sampling of it.
export function pieceExtremes(piece: Piece): Vec2[] {
  if (piece.kind === 'segment') return [piece.a, piece.b]
  const points = [piece.a, piece.b]
  const sweep = Math.abs(sweepOf(piece))
  for (let quarter = 0; quarter < 4; quarter++) {
    const angle = (quarter * Math.PI) / 2
    if (alongArc(piece, angle) <= sweep) points.push(onCircle(piece.center, piece.radius, angle))
  }
  return points
}

export function regionExtremes(region: Region): Vec2[] {
  return region.loops.flatMap((loop) => loop.flatMap(pieceExtremes))
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boxOf(points: readonly Vec2[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x)
    box.minY = Math.min(box.minY, p.y)
    box.maxX = Math.max(box.maxX, p.x)
    box.maxY = Math.max(box.maxY, p.y)
  }
  return box
}

// The one tolerance: GEOM_EPS scaled by the size of the regions themselves —
// the larger side of their joint bounding box — and never an absolute number
// (phase 9's lesson). A region a thousandth of a unit across and one a
// thousand units across are the same question at different scales.
function toleranceFor(points: readonly Vec2[]): number {
  const box = boxOf(points)
  return GEOM_EPS * Math.max(box.maxX - box.minX, box.maxY - box.minY)
}

// ---------------------------------------------------------------------------
// Area (F3)
// ---------------------------------------------------------------------------

// The signed area a loop encloses: positive for a counter-clockwise (outer)
// loop, negative for a clockwise one (a hole). Each piece contributes its
// chord's shoelace term, and an arc adds the circular segment between itself
// and that chord, ½r²(θ − sin θ) with θ the SIGNED sweep — odd in θ, so a
// clockwise arc subtracts exactly what the same arc counter-clockwise adds.
export function loopArea(loop: Loop): number {
  let sum = 0
  for (const piece of loop) {
    sum += (piece.a.x * piece.b.y - piece.b.x * piece.a.y) / 2
    if (piece.kind === 'arc') {
      const theta = sweepOf(piece)
      sum += (piece.radius * piece.radius * (theta - Math.sin(theta))) / 2
    }
  }
  return sum
}

export function regionArea(region: Region): number {
  return region.loops.reduce((sum, loop) => sum + loopArea(loop), 0)
}

// ---------------------------------------------------------------------------
// Primitives (F1)
// ---------------------------------------------------------------------------

function describePoint(p: Vec2): string {
  const n = (v: number) => {
    const s = v.toFixed(4).replace(/\.?0+$/, '')
    return s === '-0' || s === '' ? '0' : s
  }
  return `(${n(p.x)}, ${n(p.y)})`
}

// A loop as a region, turned counter-clockwise if it runs the other way.
function oriented(loop: Loop): Region {
  return { loops: [loopArea(loop) > 0 ? loop : reversedLoop(loop)] }
}

// A polygon through the points in order, which must be SIMPLE: a polygon
// that crosses itself has no one inside, and shading it would state a region
// the author did not mean. Refused naming the two sides that meet, in the
// author's names when they are given. Turned counter-clockwise if it was
// written the other way round.
export function polygonRegion(points: readonly Vec2[], names?: readonly string[]): Region {
  const n = points.length
  const name = (i: number) => names?.[i] ?? describePoint(points[i])
  const side = (i: number) => `${name(i)}-${name((i + 1) % n)}`
  if (n < 3) throw new Error('A polygon needs at least three points')
  const tol = toleranceFor(points)

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (distance(points[i], points[j]) <= tol) {
      throw new Error(`${name(i)} and ${name(j)} are the same point, so the polygon has no side between them`)
    }
  }

  const title = `The polygon ${points.map((_, i) => name(i)).join('-')}`
  const direction = unit(sub(points[1], points[0]))
  if (points.every((p) => Math.abs(cross(direction, sub(p, points[0]))) <= tol)) {
    throw new Error(`${title} has no area — its points lie on one line`)
  }

  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    // The next side folding straight back over this one: c on the line
    // a-b, on a's side of b.
    const c = points[(i + 2) % n]
    if (distanceToSegment(c, a, b) <= tol || distanceToSegment(a, b, c) <= tol) {
      throw new Error(`${title} doubles back on itself — its sides ${side(i)} and ${side((i + 1) % n)} run over each other`)
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent through the first point
      const piece = segmentPiece(points[j], points[(j + 1) % n])
      if (meetPoints(segmentPiece(a, b), piece, tol).length > 0) {
        throw new Error(`${title} crosses itself — its sides ${side(i)} and ${side(j)} cross`)
      }
    }
  }

  // Simple, so its area is not zero and its sign is its winding.
  return oriented(points.map((p, i) => segmentPiece(p, points[(i + 1) % n])))
}

// The disk a circle bounds: one full counter-clockwise turn, from the circle's
// rightmost point.
export function diskRegion(c: GeometryCircle): Region {
  const start = onCircle(c.center, c.radius, 0)
  return { loops: [[arcPiece(c.center, c.radius, 0, TURN, start, start)]] }
}

function arcOf(arc: Arc): ArcPiece {
  return arcPiece(arc.center, arc.radius, arc.start, arc.start + arc.sweep)
}

// The sector an arc bounds — closed through the centre. The arc arrives with
// its direction already resolved, exactly as phase 4 resolves it.
export function sectorRegion(arc: Arc): Region {
  const piece = arcOf(arc)
  return oriented([segmentPiece(arc.center, piece.a), piece, segmentPiece(piece.b, arc.center)])
}

// The circular segment an arc bounds — closed through its own chord.
export function circularSegmentRegion(arc: Arc): Region {
  const piece = arcOf(arc)
  return oriented([piece, segmentPiece(piece.b, piece.a)])
}

// ---------------------------------------------------------------------------
// Where pieces meet, in closed form
// ---------------------------------------------------------------------------

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const lengthSquared = dot(ab, ab)
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSquared))
  return distance(p, { x: a.x + t * ab.x, y: a.y + t * ab.y })
}

// How far a point is from a piece: from the nearest point of a segment, or —
// for an arc — from its circle when the point's angle lies within the sweep,
// and from the nearer end otherwise.
function distanceToPiece(p: Vec2, piece: Piece): number {
  if (piece.kind === 'segment') return distanceToSegment(p, piece.a, piece.b)
  const fromCentre = distance(p, piece.center)
  if (fromCentre === 0) return piece.radius
  const angle = Math.atan2(p.y - piece.center.y, p.x - piece.center.x)
  if (alongArc(piece, angle) <= Math.abs(sweepOf(piece))) return Math.abs(fromCentre - piece.radius)
  return Math.min(distance(p, piece.a), distance(p, piece.b))
}

// The points of a line through `a` and `b` on the circle (center, radius),
// through the foot of the perpendicular, so a tangency compares two lengths.
function lineCircle(a: Vec2, b: Vec2, center: Vec2, radius: number, tol: number): Vec2[] {
  const ab = sub(b, a)
  const t = dot(sub(center, a), ab) / dot(ab, ab)
  const foot = { x: a.x + t * ab.x, y: a.y + t * ab.y }
  const h = distance(center, foot)
  if (h > radius + tol) return []
  if (Math.abs(h - radius) <= tol) return [foot]
  const half = Math.sqrt(radius * radius - h * h)
  const u = unit(ab)
  return [
    { x: foot.x - half * u.x, y: foot.y - half * u.y },
    { x: foot.x + half * u.x, y: foot.y + half * u.y },
  ]
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number, tol: number): Vec2[] {
  const d = distance(c1, c2)
  // Concentric — the same circle (its overlaps are found through the
  // endpoints, below) or two that never meet.
  if (d <= tol) return []
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return []
  const along = (d * d - r2 * r2 + r1 * r1) / (2 * d)
  const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d }
  const mid = { x: c1.x + along * u.x, y: c1.y + along * u.y }
  if (Math.abs(d - (r1 + r2)) <= tol || Math.abs(d - Math.abs(r1 - r2)) <= tol) return [mid]
  const half = Math.sqrt(Math.max(0, r1 * r1 - along * along))
  return [
    { x: mid.x - half * u.y, y: mid.y + half * u.x },
    { x: mid.x + half * u.y, y: mid.y - half * u.x },
  ]
}

// Every point where two pieces meet: where they cross or touch, in closed
// form, and every end of either lying on the other — which is how a
// coincident stretch (two sides on one line, two arcs on one circle) is
// found: by its ends. A point within the tolerance of an end is snapped to
// that end, so a vertex both boundaries share stays one point.
function meetPoints(p: Piece, q: Piece, tol: number): Vec2[] {
  const found: Vec2[] = []
  for (const end of [q.a, q.b]) if (distanceToPiece(end, p) <= tol) found.push(end)
  for (const end of [p.a, p.b]) if (distanceToPiece(end, q) <= tol) found.push(end)

  let crossings: Vec2[] = []
  if (p.kind === 'segment' && q.kind === 'segment') {
    const r = sub(p.b, p.a)
    const s = sub(q.b, q.a)
    const denominator = cross(r, s)
    // Parallel: no crossing; a collinear overlap was found by its ends above.
    if (Math.abs(denominator) > GEOM_EPS * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) {
      const t = cross(sub(q.a, p.a), s) / denominator
      crossings = [{ x: p.a.x + t * r.x, y: p.a.y + t * r.y }]
    }
  } else if (p.kind === 'segment' && q.kind === 'arc') {
    crossings = lineCircle(p.a, p.b, q.center, q.radius, tol)
  } else if (p.kind === 'arc' && q.kind === 'segment') {
    crossings = lineCircle(q.a, q.b, p.center, p.radius, tol)
  } else if (p.kind === 'arc' && q.kind === 'arc') {
    crossings = circleCircle(p.center, p.radius, q.center, q.radius, tol)
  }
  for (const point of crossings) {
    if (distanceToPiece(point, p) <= tol && distanceToPiece(point, q) <= tol) found.push(point)
  }

  const ends = [p.a, p.b, q.a, q.b]
  return found.map((point) => ends.find((end) => distance(end, point) <= tol) ?? point)
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

// Where along a piece a point of it lies: a segment's parameter, an arc's
// angle travelled from its start.
function positionAlong(piece: Piece, p: Vec2): number {
  if (piece.kind === 'segment') {
    const ab = sub(piece.b, piece.a)
    return dot(sub(p, piece.a), ab) / dot(ab, ab)
  }
  return alongArc(piece, Math.atan2(p.y - piece.center.y, p.x - piece.center.x))
}

// A piece cut at the given points of it (none at its own ends), in order.
function splitPiece(piece: Piece, points: readonly Vec2[], tol: number): Piece[] {
  const inner = points
    .filter((p) => distance(p, piece.a) > tol && distance(p, piece.b) > tol)
    .map((p) => ({ p, at: positionAlong(piece, p) }))
    .sort((x, y) => x.at - y.at)
  const cuts: { p: Vec2; at: number }[] = []
  for (const cut of inner) {
    if (cuts.length === 0 || distance(cuts[cuts.length - 1].p, cut.p) > tol) cuts.push(cut)
  }
  if (cuts.length === 0) return [piece]

  const out: Piece[] = []
  let start = piece.a
  let startAngle = piece.kind === 'arc' ? piece.from : 0
  for (const cut of cuts) {
    if (piece.kind === 'segment') out.push(segmentPiece(start, cut.p))
    else {
      const angle = piece.from + (piece.ccw ? cut.at : -cut.at)
      out.push(arcPiece(piece.center, piece.radius, startAngle, angle, start, cut.p))
      startAngle = angle
    }
    start = cut.p
  }
  out.push(piece.kind === 'segment' ? segmentPiece(start, piece.b) : arcPiece(piece.center, piece.radius, startAngle, piece.to, start, piece.b))
  return out
}

interface SplitLoop {
  pieces: Piece[]
  // Whether any piece of the loop meets the other region's boundary at all,
  // even only at a point.
  touched: boolean
}

function splitAgainst(region: Region, other: Region, tol: number): SplitLoop[] {
  const otherPieces = other.loops.flat()
  return region.loops.map((loop) => {
    let touched = false
    const pieces = loop.flatMap((piece) => {
      const points = otherPieces.flatMap((q) => meetPoints(piece, q, tol))
      if (points.length > 0) touched = true
      return splitPiece(piece, points, tol)
    })
    return { pieces, touched }
  })
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

// The angle a piece subtends at p, signed. A segment's is the angle between
// its ends as seen from p. An arc's is its chord's, plus a full turn (signed
// by the sweep) when p lies inside the circular segment between the arc and
// that chord — the closed loop "arc, then chord back" winds once round such a
// point and not at all round any other. Exact: no piece is ever sampled.
//
// The chord's angle and the side test read ONE number, the cross product of
// the chord with p — cross(a − p, b − p) is exactly cross(b − a, p − a) — so
// a point a rounding error away from the chord's line gets the same answer
// from either side of it. A point exactly ON the chord, inside the circle
// (a grid figure puts one there often: a square's side through a chord),
// sees the chord's ends in opposite directions, and the arc sweeps it
// through exactly half a turn, the way the arc runs.
function subtended(piece: Piece, p: Vec2): number {
  const u = sub(piece.a, p)
  const v = sub(piece.b, p)
  const ab = sub(piece.b, piece.a)
  const side = cross(ab, sub(p, piece.a))
  const chord = Math.atan2(side, dot(u, v))
  if (piece.kind === 'segment') return chord
  if (distance(p, piece.center) >= piece.radius) return chord
  const sweep = sweepOf(piece)
  if (Math.abs(sweep) >= TURN - GEOM_EPS) return Math.sign(sweep) * TURN
  if (side === 0) return Math.sign(sweep) * Math.PI
  const inside = side * cross(ab, sub(midpoint(piece), piece.a)) > 0
  return inside ? chord + Math.sign(sweep) * TURN : chord
}

// The winding number of a region round a point not on its boundary: 1 inside
// (outer loops counter-clockwise), 0 outside or in a hole (holes clockwise).
function windingNumber(region: Region, p: Vec2): number {
  let total = 0
  for (const loop of region.loops) for (const piece of loop) total += subtended(piece, p)
  return Math.round(total / TURN)
}

type Where = 'inside' | 'outside' | 'same' | 'opposite'

// Which side of `other` a piece lies on, decided by its midpoint. ON the
// boundary happens only for a coincident piece, and then the question is
// which side the other region is on: both interiors are on the left of their
// pieces, so they are on the same side exactly when the two run the same way.
function classify(piece: Piece, other: Region, tol: number): Where {
  const m = midpoint(piece)
  for (const loop of other.loops) {
    for (const q of loop) {
      if (distanceToPiece(m, q) > tol) continue
      const direction = piece.kind === 'segment' ? startDirection(piece) : arcTangent(piece, (piece.from + piece.to) / 2)
      const theirs = q.kind === 'segment' ? startDirection(q) : arcTangent(q, Math.atan2(m.y - q.center.y, m.x - q.center.x))
      return dot(direction, theirs) > 0 ? 'same' : 'opposite'
    }
  }
  return windingNumber(other, m) !== 0 ? 'inside' : 'outside'
}

// What each operator keeps of the FIRST region's pieces (a coincident piece
// is kept from this side only, so it is never doubled) and of the second's.
const KEEP_FIRST: Record<RegionOperator, readonly Where[]> = {
  union: ['outside', 'same'],
  intersection: ['inside', 'same'],
  difference: ['outside', 'opposite'],
}
const KEEP_SECOND: Record<RegionOperator, Where> = { union: 'outside', intersection: 'inside', difference: 'inside' }

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

// Signed curvature as a piece is travelled: positive turning left.
function curvature(piece: Piece): number {
  if (piece.kind === 'segment') return 0
  return (piece.ccw ? 1 : -1) / piece.radius
}

// Where a piece leaving a vertex sits among the others, as the angle
// clockwise from the way back — the reversed incoming piece — in [0, 2π]. The
// smallest is the sharpest LEFT turn. A piece leaving straight back along the
// way it came (a cusp, or a hole touching the outer boundary) sits at 0 or 2π
// depending on which side of the way back it curves.
function wayOn(into: Piece, out: Piece): number {
  const back = endDirection(into)
  const ref = { x: -back.x, y: -back.y }
  const direction = startDirection(out)
  const raw = Math.atan2(cross(direction, ref), dot(direction, ref))
  const angle = raw < 0 ? raw + TURN : raw
  if (angle > GEOM_EPS && angle < TURN - GEOM_EPS) return angle
  // Straight back: the way back curves with −κ(into).
  return curvature(out) < -curvature(into) ? 0 : TURN
}

// Two consecutive pieces that are one piece: collinear segments running on,
// or arcs of one circle running the same way.
function merged(p: Piece, q: Piece, tol: number): Piece | null {
  if (p.kind === 'segment' && q.kind === 'segment') {
    if (distanceToSegment(p.b, p.a, q.b) > tol) return null
    if (dot(sub(p.b, p.a), sub(q.b, q.a)) <= 0) return null
    return segmentPiece(p.a, q.b)
  }
  if (p.kind === 'arc' && q.kind === 'arc') {
    if (p.ccw !== q.ccw || distance(p.center, q.center) > tol || Math.abs(p.radius - q.radius) > tol) return null
    const sweep = sweepOf(p) + sweepOf(q)
    if (Math.abs(sweep) > TURN + GEOM_EPS) return null
    return arcPiece(p.center, p.radius, p.from, p.from + sweep, p.a, q.b)
  }
  return null
}

function mergeLoop(loop: Loop, tol: number): Loop {
  const out: Piece[] = []
  for (const piece of loop) {
    const last = out.length > 0 ? merged(out[out.length - 1], piece, tol) : null
    if (last) out[out.length - 1] = last
    else out.push(piece)
  }
  for (;;) {
    if (out.length < 2) break
    const wrap = merged(out[out.length - 1], out[0], tol)
    if (!wrap) break
    out.pop()
    out[0] = wrap
  }
  return out
}

// A kept piece and the loop of the operand it came from.
interface Kept {
  piece: Piece
  origin: number
}

// Chains pieces end to end into closed loops. Where several pieces leave one
// point — loops touching there — the path goes on along the loop it came
// from, if it can: a circle inscribed in a square stays one hole touching one
// square at four points, rather than four corner loops pinched together, and
// two disks touching from outside stay two loops rather than one figure of
// eight. Among several such pieces, or none, it takes the sharpest left turn
// (which traces the smallest loop round the interior on its left); ties go to
// the piece curving more to the left, then to the earlier piece. A fixed
// rule, so the result depends on nothing but the input.
//
// Null when a chain cannot close. The kept pieces of two exact boundaries
// always close; they fail to only when two boundaries run within a
// tolerance or two of each other without meeting, so that a sliver of one is
// judged to lie ON the other — the caller refuses that in the author's words.
function assemble(pieces: readonly Kept[], tol: number): Loop[] | null {
  const used = pieces.map(() => false)
  const loops: Loop[] = []
  for (let i = 0; i < pieces.length; i++) {
    if (used[i]) continue
    used[i] = true
    const loop: Loop = [pieces[i].piece]
    const start = pieces[i].piece.a
    let current = pieces[i]
    while (distance(current.piece.b, start) > tol) {
      const candidates = pieces
        .map((kept, j) => ({ kept, j }))
        .filter(({ kept, j }) => !used[j] && distance(kept.piece.a, current.piece.b) <= tol)
      const own = candidates.filter(({ kept }) => kept.origin === current.origin)
      let best: { kept: Kept; j: number } | null = null
      let bestWay = Infinity
      let bestCurvature = -Infinity
      for (const candidate of own.length > 0 ? own : candidates) {
        const way = wayOn(current.piece, candidate.kept.piece)
        const k = curvature(candidate.kept.piece)
        if (way < bestWay - GEOM_EPS || (Math.abs(way - bestWay) <= GEOM_EPS && k > bestCurvature)) {
          best = candidate
          bestWay = way
          bestCurvature = k
        }
      }
      if (!best) return null
      used[best.j] = true
      loop.push(best.kept.piece)
      current = best.kept
    }
    loops.push(mergeLoop(loop, tol))
  }
  return loops
}

// ---------------------------------------------------------------------------
// Booleans (F2)
// ---------------------------------------------------------------------------

// `first` ∘ `second`. `what` names the expression in the author's words, for
// the one refusal: a result with nothing left to shade.
//
// Orientation needs no repair afterwards: every kept piece keeps the
// interior on its left (a piece of the second region kept by a difference is
// reversed, because there the second region's inside is the result's
// outside), so each assembled loop is counter-clockwise exactly when it is an
// outer boundary, and the sign of its area says which it is.
export function combineRegions(op: RegionOperator, first: Region, second: Region, what = 'the region'): Region {
  const tol = toleranceFor([...regionExtremes(first), ...regionExtremes(second)])
  const kept: Kept[] = []

  const side = (loop: SplitLoop, piece: Piece, other: Region): Where => {
    if (loop.touched) return classify(piece, other, tol)
    // A loop that meets the other boundary nowhere is wholly inside the other
    // region or wholly outside it — one containment test decides the loop.
    return windingNumber(other, midpoint(loop.pieces[0])) !== 0 ? 'inside' : 'outside'
  }

  splitAgainst(first, second, tol).forEach((loop, origin) => {
    for (const piece of loop.pieces) if (KEEP_FIRST[op].includes(side(loop, piece, second))) kept.push({ piece, origin })
  })
  splitAgainst(second, first, tol).forEach((loop, index) => {
    const origin = first.loops.length + index
    for (const piece of loop.pieces) {
      if (side(loop, piece, first) !== KEEP_SECOND[op]) continue
      kept.push({ piece: op === 'difference' ? reversed(piece) : piece, origin })
    }
  })

  const loops = assemble(kept, tol)
  if (!loops) {
    throw new Error(`${what} has boundaries too close to tell apart — make them meet exactly, or move them clearly apart`)
  }
  if (loops.length === 0) throw new Error(`${what} leaves nothing to shade`)
  return { loops }
}

// ---------------------------------------------------------------------------
// Components, and where an area label hangs (F6)
// ---------------------------------------------------------------------------

// One connected piece of a region: an outer loop and the holes inside it.
export interface RegionComponent {
  outer: Loop
  holes: Loop[]
  area: number
}

// The outer loops (positive area) each with the holes they contain. A hole
// belongs to the smallest outer loop round a point strictly inside the hole
// — never a point of its boundary, which may touch the outer loop (an
// inscribed circle touches its square at four points).
export function regionComponents(region: Region): RegionComponent[] {
  const outers = region.loops.filter((loop) => loopArea(loop) > 0)
  const components: RegionComponent[] = outers.map((outer) => ({ outer, holes: [], area: loopArea(outer) }))
  for (const hole of region.loops.filter((loop) => loopArea(loop) < 0)) {
    const inside = chordPoint([reversedLoop(hole)])
    if (!inside) continue
    const owner = components
      .filter((component) => windingNumber({ loops: [component.outer] }, inside) !== 0)
      .sort((x, y) => loopArea(x.outer) - loopArea(y.outer))[0]
    if (!owner) continue
    owner.holes.push(hole)
    owner.area += loopArea(hole)
  }
  return components
}

// Where the horizontal line at height y meets a piece, in closed form: the
// x of each crossing (both ends of a side lying along the line).
function crossingsAt(piece: Piece, y: number, tol: number): number[] {
  if (piece.kind === 'segment') {
    const { a, b } = piece
    if (Math.abs(a.y - b.y) <= tol) return Math.abs(a.y - y) <= tol ? [a.x, b.x] : []
    if (y < Math.min(a.y, b.y) - tol || y > Math.max(a.y, b.y) + tol) return []
    return [a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)]
  }
  const s = (y - piece.center.y) / piece.radius
  if (Math.abs(s) > 1) return []
  const sweep = Math.abs(sweepOf(piece))
  const angles = [Math.asin(s), Math.PI - Math.asin(s)]
  return angles
    .filter((angle) => {
      const along = alongArc(piece, angle)
      return along <= sweep + GEOM_EPS || along >= TURN - GEOM_EPS
    })
    .map((angle) => piece.center.x + piece.radius * Math.cos(angle))
}

// F6's scan over the loops of one component (the first is its outer loop):
// the seven horizontal lines at i·h/8 up its height h, i = 1 … 7, each met
// with every piece in closed form; the midpoint of the longest chord lying
// strictly inside (a chord runs on through a point where the boundary only
// touches the line), ties to the lowest line, then to the leftmost chord. Null
// only for a component with no inside, which a region never has.
function chordPoint(loops: readonly Loop[]): Vec2 | null {
  const shape: Region = { loops: [...loops] }
  const extremes = loops[0].flatMap(pieceExtremes)
  const box = boxOf(extremes)
  const tol = toleranceFor(extremes)
  const h = box.maxY - box.minY

  const onBoundary = (p: Vec2) => loops.some((loop) => loop.some((piece) => distanceToPiece(p, piece) <= tol))
  const interior = (p: Vec2) => !onBoundary(p) && windingNumber(shape, p) !== 0

  let best: Vec2 | null = null
  let bestLength = 0
  for (let i = 1; i <= 7; i++) {
    const y = box.minY + (i * h) / 8
    const xs = loops
      .flat()
      .flatMap((piece) => crossingsAt(piece, y, tol))
      .sort((p, q) => p - q)
    // The chords lying strictly inside, left to right.
    const inside: [number, number][] = []
    for (let k = 0; k + 1 < xs.length; k++) {
      if (xs[k + 1] - xs[k] <= tol) continue
      if (interior({ x: (xs[k] + xs[k + 1]) / 2, y })) inside.push([xs[k], xs[k + 1]])
    }
    // Two inside chords meeting end to end are ONE chord: the boundary only
    // touches the line there (a tangency, or a vertex on the line), so the
    // region is on both sides of the point (fix round 1, M5). Should the
    // merged chord's midpoint be that touching point itself, its two parts
    // stand as chords of their own instead.
    const candidates: [number, number][] = []
    let run: [number, number][] = []
    const flush = () => {
      if (run.length === 0) return
      const merged: [number, number] = [run[0][0], run[run.length - 1][1]]
      if (run.length === 1 || interior({ x: (merged[0] + merged[1]) / 2, y })) candidates.push(merged)
      else candidates.push(...run)
      run = []
    }
    for (const chord of inside) {
      if (run.length > 0 && chord[0] - run[run.length - 1][1] > tol) flush()
      run.push(chord)
    }
    flush()
    for (const [from, to] of candidates) {
      if (to - from <= bestLength + tol) continue
      best = { x: (from + to) / 2, y }
      bestLength = to - from
    }
  }
  return best
}

// F6 — a deterministic point INSIDE the region for its area label: the scan
// above, on the largest component by area. Seven lines rather than one,
// because a single middle line can meet nothing but boundary: a square minus
// its inscribed circle has chords of length zero across its middle. Exact,
// and never outside the region: an annulus's label sits in the ring.
export function interiorLabelPoint(region: Region): Vec2 {
  const components = regionComponents(region)
  let largest = components[0]
  for (const component of components) if (component.area > largest.area) largest = component
  const found = chordPoint([largest.outer, ...largest.holes])
  if (found) return found
  // Unreachable for a region with area; the middle of its box otherwise.
  const box = boxOf(largest.outer.flatMap(pieceExtremes))
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
}
