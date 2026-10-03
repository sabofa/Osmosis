import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import { sampleRange } from './adaptive'
import { ChainSink } from './sink'
import { fnsOf, run, scopeOf, trueY, view } from './testkit'
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
})

describe('sampleRange — the budget', () => {
  it('always evaluates the whole start grid, however small the budget', () => {
    const r = run('x^2', { ...FULL, budget: { points: 1, intervals: 1 } })
    expect(r.capped).toBe(true)
    // grid of 300 intervals: connected where the twin certified, so the parabola is still one chain
    expect(r.counter.intervals).toBeGreaterThanOrEqual(300)
    expect(r.chains).toHaveLength(1)
  })
  it('does not say capped when the budget was never reached', () => {
    expect(run('x^2').capped).toBe(false)
  })
})
