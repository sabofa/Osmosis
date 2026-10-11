import { describe, expect, it } from 'vitest'
import type { Bounds, Chain, SceneObject } from '../../scene/types'
import { condition, expr, scopeOf } from '../sample/testkit'
import type { View } from '../sample/curve'
import { sampleImplicit, type SampledImplicit } from './implicit'
import { BOUNDS, chainVertices, VIEW_800 } from './regionkit'
import { FULL } from './tuning'
import type { StatementOptions } from './types'

type CurveObject = Extract<SceneObject, { kind: 'curve' }>
type MarkObject = Extract<SceneObject, { kind: 'mark' }>

function curveOf(left: string, right: string, where: string | null = null, o: { view?: View; quality?: 'full' | 'coarse'; budget?: StatementOptions['budget'] } = {}): SampledImplicit {
  return sampleImplicit(expr(left), expr(right), where === null ? null : condition(where), o.view ?? VIEW_800, scopeOf(), { statement: 3, color: null, quality: o.quality ?? 'full', budget: o.budget })
}

const chainsOf = (s: SampledImplicit): Chain[] => (s.objects[0] as CurveObject).chains
const marksOf = (s: SampledImplicit): MarkObject[] => s.objects.filter((o): o is MarkObject => o.kind === 'mark')
const ROOT: Bounds = { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }

function lengthOf(chain: Chain): number {
  const v = chainVertices([chain])
  let sum = 0
  for (let i = 0; i + 1 < v.length; i++) sum += Math.hypot(v[i + 1].x - v[i].x, v[i + 1].y - v[i].y)
  return sum
}

describe('sampleImplicit: the curve', () => {
  it('x^2 + y^2 = 4: one closed chain, counter-clockwise, on the circle, with identity and a length for a parameter', () => {
    const s = curveOf('x^2 + y^2', '4')
    expect(s.badView).toBe(false)
    expect(s.capped).toBe(false)
    expect(s.tested && s.defined).toBe(true)
    expect(s.drawnInView).toBe(true)
    expect(s.objects.length).toBe(1)
    const curve = s.objects[0] as CurveObject
    expect(curve.kind).toBe('curve')
    expect(curve.id).toEqual({ statement: 3, object: 'curve' })
    expect(curve.breaks).toEqual([])
    expect(curve.chains.length).toBe(1)
    const [chain] = curve.chains
    expect(chain.closed).toBe(true)
    const v = chainVertices([chain])
    expect(Math.max(...v.map((q) => Math.abs(Math.hypot(q.x, q.y) - 2)))).toBeLessThan(1e-4)
    // counter-clockwise from the smallest vertex: the area the chain encloses is positive
    let a = 0
    for (let i = 0; i < v.length; i++) a += v[i].x * v[(i + 1) % v.length].y - v[(i + 1) % v.length].x * v[i].y
    expect(a / 2).toBeCloseTo(4 * Math.PI, 1)
    expect(chain.param[0]).toBe(0)
    expect(chain.param[chain.param.length - 1]).toBeLessThan(4 * Math.PI)
    expect(chain.param[chain.param.length - 1]).toBeGreaterThan(4 * Math.PI - 0.1)
  })

  it('x^2 + y^2 = 0: one filled value mark at the origin', () => {
    const s = curveOf('x^2 + y^2', '0')
    expect(chainsOf(s)).toEqual([])
    const [m] = marksOf(s)
    expect(marksOf(s).length).toBe(1)
    expect(m.role).toBe('value')
    expect(m.fill).toBe('filled')
    expect(m.id).toEqual({ statement: 3, object: 'value.0' })
    expect(Math.hypot(m.at.x, m.at.y)).toBeLessThan(0.05)
    expect(s.drawnInView).toBe(true)
  })

  it('says nothing of a curve that is off the view, and does not call it undefined', () => {
    const s = curveOf('x^2 + y^2', '-1')
    expect(chainsOf(s)).toEqual([])
    expect(s.tested).toBe(true)
    expect(s.defined).toBe(true)
    expect(s.drawnInView).toBe(false)
    expect(s.blankInView).toBe(false)
  })

  it('says defined false for a curve that is undefined everywhere in the view', () => {
    const s = curveOf('sqrt(-1 - x^2)', 'y')
    expect(chainsOf(s)).toEqual([])
    expect(s.tested).toBe(true)
    expect(s.defined).toBe(false)
  })

  it('draws the same twice', () => {
    for (const [l, r, w] of [
      ['x^2 + y^2', '4', null],
      ['x^2 + y^2', '4', 'y > 0'],
      ['x*y', '1', 'x > 0'],
    ] as const) {
      expect(curveOf(l, r, w)).toEqual(curveOf(l, r, w))
    }
  })
})

