import { describe, expect, it } from 'vitest'
import { UNKNOWN } from '../../math/interval'
import { chainPoints } from '../../scene/chains'
import { sampleRange } from './adaptive'
import { ChainSink } from './sink'
import { fnsOf, run, runView, scopeOf, trueY, view } from './testkit'
import { COARSE, FULL } from './tuning'
import type { CurveFns, End, EvalCounter } from './types'

// every vertex within ½ px of the true curve, and every segment's midpoint within 1 px (no aliasing)
function onCurve(text: string, chains: ReturnType<typeof run>['chains']) {
  const f = trueY(text, scopeOf())
  for (const c of chains) {
    const p = chainPoints(c)
    for (let i = 0; i < p.length; i++) {
      if (Math.abs(p[i].y) < 14.99) expect(Math.abs(f(p[i].x) - p[i].y) * 40, `${text} vertex at ${p[i].x}`).toBeLessThanOrEqual(0.5)
      if (i > 0) {
        const mx = (p[i - 1].x + p[i].x) / 2
        const my = (p[i - 1].y + p[i].y) / 2
        if (Math.abs(my) < 10) expect(Math.abs(f(mx) - my) * 40, `${text} segment at ${mx}`).toBeLessThanOrEqual(1)
      }
    }
  }
}

describe('sampleRange', () => {
  it('draws x^2 as one chain, on the curve, segments at most 8 px', () => {
    const r = run('x^2')
    expect(r.chains).toHaveLength(1)
    onCurve('x^2', r.chains)
  })
  it('steepness never breaks a curve: y = 1000x crosses the view as one chain', () => {
    const r = run('1000x')
    expect(r.chains).toHaveLength(1)
    expect(chainPoints(r.chains[0]).some((p) => Math.abs(p.y) < 1)).toBe(true)
  })
  it('does not alias sin(50x)', () => onCurve('sin(50x)', run('sin(50x)').chains))
  it('without help from the structure walk, still never bridges the pole of 1/(x - 1)', () => {
    const r = run('1/(x - 1)')
    for (const c of r.chains) {
      const xs = chainPoints(c).map((p) => p.x)
      expect(xs.some((x) => x < 1) && xs.some((x) => x > 1)).toBe(false)
    }
  })
  it('reaches the sqrt edge to machine precision', () => {
    const r = run('sqrt(x)')
    expect(Math.min(...chainPoints(r.chains[0]).map((p) => p.x))).toBeLessThan(1e-12)
    expect(r.breaks.some((b) => b.kind === 'edge' && Math.abs(b.at) < 1e-12)).toBe(true)
  })
  it('lets ln x dive off the bottom of the overscan box', () => {
    const p = run('ln(x)').chains.flatMap(chainPoints)
    expect(Math.min(...p.map((q) => q.y))).toBeCloseTo(-15, 9)
    expect(p.every((q) => q.x > 0)).toBe(true)
  })
  // This one is met at 0.1234 and not at every offset: the peak is 0.04 px wide, under the
  // 1/16 px floor, so only a sample that happens to land within 1e-4 of it reaches 0.99.
  // The sweep over a peak 10 times wider, further down, is the test that holds anywhere.
  it('finds a narrow spike the midpoint test alone would miss', () => {
    const p = run('1/(1 + 10^6 (x - 0.1234)^2)').chains.flatMap(chainPoints)
    expect(Math.max(...p.map((q) => q.y))).toBeGreaterThan(0.99)
  })
  it('connects a continuous seam the twin cannot certify, and breaks a real jump', () => {
    expect(run('{x < 1: x, 1}').chains).toHaveLength(1)
    const j = run('{x < 1: x, 2}')
    expect(j.chains).toHaveLength(2)
    expect(j.breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - 1) < 1e-3)).toBe(true)
  })
  it('culls a curve entirely off screen cheaply', () => {
    const r = run('x + 100')
    expect(r.chains).toHaveLength(0)
    expect(r.counter.intervals).toBeLessThan(200)
  })
  it('at the budget it coarsens, says so, and still never bridges a pole', () => {
    const r = run('1/(x - 1) + sin(30x)', { ...FULL, budget: { points: 300, intervals: 150 } })
    expect(r.capped).toBe(true)
    expect(r.chains.length).toBeGreaterThan(0)
    for (const c of r.chains) {
      const xs = chainPoints(c).map((p) => p.x)
      expect(xs.some((x) => x < 1) && xs.some((x) => x > 1)).toBe(false)
    }
  })
  it('is deterministic', () => {
    expect(JSON.stringify(run('tan(x) + x^3'))).toBe(JSON.stringify(run('tan(x) + x^3')))
  })
})

