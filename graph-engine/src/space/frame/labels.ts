// Frame label geometry, shared by the box frame and the axes frame (plan G5,
// G6). Everything here is screen-space arithmetic on projected points. Pure.

import { project, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { Vec3 } from '../scene/types'
import { TICK_FONT_PX, TITLE_FONT_PX, type FrameLabel } from './types'

// A label is pushed off its anchor by this plus half its own extent.
export const TICK_LABEL_PUSH_PX = 10
// The axis title sits this far beyond the outermost tick label.
export const TITLE_GAP_PX = 6
// Two labels closer than this (box to box) count as overlapping.
export const LABEL_GAP_PX = 2

export interface LabelBox {
  // Centre, CSS px.
  x: number
  y: number
  width: number
  height: number
}

// Without measuring text: a character is about 0.6 em wide, and a line one em tall.
export function estimateLabelSize(text: string, fontSize: number): { width: number; height: number } {
  return { width: 0.6 * fontSize * [...text].length, height: fontSize }
}

export function labelsOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + LABEL_GAP_PX &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + LABEL_GAP_PX
  )
}

// A label to thin: its box, and the multiple of the step its tick is.
export interface ThinItem extends LabelBox {
  index?: number
}

// Which of an edge's labels (in order along it) to show. Both end labels
// (the first and last ticks) always stay, the same rule at each end, whether
// or not the ends sit on the box's bounds. Between them: all, else the ticks
// whose multiple is divisible by 2, then 3, and so on, so the interior labels
// read at a coarser step (0, 0.4, 0.8 ...), until no two neighbours overlap;
// an interior label that collides with an end label gives way to it.
export function thinLabels(items: readonly ThinItem[]): number[] {
  const n = items.length
  if (n <= 1) return items.map((_, i) => i)
  if (n === 2) return labelsOverlap(items[0], items[1]) ? [0] : [0, 1]
  const clear = (kept: number[]) => kept.every((k, i) => i === 0 || !labelsOverlap(items[kept[i - 1]], items[k]))
  const multiple = (i: number) => items[i].index ?? i
  for (let m = 1; m < n; m++) {
    const kept = [0]
    for (let i = 1; i < n - 1; i++) if (((multiple(i) % m) + m) % m === 0) kept.push(i)
    kept.push(n - 1)
    while (kept.length > 2 && labelsOverlap(items[kept[0]], items[kept[1]])) kept.splice(1, 1)
    while (kept.length > 2 && labelsOverlap(items[kept[kept.length - 1]], items[kept[kept.length - 2]])) kept.splice(kept.length - 2, 1)
    if (clear(kept)) return kept
  }
  return labelsOverlap(items[0], items[n - 1]) ? [0] : [0, n - 1]
}

// The extent of a w x h box along a unit screen direction, halved.
export function halfExtentAlong(n: readonly [number, number], size: { width: number; height: number }): number {
  return (Math.abs(n[0]) * size.width + Math.abs(n[1]) * size.height) / 2
}

export function screenOf(world: WorldMap, camera: CameraMatrices, p: Vec3): { x: number; y: number } {
  const s = project(camera, world.toWorld(p))
  return { x: s.x, y: s.y }
}

// The unit screen normal of the edge a -> b that points along `toward`
// (which need not be unit). Falls back to `toward` itself when the edge
// projects to a point, and to screen-left when that is degenerate too.
export function edgeNormal(
  sa: { x: number; y: number },
  sb: { x: number; y: number },
  toward: readonly [number, number],
): [number, number] {
  const ex = sb.x - sa.x
  const ey = sb.y - sa.y
  const len = Math.hypot(ex, ey)
  if (!(len > 1e-6)) {
    const t = Math.hypot(toward[0], toward[1])
    return t > 1e-9 ? [toward[0] / t, toward[1] / t] : [-1, 0]
  }
  const n: [number, number] = [-ey / len, ex / len]
  return n[0] * toward[0] + n[1] * toward[1] >= 0 ? n : [-n[0], -n[1]]
}

export interface EdgeTick {
  key: string
  position: Vec3
  text: string
  // The multiple of the step this tick is (k in k * step).
  index: number
}

// Tick labels along one edge, pushed along `normal` by the push distance plus
// half their extent, then thinned (both end labels kept); and the axis title
// beyond the labels.
export function edgeLabels(
  world: WorldMap,
  camera: CameraMatrices,
  ticks: readonly EdgeTick[],
  normal: readonly [number, number],
  push: number,
  title: { key: string; position: Vec3; text: string } | null,
): FrameLabel[] {
  const boxes: ThinItem[] = []
  const offsets: [number, number][] = []
  for (const t of ticks) {
    const size = estimateLabelSize(t.text, TICK_FONT_PX)
    const reach = push + halfExtentAlong(normal, size)
    const offset: [number, number] = [normal[0] * reach, normal[1] * reach]
    const s = screenOf(world, camera, t.position)
    boxes.push({ x: s.x + offset[0], y: s.y + offset[1], ...size, index: t.index })
    offsets.push(offset)
  }
  const kept = thinLabels(boxes)
  const labels: FrameLabel[] = kept.map((i) => ({
    key: ticks[i].key,
    position: ticks[i].position,
    screenOffset: offsets[i],
    text: ticks[i].text,
    role: 'tick',
  }))
  if (title) {
    const outermost = kept.reduce((m, i) => Math.max(m, halfExtentAlong(normal, boxes[i]) * 2), 0)
    const size = estimateLabelSize(title.text, TITLE_FONT_PX)
    const reach = push + outermost + TITLE_GAP_PX + halfExtentAlong(normal, size)
    labels.push({ ...title, screenOffset: [normal[0] * reach, normal[1] * reach], role: 'title' })
  }
  return labels
}

// Across edges: the x and y tick edges meet at the front corner, where both
// end labels sit, and thinning within one edge cannot see the other. Taking
// the edges in order, a tick label that would overlap one already kept from
// an earlier edge is dropped. Titles are left alone.
export function dropCrossEdgeCollisions(world: WorldMap, camera: CameraMatrices, edges: readonly FrameLabel[][]): FrameLabel[] {
  const kept: FrameLabel[] = []
  const placed: LabelBox[] = []
  for (const edge of edges) {
    const mine: LabelBox[] = []
    for (const label of edge) {
      if (label.role !== 'tick') {
        kept.push(label)
        continue
      }
      const s = screenOf(world, camera, label.position)
      const box = { x: s.x + label.screenOffset[0], y: s.y + label.screenOffset[1], ...estimateLabelSize(label.text, TICK_FONT_PX) }
      if (placed.some((other) => labelsOverlap(other, box))) continue
      kept.push(label)
      mine.push(box)
    }
    placed.push(...mine)
  }
  return kept
}
