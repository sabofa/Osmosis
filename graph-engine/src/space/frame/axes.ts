// The textbook axes frame (plan G6, spec SP5 `@frame: axes`): three axes
// through the origin with arrowheads, short tick marks, small labels and the
// axis letters, the way OpenStax and Stewart draw most figures. Pure.
//
// - The axes cross at the origin, clamped into the box when it lies outside.
// - Each axis runs from the box min to 8% beyond the box max; the arrowhead
//   is drawn there by the arrow pipeline (role 'axis'), and the axis's
//   @titles text sits beyond the tip.
// - Tick marks are perpendicular to the axis, in whichever plane through it
//   faces the camera best; labels skip the crossing and are thinned like the
//   box frame's.

import type { CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { Range, Vec3 } from '../scene/types'
import { edgeLabels, edgeNormal, estimateLabelSize, halfExtentAlong, screenOf, type EdgeTick } from './labels'
import { frameGeometryKey } from './key'
import { formatFixedTick, formatTick, tickIndex, ticks } from './ticks'
import { TITLE_FONT_PX, type FrameAxes, type FrameAxis, type FrameLabel, type FrameLine, type FrameModel } from './types'

export const AXIS_OVERSHOOT = 0.08
// Half a tick mark, in world units.
export const AXIS_TICK_HALF = 0.025
// Axis tick labels sit closer than the box frame's: the mark is centred on the axis.
export const AXIS_LABEL_PUSH_PX = 8
// Where tick labels go relative to their axis on screen: below, a little to
// the left (so a vertical axis's labels sit on its left).
const LABEL_SIDE: readonly [number, number] = [-0.3, 1]
const LETTER_PUSH_PX = 8

type Axis = 0 | 1 | 2
const NAMES = ['x', 'y', 'z'] as const

function clampTo(v: number, r: Range): number {
  return Math.min(r.max, Math.max(r.min, v))
}

function with3(p: Vec3, axis: Axis, value: number): Vec3 {
  const out: [number, number, number] = [p[0], p[1], p[2]]
  out[axis] = value
  return out
}

export function axesFrame(world: WorldMap, camera: CameraMatrices, axes: FrameAxes): FrameModel {
  const { box } = world
  const d = camera.direction
  const ranges: readonly Range[] = [box.x, box.y, box.z]
  const specs: readonly FrameAxis[] = [axes.x, axes.y, axes.z]
  const origin: Vec3 = [clampTo(0, box.x), clampTo(0, box.y), clampTo(0, box.z)]

  const lines: FrameLine[] = []
  const labels: FrameLabel[] = []
  const tickAxes: Axis[] = []

  for (const axis of [0, 1, 2] as const) {
    const r = ranges[axis]
    const spec = specs[axis]
    const a = with3(origin, axis, r.min)
    const b = with3(origin, axis, r.max + AXIS_OVERSHOOT * (r.max - r.min))
    lines.push({ a, b, role: 'axis' })

    // The plane through this axis and axis j has the third axis k as its
    // normal; it faces the camera best when |d_k| is largest.
    const [j, k] = ([0, 1, 2] as Axis[]).filter((c) => c !== axis) as [Axis, Axis]
    const along: Axis = Math.abs(d[k]) >= Math.abs(d[j]) ? j : k
    tickAxes.push(along)
    const half = AXIS_TICK_HALF / world.scale[along]

    const items: EdgeTick[] = []
    // V1: a flat axis shows one tick, at its data value, in place of the step ladder.
    const values = spec.fixed !== null ? [spec.fixed] : ticks(r, spec.step, spec.scale)
    for (const v of values) {
      if (Math.abs(v - origin[axis]) <= 1e-9 * Math.max(spec.step, Math.abs(v))) continue
      const p = with3(origin, axis, v)
      lines.push({ a: with3(p, along, p[along] - half), b: with3(p, along, p[along] + half), role: 'tick' })
      const index = tickIndex(v, spec.step)
      // S6 fix round 1, M1: the flat axis's single tick (spec.fixed) is
      // labelled with the value's own digits, never the step's.
      const text = spec.fixed !== null ? formatFixedTick(v) : formatTick(v, spec.authored, spec.step)
      items.push({ key: `tick:${NAMES[axis]}:${index}`, position: p, text, index })
    }
    const sa = screenOf(world, camera, a)
    const sb = screenOf(world, camera, b)
    const normal = edgeNormal(sa, sb, LABEL_SIDE)
    labels.push(...edgeLabels(world, camera, items, normal, AXIS_LABEL_PUSH_PX, null))

    // The letter, beyond the tip along the axis's own screen direction.
    const ex = sb.x - sa.x
    const ey = sb.y - sa.y
    const len = Math.hypot(ex, ey)
    const dir: [number, number] = len > 1e-6 ? [ex / len, ey / len] : [0, -1]
    const size = estimateLabelSize(spec.title, TITLE_FONT_PX)
    const reach = LETTER_PUSH_PX + halfExtentAlong(dir, size)
    labels.push({ key: `title:${NAMES[axis]}`, position: b, screenOffset: [dir[0] * reach, dir[1] * reach], text: spec.title, role: 'title' })
  }

  return { style: 'axes', lines, labels, key: `${frameGeometryKey('axes', world, axes)}|${tickAxes.join('')}` }
}
