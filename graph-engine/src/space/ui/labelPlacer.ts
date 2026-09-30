// One collision-aware placer for every piece of overlay text (S6 plan V2,
// spec SP11's S6 row). Frame tick and title labels arrive already thinned
// along their own edge (frame/labels.ts thinLabels, dropCrossEdgeCollisions)
// and offer exactly one candidate, their fixed screen offset; point labels
// and annotations (readouts, and a contour's value label — both scene.labels
// kind 'annotation') offer a ring of candidates around their anchor.
//
// Placement is greedy by priority — annotations first, then point labels,
// then frame labels — and within a priority by the order given, so the same
// input always places the same way (determinism). A candidate that overlaps
// an already-placed label is skipped. A label with nowhere to go is dropped,
// except an annotation, which always shows, at its first candidate, with a
// leader line back to its anchor (V2: "a label that fits nowhere is dropped,
// except readouts, which always show via a leader line").
//
// Pure: screen-space arithmetic on already-projected points, no DOM.

import { estimateLabelSize, labelsOverlap, LABEL_GAP_PX, type LabelBox } from '../frame/labels'

export type PlacedRole = 'tick' | 'title' | 'label' | 'annotation' | 'contour'

export interface ScreenPoint {
  x: number
  y: number
}

export interface LabelRequest {
  key: string
  text: string
  role: PlacedRole
  fontSize: number
  // The data point this label is attached to, in CSS px: a dropped
  // annotation's leader line runs here, and it is the fallback position
  // when `candidates` is empty (a frame label's fixed offset already IS its
  // one candidate, so frame requests pass it there instead).
  anchor: ScreenPoint
  // Candidate label-centre positions, tried in the given order.
  candidates: readonly ScreenPoint[]
  // S6 fix round 1, M2: sized from this instead of `text` when set — a
  // readout currently showing its full, clicked-open digits (labelPool.ts)
  // reserves the room those need, not just its capped display text's, so
  // expanding it in place never overlaps a neighbour the capped size had
  // room to miss.
  sizeText?: string
}

export interface PlacedLabel {
  key: string
  text: string
  role: PlacedRole
  x: number
  y: number
  visible: boolean
  // Set whenever the placement (fitted or the readout fallback) lands more
  // than LEADER_DISTANCE_PX from the anchor: a leader from the label back to
  // it. Only ever set for 'annotation' — a 'contour' label is dropped
  // instead (I3).
  leader: ScreenPoint | null
}

// Placement order (S6 fix round 1, I3): readouts, then point labels, then
// contour value labels, then frame labels — a higher-priority label keeps
// its spot even if a lower one was there first. Contour labels used to share
// 'annotation''s priority and its "never dropped" fallback, which let them
// outrank a point label and always show regardless of collisions; they are
// now their own role, ranked under point labels and, like a point label,
// simply dropped when nothing fits.
const PRIORITY: Record<PlacedRole, number> = { annotation: 0, label: 1, contour: 2, tick: 3, title: 3 }

// I3: a readout placed this far from its anchor or farther gets a visible
// leader back to it, whether that placement came from its own candidate
// ring or the least-overlap fallback below.
export const LEADER_DISTANCE_PX = 14

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// How much two boxes overlap, in px^2 of penetration (0 when they do not):
// the least-bad candidate under annotationFallbackCandidates is the one
// that minimises the sum of this against everything already placed.
function overlapAmount(a: LabelBox, b: LabelBox): number {
  const dx = (a.width + b.width) / 2 + LABEL_GAP_PX - Math.abs(a.x - b.x)
  const dy = (a.height + b.height) / 2 + LABEL_GAP_PX - Math.abs(a.y - b.y)
  return dx > 0 && dy > 0 ? dx * dy : 0
}