// The ends of a range: how Task 5 hands the core the pieces between trouble spots.
describe('sampleRange — ends', () => {
  const free: End = { kind: 'free' }
  // a CurveFns that records every parameter its point function is asked about
  function spied(text: string): { fns: CurveFns; seen: number[] } {
    const fns = fnsOf(text, scopeOf())
    const seen: number[] = []
    return {
      seen,
      fns: {
        ...fns,
        point(t, out) {
          seen.push(t)
          fns.point(t, out)
        },
      },
    }
  }
  const go = (fns: CurveFns, t0: number, t1: number, left: End, right: End, sink = new ChainSink(view.clip), counter: EvalCounter = { points: 0, intervals: 0 }) => ({
    sink,
    counter,
    ...sampleRange(fns, t0, t1, { left, right }, view, FULL, counter, sink),
  })

  it('never evaluates at a singular end, and starts a floor (1/16 px) inside it', () => {
    const { fns, seen } = spied('1/x')
    const r = go(fns, 0, 5, { kind: 'singular' }, free)
    expect(seen).not.toContain(0)
    expect(Math.min(...seen)).toBeCloseTo(1 / 16 / 40, 12)
    // the curve runs from just inside the pole up off the top of the box, as one chain
    expect(r.sink.chains()).toHaveLength(1)
    expect(Math.min(...chainPoints(r.sink.chains()[0]).map((p) => p.x))).toBeGreaterThan(0)
  })
  it('never evaluates at a singular right end either', () => {
    const { fns, seen } = spied('1/x')
    go(fns, -5, 0, free, { kind: 'singular' })
    expect(seen).not.toContain(0)
    expect(Math.max(...seen)).toBeCloseTo(-1 / 16 / 40, 12)
  })
  it('an anchor end is used instead of evaluating there', () => {
    const { fns, seen } = spied('x^2')
    go(fns, 0, 3, { kind: 'anchor', at: { x: 0, y: 0 } }, { kind: 'anchor', at: { x: 3, y: 9 } })
    expect(seen).not.toContain(0)
    expect(seen).not.toContain(3)
  })
  it('two ranges anchored at the same point share one chain (how a hole is bridged)', () => {
    const fns = fnsOf('x^2', scopeOf())
    const sink = new ChainSink(view.clip)
    const counter = { points: 0, intervals: 0 }
    sampleRange(fns, -3, 0, { left: free, right: { kind: 'anchor', at: { x: 0, y: 0 } } }, view, FULL, counter, sink)
    sampleRange(fns, 0, 3, { left: { kind: 'anchor', at: { x: 0, y: 0 } }, right: free }, view, FULL, counter, sink)
    expect(sink.chains()).toHaveLength(1)
    const ps = chainPoints(sink.chains()[0])
    expect(ps.filter((p) => p.x === 0)).toHaveLength(1)
  })
  // An interval that ends at an anchor is drawn at the floor, though the twin cannot vouch for
  // it: next to a removable hole the enclosure of (x^2 - 1)/(x - 1) is unbounded, and at the tip
  // of an arc it dips under the domain. Without that the chain stops a floor short of its anchor
  // with a jump break, which is not what an anchor is for.
  it('two ranges anchored at a hole of an unbounded enclosure share one chain, with no break', () => {
    const fns = fnsOf('(x^2 - 1)/(x - 1)', scopeOf())
    const sink = new ChainSink(view.clip)
    const counter = { points: 0, intervals: 0 }
    const at = { x: 1, y: 2 }
    sampleRange(fns, -3, 1, { left: free, right: { kind: 'anchor', at } }, view, FULL, counter, sink)
    sampleRange(fns, 1, 3, { left: { kind: 'anchor', at }, right: free }, view, FULL, counter, sink)
    expect(sink.breaks()).toEqual([])
    expect(sink.chains()).toHaveLength(1)
    const chain = sink.chains()[0]
    const ps = chainPoints(chain)
    expect(ps.filter((p) => p.x === 1 && p.y === 2)).toHaveLength(1)
    expect(chain.param[ps.findIndex((p) => p.x === 1)]).toBe(1)
  })
  it('a chain anchored at the tip of an arc reaches it, with no break', () => {
    const fns = fnsOf('sqrt(1 - x^2)', scopeOf(), 400)
    const sink = new ChainSink({ xMin: -1.25, xMax: 1.25, yMin: -1.25, yMax: 1.25 })
    const screen = { px: { x: 400, y: 400 }, clip: { xMin: -1.25, xMax: 1.25, yMin: -1.25, yMax: 1.25 } }
    sampleRange(fns, 0, 1, { left: free, right: { kind: 'anchor', at: { x: 1, y: 0 } } }, screen, FULL, { points: 0, intervals: 0 }, sink)
    expect(sink.breaks()).toEqual([])
    const ps = chainPoints(sink.chains()[0])
    expect(ps[ps.length - 1]).toEqual({ x: 1, y: 0 })
  })
  // The anchor says where the curve arrives, not that nothing is in the way: a pole the walk did
  // not find (a built-in with no rule, a zero classified unknown) in the last floor interval opens
  // the gap, and the stretch is lifted with its jump break, not drawn as a stroke through it.
  it('does not draw the stretch to an anchor when its gap does not close', () => {
    // 1/x + 5 has a pole at 0, and the anchor claims the curve arrives at (0, 5)
    const fns = fnsOf('1/x + 5', scopeOf())
    const sink = new ChainSink(view.clip)
    sampleRange(fns, -3, 0, { left: free, right: { kind: 'anchor', at: { x: 0, y: 5 } } }, view, FULL, { points: 0, intervals: 0 }, sink)
    expect(sink.breaks().some((b) => b.kind === 'jump')).toBe(true)
    for (const c of sink.chains()) expect(chainPoints(c).some((p) => p.x === 0)).toBe(false)
  })
  it('a jump is still a jump where no anchor says the curve arrives', () => {
    // a tip too steep for the core to take on its own, with no anchor: the core lifts and records it. This was the
    // semicircle's (1 - x^2)^(1/2); its gaps close by 0.71 a halving, which the floor test (calc P2 task 7, fix round 1)
    // takes as a continuous curve and joins, so the quartic root's tip stands in: 0.84 a halving, which it does not
    const fns = fnsOf('(1 - x^2)^0.25', scopeOf(), 400)
    const sink = new ChainSink({ xMin: -1.25, xMax: 1.25, yMin: -1.25, yMax: 1.25 })
    const screen = { px: { x: 400, y: 400 }, clip: { xMin: -1.25, xMax: 1.25, yMin: -1.25, yMax: 1.25 } }
    sampleRange(fns, 0, 1, { left: free, right: free }, screen, FULL, { points: 0, intervals: 0 }, sink)
    expect(sink.breaks().length).toBeGreaterThan(0)
  })
  it('a range with no width draws nothing', () => {
    const fns = fnsOf('x', scopeOf())
    const r = go(fns, 2, 2, free, free)
    expect(r.sink.chains()).toHaveLength(0)
    expect(r.capped).toBe(false)
  })
})