describe('sampleImplicit: the `if` clause clips the chains, with no centroid rule', () => {
  it('x^2 + y^2 = 4 if y > 0: the upper arc only, ending at (-2, 0) and (2, 0)', () => {
    const s = curveOf('x^2 + y^2', '4', 'y > 0')
    const chains = chainsOf(s)
    expect(chains.length).toBe(1)
    const [chain] = chains
    expect(chain.closed).toBe(false)
    const v = chainVertices([chain])
    expect(Math.min(...v.map((q) => q.y))).toBeGreaterThanOrEqual(0)
    expect(Math.max(...v.map((q) => Math.abs(Math.hypot(q.x, q.y) - 2)))).toBeLessThan(1e-4)
    // from the smaller x end to the other: (-2, 0) to (2, 0), to the root the leaf edge holds on y = 0
    expect(Math.abs(v[0].x + 2)).toBeLessThan(1e-4)
    expect(v[0].y).toBe(0)
    expect(Math.abs(v[v.length - 1].x - 2)).toBeLessThan(1e-4)
    expect(v[v.length - 1].y).toBe(0)
    // half of the circle's length
    expect(Math.abs(lengthOf(chain) - 2 * Math.PI)).toBeLessThan(0.01)
    expect(s.tested && s.defined).toBe(true)
  })

  it('cuts where the clause\'s boundary crosses a leaf, not at a leaf\'s edge: x^2 + y^2 = 4 if x > 1 ends on x = 1', () => {
    const s = curveOf('x^2 + y^2', '4', 'x > 1')
    const [chain] = chainsOf(s)
    expect(chainsOf(s).length).toBe(1)
    const v = chainVertices([chain])
    expect(Math.min(...v.map((q) => q.x))).toBeGreaterThanOrEqual(1 - 2e-3)
    expect(Math.abs(Math.min(...v.map((q) => q.x)) - 1)).toBeLessThan(2e-3)
    // the ends are on the circle too, to a chord's error
    expect(Math.abs(Math.abs(v[0].y) - Math.sqrt(3))).toBeLessThan(0.01)
    expect(Math.abs(Math.abs(v[v.length - 1].y) - Math.sqrt(3))).toBeLessThan(0.01)
  })

  it('draws a quarter arc for an and, two arcs for an or', () => {
    const quarter = curveOf('x^2 + y^2', '4', 'x > 0 and y > 0')
    expect(chainsOf(quarter).length).toBe(1)
    const q = chainVertices(chainsOf(quarter))
    expect(Math.min(...q.map((p) => p.x))).toBeGreaterThanOrEqual(0)
    expect(Math.min(...q.map((p) => p.y))).toBeGreaterThanOrEqual(0)
    expect(Math.abs(lengthOf(chainsOf(quarter)[0]) - Math.PI)).toBeLessThan(0.01)
    const caps = curveOf('x^2 + y^2', '4', 'y > 1 or y < -1')
    expect(chainsOf(caps).length).toBe(2)
    const ys = chainVertices(chainsOf(caps)).map((p) => Math.abs(p.y))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(1 - 2e-3)
    // each cap is an arc of 2 pi / 3 of the radius-2 circle: 4 pi / 3
    for (const chain of chainsOf(caps)) expect(Math.abs(lengthOf(chain) - (4 * Math.PI) / 3)).toBeLessThan(0.02)
  })

  it('keeps the whole curve where the clause is proven true over its leaves, and costs only the proof', () => {
    const plain = curveOf('x^2 + y^2', '4')
    const kept = curveOf('x^2 + y^2', '4', 'x > -100')
    expect(chainsOf(kept)).toEqual(chainsOf(plain))
    expect(kept.stats.points).toBeLessThan(plain.stats.points * 1.05)
  })

  it('draws nothing where the clause is proven false, says it was not tested, and does not call the curve undefined', () => {
    const s = curveOf('x^2 + y^2', '4', 'x > 100')
    expect(chainsOf(s)).toEqual([])
    expect(s.tested).toBe(false)
    expect(s.defined).toBe(false)
  })

  it('takes a strict clause to exclude the zero set and an inclusive one to include it: y = 0 if y > 0 is nothing, y = 0 if y >= 0 is the axis', () => {
    expect(chainsOf(curveOf('y', '0', 'y > 0'))).toEqual([])
    const axis = chainsOf(curveOf('y', '0', 'y >= 0'))
    expect(axis.length).toBe(1)
    const v = chainVertices(axis)
    expect(Math.max(...v.map((q) => Math.abs(q.y)))).toBe(0)
    expect(Math.min(...v.map((q) => q.x))).toBe(-15)
    expect(Math.max(...v.map((q) => q.x))).toBe(15)
  })

  it('clips a line: y = x if x > 1 starts at (1, 1)', () => {
    const s = curveOf('y', 'x', 'x > 1')
    const [chain] = chainsOf(s)
    expect(chainsOf(s).length).toBe(1)
    const v = chainVertices([chain])
    expect(Math.abs(v[0].x - 1)).toBeLessThan(2e-3)
    expect(Math.abs(v[0].y - 1)).toBeLessThan(2e-3)
    expect(v[v.length - 1]).toEqual({ x: 15, y: 15 })
  })

  it('keeps an isolated point where the clause is true at it, and not where it is not', () => {
    expect(marksOf(curveOf('x^2 + y^2', '0', 'x > -1')).length).toBe(1)
    expect(marksOf(curveOf('x^2 + y^2', '0', 'x > 1')).length).toBe(0)
  })

  it('joins nothing across a pole: y = tan(x) if x > 0 is the branches to the right of the origin, each whole', () => {
    const s = curveOf('y', 'tan(x)', 'x > 0')
    const chains = chainsOf(s)
    // poles at pi/2 + k pi (k = 0..4) in (0, 15]: six pieces
    expect(chains.length).toBe(6)
    const v = chainVertices(chains)
    expect(Math.min(...v.map((q) => q.x))).toBeGreaterThanOrEqual(-1e-9)
    const poles = Array.from({ length: 5 }, (_, k) => Math.PI / 2 + k * Math.PI)
    for (const chain of chains) {
      const xs = chainVertices([chain]).map((q) => q.x)
      for (const p of poles) expect(Math.min(...xs) < p - 1e-4 && Math.max(...xs) > p + 1e-4, `a chain across ${p}`).toBe(false)
    }
    expect(s.capped).toBe(false)
  })

  it('works in a view panned off the grid lines', () => {
    const view = { bounds: { xMin: -9.73, xMax: 10.27, yMin: -9.31, yMax: 10.69 }, widthPx: 800, heightPx: 800 }
    const s = curveOf('x^2 + y^2', '4', 'y > 0', { view })
    const [chain] = chainsOf(s)
    expect(chainsOf(s).length).toBe(1)
    const v = chainVertices([chain])
    expect(Math.min(...v.map((q) => q.y))).toBeGreaterThanOrEqual(-2e-3)
    expect(Math.abs(Math.abs(v[0].x) - 2)).toBeLessThan(2e-3)
    expect(Math.abs(Math.abs(v[v.length - 1].x) - 2)).toBeLessThan(2e-3)
    expect(Math.abs(lengthOf(chain) - 2 * Math.PI)).toBeLessThan(0.02)
  })

  it('refuses a clause the kernel refuses', () => {
    expect(() => curveOf('x^2 + y^2', '4', 'z > 0')).toThrow()
  })
})

