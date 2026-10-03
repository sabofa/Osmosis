import { describe, expect, it } from 'vitest'
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
  it('a jump is still a jump where no anchor says the curve arrives', () => {
    // the same arc, the same floor interval at its tip, with no anchor: the core lifts and records it
    const fns = fnsOf('sqrt(1 - x^2)', scopeOf(), 400)
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

describe('sampleRange — the spike test', () => {
  it('draws the peak of a spike 1 px wide to within 1 px of its height, wherever it falls', () => {
    // (at spikeFactor 8, one of these offsets draws the peak 32.6 px short)
    for (const c of offsets(50)) {
      const m = Math.max(...run(`1/(1 + 10^4 (x - ${c})^2)`).chains.flatMap(chainPoints).map((p) => p.y))
      expect((1 - m) * 40, `peak at ${c}`).toBeLessThanOrEqual(1)
    }
  })
})
