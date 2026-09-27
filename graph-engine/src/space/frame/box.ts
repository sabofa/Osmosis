// The box frame (plan G5, spec SP5 "The frame is a real chart"). Pure.
//
// - Back walls: the x-wall is at x = min when the eye direction has d_x > 0,
//   else x = max; the same for y. The floor is at z = min when d_z >= 0,
//   else z = max. So the walls stay behind the data as the camera orbits.
// - Gridlines on each back wall at the tick values of its two axes; wall
//   outlines in gridStrong, gridlines in grid.
// - Tick edges: x ticks along the x-parallel edge at the floor and the FRONT
//   y; y ticks along the y-parallel edge at the floor and the front x; z
//   ticks along the vertical edge that projects leftmost on screen, ties
//   broken toward the front. Each is a silhouette edge of the box.
// - Tick labels are pushed perpendicular to their edge on screen, away from
//   the projected box centre, by 10 px plus half their extent, then thinned;
//   the axis title sits at the edge midpoint beyond them. Where two edges
//   meet (the front corner), a later edge's label gives way to an earlier's.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { Range, Vec3 } from '../scene/types'
import { dropCrossEdgeCollisions, edgeLabels, edgeNormal, screenOf, TICK_LABEL_PUSH_PX, type EdgeTick } from './labels'
import { frameGeometryKey } from './key'
import { formatTick, tickIndex, ticks } from './ticks'
import type { FrameAxes, FrameAxis, FrameLabel, FrameLine, FrameModel } from './types'

// A tick mark's length, in world units (the box's longest half-extent is 1).
export const BOX_TICK_LENGTH = 0.04

type Axis = 0 | 1 | 2
const NAMES = ['x', 'y', 'z'] as const

function near(a: number, b: number, step: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(step, Math.abs(a), Math.abs(b))
}

// Tick values strictly inside a range: the ones at its ends are the wall outline.
function interior(values: readonly number[], r: Range, step: number): number[] {
  return values.filter((v) => !near(v, r.min, step) && !near(v, r.max, step))
}

function with3(p: Vec3, axis: Axis, value: number): Vec3 {
  const out: [number, number, number] = [p[0], p[1], p[2]]
  out[axis] = value
  return out
}