describe('sampleRange — edges and the coarse preset', () => {
  it('a curve that starts at an edge is one chain, in increasing parameter', () => {
    for (const text of ['ln(x)', 'sqrt(x)']) {
      const r = run(text)
      expect(r.chains, text).toHaveLength(1)
      const t = Array.from(r.chains[0].param)
      expect(t.every((v, i) => i === 0 || v >= t[i - 1]), `${text} parameters increase`).toBe(true)
    }
  })
  it('the coarse preset draws the same curve with fewer evaluations', () => {
    const full = run('x^2 + sin(3x)')
    const coarse = run('x^2 + sin(3x)', COARSE)
    expect(coarse.chains).toHaveLength(1)
    expect(coarse.counter.points).toBeLessThan(full.counter.points)
  })
  it('the coarse preset is not dearer than the full one on a curve the twin encloses loosely', () => {
    // a cancelling quotient and a quartic: loose enclosures that a strict spike test keeps refining
    for (const text of ['(x^3 - 3x^2 + 3x - 1)/(x^2 - 2x + 1)', 'x^4 - 10x^2 + 9']) {
      const full = run(text)
      const coarse = run(text, COARSE)
      expect(coarse.capped, `${text} caps under coarse`).toBe(false)
      expect(coarse.counter.intervals, text).toBeLessThan(full.counter.intervals)
      // (at spikeFactor 2 the quotient capped the coarse budget, at 7552 of 7500)
      expect(coarse.counter.intervals, `${text} spends the coarse budget`).toBeLessThan(COARSE.budget.intervals * 0.75)
    }
  })
})

