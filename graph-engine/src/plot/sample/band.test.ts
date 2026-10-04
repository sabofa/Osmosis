import { describe, expect, it } from 'vitest'
import { compileInterval, CONTINUOUS, iv, PARTIAL } from '../../math/interval'
import { chainPoints } from '../../scene/chains'
import type { Bounds, Chain, SceneObject } from '../../scene/types'
import { sampleRange } from './adaptive'
import { BandSink, largestStep, oscillates } from './band'
import { sampleCurve, type CurveSpec } from './curve'
import { ChainSink } from './sink'
import { expr, fnsOf, scopeOf, trueY, view as wideScreen } from './testkit'
import { BAND, COARSE, FULL, type Tuning } from './tuning'
import type { EvalCounter } from './types'

type BandObject = Extract<SceneObject, { kind: 'band' }>
type CurveObject = Extract<SceneObject, { kind: 'curve' }>
interface Column {
  t0: number
  t1: number
  lo: number
  hi: number
}

// [-1, 1] x [-1.5, 1.5] at 800 x 1200 px: 400 px per unit on both axes.
const tall = { bounds: { xMin: -1, xMax: 1, yMin: -1.5, yMax: 1.5 }, widthPx: 800, heightPx: 1200 }
// [-10, 10]^2 at 800 px: 40 px per unit.
const wide = { bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, widthPx: 800, heightPx: 800 }

const explicit = (body: string, independent: 'x' | 'y' = 'x'): CurveSpec => ({ kind: 'explicit', independent, body: expr(body), domain: null })
const sample = (spec: CurveSpec, v = tall, quality: 'full' | 'coarse' = 'full', color: string | null = null) => sampleCurve(spec, v, scopeOf(), { statement: 3, color, asymptotes: true, quality })
const bandsOf = (objs: SceneObject[]) => objs.filter((o) => o.kind === 'band') as BandObject[]
const curveOf = (objs: SceneObject[]) => objs.find((o) => o.kind === 'curve') as CurveObject

// The columns a band's outline stands for. The outline is a staircase, orthogonal all the way: along the
// top in increasing t, one horizontal run per column, then back along the bottom. So a column is a
// horizontal run of the top with the run of the bottom over the same t, and the vertical steps are
// skipped.
function columnsOf(band: BandObject, axis: 'y' | 'x' = 'y'): Column[] {
  const chain = band.outline[0]
  const n = chain.param.length
  const value = (i: number) => chain.xy[2 * i + (axis === 'y' ? 1 : 0)]
  const top: { t0: number; t1: number; hi: number }[] = []
  const bottom: { t0: number; t1: number; lo: number }[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a = chain.param[i]
    const b = chain.param[j]
    if (a === b || value(i) !== value(j)) continue
    if (a < b) top.push({ t0: a, t1: b, hi: value(i) })
    else bottom.push({ t0: b, t1: a, lo: value(i) })
  }
  bottom.reverse()
  expect(bottom.map((c) => [c.t0, c.t1])).toEqual(top.map((c) => [c.t0, c.t1]))
  return top.map((c, i) => ({ t0: c.t0, t1: c.t1, lo: bottom[i].lo, hi: c.hi }))
}

const pointsOf = (c: Chain) => Array.from({ length: c.param.length }, (_, i) => [c.xy[2 * i], c.xy[2 * i + 1]])

describe('oscillates', () => {
  const o = (values: number[], minTurns = 2) => oscillates(Float64Array.from(values), values.length, minTurns)
  it('is false for a monotone run, whether or not it stalls', () => {
    expect(o([0, 1, 2, 3, 4])).toBe(false)
    expect(o([4, 3, 2, 1, 0])).toBe(false)
    expect(o([0, 1, 1, 1, 2, 2])).toBe(false)
    expect(o([5, 5, 5, 5])).toBe(false)
    expect(o([])).toBe(false)
  })
  it('is false for one turn and true for two', () => {
    expect(o([0, 1, 0])).toBe(false)
    expect(o([0, 1, 2, 1, 0])).toBe(false)
    expect(o([0, 1, 0, 1])).toBe(true)
    expect(o([1, 0, 1, 0])).toBe(true)
    expect(o([0, 3, 1, 2])).toBe(true)
  })
  it('does not count a stall as a turn, nor lose a turn to one', () => {
    expect(o([0, 1, 1, 0, 0, 1])).toBe(true)
    expect(o([0, 1, 1, 1, 0])).toBe(false)
  })
  it('skips values that are not finite', () => {
    expect(o([0, Number.NaN, 1, 0, Number.NaN, 1])).toBe(true)
    expect(o([0, Number.NaN, 1, Number.NaN, 0])).toBe(false)
    expect(o([0, Number.POSITIVE_INFINITY, 1, Number.NEGATIVE_INFINITY, 0])).toBe(false)
    expect(o([Number.NaN, Number.NaN, Number.NaN])).toBe(false)
  })
  it('reads only `count` values, and the number of turns asked for is a parameter', () => {
    expect(oscillates(Float64Array.from([0, 1, 0, 1]), 3, 2)).toBe(false)
    expect(oscillates(Float64Array.from([0, 1, 0, 1]), 4, 2)).toBe(true)
    expect(o([0, 1, 0], 1)).toBe(true)
    expect(o([0, 1, 0, 1], 3)).toBe(false)
    expect(o([0, 1, 0, 1, 0], 3)).toBe(true)
  })
})

