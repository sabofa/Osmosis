// The dense-sample discontinuity check (calc P2, final review fix I7): is a drawn segment a bridge over a jump of the
// true curve?
//
// The corpus's other checks cannot say. A vertex is asked against the true curve at its own parameter, and a chord at
// ONE point of it against the true curve's polyline of eight pieces; a segment that runs across a staircase of jumps
// (floor(1000x) is 40 px steps 0.04 px wide, which a 480 px chord covers a dozen of) has its ends on the curve, and the
// polyline of the curve beside it is the same chord, because connecting samples across a jump IS the bridge. What tells
// a bridge is the jump itself: the true curve sampled densely over the segment's parameter span has two neighbouring
// samples further apart than a smooth curve's are, and bisecting the pair does not close the gap.
//
//  - A segment's span is sampled at `samples` + 1 parameters (its ends too, unless an end is an anchor or on the clip
//    box, where the segment was never the curve's).
//  - Two neighbouring samples more than `jumpPx` apart on screen are bisected (both halves, a half only while its own
//    gap is still over jumpPx): a smooth curve's gap halves at each level, however steep, and a jump's does not, so a gap
//    that is still there at the width of the doubles is a discontinuity of that size.
//  - A sample that is not finite is "undefined inside the segment": as far off as can be.
// A jump under jumpPx is allowed: the sampler bridges a jump under a pixel, on purpose (adaptive.ts, the floor test).
//
// It costs `samples` evaluations a segment, so a case with expensive points checks a stride of its segments, and the
// longer ones always (a bridge is a long stroke).
import type { Bounds, Chain, SceneObject, Vec2 } from '../../scene/types'

export const DENSE = {
  // samples over a segment's span (the segments are at most 16 px long: a sample every half pixel of chord)
  samples: 32,
  // the gap two neighbouring samples may have, and a jump may be: the sampler's own gapPx (1) and its margin
  jumpPx: 2,
  // a segment at least this long (px) is always checked, whatever the stride
  alwaysPx: 3,
  // the width a bisection stops at, relative to the parameter (at least 1e-3 of it): the doubles' own
  floorRel: 1e-13,
}

export type Truth = (t: number) => Vec2

const finite = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y)
const gapPx = (a: Vec2, b: Vec2, px: Vec2) => Math.hypot((a.x - b.x) * px.x, (a.y - b.y) * px.y)

// The size (px) of the discontinuity between two finite points of the true curve at ta < tb, or 0 if there is none a
// bisection does not close; Infinity if the curve is not finite in between.
function persisting(truth: Truth, ta: number, tb: number, a: Vec2, b: Vec2, px: Vec2, jumpPx: number): number {
  const gap = gapPx(a, b, px)
  if (!(gap > jumpPx)) return 0
  const tm = ta + (tb - ta) / 2
  if (!(tm > ta && tm < tb) || tb - ta <= DENSE.floorRel * Math.max(Math.abs(ta), Math.abs(tb), 1e-3)) return gap
  const m = truth(tm)
  if (!finite(m)) return Number.POSITIVE_INFINITY
  const left = persisting(truth, ta, tm, a, m, px, jumpPx)
  return left > 0 ? left : persisting(truth, tm, tb, m, b, px, jumpPx)
}

// The biggest discontinuity of the true curve inside the span [ta, tb] of one segment (0: none), the span's end not
// asked where `skipA` / `skipB` say the segment's end is not the curve's. Infinity: undefined inside.
export function bridgeInside(truth: Truth, ta: number, tb: number, px: Vec2, skipA = false, skipB = false, samples: number = DENSE.samples, jumpPx: number = DENSE.jumpPx): number {
  let prev: Vec2 | null = null
  let prevT = ta
  for (let k = skipA ? 1 : 0; k <= (skipB ? samples - 1 : samples); k++) {
    const t = k === 0 ? ta : k === samples ? tb : ta + ((tb - ta) * k) / samples
    const p = truth(t)
    if (!finite(p)) return Number.POSITIVE_INFINITY
    if (prev !== null) {
      const size = persisting(truth, prevT, t, prev, p, px, jumpPx)
      if (size > 0) return size
    }
    prev = p
    prevT = t
  }
  return 0
}

// Which ends of segments are not the true curve's, for `firstBridge`'s `skip`: a vertex at a parameter the sampler typed
// (a break of the statement's curve, or for an explicit curve the independent coordinate of one of its marks) is a limit
// the structure walk read, not where the expression takes its value; and one on the clip box is where the sink cut the
// curve, with a parameter interpolated along the segment it cut.
export function anchorSkip(objects: readonly SceneObject[], statement: number, independent: 'x' | 'y' | null, clip: Bounds): (t: number, p: Vec2) => boolean {
  const anchors: number[] = []
  for (const o of objects) {
    if (o.kind === 'curve' && o.id.statement === statement) for (const b of o.breaks) anchors.push(b.at)
    if (o.kind === 'mark' && o.id.statement === statement && independent !== null) anchors.push(independent === 'x' ? o.at.x : o.at.y)
  }
  const tolX = 1e-9 * (clip.xMax - clip.xMin)
  const tolY = 1e-9 * (clip.yMax - clip.yMin)
  return (t, p) => anchors.some((a) => Math.abs(a - t) <= 1e-9 * Math.max(1, Math.abs(t))) || Math.abs(p.x - clip.xMin) <= tolX || Math.abs(p.x - clip.xMax) <= tolX || Math.abs(p.y - clip.yMin) <= tolY || Math.abs(p.y - clip.yMax) <= tolY
}

export interface Bridge {
  // the size of the worst bridge found (px; 0 none, Infinity undefined inside)
  size: number
  // the parameters of its segment
  from: number
  to: number
  // how many segments were checked
  checked: number
}

// The first segment of the chains that bridges a jump, or `size: 0`. `skip` says an end of a segment is not the curve's:
// an anchor (a limit the structure walk read, or where the curve was cut at the clip box). `maxSegments`: at most this
// many segments are checked, by a stride (and every segment of `DENSE.alwaysPx` or more).
export function firstBridge(chains: readonly Chain[], truth: Truth, px: Vec2, skip: (t: number, p: Vec2) => boolean, maxSegments = Number.POSITIVE_INFINITY): Bridge {
  let total = 0
  for (const chain of chains) total += Math.max(0, chain.param.length - 1)
  const stride = Math.max(1, Math.ceil(total / maxSegments))
  let n = 0
  let checked = 0
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.param.length; i++, n++) {
      const a = { x: chain.xy[2 * i], y: chain.xy[2 * i + 1] }
      const b = { x: chain.xy[2 * i + 2], y: chain.xy[2 * i + 3] }
      if (n % stride !== 0 && gapPx(a, b, px) < DENSE.alwaysPx) continue
      checked++
      const ta = chain.param[i]
      const tb = chain.param[i + 1]
      const size = bridgeInside(truth, ta, tb, px, skip(ta, a), skip(tb, b))
      if (size > 0) return { size, from: ta, to: tb, checked }
    }
  }
  return { size: 0, from: Number.NaN, to: Number.NaN, checked }
}