describe('sampleRange — the budget', () => {
  it('always evaluates the whole start grid, however small the interval budget', () => {
    const r = run('x^2', { ...FULL, budget: { points: 400, intervals: 1 } })
    expect(r.capped).toBe(true)
    // grid of 300 intervals: connected where the twin certified, so the parabola is still one chain
    expect(r.counter.intervals).toBeGreaterThanOrEqual(300)
    expect(r.chains).toHaveLength(1)
  })
  it('does not say capped when the budget was never reached', () => {
    expect(run('x^2').capped).toBe(false)
  })
  it('never lets the start grid itself outgrow the point budget', () => {
    // 4000 px per unit over 30 units would be a grid of 30000 intervals
    const sink = new ChainSink(view.clip)
    const counter = { points: 0, intervals: 0 }
    const fns = fnsOf('x^2', scopeOf(), 4000)
    sampleRange(fns, -15, 15, { left: { kind: 'free' }, right: { kind: 'free' } }, view, { ...FULL, budget: { points: 1000, intervals: 1e9 } }, counter, sink)
    expect(counter.points).toBeLessThanOrEqual(1001)
  })
})

// Two steps the rule prescribes draw a stretch no one has certified, unless they ask the twin
// first: the edge refine, and the jump test.
const offsets = (n: number, from = 0.3, step = 0.0123457) => Array.from({ length: n }, (_, k) => from + k * step)
const verts = (chains: ReturnType<typeof run>['chains']) => chains.map(chainPoints)
// segments between consecutive vertices of a chain, with their length on screen
function segmentsOf(chains: ReturnType<typeof run>['chains'], px = 40) {
  const out: { a: { x: number; y: number }; b: { x: number; y: number }; len: number; rise: number }[] = []
  for (const p of verts(chains)) {
    for (let i = 1; i < p.length; i++) out.push({ a: p[i - 1], b: p[i], len: Math.hypot((p[i].x - p[i - 1].x) * px, (p[i].y - p[i - 1].y) * px), rise: Math.abs(p[i].y - p[i - 1].y) * px })
  }
  return out
}

