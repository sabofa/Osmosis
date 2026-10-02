// Which labels show, and where (plan G10; S6 plan V2). Pure: the DOM overlay
// only applies what this returns.
//
// - Every label — frame ticks and titles, point labels, and annotations
//   (readouts, and a contour's value label) — is offered to one placer
//   (labelPlacer.ts placeLabels), which resolves collisions by priority:
//   annotations first, then point labels, then frame labels, so a readout or
//   a point label can claim a tick label's spot but never the reverse.
// - Frame labels keep their existing fixed screen offset as their one
//   candidate. Point and annotation labels offer a ring of candidates
//   (labelPlacer.ts pointCandidates / annotationCandidates) around their
//   projected anchor.
// - A label whose anchor projects outside the viewport, or behind a
//   perspective eye, is hidden, and never contests a placement another label
//   could use.
// - A dropped annotation still shows, at its first candidate, with a leader
//   line back to its anchor (never dropped outright); a dropped point label
//   is hidden.
// - Keys are stable across camera moves, so the pool reuses its spans.

import { estimateLabelSize, type LabelBox } from '../frame/labels'
import { LABEL_FONT_PX, TICK_FONT_PX, TITLE_FONT_PX } from '../frame/types'
import { project, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { FrameModel } from '../frame/types'
import type { LabelAnchor } from '../scene/types'
import { annotationCandidates, placeLabels, pointCandidates, type LabelRequest, type PlacedRole, type ScreenPoint } from './labelPlacer'

export type LabelRole = 'tick' | 'title' | 'label'

export interface Leader {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface LabelItem {
  key: string
  text: string
  // CSS px in the viewport: the label's centre for 'tick' and 'title', its
  // bottom-left corner for 'label'.
  x: number
  y: number
  role: LabelRole
  visible: boolean
  // An annotation shown through its fallback candidate: a line from the
  // label's centre (x1, y1) back to its anchor (x2, y2), null otherwise.
  leader: Leader | null
  // S6 plan V3: the same text with every digit its error supports, shown on
  // a click; present only for an annotation whose scene label carried one.
  fullText?: string
}

function inView(camera: CameraMatrices, s: { x: number; y: number; depth: number }): boolean {
  const { width, height } = camera.viewport
  return s.x >= 0 && s.x <= width && s.y >= 0 && s.y <= height && s.depth >= -1 && s.depth <= 1
}

// The public LabelRole has neither 'annotation' nor 'contour': a readout and
// a contour value label both draw exactly like a point label (data role:
// 'label'), differing only in this module's internal priority, candidate
// ring, and (I3) droppability.
function publicRole(role: PlacedRole): LabelRole {
  return role === 'annotation' || role === 'contour' ? 'label' : role
}

// A box-edge point (I3): where the segment from the label's centre toward
// the anchor first crosses the label's own rectangle, so a leader is drawn
// from the label's edge, not through its own text. Degenerates to the
// centre when the anchor is inside the box (should not happen at the
// leader distances this fires at, but stays finite either way).
function boxEdgeToward(center: ScreenPoint, size: { width: number; height: number }, anchor: ScreenPoint): ScreenPoint {
  const dx = anchor.x - center.x
  const dy = anchor.y - center.y
  if (dx === 0 && dy === 0) return center
  const halfW = size.width / 2
  const halfH = size.height / 2
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY, 1)
  return { x: center.x + dx * scale, y: center.y + dy * scale }
}

// `chromeRects` (S6 plan V10): the panel, colorbar and readout boxes'
// screen-space rectangles, in the same CSS-px viewport frame as everything
// else here — SpaceRenderer.ts measures them from the live DOM (this module
// stays pure) and passes them through unchanged.
// `isExpanded` (S6 fix round 1, M2): whether a label is currently showing
// its full, clicked-open text (labelPool.ts LabelPool.isExpanded, through
// SpaceRenderer.ts's overlay) — read only for a label carrying a
// `fullText`, to size its placement from that instead of its capped text.
export function layoutLabels(
  frame: FrameModel,
  sceneLabels: readonly LabelAnchor[],
  camera: CameraMatrices,
  world: WorldMap,
  chromeRects: readonly LabelBox[] = [],
  isExpanded: (key: string) => boolean = () => false,
): LabelItem[] {
  const requests: LabelRequest[] = []
  const anchors = new Map<string, { x: number; y: number; visible: boolean }>()
  const fullTexts = new Map<string, string>()

  for (const l of frame.labels) {
    const s = project(camera, world.toWorld(l.position))
    const anchor: ScreenPoint = { x: s.x + l.screenOffset[0], y: s.y + l.screenOffset[1] }
    anchors.set(l.key, { ...anchor, visible: inView(camera, s) })
    requests.push({
      key: l.key,
      text: l.text,
      role: l.role,
      fontSize: l.role === 'tick' ? TICK_FONT_PX : TITLE_FONT_PX,
      anchor,
      candidates: [anchor],
    })
  }
  sceneLabels.forEach((l, i) => {
    const s = project(camera, world.toWorld(l.position))
    const key = `label:${i}:${l.source.object}`
    const anchor: ScreenPoint = { x: s.x, y: s.y }
    anchors.set(key, { ...anchor, visible: inView(camera, s) })
    if (l.fullText !== undefined) fullTexts.set(key, l.fullText)
    // I3: a contour value label keeps annotation's candidate ring (it is
    // still text hung beside a point on a curve, at the same scale as a
    // readout) but not its role — see PRIORITY and placeLabels' fallback.
    const role: PlacedRole = l.kind === 'annotation' ? 'annotation' : l.kind === 'contour' ? 'contour' : 'label'
    requests.push({
      key,
      text: l.text,
      role,
      fontSize: LABEL_FONT_PX,
      anchor,
      candidates: role === 'annotation' || role === 'contour' ? annotationCandidates(anchor) : pointCandidates(anchor),
      sizeText: l.fullText !== undefined && isExpanded(key) ? l.fullText : undefined,
    })
  })

  // An off-screen anchor never contests a placement a visible label could use.
  const onScreen = requests.filter((r) => anchors.get(r.key)!.visible)
  const placedByKey = new Map(placeLabels(onScreen, chromeRects).map((p) => [p.key, p]))

  return requests.map((r) => {
    const a = anchors.get(r.key)!
    const role = publicRole(r.role)
    const fullText = fullTexts.get(r.key)
    if (!a.visible) return { key: r.key, text: r.text, x: a.x, y: a.y, role, visible: false, leader: null, fullText }
    const p = placedByKey.get(r.key)!
    if (role === 'tick' || role === 'title') return { key: r.key, text: r.text, x: p.x, y: p.y, role, visible: p.visible, leader: null }
    // 'label' anchors at its bottom-left corner (labelPool.ts labelTransform);
    // the placer works in box-centre coordinates, so convert once here.
    // M2: the same (possibly expanded) size the placement itself was sized
    // from, so the geometry here matches what was actually reserved.
    const size = estimateLabelSize(r.sizeText ?? r.text, r.fontSize)
    // I3: from the label's own edge (nearest the anchor), not through its
    // centre and its text.
    const edge = p.leader ? boxEdgeToward({ x: p.x, y: p.y }, size, p.leader) : null
    const leader: Leader | null = edge && p.leader ? { x1: edge.x, y1: edge.y, x2: p.leader.x, y2: p.leader.y } : null
    return { key: r.key, text: r.text, x: p.x - size.width / 2, y: p.y + size.height / 2, role, visible: p.visible, leader, fullText }
  })
}
