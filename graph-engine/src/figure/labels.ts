import type { Vec2 } from '../scene/types'
import { rectAround, type Rect } from './document'

// E2 — label layout.
//
// This is the decision the spec says is most likely to determine whether the
// renderer is usable, and the reason is arithmetic: a competition figure can
// carry twenty or more labelled points, and naive "offset up and to the
// right" placement makes a mess of them well before that. So every label is
// given a set of candidate positions, each candidate is scored against the
// geometry already drawn and the labels already placed, and the best one
// wins. Ties are broken by a fixed candidate order, never by chance.
//
// Everything in this file works in **view coordinates** — the projected,
// y-down space the SVG itself uses. Label sizes are in the same units, which
// is the whole reason the layout can be done here rather than being deferred
// to the browser.

// ---------------------------------------------------------------------------
// Text metrics
// ---------------------------------------------------------------------------

// The estimation rule, stated once.
//
// SVG gives real metrics through `getBBox()`, but only in a browser with the
// figure already in the document — and the layout has to happen *before* the
// markup exists, in node, in tests. So text is measured by character class:
//
//   narrow  (i l j t f r I . , ' ` ! | : ; [ ] ( ) space)  0.32 em
//   wide    (m w M W @)                                    0.90 em
//   digits and capitals                                    0.62 em
//   everything else                                        0.52 em
//
// and a line is 1.15 em tall (cap height plus a descender allowance). Those
// numbers are the advance widths of a typical UI sans at 1 em, rounded to two
// figures. The estimate is deliberately a little generous: over-measuring
// spreads labels slightly further apart than necessary, while under-measuring
// lets two of them touch — and only one of those two is a bug.
//
// A browser path can sharpen this later by substituting a measurer that calls
// getBBox; the layout takes sizes, not a font, so nothing else changes.
const NARROW = new Set("iljtfrI.,'`!|:;[](){} ".split(''))
const WIDE = new Set('mwMW@'.split(''))

export interface TextSize {
  width: number
  height: number
}

export function estimateTextSize(text: string, fontSize: number): TextSize {
  let ems = 0
  for (const ch of text) {
    if (NARROW.has(ch)) ems += 0.32
    else if (WIDE.has(ch)) ems += 0.9
    else if (/[0-9A-Z]/.test(ch)) ems += 0.62
    else ems += 0.52
  }
  return { width: ems * fontSize, height: 1.15 * fontSize }
}

// The default label size in view units. FIGURE_SIZE is 640, so this is a
// label roughly a fiftieth of the figure's width — the proportion a textbook
// figure uses.
export const LABEL_FONT_SIZE = 15

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface LabelAnchor {
  // Stable identity, carried through to the emitted element (E4) and used as
  // the final tie-break so that two labels with identical scores at identical
  // positions still resolve the same way on every run.
  id: string
  text: string
  at: Vec2
  fontSize: number
  // A unit direction the label would rather sit in — a polygon vertex points
  // away from its own centroid, so the label lands outside the shape instead
  // of on top of the angle mark that always sits inside it. A hint, not a
  // constraint: it loses to a collision every time.
  prefer?: Vec2 | null
  // The box this label occupies, when the caller already knows it. A plain
  // text label does not: its size is estimated from its own characters, which
  // is what `text` is for. A notation label does, because its overbars and
  // arrows make it taller than its glyphs and the caller has already laid
  // those out (see notation.ts's layoutNotation).
  size?: TextSize
  // Whether this label is allowed to sit inside a closed shape.
  //
  // Off by default, because a name floating in the middle of a triangle
  // belongs to nothing. An *angle measure* is the exception and the reason
  // this exists: the inside of the shape is exactly where it belongs, and
  // without the exemption the inside-penalty drives it out past the vertex,
  // where it names no angle at all.
  mayEnterShapes?: boolean
}

