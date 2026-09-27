// The axis box (plan G3). Pure.
//
// 1. An authored @bounds3d axis wins, exactly as written, with no rounding.
// 2. Otherwise the axis comes from the scene's data extent, rounded outward to
//    multiples of the axis's authored @ticks3d step when it has one (so
//    x pi/2 over a surface on [-2pi, 2pi] stays [-2pi, 2pi]), else of
//    niceStep(span, 8).
// 3. With no data, [-5, 5].
// A degenerate data span (max - min < 1e-9 * max(1, |max|, |min|)) becomes
// [v - s, v + s], where s is half the largest non-degenerate span among the
// other axes (authored or data), or 1 if they are all degenerate; it is then
// rounded like the others.

import type { SpaceConfig, TickStep } from '../config'
import type { Box3, Range } from '../scene/types'
import { niceStep } from './nice'
import { TICK_TARGET } from './ticks'

const DEFAULT_RANGE: Range = { min: -5, max: 5 }

type Axis = 'x' | 'y' | 'z'
const AXES: readonly Axis[] = ['x', 'y', 'z']

function isDegenerate(r: Range): boolean {
  return r.max - r.min < 1e-9 * Math.max(1, Math.abs(r.max), Math.abs(r.min))
}

function isFiniteRange(r: Range): boolean {
  return Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min
}

// Outward to multiples of the step (the authored one, else the nice one),
// with a 1e-9 step tolerance so a bound already on a multiple (0.3 / 0.1 =
// 2.9999999999999996) is not pushed out.
function roundOut(r: Range, authored: TickStep | null): Range {
  const step = authored && authored.value > 0 && Number.isFinite(authored.value) ? authored.value : niceStep(r.max - r.min, TICK_TARGET)
  return {
    min: Math.floor(r.min / step + 1e-9) * step,
    max: Math.ceil(r.max / step - 1e-9) * step,
  }
}

export function resolveBox(space: SpaceConfig, extent: Box3 | null): Box3 {
  const raw: Record<Axis, Range | null> = { x: null, y: null, z: null }
  const authored: Record<Axis, boolean> = { x: false, y: false, z: false }
  for (const axis of AXES) {
    const written = space.bounds[axis]
    if (written) {
      raw[axis] = written
      authored[axis] = true
    } else if (extent && isFiniteRange(extent[axis])) {
      raw[axis] = extent[axis]
    }
  }

  const out = {} as Record<Axis, Range>
  for (const axis of AXES) {
    const r = raw[axis]
    if (authored[axis] && r) {
      out[axis] = { min: r.min, max: r.max }
    } else if (!r) {
      out[axis] = { ...DEFAULT_RANGE }
    } else if (isDegenerate(r)) {
      const others = AXES.filter((a) => a !== axis)
        .map((a) => raw[a])
        .filter((o): o is Range => o !== null && !isDegenerate(o))
        .map((o) => o.max - o.min)
      const s = others.length > 0 ? Math.max(...others) / 2 : 1
      const v = (r.min + r.max) / 2
      out[axis] = roundOut({ min: v - s, max: v + s }, space.ticks[axis])
    } else {
      out[axis] = roundOut(r, space.ticks[axis])
    }
  }
  return out
}