describe('sampleRange — the stretch to an edge is certified before it is drawn', () => {
  it('tan(1/x) draws no long stroke down the accumulation point', () => {
    const r = run('tan(1/x)')
    const near = segmentsOf(r.chains).filter((s) => Math.abs(s.a.x) < 0.01 && Math.abs(s.b.x) < 0.01)
    expect(near.filter((s) => s.len > 8)).toEqual([])
  })
  it('a closed floor step has no riser at its edge, at any offset', () => {
    for (const c of offsets(20)) {
      const r = run(`{x <= ${c}: floor(x - ${c} + 1)}`)
      const risers = segmentsOf(r.chains).filter((s) => Math.abs(s.a.x - c) < 0.002 && Math.abs(s.b.x - c) < 0.002 && s.rise > 4)
      expect(risers, `riser at ${c}`).toEqual([])
      expect(r.breaks.some((b) => b.kind === 'edge' && Math.abs(b.at - c) < 0.002), `edge break at ${c}`).toBe(true)
    }
  })
  it('an open-ended ceiling step has none either', () => {
    for (const c of offsets(20)) {
      const risers = segmentsOf(run(`{x >= ${c}: ceil(x - ${c})}`).chains).filter((s) => Math.abs(s.a.x - c) < 0.002 && Math.abs(s.b.x - c) < 0.002 && s.rise > 4)
      expect(risers, `riser at ${c}`).toEqual([])
    }
  })
  // A sqrt-type edge makes the twin say PARTIAL over the last stretch, which must not hide a step in it.
  it.each([
    ['floor(x - c + 1) + sqrt(c - x)', (c: number) => `floor(x - ${c} + 1) + sqrt(${c} - x)`],
    ['ceil(x - c) + sqrt(x - c)', (c: number) => `ceil(x - ${c}) + sqrt(x - ${c})`],
    ['{x <= c: floor(x - c + 1)} + sqrt(c - x) * 0', (c: number) => `{x <= ${c}: floor(x - ${c} + 1)} + sqrt(${c} - x) * 0`],
  ])('a step that coincides with a sqrt-type edge has no riser: %s', (_name, text) => {
    for (const c of offsets(30)) {
      const risers = segmentsOf(run(text(c)).chains).filter((s) => Math.abs(s.a.x - c) < 0.002 && Math.abs(s.b.x - c) < 0.002 && s.rise > 8)
      expect(risers, `riser at ${c}`).toEqual([])
    }
  })
  it('does not draw across a pole inside the last floor width of an edge', () => {
    for (const e of offsets(20)) {
      const p = e + 0.0008
      const across = segmentsOf(run(`sqrt(x - ${e})/(x - ${p})`).chains).filter((s) => Math.min(s.a.x, s.b.x) <= p && Math.max(s.a.x, s.b.x) >= p && s.len > 4)
      expect(across, `pole at ${p}`).toEqual([])
    }
  })
  it('still reaches a closed semicircle tip, and ln, sqrt remain one chain', () => {
    const r = 2.3456
    const xs = run(`sqrt(${r * r} - x^2)`).chains.flatMap(chainPoints).map((p) => p.x)
    // the tips are within a pixel of the circle's ends
    expect(Math.min(...xs)).toBeLessThan(-r + 1 / 40)
    expect(Math.max(...xs)).toBeGreaterThan(r - 1 / 40)
    expect(run('ln(x)').chains).toHaveLength(1)
    expect(run('sqrt(x)').chains).toHaveLength(1)
  })
})

describe('sampleRange — the jump test respects what the twin reported', () => {
  it('does not bridge the pole of 1/(x - c) in a view of +-1e5, at any offset', () => {
    for (const k of Array.from({ length: 20 }, (_, i) => i)) {
      const c = 1e5 * (0.0123 + k * 0.0371)
      const r = runView(`1/(x - ${c})`, 1e5)
      for (const p of verts(r.chains)) expect(p.some((q) => q.x < c) && p.some((q) => q.x > c), `a chain spans ${c}`).toBe(false)
      // a break within the floor width (1/16 px is 16 units here)
      expect(r.breaks.some((b) => Math.abs(b.at - c) <= 16), `no break at ${c}`).toBe(true)
    }
  })
  it('nor the double pole of 1/(x - c)^2 in a view of +-1e4', () => {
    for (const k of Array.from({ length: 20 }, (_, i) => i)) {
      const c = 1e4 * (0.0123 + k * 0.0371)
      const r = runView(`1/(x - ${c})^2`, 1e4)
      for (const p of verts(r.chains)) expect(p.some((q) => q.x < c) && p.some((q) => q.x > c), `a chain spans ${c}`).toBe(false)
    }
  })
  it('still joins a curve the twin could not bound at all (an integral)', () => {
    expect(run('integral(t = 0 to x, cos(t))').chains).toHaveLength(1)
  })
})