describe('oscillates, the largest step read as a stall', () => {
  const o = (values: number[], minTurns = 2) => oscillates(Float64Array.from(values), values.length, minTurns, true)
  it('a jump against the slope is up, down, up and not an oscillation', () => {
    const jump = [0, 1, 2, 3, -4, -3, -2, -1]
    expect(oscillates(Float64Array.from(jump), jump.length, 2)).toBe(true)
    expect(o(jump)).toBe(false)
    // a pole is a step too: up to a huge value and back from a hugely negative one
    expect(o([0, 1, 2, 3, 1e9, -1e9, -3, -2])).toBe(false)
    // and a jump the other way
    expect(o([3, 2, 1, 0, 10, 9, 8, 7])).toBe(false)
  })
  it('an oscillation is many steps and keeps its turns, though it loses one step', () => {
    expect(o([0, 1, 0, 1, 0, 1, 0, 1])).toBe(true)
    expect(o([0, 5, 1, 4, 2, 3, 2, 4, 1])).toBe(true)
  })
  it('a short one loses what the step took: one turn after it is one turn', () => {
    expect(o([0, 1, 0, 1])).toBe(false)
    expect(o([0, 1, 0, 1], 1)).toBe(true)
  })
  it('skips values that are not finite when it looks for the step, and a flat run has no step to skip', () => {
    expect(o([0, Number.NaN, 5, 0, 5, 0, 5])).toBe(true)
    expect(o([2, 2, 2, 2])).toBe(false)
  })
})

describe('largestStep', () => {
  const at = (values: number[], count = values.length) => largestStep(Float64Array.from(values), count)
  it('is the index of the value the biggest step between neighbours ends at', () => {
    expect(at([0, 1, 2, -5, -4])).toBe(3)
    expect(at([0, 1, 9, 0], 3)).toBe(2)
  })
  it('is the first of two as big', () => {
    expect(at([0, 1, 0])).toBe(1)
  })
  it('steps over values that are not finite, from the last that was to the next', () => {
    expect(at([0, Number.NaN, 5, 5.5])).toBe(2)
  })
  it('is -1 where there is no step', () => {
    expect(at([3, 3, 3])).toBe(-1)
    expect(at([1])).toBe(-1)
    expect(at([])).toBe(-1)
    expect(at([Number.NaN, 2, Number.NaN])).toBe(-1)
  })
})

describe('BandSink', () => {
  const clip: Bounds = { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }

  it('merges adjacent columns into one band, and a gap starts another', () => {
    const s = new BandSink('y', clip)
    s.column(0, 1, -1, 1)
    s.column(1, 2, -2, 2)
    s.column(3, 4, 0, 1)
    const bands = s.bands()
    expect(bands).toHaveLength(2)
    // each band's outline is one closed chain
    expect(bands.map((b) => b.length)).toEqual([1, 1])
    expect(bands.every((b) => b[0].closed)).toBe(true)
    expect(Array.from(bands[0][0].param)).toEqual([0, 1, 1, 2, 2, 1, 1, 0])
  })

  it('outlines along the top in increasing t, then back along the bottom, the parameter at each vertex', () => {
    const s = new BandSink('y', clip)
    s.column(0, 1, -1, 1)
    s.column(1, 2, -2, 3)
    const [chain] = s.bands()[0]
    expect(pointsOf(chain)).toEqual([[0, 1], [1, 1], [1, 3], [2, 3], [2, -2], [1, -2], [1, -1], [0, -1]])
    expect(Array.from(chain.param)).toEqual([0, 1, 1, 2, 2, 1, 1, 0])
  })

  it('does not repeat a vertex where adjacent columns are as high as each other', () => {
    const s = new BandSink('y', clip)
    s.column(0, 1, -1, 1)
    s.column(1, 2, -1, 1)
    const [chain] = s.bands()[0]
    expect(pointsOf(chain)).toEqual([[0, 1], [1, 1], [2, 1], [2, -1], [1, -1], [0, -1]])
  })

  it('for x = f(y) the oscillation is along x and the parameter is y', () => {
    const s = new BandSink('x', clip)
    s.column(0, 1, -1, 1)
    s.column(1, 2, -2, 3)
    const [chain] = s.bands()[0]
    expect(pointsOf(chain)).toEqual([[1, 0], [1, 1], [3, 1], [3, 2], [-2, 2], [-2, 1], [-1, 1], [-1, 0]])
    expect(Array.from(chain.param)).toEqual([0, 1, 1, 2, 2, 1, 1, 0])
  })

  it('clips to the box: a column is cut at it, and one wholly outside is not a column', () => {
    const s = new BandSink('y', clip)
    s.column(0, 1, -30, 30)
    s.column(2, 3, 20, 30)
    s.column(4, 5, -30, -20)
    s.column(14, 16, -1, 1)
    s.column(16, 17, -1, 1)
    const bands = s.bands()
    expect(bands).toHaveLength(2)
    expect(pointsOf(bands[0][0])).toEqual([[0, 15], [1, 15], [1, -15], [0, -15]])
    expect(Math.max(...bands[1][0].param)).toBe(15)
  })

  it('ignores a column that is not a column: not finite, or no width, or no height', () => {
    const s = new BandSink('y', clip)
    s.column(Number.NaN, 1, 0, 1)
    s.column(0, Number.POSITIVE_INFINITY, 0, 1)
    s.column(1, 1, 0, 1)
    s.column(2, 1, 0, 1)
    s.column(0, 1, Number.NaN, 1)
    s.column(0, 1, 0, Number.NaN)
    s.column(0, 1, 2, 1)
    s.column(0, 1, 1, 1)
    expect(s.bands()).toEqual([])
  })

  it('reading does not end a band, and each read is the same outline', () => {
    const s = new BandSink('y', clip)
    s.column(0, 1, -1, 1)
    const first = s.bands()
    s.column(1, 2, -2, 2)
    const second = s.bands()
    expect(first).toHaveLength(1)
    expect(first[0][0].param).toHaveLength(4)
    expect(second).toHaveLength(1)
    expect(Array.from(second[0][0].param)).toEqual([0, 1, 1, 2, 2, 1, 1, 0])
    expect(s.bands()).toEqual(second)
  })
})