describe('sampleImplicit: the view', () => {
  const ok = { statement: 0, color: null, quality: 'full' as const }
  const bad = (bounds: Bounds, widthPx = 800, heightPx = 800) => sampleImplicit(expr('x^2 + y^2'), expr('4'), null, { bounds, widthPx, heightPx }, scopeOf(), ok)

  it('draws nothing and says badView for a view that is not a finite box of positive size, or a viewport of no px', () => {
    for (const bounds of [
      { xMin: NaN, xMax: 10, yMin: -10, yMax: 10 },
      { xMin: 10, xMax: -10, yMin: -10, yMax: 10 },
      { xMin: -10, xMax: 10, yMin: 3, yMax: 3 },
      { xMin: -Infinity, xMax: Infinity, yMin: -10, yMax: 10 },
    ]) {
      const r = bad(bounds)
      expect(r.badView).toBe(true)
      expect(r.objects).toEqual([])
    }
    for (const [w, h] of [
      [0, 800],
      [800, NaN],
      [-1, -1],
    ]) expect(bad(BOUNDS, w, h).badView).toBe(true)
  })

  it('does not let a RangeError out of the quadtree', () => {
    expect(() => bad({ xMin: 0, xMax: 1e-320, yMin: 0, yMax: 1 })).not.toThrow()
  })
})

