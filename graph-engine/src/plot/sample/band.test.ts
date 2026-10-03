import { describe, expect, it } from 'vitest'
import { compileInterval, iv } from '../../math/interval'
import type { Bounds, Chain, SceneObject } from '../../scene/types'
import { sampleRange } from './adaptive'
import { BandSink, oscillates } from './band'
import { sampleCurve, type CurveSpec } from './curve'
import { ChainSink } from './sink'
import { expr, fnsOf, scopeOf, view as wideScreen } from './testkit'
import { FULL } from './tuning'
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

  it('a band across a view is not cut by columns whose ends happen to sit at its extremes', () => {
    // 363 x is about 9.1 rad over a pixel, near 3 pi: the two ends of a column are close to mirror
    // images, and for some columns both are at the extremes, where the twin's enclosure is no taller
    // than the ends and the column looks like a steep stroke. Beside a band it is tried anyway.
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
  const range = (text: string, screen = wideScreen) => {
    const bands = new Recorder('y', screen.clip)
    const sink = new ChainSink(screen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const fns = fnsOf(text, scopeOf(), screen.px.x)
    const { capped } = sampleRange(fns, screen.clip.xMin, screen.clip.xMax, ends, screen, FULL, counter, sink, bands)
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

  it('a steep monotone column is not a band: it refines to the floor and connects, as without a sink', () => {
    const withBands = range('sin(50x)')
    expect(withBands.bands.seen).toEqual([])
    const sink = new ChainSink(wideScreen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    sampleRange(fnsOf('sin(50x)', scopeOf()), wideScreen.clip.xMin, wideScreen.clip.xMax, ends, wideScreen, FULL, counter, sink)
    expect(withBands.chains).toEqual(sink.chains())
    expect(withBands.chains).toHaveLength(1)
  })

  it('a stretch that is only steep costs next to nothing to leave alone: sin(50x) is not capped for it', () => {
    const withBands = range('sin(50x)')
    const without = new ChainSink(wideScreen.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    sampleRange(fnsOf('sin(50x)', scopeOf()), wideScreen.clip.xMin, wideScreen.clip.xMax, ends, wideScreen, FULL, counter, without)
    // (what is spent is at the peaks, which are columns that do not flatten and are not strokes)
    expect(withBands.capped).toBe(false)
    expect(withBands.counter.points).toBeLessThan(1.25 * counter.points)
    expect(withBands.counter.intervals).toBe(counter.intervals)
  })

  it('tries a column once, whatever the twin is like: no more than 14 evaluations a pixel over what it costs without', () => {
    // sin(40x) cos(40x) is enclosed loosely (a product of two intervals), so no stretch of it is shown to be a stroke
    const text = 'sin(40x) cos(40x)'
    const withBands = range(text)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    sampleRange(fnsOf(text, scopeOf()), wideScreen.clip.xMin, wideScreen.clip.xMax, ends, wideScreen, FULL, counter, new ChainSink(wideScreen.clip))
    expect(withBands.bands.seen).toEqual([])
    expect(withBands.counter.points - counter.points).toBeGreaterThan(0)
    expect(withBands.counter.points - counter.points).toBeLessThanOrEqual(14 * 1200)
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