export interface LabelObstacles {
  segments: [Vec2, Vec2][]
  circles: { center: Vec2; radius: number }[]
  // Closed shapes a label should stay out of. Distinct from their edges,
  // which are segments: a label can clear every edge by a mile and still be
  // sitting in the middle of the triangle.
  polygons: Vec2[][]
}

export function noObstacles(): LabelObstacles {
  return { segments: [], circles: [], polygons: [] }
}

export interface PlacedLabel {
  id: string
  text: string
  // The centre of the placed box. Emitted with text-anchor="middle" and
  // dominant-baseline="central", so this is exactly where the text goes.
  at: Vec2
  anchor: Vec2
  rect: Rect
  fontSize: number
  // Which ring of the escape ladder the label ended up on. Ring 0 is "as
  // close as a label can sit".
  ring: number
  // Whether the label had to settle for somewhere other than what it asked
  // for: a ring past the nearest one, or a direction more than 45 degrees off
  // its `prefer` hint.
  //
  // It is the LAYOUT that knows this — a caller looking only at coordinates
  // cannot tell a label that chose its spot from one that was pushed there —
  // and it is what decides whether a leader line is drawn back to whatever
  // the label names.
  displaced: boolean
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

// Eight compass directions, in a fixed order. The order is the tie-break: a
// label with nothing to avoid goes right, then up-right, and so on — which
// matches the convention a hand-drawn figure uses, and, more importantly,
// means the same figure resolves the same way every time.
const DIRECTIONS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 0.7071067811865476, y: -0.7071067811865476 },
  { x: 0, y: -1 },
  { x: -0.7071067811865476, y: -0.7071067811865476 },
  { x: -1, y: 0 },
  { x: -0.7071067811865476, y: 0.7071067811865476 },
  { x: 0, y: 1 },
  { x: 0.7071067811865476, y: 0.7071067811865476 },
]

// The escape ladder. Ring 0 is "right next to the point"; each further ring
// is a label that could not fit closer. Bounded on purpose: a label pushed
// arbitrarily far stops belonging to its point, which is a different kind of
// wrong from overlapping.
const RINGS = [1, 1.45, 1.95, 2.55, 3.3, 4.2]

// Weights. The ordering between them is the policy and matters more than the
// magnitudes: colliding with another label is worse than sitting on a line,
// which is worse than sitting inside a shape, which is worse than ignoring
// the direction hint, which is worse than being one ring further out.
const W_LABEL = 1e6
const W_SEGMENT = 1e3
const W_CIRCLE = 1e3
const W_INSIDE = 400
const W_PREFER = 60
const W_RING = 25

// How closely the chosen direction has to match the `prefer` hint for the
// label to count as having got what it asked for. cos 45 degrees: the hint
// names one of eight compass directions, so this admits that direction and
// its two neighbours and nothing else.
const PREFER_SATISFIED = Math.SQRT1_2

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function rectCorners(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
}

// Whether a segment touches a box: either endpoint inside, or the segment
// crossing one of the four edges. Written as a distance test against the
// box's own edges plus a containment test, which is shorter than four
// segment-segment intersections and no less exact for this purpose.
function segmentHitsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  const inside = (p: Vec2) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  if (inside(a) || inside(b)) return true
  const corners = rectCorners(r)
  for (let i = 0; i < 4; i++) {
    const c = corners[i]
    const d = corners[(i + 1) % 4]
    if (segmentsCross(a, b, c, d)) return true
  }
  return false
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  return o1 * o2 < 0 && o3 * o4 < 0
}

// Whether a circle's *stroke* passes through the box. A label inside a large
// circle is fine; a label straddling its outline is not.
function circleHitsRect(center: Vec2, radius: number, r: Rect): boolean {
  let near = Number.POSITIVE_INFINITY
  let far = 0
  for (const corner of rectCorners(r)) {
    const d = Math.hypot(corner.x - center.x, corner.y - center.y)
    near = Math.min(near, d)
    far = Math.max(far, d)
  }
  // The closest point of the box may be on an edge rather than at a corner,
  // which matters when the centre is beside the box.
  const clampedX = Math.max(r.x, Math.min(center.x, r.x + r.width))
  const clampedY = Math.max(r.y, Math.min(center.y, r.y + r.height))
  near = Math.min(near, Math.hypot(clampedX - center.x, clampedY - center.y))
  return near <= radius && far >= radius
}