// S6 plan V10: "nothing overlaps the frame's tick labels" — the placer also
// takes the chrome's own rectangles (the parameter panel, the colorbar, the
// readout boxes; SpaceRenderer.ts measures them from the DOM, since this
// module stays pure). They out-rank every label — seeded into `placed`
// before anything is placed — but never appear in the output themselves.
export function placeLabels(requests: readonly LabelRequest[], obstacles: readonly LabelBox[] = []): PlacedLabel[] {
  const order = requests
    .map((request, index) => ({ request, index }))
    .sort((a, b) => PRIORITY[a.request.role] - PRIORITY[b.request.role] || a.index - b.index)

  const placed: LabelBox[] = [...obstacles]
  const out = new Map<string, PlacedLabel>()
  const place = (request: LabelRequest, at: ScreenPoint, size: { width: number; height: number }): PlacedLabel => {
    placed.push({ x: at.x, y: at.y, ...size })
    const leader = request.role === 'annotation' && distance(at, request.anchor) > LEADER_DISTANCE_PX ? request.anchor : null
    return { key: request.key, text: request.text, role: request.role, x: at.x, y: at.y, visible: true, leader }
  }
  for (const { request } of order) {
    const size = estimateLabelSize(request.sizeText ?? request.text, request.fontSize)
    const candidates = request.candidates.length > 0 ? request.candidates : [request.anchor]
    let fit: ScreenPoint | null = null
    for (const c of candidates) {
      const box: LabelBox = { x: c.x, y: c.y, ...size }
      if (placed.some((p) => labelsOverlap(p, box))) continue
      fit = c
      break
    }
    if (fit) {
      out.set(request.key, place(request, fit, size))
      continue
    }
    // I3: a readout is never simply dropped — but the old fallback
    // (candidates[0]) is the very spot every candidate above already found
    // blocked. Search farther out (to 120 px) for the least-overlapping
    // spot instead, so it settles somewhere sane rather than exactly atop
    // whatever is already there. A dropped label of any other role (a point
    // label, or, since I3, a contour value) is simply hidden.
    if (request.role === 'annotation') {
      let best = candidates[0]
      let bestScore = Infinity
      for (const c of [...candidates, ...annotationFallbackCandidates(request.anchor)]) {
        const box: LabelBox = { x: c.x, y: c.y, ...size }
        const score = placed.reduce((sum, p) => sum + overlapAmount(p, box), 0)
        if (score < bestScore) {
          bestScore = score
          best = c
          if (score === 0) break
        }
      }
      out.set(request.key, place(request, best, size))
      continue
    }
    out.set(request.key, { key: request.key, text: request.text, role: request.role, x: request.anchor.x, y: request.anchor.y, visible: false, leader: null })
  }
  // Back to the input order, so a caller zipping with other per-item data
  // (the DOM pool, a test) sees a stable, request-shaped list.
  return requests.map((r) => out.get(r.key)!)
}

// Eight directions around an anchor, screen space (y grows downward): up
// and to the right first — the single fixed offset point labels used before
// V2 — then clockwise.
const DIRECTIONS: readonly ScreenPoint[] = ([
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
] as const).map(([x, y]) => {
  const len = Math.hypot(x, y)
  return { x: x / len, y: y / len }
})

function ring(anchor: ScreenPoint, radius: number): ScreenPoint[] {
  return DIRECTIONS.map((d) => ({ x: anchor.x + d.x * radius, y: anchor.y + d.y * radius }))
}

// Point labels (V2): 8 candidate offsets at one radius, close to the anchor.
export const POINT_LABEL_RADIUS = 10

export function pointCandidates(anchor: ScreenPoint): ScreenPoint[] {
  return ring(anchor, POINT_LABEL_RADIUS)
}

// Annotation readouts (V2): 8 offsets, then the same ring at increasing
// radius out to 60 px, so a crowded spot still finds room before falling
// back to the least-overlap search below.
export const ANNOTATION_RADII: readonly number[] = [14, 26, 38, 50, 60]

export function annotationCandidates(anchor: ScreenPoint): ScreenPoint[] {
  return ANNOTATION_RADII.flatMap((r) => ring(anchor, r))
}

// I3: when nothing within ANNOTATION_RADII is clear, a readout searches this
// farther ring (70-120 px) for the least-overlapping spot, rather than
// reusing candidates[0] — the very spot the first search already rejected.
export const ANNOTATION_FALLBACK_RADII: readonly number[] = [70, 80, 90, 100, 110, 120]

export function annotationFallbackCandidates(anchor: ScreenPoint): ScreenPoint[] {
  return ANNOTATION_FALLBACK_RADII.flatMap((r) => ring(anchor, r))
}