describe('sampleImplicit: the spend, one budget for the whole statement', () => {
  it('draws the acceptance curves uncapped inside the statement\'s budget, at FULL', () => {
    for (const [l, r] of [
      ['x^2 + y^2', '4'],
      ['x^2 - y^2', '1'],
      ['x*y', '1'],
      ['y', 'tan(x)'],
      ['sin(x)', 'cos(y)'],
      ['(x^2 + y^2)^2', '2*(x^2 - y^2)'],
      ['y', 'ln(x)'],
    ]) {
      const s = curveOf(l, r)
      expect(s.capped, `${l} = ${r}`).toBe(false)
      expect(s.stats.points, `${l} = ${r}`).toBeLessThan(FULL.statement.points)
      expect(s.stats.intervals, `${l} = ${r}`).toBeLessThan(FULL.statement.intervals)
    }
  })

  it('costs, counted (points / twin evaluations, FULL then COARSE), under 1.5 times what it was measured to', () => {
    const measured: [string, string, string | null, number, number, number, number][] = [
      ['x^2 + y^2', '4', null, 10412, 2261, 2940, 597],
      ['x^2 + y^2', '4', 'y > 0', 10424, 2811, 2952, 739],
      ['y', 'tan(x)', null, 732945, 135857, 174843, 30518],
      ['x*y', '1', null, 38760, 8093, 10752, 1981],
    ]
    for (const [l, r, w, fp, fi, cp, ci] of measured) {
      const f = curveOf(l, r, w, { quality: 'full' })
      const c = curveOf(l, r, w, { quality: 'coarse' })
      expect(f.stats.points, `${l} = ${r}`).toBeLessThan(1.5 * fp)
      expect(f.stats.intervals, `${l} = ${r}`).toBeLessThan(1.5 * fi)
      expect(c.stats.points, `${l} = ${r}`).toBeLessThan(1.5 * cp)
      expect(c.stats.intervals, `${l} = ${r}`).toBeLessThan(1.5 * ci)
    }
  })

  it('draws on bigger leaves at the cap, all of it, and says so; every vertex is still on the curve', () => {
    const budget = { points: 4000, intervals: 1200 }
    const s = curveOf('x^2 + y^2', '4', null, { budget })
    expect(s.capped).toBe(true)
    expect(s.drawnInView).toBe(true)
    expect(s.stats.points).toBeLessThanOrEqual(budget.points)
    expect(s.stats.intervals).toBeLessThanOrEqual(budget.intervals)
    const chains = chainsOf(s)
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(true)
    expect(Math.max(...chainVertices(chains).map((q) => Math.abs(Math.hypot(q.x, q.y) - 2)))).toBeLessThan(1e-4)
    // coarser than FULL's
    expect(chainVertices(chains).length).toBeLessThan(chainVertices(chainsOf(curveOf('x^2 + y^2', '4'))).length / 2)
  })

  it('draws a crowd on bigger leaves, never a false crossing: sin(10x) = cos(10y) at FULL is capped and drawn', () => {
    const s = curveOf('sin(10*x)', 'cos(10*y)')
    expect(s.capped).toBe(true)
    expect(s.drawnInView).toBe(true)
    expect(s.blankInView).toBe(false)
    expect(s.stats.points).toBeLessThanOrEqual(FULL.statement.points)
    // every vertex is on the curve: |sin(10x) - cos(10y)| / |grad| under half a px (the gradient is at most 10 sqrt 2 a unit)
    let worst = 0
    for (const q of chainVertices(chainsOf(s))) worst = Math.max(worst, Math.abs(Math.sin(10 * q.x) - Math.cos(10 * q.y)))
    expect(worst).toBeLessThan(0.5 * 14.2 / 40)
  })

  it('says a view with nothing drawn was starved when the budget was too small to contour anything', () => {
    const s = curveOf('x^2 + y^2', '4', null, { budget: { points: 100, intervals: 40 } })
    expect(s.capped).toBe(true)
    expect(s.drawnInView).toBe(false)
    expect(s.blankInView).toBe(true)
  })

  it('draws the coarse pass as the same curve for about a quarter of the work', () => {
    const f = curveOf('x^2 + y^2', '4')
    const c = curveOf('x^2 + y^2', '4', null, { quality: 'coarse' })
    expect(c.stats.points).toBeLessThan(f.stats.points / 2.5)
    expect(Math.max(...chainVertices(chainsOf(c)).map((q) => Math.abs(Math.hypot(q.x, q.y) - 2)))).toBeLessThan(1e-4)
  })

  it('holds a clause\'s chords inside the same budget: a clause on a capped curve says capped and keeps only what it clipped', () => {
    const budget = { points: 3000, intervals: 900 }
    const s = curveOf('x^2 + y^2', '4', 'y > 0', { budget })
    expect(s.capped).toBe(true)
    const v = chainVertices(chainsOf(s))
    expect(Math.min(...v.map((q) => q.y))).toBeGreaterThanOrEqual(-1e-9)
    expect(s.stats.points).toBeLessThanOrEqual(budget.points * 1.05)
  })
})

describe('sampleImplicit: the root of the view', () => {
  it('draws to the edge of the overscan and no further', () => {
    const s = curveOf('y', 'x')
    const v = chainVertices(chainsOf(s))
    expect(Math.min(...v.map((q) => q.x))).toBe(ROOT.xMin)
    expect(Math.max(...v.map((q) => q.x))).toBe(ROOT.xMax)
  })
})
