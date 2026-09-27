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

// Which of an edge's labels (in order along it) to show: all, else every 2nd,
// then every 3rd, and so on, until no two neighbours overlap. The first always
// stays, and the last stays when it sits at the edge's end (`keepLast`); the
// kept label before it gives way if the two collide.
export function thinLabels(items: readonly LabelBox[], keepLast: boolean): number[] {
  const n = items.length
  if (n <= 1) return items.map((_, i) => i)
  const clear = (kept: number[]) => kept.every((k, i) => i === 0 || !labelsOverlap(items[kept[i - 1]], items[k]))
  for (let m = 1; m < n; m++) {
    const kept: number[] = []
    for (let i = 0; i < n; i += m) kept.push(i)
    if (keepLast && kept[kept.length - 1] !== n - 1) {
      while (kept.length > 1 && labelsOverlap(items[kept[kept.length - 1]], items[n - 1])) kept.pop()
      kept.push(n - 1)
    }
    if (clear(kept)) return kept
  }
  return [0]
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
}

// Tick labels along one edge, pushed along `normal` by the push distance plus
// half their extent, then thinned; and the axis title at `titleAt`, beyond
// the labels. `keepLast` says the last tick sits at the edge's end.
export function edgeLabels(
  world: WorldMap,
  camera: CameraMatrices,
  ticks: readonly EdgeTick[],
  normal: readonly [number, number],
  push: number,
  keepLast: boolean,
  title: { key: string; position: Vec3; text: string } | null,
): FrameLabel[] {
  const boxes: LabelBox[] = []
  const offsets: [number, number][] = []
  for (const t of ticks) {
    const size = estimateLabelSize(t.text, TICK_FONT_PX)
    const reach = push + halfExtentAlong(normal, size)
    const offset: [number, number] = [normal[0] * reach, normal[1] * reach]
    const s = screenOf(world, camera, t.position)
    boxes.push({ x: s.x + offset[0], y: s.y + offset[1], ...size })
    offsets.push(offset)
  }
  const kept = thinLabels(boxes, keepLast)
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