// calc P2 task 7, fix round 1 (S1). A twin that says nothing (UNKNOWN: an integral's) certifies no interval, so every one is
// bisected to the floor and decided there by the jump test. That test asked for a gap under a pixel, which a smooth curve
// steeper than 16:1 on screen never has at a 1/16 px interval: it broke at every floor interval, however smooth it was.
// At the floor the test no longer asks for the gap to be small, only to close: halved up to CORE.floorHalvings levels below
// the floor, each gap at most halvingShrink times the one before. A real jump does not shrink; a smooth curve's gaps halve.
describe('sampleRange — a smooth curve the twin cannot certify is not broken at every floor interval', () => {
  // a twin that says nothing at all: no bounds, the verdict UNKNOWN
  const unknown = (f: (x: number) => number): CurveFns => ({
    point(t, out) {
      out[0] = t
      out[1] = f(t)
    },
    enclose(lo, hi, out) {
      out.xLo = lo
      out.xHi = hi
      out.yLo = Number.NEGATIVE_INFINITY
      out.yHi = Number.POSITIVE_INFINITY
      return UNKNOWN
    },
    pxPerT: 40,
    oscillationAxis: 'y',
  })
  // [-1.5, 1.5] in the view of 40 px per unit: 120 px, in a box of +-15
  const go = (f: (x: number) => number, tuning = FULL) => {
    const sink = new ChainSink(view.clip)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const { capped } = sampleRange(unknown(f), -1.5, 1.5, { left: { kind: 'free' }, right: { kind: 'free' } }, view, tuning, counter, sink)
    return { chains: sink.chains(), breaks: sink.breaks(), capped, counter }
  }

  it.each([['20x', (x: number) => 20 * x], ['40 sin(x)', (x: number) => 40 * Math.sin(x)], ['100x', (x: number) => 100 * x]])('%s (slope past 16:1) is one chain with no jump break, at FULL and COARSE', (_name, f) => {
    for (const tuning of [FULL, COARSE]) {
      const r = go(f, tuning)
      expect(r.capped).toBe(false)
      expect(r.breaks.filter((b) => b.kind === 'jump')).toEqual([])
      expect(r.chains).toHaveLength(1)
      // and it is the curve: every vertex on it
      for (const p of chainPoints(r.chains[0])) expect(Math.abs(f(p.x) - p.y) * 40).toBeLessThanOrEqual(0.5)
    }
  })
  it('a jump is still a jump on a steep curve: 1 unit, 1 px, on a slope of 20', () => {
    const c = 0.1234
    for (const size of [1, 1 / 40]) {
      const r = go((x) => 20 * x + (x < c ? 0 : size))
      expect(r.breaks.filter((b) => b.kind === 'jump' && Math.abs(b.at - c) < 0.01), `a jump of ${size} unit`).toHaveLength(1)
      for (const ch of r.chains) {
        const xs = chainPoints(ch).map((p) => p.x)
        expect(xs.some((x) => x < c - 1e-9) && xs.some((x) => x > c + 1e-9), `a chain bridges a jump of ${size} unit`).toBe(false)
      }
    }
  })
  // fix round 2 (rule 1). The floor test first followed only the half of the interval with the larger gap, halving after
  // halving. A jump set AGAINST the slope makes the gap of its own half the smaller, so that half was dropped at the first
  // halving and never looked at, and the interval was bridged: at 40 of 40 offsets of a slope of 200 with a 2 px jump
  // (FULL), of a slope of 20 with 1 px, and of 2000 with 40 px (COARSE). Now every sub-interval whose gap is still a pixel is
  // bisected, and each leaf (a gap under a pixel) must pass the old test.
  it.each([
    ['FULL, slope 200, a jump of 2 px', FULL, 200, 2],
    ['COARSE, slope 20, a jump of 1 px', COARSE, 20, 1],
    ['COARSE, slope 2000, a jump of 40 px', COARSE, 2000, 40],
    ['FULL, slope 20, a jump of 1 px', FULL, 20, 1],
  ])('a jump set against the slope is a jump, at 40 offsets: %s', (_name, tuning, slope, px) => {
    // |y| < 15 is the box: the curve is in it for |x| < 15 / slope
    const inBox = 15 / slope
    const floorWidth = tuning.uncertifiedFloorPx / 40
    for (let k = 0; k < 40; k++) {
      const c = inBox * (0.05 + (0.8 * k) / 40) + 1e-7 * k
      const r = go((x) => slope * x - (px / 40) * (x >= c ? 1 : 0), tuning)
      expect(r.breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - c) <= 2 * floorWidth), `no jump break at ${c}`).toBe(true)
      for (const ch of r.chains) {
        const xs = chainPoints(ch).map((p) => p.x)
        expect(xs.some((x) => x < c) && xs.some((x) => x >= c), `a chain bridges the jump at ${c}`).toBe(false)
      }
    }
  })
  it('a pole inside a floor interval, the twin saying nothing, is not bridged', () => {
    const c = 0.1234
    const r = go((x) => 1 / (x - c))
    for (const ch of r.chains) {
      const xs = chainPoints(ch).map((p) => p.x)
      expect(xs.some((x) => x < c) && xs.some((x) => x > c)).toBe(false)
    }
    expect(r.breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - c) < 0.01)).toBe(true)
  })
  it('the floor test needs a bounded enclosure: a twin that reports a pole is still believed', () => {
    // 1/(x - c) with its real twin: unbounded enclosure over the interval holding c, so no connection however the gaps look
    for (const c of offsets(10)) {
      const r = run(`1/(x - ${c})`)
      for (const ch of r.chains) {
        const xs = chainPoints(ch).map((p) => p.x)
        expect(xs.some((x) => x < c) && xs.some((x) => x > c), `a chain bridges the pole at ${c}`).toBe(false)
      }
    }
  })
  // What lets a steep curve whose twin says nothing fit its budget at all: most of an integral is off screen (40 sin(x) is in a view
  // of +-10 for a sixth of its range, and steep over most of the rest), and with no enclosure to cull it by every interval of it was
  // bisected to the floor and tested there (135000 points for the whole of a slope of 20, against a budget of 60000).
  it('an interval the twin says nothing about, with both ends and the midpoint beyond the same side of the box, is culled, not refined', () => {
    const r = go((x) => 1000 + 20 * x)
    expect(r.chains).toEqual([])
    expect(r.breaks).toEqual([])
    // a start grid (31 intervals) and a midpoint for each: no refinement
    expect(r.counter.points).toBeLessThan(100)
    expect(r.capped).toBe(false)
  })
  it('but not one that crosses into the box: an end inside, or the ends on opposite sides', () => {
    const r = go((x) => 20 * x)
    expect(chainPoints(r.chains[0]).some((p) => Math.abs(p.y) < 1)).toBe(true)
    expect(r.counter.points).toBeGreaterThan(100)
  })
  it('only for a twin that says nothing: where it has an enclosure it culls by it, and where it has a pole it is not fooled', () => {
    // 1/(x - c): the enclosure of the box around the pole is unbounded (PARTIAL, not UNKNOWN), so it is refined to the floor and broken there
    const r = run('1/(x - 0.1234)')
    expect(r.breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - 0.1234) < 0.01)).toBe(true)
  })
  it('a drag stops refining what the twin cannot certify at uncertifiedFloorPx, a coarser floor, and draws the same curve', () => {
    expect(FULL.uncertifiedFloorPx).toBe(FULL.floorPx)
    expect(COARSE.uncertifiedFloorPx).toBe(0.5)
    // (not cheaper for a steep curve since fix round 2: the leaves are set by the curve's vertical travel, a gap of under a pixel
    // each, and not by where the bisecting stops)
    const full = go((x) => 20 * x)
    const coarse = go((x) => 20 * x, COARSE)
    expect(full.chains).toHaveLength(1)
    expect(coarse.chains).toHaveLength(1)
  })
})

describe('sampleRange — the spike test', () => {
  it('draws the peak of a spike 1 px wide to within 1 px of its height, wherever it falls', () => {
    // (at spikeFactor 8, one of these offsets draws the peak 32.6 px short)
    for (const c of offsets(50)) {
      const m = Math.max(...run(`1/(1 + 10^4 (x - ${c})^2)`).chains.flatMap(chainPoints).map((p) => p.y))
      expect((1 - m) * 40, `peak at ${c}`).toBeLessThanOrEqual(1)
    }
  })
})