export function boxFrame(world: WorldMap, camera: CameraMatrices, axes: FrameAxes): FrameModel {
  const { box } = world
  const d = camera.direction
  const ranges: readonly Range[] = [box.x, box.y, box.z]
  const specs: readonly FrameAxis[] = [axes.x, axes.y, axes.z]

  const xBack = d[0] > 0 ? box.x.min : box.x.max
  const xFront = d[0] > 0 ? box.x.max : box.x.min
  const yBack = d[1] > 0 ? box.y.min : box.y.max
  const yFront = d[1] > 0 ? box.y.max : box.y.min
  const zFloor = d[2] >= 0 ? box.z.min : box.z.max

  const lines: FrameLine[] = []
  const tickValues = specs.map((s, i) => ticks(ranges[i], s.step, s.scale))

  // Wall outlines, each edge once (the three walls share the back corner's edges).
  const seen = new Set<string>()
  const edge = (a: Vec3, b: Vec3, role: FrameLine['role']) => {
    const ka = a.join(',')
    const kb = b.join(',')
    const key = `${role}|${ka < kb ? ka + '|' + kb : kb + '|' + ka}`
    if (seen.has(key)) return
    seen.add(key)
    lines.push({ a, b, role })
  }
  // A wall is the rectangle on plane `axis` = `at`, spanning the other two axes.
  const wall = (axis: Axis, at: number) => {
    const [u, v] = ([0, 1, 2] as Axis[]).filter((a) => a !== axis) as [Axis, Axis]
    const corner = (a: number, b: number) => with3(with3(with3([0, 0, 0], axis, at), u, a), v, b)
    const ru = ranges[u]
    const rv = ranges[v]
    edge(corner(ru.min, rv.min), corner(ru.max, rv.min), 'wall')
    edge(corner(ru.max, rv.min), corner(ru.max, rv.max), 'wall')
    edge(corner(ru.max, rv.max), corner(ru.min, rv.max), 'wall')
    edge(corner(ru.min, rv.max), corner(ru.min, rv.min), 'wall')
    // Gridlines: at each interior u tick a line across v, and vice versa.
    for (const t of interior(tickValues[u], ru, specs[u].step)) lines.push({ a: corner(t, rv.min), b: corner(t, rv.max), role: 'grid' })
    for (const t of interior(tickValues[v], rv, specs[v].step)) lines.push({ a: corner(ru.min, t), b: corner(ru.max, t), role: 'grid' })
  }
  wall(0, xBack)
  wall(1, yBack)
  wall(2, zFloor)

  // The z edge: the vertical edge whose projected x is smallest; a tie goes
  // to the corner nearest the eye.
  const zMid = (box.z.min + box.z.max) / 2
  let zEdge: [number, number] = [xFront, yFront]
  let bestX = Number.POSITIVE_INFINITY
  let bestDepth = Number.NEGATIVE_INFINITY
  for (const x of [box.x.min, box.x.max]) {
    for (const y of [box.y.min, box.y.max]) {
      const sx = screenOf(world, camera, [x, y, zMid]).x
      const w = world.toWorld([x, y, zMid])
      const depth = w[0] * d[0] + w[1] * d[1] + w[2] * d[2]
      if (sx < bestX - 1e-6 || (Math.abs(sx - bestX) <= 1e-6 && depth > bestDepth)) {
        bestX = sx
        bestDepth = depth
        zEdge = [x, y]
      }
    }
  }
  // z tick marks point outward along whichever of +-x, +-y runs further left.
  const xOut = zEdge[0] === box.x.max ? 1 : -1
  const yOut = zEdge[1] === box.y.max ? 1 : -1
  const right = camera.basis.right
  const zTickAxis: Axis = xOut * right[0] <= yOut * right[1] ? 0 : 1
  const zTickSign = zTickAxis === 0 ? xOut : yOut

  const markLength = (axis: Axis) => BOX_TICK_LENGTH / world.scale[axis]
  const edges: FrameLabel[][] = []
  const centre = screenOf(world, camera, world.centre)

  // One tick edge: the edge line, a mark per tick pointing outward along
  // `outAxis`, and the labels pushed away from the box centre.
  const tickEdge = (axis: Axis, base: Vec3, outAxis: Axis, outSign: number) => {
    const r = ranges[axis]
    const spec = specs[axis]
    const a = with3(base, axis, r.min)
    const b = with3(base, axis, r.max)
    lines.push({ a, b, role: 'tick' })
    const items: EdgeTick[] = []
    for (const v of tickValues[axis]) {
      const p = with3(base, axis, v)
      lines.push({ a: p, b: with3(p, outAxis, p[outAxis] + outSign * markLength(outAxis)), role: 'tick' })
      const index = tickIndex(v, spec.step)
      items.push({ key: `tick:${NAMES[axis]}:${index}`, position: p, text: formatTick(v, spec.authored, spec.step), index })
    }
    const sa = screenOf(world, camera, a)
    const sb = screenOf(world, camera, b)
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }
    const normal = edgeNormal(sa, sb, [mid.x - centre.x, mid.y - centre.y])
    const title = { key: `title:${NAMES[axis]}`, position: with3(base, axis, (r.min + r.max) / 2), text: spec.title }
    edges.push(edgeLabels(world, camera, items, normal, TICK_LABEL_PUSH_PX, title))
  }
  const ySign = yFront === box.y.max ? 1 : -1
  const xSign = xFront === box.x.max ? 1 : -1
  tickEdge(0, [0, yFront, zFloor], 1, ySign)
  tickEdge(1, [xFront, 0, zFloor], 0, xSign)
  tickEdge(2, [zEdge[0], zEdge[1], 0], zTickAxis, zTickSign)
  const labels = dropCrossEdgeCollisions(world, camera, edges)

  const key = [
    frameGeometryKey('box', world, axes),
    xBack === box.x.min ? 0 : 1,
    yBack === box.y.min ? 0 : 1,
    zFloor === box.z.min ? 0 : 1,
    zEdge[0] === box.x.min ? 0 : 1,
    zEdge[1] === box.y.min ? 0 : 1,
    zTickAxis,
  ].join(':')
  return { lines, labels, key }
}
