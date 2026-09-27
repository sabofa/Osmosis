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

import { estimateLabelSize, labelsOverlap, type LabelBox } from '../frame/labels'

export type PlacedRole = 'tick' | 'title' | 'label' | 'annotation'

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
}

export interface PlacedLabel {
  key: string
  text: string
  role: PlacedRole
  x: number
  y: number
  visible: boolean
  // Set only for an annotation shown through its fallback: a leader from the
  // label back to its anchor.
  leader: ScreenPoint | null
}

// Placement order (V2): readouts (and contour values) before point labels
// before frame labels — a higher-priority label keeps its spot even if a
// tick label was there first.
const PRIORITY: Record<PlacedRole, number> = { annotation: 0, label: 1, tick: 2, title: 2 }

export function placeLabels(requests: readonly LabelRequest[]): PlacedLabel[] {
  const order = requests
    .map((request, index) => ({ request, index }))
    .sort((a, b) => PRIORITY[a.request.role] - PRIORITY[b.request.role] || a.index - b.index)

  const placed: LabelBox[] = []
  const out = new Map<string, PlacedLabel>()
  for (const { request } of order) {
    const size = estimateLabelSize(request.text, request.fontSize)
    const candidates = request.candidates.length > 0 ? request.candidates : [request.anchor]
    let fit: ScreenPoint | null = null
    for (const c of candidates) {
      const box: LabelBox = { x: c.x, y: c.y, ...size }
      if (placed.some((p) => labelsOverlap(p, box))) continue
      fit = c
      placed.push(box)
      break
    }
    if (fit) {
      out.set(request.key, { key: request.key, text: request.text, role: request.role, x: fit.x, y: fit.y, visible: true, leader: null })
      continue
    }
    if (request.role === 'annotation') {
      const c = candidates[0]
      placed.push({ x: c.x, y: c.y, ...size })
      out.set(request.key, { key: request.key, text: request.text, role: request.role, x: c.x, y: c.y, visible: true, leader: request.anchor })
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
// back to a leader line.
export const ANNOTATION_RADII: readonly number[] = [14, 26, 38, 50, 60]

export function annotationCandidates(anchor: ScreenPoint): ScreenPoint[] {
  return ANNOTATION_RADII.flatMap((r) => ring(anchor, r))
}