describe('bands from sampleCurve', () => {
  it('sin(1/x) has a band around 0, within [-1, 1] and reaching both, with no chain vertex in it', () => {
    const r = sample(explicit('sin(1/x)'))
    const around = bandsOf(r.objects).filter((b) => columnsOf(b).some((c) => c.t0 <= 0 && c.t1 >= 0))
    expect(around).toHaveLength(1)
    const cols = columnsOf(around[0])
    const tMin = Math.min(...cols.map((c) => c.t0))
    const tMax = Math.max(...cols.map((c) => c.t1))
    expect(tMin).toBeLessThan(-0.01)
    expect(tMax).toBeGreaterThan(0.01)
    expect(Math.min(...cols.map((c) => c.lo))).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeLessThanOrEqual(1)
    expect(Math.min(...cols.map((c) => c.lo))).toBeLessThan(-0.99)
    expect(Math.max(...cols.map((c) => c.hi))).toBeGreaterThan(0.99)
    // nothing drawn through it: the chains stop at the band and start again after it
    for (const c of curveOf(r.objects).chains) for (let i = 0; i < c.param.length; i++) expect(c.xy[2 * i] <= tMin || c.xy[2 * i] >= tMax, `a chain vertex at ${c.xy[2 * i]}`).toBe(true)
    // and the curve is still drawn where it does not oscillate faster than a pixel
    expect(curveOf(r.objects).chains.length).toBeGreaterThan(0)
  })

  it('x sin(1/x): a band shrinks toward 0, each column no taller than its envelope', () => {
    const r = sample(explicit('x sin(1/x)'))
    const cols = bandsOf(r.objects).flatMap((b) => columnsOf(b))
    expect(cols.length).toBeGreaterThan(10)
    for (const c of cols) {
      // The column's nearest |t| (0 if it holds 0). |x sin(1/x)| <= |x|, so the extent is at most 2 |t| at the
      // column's far edge, and a pixel wide (the 2 px of slack, at 400 px per unit) further out than its near one
      const near = c.t0 <= 0 && c.t1 >= 0 ? 0 : Math.min(Math.abs(c.t0), Math.abs(c.t1))
      expect(c.hi - c.lo, `column at ${c.t0}`).toBeLessThanOrEqual(2 * near + 2 / 400)
    }
    // it is a funnel: the columns nearest 0 are shorter than those furthest from it
    const near = cols.filter((c) => Math.abs(c.t0) < 0.004).map((c) => c.hi - c.lo)
    const far = cols.filter((c) => Math.abs(c.t0) > 0.012).map((c) => c.hi - c.lo)
    expect(near.length).toBeGreaterThan(0)
    expect(far.length).toBeGreaterThan(0)
    expect(Math.max(...near)).toBeLessThan(Math.max(...far))
  })

  it('sin(50x) over [-10, 10] at 800 px has no band: its period is 5 px', () => {
    const r = sample(explicit('sin(50x)'), wide)
    expect(bandsOf(r.objects)).toEqual([])
    expect(r.objects).toHaveLength(1)
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })

  it('sin(500x) over [-10, 10] at 800 px is one band across the view, y in [-1, 1]', () => {
    const r = sample(explicit('sin(500x)'), wide)
    const bands = bandsOf(r.objects)
    expect(bands).toHaveLength(1)
    const cols = columnsOf(bands[0])
    expect(Math.min(...cols.map((c) => c.t0))).toBeLessThanOrEqual(-10)
    expect(Math.max(...cols.map((c) => c.t1))).toBeGreaterThanOrEqual(10)
    // every column is adjacent to the next, and about a pixel wide
    for (let i = 1; i < cols.length; i++) expect(cols[i].t0).toBe(cols[i - 1].t1)
    // (a pixel to rounding: halving a 4 px interval twice is a pixel and a hair, about one time in three)
    for (const c of cols) expect((c.t1 - c.t0) * 40).toBeLessThanOrEqual(1 + 1e-9)
    expect(Math.min(...cols.map((c) => c.lo))).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeLessThanOrEqual(1)
    expect(Math.min(...cols.map((c) => c.lo))).toBeLessThan(-0.99)
    expect(Math.max(...cols.map((c) => c.hi))).toBeGreaterThan(0.99)
    // it is the picture, and not a smear of ink on top of it
    expect(curveOf(r.objects).chains).toEqual([])
    // and it is not a hit on the budget, which it used to be
    expect(r.capped).toBe(false)
  })

  // calc P2 task 8, fix round 1: a flat curve whose scalar value is a constant plus rounding noise (the twin cannot see
  // the cancellation, so its enclosure is loose and the column is tried) turns round in its samples, and was a band of
  // 1e-14 px: invisible, over 92 % of the width, with no message.
  it.each(['(x + 1)^2 - x^2 - 2x', '(x^2 - 1)/(x - 1) - x', 'cosh(x)^2 - sinh(x)^2'])('%s, which is the line y = 1, is one chain across the view and no band', (body) => {
    const r = sample(explicit(body), wide)
    expect(bandsOf(r.objects)).toEqual([])
    const chains = curveOf(r.objects).chains
    expect(chains).toHaveLength(1)
    const xs = chainPoints(chains[0]).map((p) => p.x)
    expect(Math.min(...xs)).toBeLessThanOrEqual(-10)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(10)
    for (const p of chainPoints(chains[0])) expect(Math.abs(p.y - 1) * 40, `${body} at ${p.x}`).toBeLessThan(0.25)
    expect(r.capped).toBe(false)
  })
  it('a wave under a quarter of a pixel from crest to trough is not a band, and one of 8 px is', () => {
    // 0.25 px is flatPx: a column whose samples span under it is flat, however often they turn (at 40 px a unit, 0.002 is
    // 0.16 px from crest to trough). The cancelling term loosens the enclosure, so the columns are tried at all.
    expect(bandsOf(sample(explicit('exp(x^2) - exp(x^2) + 0.002 sin(500x)'), wide).objects)).toEqual([])
    expect(bandsOf(sample(explicit('exp(x^2) - exp(x^2) + 0.1 sin(500x)'), wide).objects).length).toBeGreaterThan(0)
  })

  it('a band across a view is not cut by columns whose ends happen to sit at its extremes', () => {
    // 363 x is about 9.1 rad over a pixel, near 3 pi: the two ends of a column are close to mirror
    // images, and for some columns both are at the extremes, where the twin's enclosure is no taller
    // than the ends and the column looks like a steep stroke (it was 115 bands when a certified column
    // was left out as one; a certified column is tried now, and its stroke is drawn from its samples).
    for (const w of [363, 370]) {
      const r = sample(explicit(`sin(${w}x)`), wide)
      expect(bandsOf(r.objects), `sin(${w}x)`).toHaveLength(1)
      expect(curveOf(r.objects).chains, `sin(${w}x)`).toEqual([])
    }
  })

  it('where the curve is not defined half the time it is a band of what is defined: sqrt(sin(500x))', () => {
    const r = sample(explicit('sqrt(sin(500x))'), wide)
    const bands = bandsOf(r.objects)
    expect(bands).toHaveLength(1)
    const cols = columnsOf(bands[0])
    expect(Math.min(...cols.map((c) => c.lo))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...cols.map((c) => c.hi))).toBeLessThanOrEqual(1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeGreaterThan(0.95)
    expect(curveOf(r.objects).chains).toEqual([])
  })

  it('a column beside a band needs one turn, not two: a period of 1 to 2 px is one band, not a hundred with chains between', () => {
    // sin(200x) was 446 bands and 446 chains, capped at FULL (30155 intervals): half the columns hold two turns
    // of it and half one, and a band that stopped at every one of the second kind was a band and a chain, alternately
    for (const w of [150, 180, 200, 230]) {
      const r = sample(explicit(`sin(${w}x)`), wide)
      expect(bandsOf(r.objects), `sin(${w}x)`).toHaveLength(1)
      expect(r.capped, `sin(${w}x)`).toBe(false)
      // what the columns before the first with two turns are: a pixel or three of the overscan, off the view
      for (const c of curveOf(r.objects).chains) for (let i = 0; i < c.param.length; i++) expect(Math.abs(c.xy[2 * i]) > 10, `sin(${w}x) chain at ${c.xy[2 * i]}`).toBe(true)
    }
  })

  it('a period of 2.5 px is not a band, and is not capped either: it is drawn from its samples', () => {
    const r = sample(explicit('sin(100x)'), wide)
    expect(bandsOf(r.objects)).toEqual([])
    expect(r.capped).toBe(false)
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })

  it('the steps of a staircase are not tried for a band: round(5 sin(20x)) is not capped by them', () => {
    // each step is a column the twin cannot certify and whose ends are the span of its enclosure; capped at FULL (60005
    // points) when each took its samples
    const r = sample(explicit('round(5 sin(20x))'), wide)
    expect(bandsOf(r.objects)).toEqual([])
    expect(r.capped).toBe(false)
  })

  it('a pole or a jump the structure walk did not find is not swallowed by a band: its break is kept', () => {
    // a jump against the slope is up, down, up: two turns that no oscillation made. These are sums whose poles and
    // jumps the walk cannot locate (a loop bounded by a @param); the jump test finds them, and a band over one
    // would be a full-height bar with no break
    const at = (breaks: { at: number }[], t: number) => breaks.some((b) => Math.abs(b.at - t) < 0.03)
    const cases: [string, string, number[]][] = [
      ['sum(k = 1 to n, 1/(x - k - 0.0123))', '@param n = 5 range [1, 10]', [1.0123, 2.0123, 3.0123, 4.0123, 5.0123]],
      ['sum(k = 1 to n, -1/(x - k - 0.0123))', '@param n = 5 range [1, 10]', [1.0123, 2.0123, 3.0123, 4.0123, 5.0123]],
      ['sum(k = 1 to n, sign(x - k - 0.0123)) - 4x', '@param n = 3 range [1, 10]', [1.0123, 2.0123, 3.0123]],
      ['sum(k = 1 to n, 3 x/n - floor(x - k - 0.0123))', '@param n = 3 range [1, 10]', [1.0123, 2.0123, 3.0123]],
    ]
    for (const [body, defs, spots] of cases) {
      const r = sampleCurve(explicit(body), wide, scopeOf(defs), { statement: 0, color: null, asymptotes: true, quality: 'full' })
      expect(bandsOf(r.objects), body).toEqual([])
      for (const t of spots) expect(at(curveOf(r.objects).breaks, t), `${body}: a break at ${t}`).toBe(true)
    }
  })

  it('a jump the walk did not find, inside an oscillation, is a break between two bands and not a bar over it', () => {
    // sin(500x) is 2 high and the jump is 10: the samples either side of it have no value in common, so the column
    // that holds it is two, and the jump is a break (the same one the core would have left it, had the column not
    // been a band). It drew a column [-5.9, 6.0] across the jump and no break.
    const spots = [1.0123, 2.0123, 3.0123]
    const r = sampleCurve(explicit('sin(500x) + sum(k = 1 to n, 5 sign(x - k - 0.0123))'), wide, scopeOf('@param n = 3 range [1, 10]'), { statement: 0, color: null, asymptotes: true, quality: 'full' })
    const cols = bandsOf(r.objects).flatMap((b) => columnsOf(b))
    for (const t of spots) {
      expect(curveOf(r.objects).breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - t) < 0.03), `a jump break at ${t}`).toBe(true)
      expect(cols.some((c) => c.t0 < t && c.t1 > t), `a column over ${t}`).toBe(false)
    }
    expect(Math.max(...cols.map((c) => c.hi - c.lo))).toBeLessThan(3)
    expect(r.capped).toBe(false)
  })

  // the worst a drawn chain's segment middle is off the curve, in px, over the view [-10, 10]: a false line is tens
  const worstSegment = (text: string, objs: SceneObject[]) => {
    const f = trueY(text, scopeOf())
    let worst = 0
    for (const c of curveOf(objs).chains) {
      const p = chainPoints(c)
      for (let i = 1; i < p.length; i++) {
        const mx = (p[i - 1].x + p[i].x) / 2
        if (Math.abs(mx) <= 10) worst = Math.max(worst, Math.abs(f(mx) - (p[i - 1].y + p[i].y) / 2) * 40)
      }
    }
    return worst
  }

  it('an oscillation at a lattice resonance is a band like any other: sin(w x) near w = 3770 and 7540, 1759 at COARSE', () => {
    // equally spaced samples (16 a pixel at FULL, which is 1/15 px; 8 at COARSE, 1/7 px) step over whole periods of
    // sin(w x) for w near a multiple of 2 pi times 600 (40 px per unit; 2 pi times 280 at COARSE) and see no turn: no
    // band, an aliased curve, and the core, sampling at the same spacing, capped (20 of 239 frequencies at FULL, 92 of
    // 539 at COARSE) with false segments up to 80 px off. The inner samples are jittered, so they have no lattice.
    const cases = [[3770, 'full'], [7540, 'full'], [7676, 'full'], [3672, 'full'], [3867, 'full'], [1759, 'coarse'], [3518, 'coarse'], [7036, 'coarse'], [1650, 'coarse'], [1676, 'coarse']] as const
    for (const [w, quality] of cases) {
      const text = `sin(${w}x)`
      const r = sample(explicit(text), wide, quality)
      expect(bandsOf(r.objects), `${text} ${quality}`).toHaveLength(1)
      expect(r.capped, `${text} ${quality}`).toBe(false)
      expect(curveOf(r.objects).chains, `${text} ${quality}`).toEqual([])
    }
  })

  it('with the samples evenly spaced those frequencies are not a band, and the polyline guard still keeps an alias from being a line', () => {
    // the jitter off, as it was: the same resonance. The columns do not turn, the twin certifies them, and the polyline
    // of their samples is a slow wave that the enclosure fits; the extra sample off the lattice (BAND.probeAt) refuses
    // it, and the core refines the column as it always did, to the cap.
    const spread = BAND.jitterSpread
    BAND.jitterSpread = 0
    try {
      for (const [w, quality] of [[3672, 'full'], [3867, 'full'], [1650, 'coarse'], [1676, 'coarse']] as const) {
        const text = `sin(${w}x)`
        const r = sample(explicit(text), wide, quality)
        const worst = worstSegment(text, r.objects)
        expect(r.capped || worst <= 2, `${text} ${quality}: a line ${worst.toFixed(1)} px off the curve, and not capped`).toBe(true)
      }
    } finally {
      BAND.jitterSpread = spread
    }
  })

  // calc P2 task 7: the polyline of a certified column that did not turn is checked by one more sample off its lattice,
  // and that sample was held to gapPx (1 px) of the polyline. At COARSE, whose 8 samples are 1/7 px apart, sin(w x) for w
  // near 104 to 146 (a period of 1 to 2 px) is off its own polyline by more than that at an ordinary point, so the check
  // refused true polylines, the core refined them to the cap, and the cap drew false 8 px chords. The check has a
  // constant of its own, BAND.probePx (4 px), which still catches an alias (tens of px) and not the polyline's own error.
  it('COARSE sin(120x) is not capped, and no segment is more than 2 px off the curve', () => {
    const r = sample(explicit('sin(120x)'), wide, 'coarse')
    expect(r.capped).toBe(false)
    expect(worstSegment('sin(120x)', r.objects)).toBeLessThanOrEqual(2)
  })

  it('COARSE sin(w x) for w = 104 to 146 is not capped and draws no false chord', () => {
    for (let w = 104; w <= 146; w += 6) {
      const text = `sin(${w}x)`
      const r = sample(explicit(text), wide, 'coarse')
      expect(r.capped, text).toBe(false)
      expect(worstSegment(text, r.objects), text).toBeLessThanOrEqual(2)
    }
  })

  it('COARSE: a band across the view fits the budget, on 8 samples a column', () => {
    const r = sample(explicit('sin(500x)'), wide, 'coarse')
    const bands = bandsOf(r.objects)
    expect(bands).toHaveLength(1)
    const cols = columnsOf(bands[0])
    expect(Math.min(...cols.map((c) => c.t0))).toBeLessThanOrEqual(-10)
    expect(Math.max(...cols.map((c) => c.t1))).toBeGreaterThanOrEqual(10)
    expect(Math.min(...cols.map((c) => c.lo))).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeLessThanOrEqual(1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeGreaterThan(0.95)
    expect(curveOf(r.objects).chains).toEqual([])
    expect(r.capped).toBe(false)
    expect(r.stats.points).toBeLessThan(COARSE.budget.points)
  })

  it('a Weierstrass sum: every band column lies inside the twin\'s enclosure over it', () => {
    const body = 'sum(k = 0 to 12, 0.5^k cos(3^k pi x))'
    const r = sample(explicit(body))
    const cols = bandsOf(r.objects).flatMap((b) => columnsOf(b))
    expect(cols.length).toBeGreaterThan(100)
    const twin = compileInterval(expr(body), ['x'], scopeOf())
    const out = iv()
    for (const c of cols) {
      twin(out, c.t0, c.t1)
      expect(c.lo, `column at ${c.t0}`).toBeGreaterThanOrEqual(out.lo)
      expect(c.hi, `column at ${c.t0}`).toBeLessThanOrEqual(out.hi)
    }
  })

  it('a band is cut at the clip box, which is the view plus its overscan', () => {
    const r = sample(explicit('30 sin(500x)'), wide)
    const cols = bandsOf(r.objects).flatMap((b) => columnsOf(b))
    expect(cols.length).toBeGreaterThan(100)
    // y runs over [-10, 10] and the box is 25 % of 20 wider each side, and the curve is 30 high
    expect(Math.min(...cols.map((c) => c.lo))).toBe(-15)
    expect(Math.max(...cols.map((c) => c.hi))).toBe(15)
  })

  it('x = f(y) oscillates along x: a band of x in [-1, 1] over y', () => {
    const r = sample(explicit('sin(500y)', 'y'), wide)
    const bands = bandsOf(r.objects)
    expect(bands).toHaveLength(1)
    const cols = columnsOf(bands[0], 'x')
    expect(Math.min(...cols.map((c) => c.t0))).toBeLessThanOrEqual(-10)
    expect(Math.max(...cols.map((c) => c.t1))).toBeGreaterThanOrEqual(10)
    expect(Math.min(...cols.map((c) => c.lo))).toBeGreaterThanOrEqual(-1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeLessThanOrEqual(1)
    expect(Math.max(...cols.map((c) => c.hi))).toBeGreaterThan(0.99)
    // the vertices are (x, y): the parameter is the y
    const chain = bands[0].outline[0]
    for (let i = 0; i < chain.param.length; i++) expect(chain.xy[2 * i + 1]).toBe(chain.param[i])
  })

  it('a band is an object of its own after the curve, with an identity and the curve\'s colour, and records no break', () => {
    const r = sample(explicit('sin(1/x)'), tall, 'full', 'red')
    const bands = bandsOf(r.objects)
    expect(bands.length).toBeGreaterThan(0)
    expect(r.objects[0].kind).toBe('curve')
    bands.forEach((b, k) => {
      expect(b.id).toEqual({ statement: 3, object: `band.${k}` })
      expect(b.color).toBe('red')
      expect(b.outline).toHaveLength(1)
      expect(b.outline[0].closed).toBe(true)
    })
    expect(r.objects.indexOf(bands[0])).toBe(1)
    expect(curveOf(r.objects).breaks).toEqual([])
    const plain = sample(explicit('sin(500x)'), wide)
    expect(curveOf(plain.objects).breaks).toEqual([])
    expect(bandsOf(plain.objects)[0].color).toBeNull()
  })

  it('polar and parametric curves have no bands: they refine under their budget', () => {
    const polar = sample({ kind: 'polar', body: expr('1 + sin(500 theta) / 2'), from: 0, to: 2 * Math.PI }, wide)
    expect(bandsOf(polar.objects)).toEqual([])
    const parametric = sample({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('sin(500t)'), from: -10, to: 10 }, wide)
    expect(bandsOf(parametric.objects)).toEqual([])
    for (const r of [polar, parametric]) {
      expect(r.stats.points).toBeLessThan(FULL.budget.points + 400)
      expect(curveOf(r.objects).chains.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    for (const body of ['sin(1/x)', 'x sin(1/x)', 'sum(k = 0 to 12, 0.5^k cos(3^k pi x))']) {
      const a = sample(explicit(body))
      const b = sample(explicit(body))
      expect(bandsOf(a.objects).length).toBeGreaterThan(0)
      expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects))
      expect(a.stats).toEqual(b.stats)
    }
  })
})

