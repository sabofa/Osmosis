// The axis box (plan G3, S6 plan V1). Pure.
//
// 1. An authored @bounds3d axis wins, exactly as written, with no rounding.
// 2. Otherwise the axis comes from the scene's data extent, rounded outward to
//    multiples of the axis's authored @ticks3d step when it has one (so
//    x pi/2 over a surface on [-2pi, 2pi] stays [-2pi, 2pi]), else of
//    niceStep(span, 8).
// 3. With no data, [-5, 5].
// An axis with no informative span of its own — no data at all (null; a
// lone `region:`'s z never enters the extent, kernel/index.ts extentOf,
// because its floor depends on the resolved box), or a degenerate one (max -
// min < 1e-9 * max(1, |max|, |min|); vectors drawn in z = 0) — is "flat" when
// at least one other axis has a real span to measure against (V1). It
// becomes [v - s, v + s] with v the data's centre (0 with no data at all)
// and s = 0.05 x the largest other (authored or data) span, exactly — not
// rounded, so the renderer can show one tick at v (frame/ticks.ts
// frameAxes). Without a qualifying other axis (every axis empty or
// degenerate: nothing drawn, or a single point) it instead becomes [v - s, v
// + s] with s = 1, rounded like the others — v is 0 with no data anywhere.

import type { SpaceConfig, TickStep } from '../config'
import type { Box3, Range } from '../scene/types'
import { niceStep } from './nice'
import { TICK_TARGET } from './ticks'

const DEFAULT_RANGE: Range = { min: -5, max: 5 }

// V1's ratio of a flat axis's half-extent to the larger of the other axes'
// spans.
export const FLAT_SPAN_RATIO = 0.05

export type Axis = 'x' | 'y' | 'z'
const AXES: readonly Axis[] = ['x', 'y', 'z']
const NOTHING_SPANNING: Record<Axis, boolean> = { x: false, y: false, z: false }

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

interface RawAxes {
  raw: Record<Axis, Range | null>
  authored: Record<Axis, boolean>
}

function collectRaw(space: SpaceConfig, extent: Box3 | null): RawAxes {
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
  return { raw, authored }
}

function otherSpans(raw: Record<Axis, Range | null>, axis: Axis): number[] {
  return AXES.filter((a) => a !== axis)
    .map((a) => raw[a])
    .filter((o): o is Range => o !== null && !isDegenerate(o))
    .map((o) => o.max - o.min)
}

// True for an axis with nothing to size a box from by itself: no data (null)
// or a degenerate one.
function isThin(r: Range | null): boolean {
  return r === null || isDegenerate(r)
}

// Which axes get V1's flat-box treatment: not authored, thin (see isThin),
// not box-spanning (I1: a statement still to be built — a plane, an
// implicit surface, any of S4b's tools — will occupy it, so calling it flat
// now would carve a sliver out of geometry that is not flat), and at least
// one other axis with a real span to measure the thinness against. An
// authored axis never counts (it always wins exactly), and an extent with no
// qualifying other axis (nothing drawn, or every axis degenerate: a single
// point) falls back to the generic widening in resolveBox, not this rule.
export function flatAxes(space: SpaceConfig, extent: Box3 | null, spanning: Record<Axis, boolean> = NOTHING_SPANNING): Record<Axis, boolean> {
  const { raw, authored } = collectRaw(space, extent)
  const out: Record<Axis, boolean> = { x: false, y: false, z: false }
  // With no scene extent at all (nothing drawn), an axis with no data of its
  // own defaults to [-5, 5] like the others, even beside an axis some author
  // bound explicitly: there is no actual data confined to a plane to read as
  // "flat", only an unrelated author-chosen range.
  if (!extent) return out
  for (const axis of AXES) {
    if (authored[axis] || spanning[axis] || !isThin(raw[axis])) continue
    out[axis] = otherSpans(raw, axis).length > 0
  }
  return out
}

// S6 fix round 1, M1: a flat axis's single tick sits at "the data's z" —
// resolveBox's v, the box's own centre, which is correct whenever there
// really is data there (even a degenerate point: v is that point's own
// value, and the box is built symmetrically around it). The one exception
// is an axis with no data on it at all (raw is null: a lone `region:`,
// whose z never enters the extent) — resolveBox still has to put the box
// somewhere, and defaults its centre to 0, but the region itself shades the
// box's floor (kernel/integrals/common.ts floorHeight), not its centre. For
// that axis alone, frame/ticks.ts's frameAxes anchors the tick at the floor
// instead, so it still points at what is actually drawn. Only meaningful
// where flatAxes is also true; harmless (unused) elsewhere.
export function flatFloor(space: SpaceConfig, extent: Box3 | null): Record<Axis, boolean> {
  const out: Record<Axis, boolean> = { x: false, y: false, z: false }
  // Nothing drawn at all: flatAxes never flags a floor-anchored axis here
  // either (its own identical guard), so this stays consistent with it,
  // though unused either way.
  if (!extent) return out
  const { raw } = collectRaw(space, extent)
  for (const axis of AXES) out[axis] = raw[axis] === null
  return out
}

export function resolveBox(space: SpaceConfig, extent: Box3 | null, spanning: Record<Axis, boolean> = NOTHING_SPANNING): Box3 {
  const { raw, authored } = collectRaw(space, extent)
  const flat = flatAxes(space, extent, spanning)

  const out = {} as Record<Axis, Range>
  for (const axis of AXES) {
    const r = raw[axis]
    if (authored[axis] && r) {
      out[axis] = { min: r.min, max: r.max }
    } else if (flat[axis]) {
      const s = FLAT_SPAN_RATIO * Math.max(...otherSpans(raw, axis))
      const v = r ? (r.min + r.max) / 2 : 0
      out[axis] = { min: v - s, max: v + s }
    } else if (!r) {
      out[axis] = { ...DEFAULT_RANGE }
    } else if (isDegenerate(r)) {
      const others = otherSpans(raw, axis)
      const s = others.length > 0 ? Math.max(...others) / 2 : 1
      const v = (r.min + r.max) / 2
      out[axis] = roundOut({ min: v - s, max: v + s }, space.ticks[axis])
    } else {
      out[axis] = roundOut(r, space.ticks[axis])
    }
  }
  return out
}