function pointInPolygon(p: Vec2, polygon: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

interface Candidate {
  index: number
  ring: number
  direction: Vec2
  at: Vec2
  rect: Rect
}

function candidatesFor(anchor: LabelAnchor, size: TextSize): Candidate[] {
  // Far enough out that the box clears the point's own dot and the stroke it
  // sits on, scaled by the label so a long one does not creep back over its
  // anchor.
  const base = 0.75 * anchor.fontSize + Math.max(size.width, size.height) / 2
  const out: Candidate[] = []
  let index = 0
  for (let ring = 0; ring < RINGS.length; ring++) {
    for (const direction of DIRECTIONS) {
      const offset = base * RINGS[ring]
      const at = { x: anchor.at.x + direction.x * offset, y: anchor.at.y + direction.y * offset }
      out.push({ index: index++, ring, direction, at, rect: rectAround(at, size.width, size.height) })
    }
  }
  return out
}

function scoreCandidate(candidate: Candidate, anchor: LabelAnchor, obstacles: LabelObstacles, placed: Rect[]): number {
  let score = 0

  for (const rect of placed) {
    if (rectsOverlap(candidate.rect, rect)) score += W_LABEL
  }

  for (const [a, b] of obstacles.segments) {
    if (segmentHitsRect(a, b, candidate.rect)) score += W_SEGMENT
  }

  for (const circle of obstacles.circles) {
    if (circleHitsRect(circle.center, circle.radius, candidate.rect)) score += W_CIRCLE
  }

  if (!anchor.mayEnterShapes) {
    for (const polygon of obstacles.polygons) {
      if (polygon.length >= 3 && pointInPolygon(candidate.at, polygon)) score += W_INSIDE
    }
  }

  if (anchor.prefer) {
    const dot = candidate.direction.x * anchor.prefer.x + candidate.direction.y * anchor.prefer.y
    score += ((1 - dot) / 2) * W_PREFER
  }

  score += candidate.ring * W_RING

  return score
}

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

// Greedy, in the caller's order — which is statement order, so the figure's
// own text decides who gets first choice. Greedy rather than a global
// optimum on purpose: the optimum is a set-packing problem, and an exact
// solver would be both slow and, worse, prone to a wholesale re-arrangement
// from a one-character edit. A stable, explainable placement is worth more
// here than a marginally tighter one.
export function layoutLabels(anchors: readonly LabelAnchor[], obstacles: LabelObstacles): PlacedLabel[] {
  const placedRects: Rect[] = []
  const result: PlacedLabel[] = []

  for (const anchor of anchors) {
    const size = anchor.size ?? estimateTextSize(anchor.text, anchor.fontSize)
    const candidates = candidatesFor(anchor, size)

    let best = candidates[0]
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const score = scoreCandidate(candidate, anchor, obstacles, placedRects)
      // Strictly less than: an equal score keeps the earlier candidate, so
      // the fixed DIRECTIONS/RINGS order is the tie-break.
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
      // Nothing can beat a candidate that collides with nothing and sits in
      // the nearest ring in the preferred direction.
      if (score === 0) break
    }

    placedRects.push(best.rect)
    result.push({
      id: anchor.id,
      text: anchor.text,
      at: best.at,
      anchor: anchor.at,
      rect: best.rect,
      fontSize: anchor.fontSize,
      ring: best.ring,
      displaced: best.ring > 0 || (anchor.prefer ? dot(best.direction, anchor.prefer) < PREFER_SATISFIED : false),
    })
  }

  return result
}