// A band sink that also remembers the columns the core gave it, as it gave them.
class Recorder extends BandSink {
  readonly seen: Column[] = []
  override column(t0: number, t1: number, lo: number, hi: number): void {
    this.seen.push({ t0, t1, lo, hi })
    super.column(t0, t1, lo, hi)
  }
}

describe('sampleRange with a band sink', () => {
  const ends = { left: { kind: 'free' }, right: { kind: 'free' } } as const
  const range = (text: string, tune: Tuning = FULL, screen = wideScreen) => {
    const bands = new Recorder('y', screen.clip)
    const sink = new ChainSink(screen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const fns = fnsOf(text, scopeOf(), screen.px.x)
    const { capped } = sampleRange(fns, screen.clip.xMin, screen.clip.xMax, ends, screen, tune, counter, sink, bands)
    return { bands, chains: sink.chains(), breaks: sink.breaks(), capped, counter }
  }

  it('a column never exceeds the twin\'s enclosure of its interval, whatever the samples say', () => {
    const screen = wideScreen
    const base = fnsOf('sin(500x)', scopeOf())
    // a twin that is wrong, to see what the core does with a column when it is: every value is in [-1/2, 1/2]
    const narrow = {
      ...base,
      enclose: (tLo: number, tHi: number, out: Parameters<typeof base.enclose>[2]) => {
        const v = base.enclose(tLo, tHi, out)
        out.yLo = Math.max(out.yLo, -0.5)
        out.yHi = Math.min(out.yHi, 0.5)
        return v
      },
    }
    const bands = new Recorder('y', screen.clip)
    sampleRange(narrow, screen.clip.xMin, screen.clip.xMax, ends, screen, FULL, { points: 0, intervals: 0 }, new ChainSink(screen.clip), bands)
    expect(bands.seen.length).toBeGreaterThan(100)
    for (const c of bands.seen) {
      expect(c.lo).toBeGreaterThanOrEqual(-0.5)
      expect(c.hi).toBeLessThanOrEqual(0.5)
    }
  })

  // the same range with no band sink at all: what the core did before there were bands
  const without = (text: string, tune: Tuning = FULL, screen = wideScreen) => {
    const sink = new ChainSink(screen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const { capped } = sampleRange(fnsOf(text, scopeOf(), screen.px.x), screen.clip.xMin, screen.clip.xMax, ends, screen, tune, counter, sink)
    return { chains: sink.chains(), breaks: sink.breaks(), capped, counter }
  }
  // how far a chain's vertices are from the curve (they are samples, so not at all), and its segments' middles, in px
  const errorsOf = (text: string, chains: Chain[]) => {
    const f = trueY(text, scopeOf())
    let vertex = 0
    let middle = 0
    for (const c of chains) {
      const p = chainPoints(c)
      for (let i = 0; i < p.length; i++) {
        if (Math.abs(p[i].y) < 14.99) vertex = Math.max(vertex, Math.abs(f(p[i].x) - p[i].y) * 40)
        if (i > 0) {
          const mx = (p[i - 1].x + p[i].x) / 2
          const my = (p[i - 1].y + p[i].y) / 2
          if (Math.abs(my) < 14.99) middle = Math.max(middle, Math.abs(f(mx) - my) * 40)
        }
      }
    }
    return { vertex, middle }
  }

  it('a steep monotone stretch is not a band: it is drawn from its samples, one chain, on the curve', () => {
    const r = range('sin(50x)')
    expect(r.bands.seen).toEqual([])
    expect(r.chains).toHaveLength(1)
    expect(r.capped).toBe(false)
    const e = errorsOf('sin(50x)', r.chains)
    expect(e.vertex).toBeLessThan(1e-9)
    // (a chord holds the samples it covers to flatPx, a quarter of a pixel, and the sag between them adds a little)
    expect(e.middle).toBeLessThan(0.35)
  })

  it('the polyline is thinned to chords the core would accept: no more vertices than before, none longer than maxSegPx', () => {
    // every sample was a vertex: 10x was 241 vertices and 1801, sin(50x) 9601 and 18001. A sample goes where a chord
    // from the one before to the one after is within flatPx of it and no longer than maxSegPx.
    const vertices = (chains: Chain[]) => chains.reduce((s, c) => s + c.param.length, 0)
    for (const text of ['10x', 'sin(50x)', 'x^3 - 2x + 1', 'sin(20x) + x']) {
      const r = range(text)
      const before = without(text)
      expect(vertices(r.chains), text).toBeLessThanOrEqual(vertices(before.chains))
      let longest = 0
      for (const c of r.chains) {
        const p = chainPoints(c)
        for (let i = 1; i < p.length; i++) longest = Math.max(longest, Math.hypot((p[i].x - p[i - 1].x) * 40, (p[i].y - p[i - 1].y) * 40))
      }
      expect(longest, text).toBeLessThanOrEqual(FULL.maxSegPx + 1e-9)
    }
  })

  it('it costs what leaving a stretch to the core did, and far fewer enclosures: sin(50x)', () => {
    const r = range('sin(50x)')
    const before = without('sin(50x)')
    expect(r.counter.points).toBeLessThan(1.1 * before.counter.points)
    expect(r.counter.intervals).toBeLessThan(before.counter.intervals / 5)
  })

  it('a curve that is only steep and not an oscillation is not capped for lack of a band: sin(100x), a period of 2.5 px', () => {
    // capped at FULL (30063 intervals) before its columns were drawn from their samples
    const r = range('sin(100x)')
    expect(r.bands.seen).toEqual([])
    expect(r.capped).toBe(false)
    expect(r.chains).toHaveLength(1)
    const e = errorsOf('sin(100x)', r.chains)
    expect(e.vertex).toBeLessThan(1e-9)
    expect(e.middle).toBeLessThan(0.25)
  })

  it('a column is tried once, whatever the twin is like: sin(30x) + sin(31x) is not capped by tries', () => {
    // its twin is loose (two intervals added), so a column's samples are not always a curve the enclosure vouches
    // for, and the core refines it as it did; without the rule that the halves of one that was tried are not,
    // this is capped at FULL (60005 points)
    const text = 'sin(30x) + sin(31x)'
    const r = range(text)
    const before = without(text)
    expect(r.bands.seen).toEqual([])
    expect(r.capped).toBe(false)
    // at most the samples of a column (14, and 1 more to check them) a pixel over what it cost before
    expect(r.counter.points - before.counter.points).toBeLessThanOrEqual(15 * 1200)
  })

  it('a column is about a pixel wide at most, and each is a column of the band: adjacent ones share an end', () => {
    const r = range('sin(500x)')
    expect(r.bands.seen.length).toBeGreaterThan(1000)
    for (const c of r.bands.seen) expect((c.t1 - c.t0) * 40).toBeLessThanOrEqual(1 + 1e-9)
    for (let i = 1; i < r.bands.seen.length; i++) expect(r.bands.seen[i].t0).toBe(r.bands.seen[i - 1].t1)
    expect(r.bands.bands()).toHaveLength(1)
  })

  it('counts every evaluation a column costs, and takes 16 samples over it with the ends the 2 it had', () => {
    const screen = wideScreen
    const base = fnsOf('sin(500x)', scopeOf(), screen.px.x)
    let calls = 0
    const counted = {
      ...base,
      point: (t: number, out: Float64Array) => {
        calls++
        base.point(t, out)
      },
    }
    const bands = new Recorder('y', screen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    sampleRange(counted, screen.clip.xMin, screen.clip.xMax, ends, screen, FULL, counter, new ChainSink(screen.clip), bands)
    expect(counter.points).toBe(calls)
    // a start grid of 301 points; each of the 2100 certified intervals takes its midpoint; each of the 1200
    // columns takes 14 more, its 16 samples having the two ends already
    expect(calls).toBe(301 + 2100 + 14 * 1200)
    expect(bands.seen).toHaveLength(1200)
  })

  it('COARSE takes 8 samples over a column, 6 new ones, every evaluation counted', () => {
    const screen = wideScreen
    const base = fnsOf('sin(500x)', scopeOf(), screen.px.x)
    let calls = 0
    const counted = {
      ...base,
      point: (t: number, out: Float64Array) => {
        calls++
        base.point(t, out)
      },
    }
    const bands = new Recorder('y', screen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    sampleRange(counted, screen.clip.xMin, screen.clip.xMax, ends, screen, COARSE, counter, new ChainSink(screen.clip), bands)
    expect(counter.points).toBe(calls)
    // a start grid of 8 px: 151 points; 2250 certified intervals take a midpoint each; 1200 columns take 6 more
    expect(calls).toBe(151 + 2250 + 6 * 1200)
    expect(bands.seen).toHaveLength(1200)
  })

  it('a step in an oscillation is a jump only where the twin does not certify the stretch between its two samples', () => {
    // sin(500x) with a steep rise of 5 at 0.0625, narrower than the spacing of the samples (a column is 0.025 across),
    // and a twin that calls the interval PARTIAL (it may: PARTIAL does not mean a pole) wherever it holds the spot
    // `doubt`. The column [0.05, 0.075] is uncertified either way and its largest step is the rise, with no value in
    // common between the sides. If the doubt is elsewhere in the column, the stretch between the two samples either
    // side of the rise is CONTINUOUS: a steep curve, one band column over it and no break. If the doubt is the rise
    // itself, nothing certifies it and it is a jump: two columns and a break.
    const rise = 0.0625
    const ramp = (t: number) => 2.5 + 2.5 * Math.tanh((t - rise) / 1e-4)
    // `gap`: the curve is undefined this far either side of the rise (a stretch of samples that are NaN)
    const run = (doubt: number, gap = 0) => {
      const fns = {
        point: (t: number, out: Float64Array) => {
          out[0] = t
          out[1] = Math.abs(t - rise) < gap ? Number.NaN : Math.sin(500 * t) + ramp(t)
        },
        enclose: (tLo: number, tHi: number, out: { xLo: number; xHi: number; yLo: number; yHi: number }) => {
          out.xLo = tLo
          out.xHi = tHi
          out.yLo = -1 + ramp(tLo)
          out.yHi = 1 + ramp(tHi)
          // (a NaN needs a verdict below CONTINUOUS: any interval that touches the undefined stretch has one)
          const undefinedHere = gap > 0 && tHi > rise - gap && tLo < rise + gap
          return (tLo <= doubt && doubt <= tHi) || undefinedHere ? PARTIAL : CONTINUOUS
        },
        pxPerT: 40,
        oscillationAxis: 'y' as const,
      }
      const bands = new Recorder('y', wideScreen.clip)
      const sink = new ChainSink(wideScreen.clip)
      sampleRange(fns, 0, 0.2, ends, wideScreen, FULL, { points: 0, intervals: 0 }, sink, bands)
      return { seen: bands.seen.filter((c) => c.t1 > 0.05 && c.t0 < 0.075), breaks: sink.breaks() }
    }
    const away = run(0.051)
    expect(away.breaks).toEqual([])
    expect(away.seen).toHaveLength(1)
    expect(away.seen[0].hi - away.seen[0].lo).toBeGreaterThan(5)
    const at = run(rise)
    expect(at.breaks).toHaveLength(1)
    expect(at.breaks[0].kind).toBe('jump')
    expect(Math.abs(at.breaks[0].at - rise)).toBeLessThan(0.002)
    expect(at.seen).toHaveLength(2)
    for (const c of at.seen) expect(c.hi - c.lo).toBeLessThan(2.1)
    expect(at.seen[0].t1).toBeLessThanOrEqual(rise)
    expect(at.seen[1].t0).toBeGreaterThanOrEqual(rise)
    // and a step across an undefined stretch is not a step of the curve at all: the two samples either side of a gap
    // of NaN are an edge and its mate, not a jump, and the column stays one
    const gapped = run(rise, 0.002)
    expect(gapped.breaks).toEqual([])
    expect(gapped.seen).toHaveLength(1)
  })

  it('a pole is not a band: tan(x) with a sink keeps every break it has without one', () => {
    // the column that holds a pole is up, down, up: two turns, and a band over it loses the break
    const r = range('tan(x)')
    const before = without('tan(x)')
    expect(before.breaks).toHaveLength(10)
    expect(r.bands.seen).toEqual([])
    expect(r.breaks).toEqual(before.breaks)
  })

  it('records no break where a band is', () => {
    expect(range('sin(500x)').breaks).toEqual([])
  })

  it('is deterministic, columns and counts', () => {
    const a = range('sin(1/x)')
    const b = range('sin(1/x)')
    expect(a.bands.seen).toEqual(b.bands.seen)
    expect(a.counter).toEqual(b.counter)
  })
})
