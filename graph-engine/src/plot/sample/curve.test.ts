import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import type { SceneObject } from '../../scene/types'
import { anchorSkip, firstBridge } from '../testing/dense'
import { sampleCurve, type CurveSpec } from './curve'
import { condition, expr, scopeOf, trueY } from './testkit'
import { COARSE, FULL, LOCATE } from './tuning'

const view = { bounds: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, widthPx: 800, heightPx: 800 }
const opts = { statement: 0, color: null, asymptotes: true, quality: 'full' as const }
const explicit = (body: string, domain: string | null = null): CurveSpec => ({ kind: 'explicit', independent: 'x', body: expr(body), domain: domain ? condition(domain) : null })
const run = (spec: CurveSpec, defs = '', angle: 'radians' | 'degrees' = 'radians', v = view) => sampleCurve(spec, v, scopeOf(defs, angle), opts)
const curveOf = (objs: SceneObject[]) => objs.find((o) => o.kind === 'curve') as Extract<SceneObject, { kind: 'curve' }>
const marksOf = (objs: SceneObject[]) => objs.filter((o) => o.kind === 'mark') as Extract<SceneObject, { kind: 'mark' }>[]
const guidesOf = (objs: SceneObject[]) => objs.filter((o) => o.kind === 'line' && o.role === 'asymptote') as Extract<SceneObject, { kind: 'line' }>[]
const noChainCrosses = (objs: SceneObject[], at: number) => {
  for (const c of curveOf(objs).chains) {
    const xs = chainPoints(c).map((p) => p.x)
    expect(xs.some((x) => x < at - 1e-9) && xs.some((x) => x > at + 1e-9), `a chain crosses ${at}`).toBe(false)
  }
}

describe('sampleCurve — poles', () => {
  it('tan x: four poles, typed breaks, four guides, no connectors', () => {
    const r = run(explicit('tan(x)'))
    const poles = curveOf(r.objects).breaks.filter((b) => b.kind === 'pole').map((b) => b.at)
    // the range includes the 25 % overscan: [-15, 15] holds ±π/2, ±3π/2, ±5π/2, ±7π/2, ±9π/2
    expect(poles).toHaveLength(10)
    for (const p of poles) noChainCrosses(r.objects, p)
    expect(guidesOf(r.objects)).toHaveLength(10)
  })
  it('1/x^2 and 1/(x - 1)', () => {
    for (const [body, at] of [['1/x^2', 0], ['1/(x - 1)', 1]] as const) {
      const r = run(explicit(body))
      expect(curveOf(r.objects).breaks).toContainEqual({ at: expect.closeTo(at, 12), kind: 'pole' })
      noChainCrosses(r.objects, at)
    }
  })
  it('poles in degrees, and through a parameter', () => {
    const d = run(explicit('tan(x)'), '', 'degrees', { ...view, bounds: { xMin: -200, xMax: 200, yMin: -10, yMax: 10 } })
    expect(curveOf(d.objects).breaks.filter((b) => b.kind === 'pole').map((b) => Math.round(b.at))).toEqual(expect.arrayContaining([-270, -90, 90, 270]))
    const p = run(explicit('f(x)'), 'f(x) = 1/(x - a)\n@param a = 2 range [0, 5]')
    expect(curveOf(p.objects).breaks).toContainEqual({ at: expect.closeTo(2, 12), kind: 'pole' })
  })
})

describe('sampleCurve — holes', () => {
  it.each([['(x^2 - 1)/(x - 1)', 1, 2], ['sin(x)/x', 0, 1], ['sin(x - pi)/(x - pi)', Math.PI, 1]])('%s has an open hole and one unbroken chain', (body, at, limit) => {
    const r = run(explicit(body))
    const holes = marksOf(r.objects).filter((m) => m.role === 'hole')
    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ fill: 'open', at: { x: expect.closeTo(at, 12), y: expect.closeTo(limit, 6) } })
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })
})

describe('sampleCurve — jumps and ends', () => {
  it('floor(x): open on the left, filled on the right, at every integer in range', () => {
    const r = run(explicit('floor(x)'))
    const at1 = marksOf(r.objects).filter((m) => Math.abs(m.at.x - 1) < 1e-9)
    expect(at1).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'endpoint', fill: 'open', at: { x: expect.closeTo(1, 12), y: expect.closeTo(0, 9) } }),
      expect.objectContaining({ role: 'endpoint', fill: 'filled', at: { x: expect.closeTo(1, 12), y: expect.closeTo(1, 9) } }),
    ]))
  })
  it.each([['{x < 0: x^2, x + 1}', 'open', 'filled'], ['{x <= 0: x^2, x + 1}', 'filled', 'open']])('%s ends as its condition says', (body, left, right) => {
    const r = run(explicit(body))
    const at0 = marksOf(r.objects).filter((m) => Math.abs(m.at.x) < 1e-9)
    expect(at0.find((m) => Math.abs(m.at.y) < 1e-9)?.fill).toBe(left)
    expect(at0.find((m) => Math.abs(m.at.y - 1) < 1e-9)?.fill).toBe(right)
  })
  it('y = 2 if 0 < x <= 3: open at 0, filled at 3', () => {
    const r = run(explicit('2', '0 < x <= 3'))
    const ends = marksOf(r.objects).map((m) => [Math.round(m.at.x), m.fill])
    expect(ends).toEqual([[0, 'open'], [3, 'filled']])
  })
  it('ln x and sqrt x reach their edges with no mark', () => {
    for (const body of ['ln(x)', 'sqrt(x)']) {
      const r = run(explicit(body))
      expect(marksOf(r.objects)).toHaveLength(0)
      expect(curveOf(r.objects).breaks.some((b) => b.kind === 'edge' && Math.abs(b.at) < 1e-12)).toBe(true)
    }
    const s = chainPoints(curveOf(run(explicit('sqrt(x)')).objects).chains[0])
    expect(s[0]).toEqual({ x: expect.closeTo(0, 12), y: expect.closeTo(0, 3) })
  })
  // calc P2 task 8, fix round 1: a diverging edge was a singular end, which the core starts a floor's width inside, so
  // ln x stopped at -6.46 (142 px short of the bottom of a view of [-10, 10]) and log x at -2.81. The end is free now: the
  // core samples to the edge and the sink cuts the curve at the clip box.
  it('ln x and log x dive to the bottom of the clip box, which is below the view, and have one edge break', () => {
    for (const body of ['ln(x)', 'log(x)']) {
      const r = run(explicit(body))
      const c = curveOf(r.objects)
      const ys = c.chains.flatMap(chainPoints).map((p) => p.y)
      expect(Math.min(...ys), body).toBe(-15)
      // the edge is recorded once, where the walk placed it, and not again where the core refined it
      expect(c.breaks.filter((b) => b.kind === 'edge'), body).toEqual([{ at: expect.closeTo(0, 12), kind: 'edge' }])
      expect(c.chains, body).toHaveLength(1)
    }
  })
  // fix round 2: the same of a log of a quadratic, whose edges are its zeros and whose enclosure is loose there
  it.each([
    ['ln(1 - x^2)', [-1, 1]],
    ['ln(4 - x^2)', [-2, 2]],
    ['ln(x^2 - 1)', [-1, 1]],
    ['ln(x^2 - 4x + 3)', [1, 3]],
  ] as const)('%s reaches the bottom of the clip box at each edge, with one edge break at each and no jump', (body, edges) => {
    const c = curveOf(run(explicit(body)).objects)
    const ends = c.chains.flatMap((ch) => {
      const p = chainPoints(ch)
      return [p[0], p[p.length - 1]].filter((q) => q.y === -15)
    })
    expect(ends, body).toHaveLength(2)
    expect(c.breaks.filter((b) => b.kind === 'edge').map((b) => b.at), body).toEqual(edges.map((e) => expect.closeTo(e, 12)))
    expect(c.breaks.filter((b) => b.kind === 'jump'), body).toEqual([])
  })
  it('a diverging edge on the other side, ln(-x), dives the same way', () => {
    const r = run(explicit('ln(-x)'))
    const c = curveOf(r.objects)
    expect(Math.min(...c.chains.flatMap(chainPoints).map((p) => p.y))).toBe(-15)
    expect(c.breaks.filter((b) => b.kind === 'edge')).toEqual([{ at: expect.closeTo(0, 12), kind: 'edge' }])
  })
  it('both halves of the real roots', () => {
    for (const body of ['x^(1/3)', 'x^(2/3)']) {
      const xs = curveOf(run(explicit(body)).objects).chains.flatMap(chainPoints).map((p) => p.x)
      expect(Math.min(...xs)).toBeLessThan(-9)
      expect(Math.max(...xs)).toBeGreaterThan(9)
    }
  })
})

// The nearest a chain vertex comes to (x, y), in px at `pxPerUnit`.
const nearestPx = (objs: SceneObject[], x: number, y: number, pxPerUnit: number) =>
  Math.min(...curveOf(objs).chains.flatMap(chainPoints).map((p) => Math.hypot((p.x - x) * pxPerUnit, (p.y - y) * pxPerUnit)))
const viewOf = (half: number) => ({ bounds: { xMin: -half, xMax: half, yMin: -half, yMax: half }, widthPx: 800, heightPx: 800 })

describe('sampleCurve — holes, jumps and edges are anchored, not approached', () => {
  it('a hole is one chain with a vertex at (tc, limit) and no break of any kind', () => {
    const r = run(explicit('(x^2 - 1)/(x - 1)'))
    const c = curveOf(r.objects)
    expect(c.breaks).toEqual([])
    const chain = c.chains[0]
    const i = chainPoints(chain).findIndex((p) => p.x >= 1 - 1e-9)
    expect(chainPoints(chain)[i]).toEqual({ x: expect.closeTo(1, 12), y: expect.closeTo(2, 6) })
    expect(chain.param[i]).toBeCloseTo(1, 12)
    // the parameters keep increasing through it
    for (let k = 1; k < chain.param.length; k++) expect(chain.param[k]).toBeGreaterThan(chain.param[k - 1])
  })
  it('holes between the grid lines of the start grid are all one chain, open at 2a', () => {
    for (const a of [-7.3, -4.1, -1.7, 0.3, 2.9, 5.6, 8.2]) {
      const r = run(explicit(`(x^2 - (${a})^2)/(x - (${a}))`))
      const holes = marksOf(r.objects).filter((m) => m.role === 'hole')
      expect(holes, `a = ${a}`).toHaveLength(1)
      expect(holes[0].at.y).toBeCloseTo(2 * a, 4)
      expect(curveOf(r.objects).chains, `a = ${a}`).toHaveLength(1)
      expect(curveOf(r.objects).breaks, `a = ${a}`).toEqual([])
    }
  })
  it('a hole with a value of its own: open at the limit, filled at the value, still one chain', () => {
    const r = run(explicit('{x != 1: x, 5}'))
    expect(marksOf(r.objects).map((m) => [m.id.object, m.role, m.fill, m.at.x, m.at.y])).toEqual([
      ['hole.0', 'hole', 'open', expect.closeTo(1, 12), expect.closeTo(1, 6)],
      ['value.0', 'value', 'filled', 1, 5],
    ])
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })
  it('a jump: the left chain ends at the left limit and the right begins at the right one, both at the spot', () => {
    const c = curveOf(run(explicit('floor(x)')).objects)
    const ends = c.chains.map((ch) => ({ last: chainPoints(ch).at(-1)!, lastT: ch.param.at(-1)!, first: chainPoints(ch)[0], firstT: ch.param[0] }))
    expect(ends.some((e) => Math.abs(e.last.x - 1) < 1e-9 && Math.abs(e.last.y) < 1e-9 && Math.abs(e.lastT - 1) < 1e-9)).toBe(true)
    expect(ends.some((e) => Math.abs(e.first.x - 1) < 1e-9 && Math.abs(e.first.y - 1) < 1e-9 && Math.abs(e.firstT - 1) < 1e-9)).toBe(true)
  })
  it('a value that is neither limit is its own filled mark, after the two ends', () => {
    const r = run(explicit('{x < 0: x^2, x > 0: x + 1, 5}'))
    expect(marksOf(r.objects).map((m) => [m.id.object, m.fill, Math.round(m.at.x), Math.round(m.at.y)])).toEqual([
      ['end.0', 'open', 0, 0],
      ['end.1', 'open', 0, 1],
      ['value.0', 'filled', 0, 5],
    ])
  })
  it('an arc reaches both tips, with edge breaks only and no mark', () => {
    for (const [body, tip, half] of [['sqrt(1 - x^2)', 1, 2], ['x sqrt(4 - x^2)', 2, 3], ['sqrt(9 - x^2)', 3, 4]] as const) {
      const r = sampleCurve(explicit(body), viewOf(half), scopeOf(), opts)
      const pxPerUnit = 400 / half
      expect(nearestPx(r.objects, tip, 0, pxPerUnit), body).toBeLessThan(0.25)
      expect(nearestPx(r.objects, -tip, 0, pxPerUnit), body).toBeLessThan(0.25)
      expect(curveOf(r.objects).breaks.map((b) => b.kind), body).toEqual(['edge', 'edge'])
      expect(marksOf(r.objects), body).toHaveLength(0)
      expect(curveOf(r.objects).chains, body).toHaveLength(1)
    }
  })
  it('an edge whose limit diverges is neither anchored, marked nor reached for', () => {
    const r = run(explicit('1/sqrt(x)'))
    expect(marksOf(r.objects)).toHaveLength(0)
    expect(curveOf(r.objects).breaks).toEqual([{ at: expect.closeTo(0, 12), kind: 'edge' }])
    // it climbs off the top of the box from just inside the edge: nothing is drawn at x <= 0
    expect(curveOf(r.objects).chains.flatMap(chainPoints).every((p) => p.x > 0)).toBe(true)
  })
  it('an edge is recorded once, whichever side of it is undefined', () => {
    for (const body of ['sqrt(x)', 'ln(x)', 'acos(x)']) {
      const r = run(explicit(body))
      expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'edge'), body).toHaveLength(body === 'acos(x)' ? 2 : 1)
      expect(curveOf(r.objects).breaks.filter((b) => b.kind !== 'edge'), body).toEqual([])
      expect(curveOf(r.objects).chains, body).toHaveLength(1)
    }
  })
  it('a regular spot is not a cut, and an unknown one is left to the core', () => {
    // sqrt(x^2) has a zero under its root and is continuous through it: one chain, nothing recorded
    const regular = run(explicit('sqrt(x^2)'))
    expect(curveOf(regular.objects).chains).toHaveLength(1)
    expect(curveOf(regular.objects).breaks).toEqual([])
    expect(regular.objects).toHaveLength(1)
    // sin(1/x) has no limit at 0: no hole, no pole, no guide, and the core still draws it
    const unknown = run(explicit('sin(1/x)'))
    expect(curveOf(unknown.objects).chains.length).toBeGreaterThan(0)
    expect(marksOf(unknown.objects)).toHaveLength(0)
    expect(guidesOf(unknown.objects)).toHaveLength(0)
    expect(curveOf(unknown.objects).breaks.some((b) => b.kind === 'pole')).toBe(false)
  })
  it('a closed seam edge is filled and an open one is open, on a curve of its own', () => {
    const r = run(explicit('x^2', '-2 <= x < 2'))
    expect(marksOf(r.objects).map((m) => [Math.round(m.at.x), Math.round(m.at.y), m.fill])).toEqual([[-2, 4, 'filled'], [2, 4, 'open']])
  })
})

// An anchor says where a curve arrives, not that nothing is in the way: a singularity the walk
// never located (a built-in with no structure rule, a sum whose bound is a @param, a zero the
// classifier called unknown) can sit in the last floor interval before it.
describe('sampleCurve — an anchor is not a licence to connect', () => {
  it.each([
    ['a hole', 'sin(x)/x + 0.001 perm(x - 0.9999, 0.5)', '', -1e-4],
    ['a jump', 'floor(x) + 0.001 perm(x - 1.9999, 0.5)', '', 1 - 1e-4],
    ['a sqrt edge', 'sqrt(x) + 0.001 perm(x - 1.0001, 0.5)', '', 1e-4],
    ['floor jumps, and a sum whose bound is a @param', 'floor(x) + sum(k = 1 to n, 0.01/(x - k - 0.001))', '@param n = 3 range [1, 5]', 1.001],
    ['a sqrt edge, and a one-sided pole the classifier cannot name', 'sqrt(x) + exp(0.001/(x - 0.001))', '', 0.001],
    ['a hole, and a one-sided pole the classifier cannot name', 'sin(x)/x + exp(0.001/(-x - 0.001))', '', -0.001],
  ])('a pole the walk does not find, next to %s, is not bridged', (_name, body, defs, at) => {
    // (the false connectors were 120 to 960 px strokes straight through the pole)
    noChainCrosses(run(explicit(body), defs).objects, at)
  })
  it('still reaches a root tip that closes slowly, (1 - x^2)^0.4, with no break but the edge', () => {
    // (at an anchorShrink of 0.75 the gaps of this tip, which close by 0.76 a halving, were refused)
    for (const half of [10, 5]) {
      const r = sampleCurve(explicit('(1 - x^2)^0.4'), viewOf(half), scopeOf(), opts)
      expect(nearestPx(r.objects, 1, 0, 400 / half), `half ${half}`).toBeLessThan(0.5)
      expect(nearestPx(r.objects, -1, 0, 400 / half), `half ${half}`).toBeLessThan(0.5)
      expect(curveOf(r.objects).breaks.map((b) => b.kind), `half ${half}`).toEqual(['edge', 'edge'])
    }
  })
})

// The limit a mark is at is read again close in to the spot, but not so far from what limits.ts
// read that the fill (which compares it with the curve's own value at 0.05 px) changes its mind.
describe('sampleCurve — a re-read limit does not change a fill', () => {
  it('{x < 7: (x^2 - 49)/(x - 7), x > 7: x + 5, 14}: left end filled, right open, no stray value mark, at every zoom', () => {
    for (const half of [0.3, 0.35, 0.5, 1, 2, 5]) {
      const v = { bounds: { xMin: 7 - half, xMax: 7 + half, yMin: 14 - half, yMax: 14 + half }, widthPx: 800, heightPx: 800 }
      const r = sampleCurve(explicit('{x < 7: (x^2 - 49)/(x - 7), x > 7: x + 5, 14}'), v, scopeOf(), opts)
      expect(marksOf(r.objects).map((m) => [m.id.object, m.fill, Math.round(m.at.y)]), `half ${half}`).toEqual([['end.0', 'filled', 14], ['end.1', 'open', 12]])
    }
  })
})

// "<" against "<=" is the author's, and no sample can tell it where the seam is not an exact double.
describe('sampleCurve — a comparison says who owns its seam', () => {
  // the mark at the seam whose end has the given y (the piece the comparison holds on)
  const endAt = (objs: SceneObject[], x: number, y: number) => marksOf(objs).find((m) => Math.abs(m.at.x - x) < 1e-9 && Math.abs(m.at.y - y) < 1e-6)
  it.each([
    ['x^2', 2, Math.SQRT2],
    ['x^3', 5, Math.cbrt(5)],
  ])('{%s < %i: 0, 1}: the piece it holds on is open, the other filled; with <= the other way round', (lhs, rhs, seam) => {
    // the comparison holds to the left of the positive seam: that piece is 0. Strict, it is false AT the
    // seam, so the seam belongs to the 1 that carries on from the right; inclusive, it is the 0's.
    const strict = run(explicit(`{${lhs} < ${rhs}: 0, 1}`))
    const inclusive = run(explicit(`{${lhs} <= ${rhs}: 0, 1}`))
    expect([endAt(strict.objects, seam, 0)?.fill, endAt(strict.objects, seam, 1)?.fill]).toEqual(['open', 'filled'])
    expect([endAt(inclusive.objects, seam, 0)?.fill, endAt(inclusive.objects, seam, 1)?.fill]).toEqual(['filled', 'open'])
    // and no mark of a value of its own: what the curve computes AT an irrational seam is not asked
    expect(marksOf(strict.objects).filter((m) => m.role === 'value')).toEqual([])
    expect(marksOf(inclusive.objects).filter((m) => m.role === 'value')).toEqual([])
  })
  it('sin(x) >= 0 against sin(x) > 0 at pi', () => {
    const inclusive = run(explicit('{sin(x) >= 0: 0, 1}'))
    const strict = run(explicit('{sin(x) > 0: 0, 1}'))
    // sin is positive to the left of pi, so that is the piece the comparison holds on
    expect([endAt(inclusive.objects, Math.PI, 0)?.fill, endAt(inclusive.objects, Math.PI, 1)?.fill]).toEqual(['filled', 'open'])
    expect([endAt(strict.objects, Math.PI, 0)?.fill, endAt(strict.objects, Math.PI, 1)?.fill]).toEqual(['open', 'filled'])
  })
  it('a comparison facing the other way: {x^2 > 2: 1, 0} owns its seam from the other side', () => {
    // x^2 > 2 holds to the RIGHT of the positive root, where the piece is 1; strict, the seam is the 0's
    const strict = run(explicit('{x^2 > 2: 1, 0}'))
    const inclusive = run(explicit('{x^2 >= 2: 1, 0}'))
    expect([endAt(strict.objects, Math.SQRT2, 0)?.fill, endAt(strict.objects, Math.SQRT2, 1)?.fill]).toEqual(['filled', 'open'])
    expect([endAt(inclusive.objects, Math.SQRT2, 0)?.fill, endAt(inclusive.objects, Math.SQRT2, 1)?.fill]).toEqual(['open', 'filled'])
  })
  it('the exact seams keep their fills, whichever way the comparison faces', () => {
    const fills = (body: string) => marksOf(run(explicit(body)).objects).filter((m) => Math.abs(m.at.x - 1) < 1e-9).map((m) => [m.at.y, m.fill])
    expect(fills('{x > 1: 0, 1}')).toEqual([[expect.closeTo(1, 9), 'filled'], [expect.closeTo(0, 9), 'open']])
    expect(fills('{x >= 1: 0, 1}')).toEqual([[expect.closeTo(1, 9), 'open'], [expect.closeTo(0, 9), 'filled']])
  })
  it.each([
    ['x^2 < 2', 'open', 'open'],
    ['x^2 <= 2', 'filled', 'filled'],
  ])('a domain %s: its two edges are %s', (domain, left, right) => {
    const r = run(explicit('x', domain))
    expect(marksOf(r.objects).map((m) => [Math.round(m.at.x * 100), m.fill])).toEqual([[-141, left], [141, right]])
  })
  it.each([
    ['x^3 < 5', 'open'],
    ['x^3 <= 5', 'filled'],
  ])('a domain %s: its one edge is %s', (domain, fill) => {
    expect(marksOf(run(explicit('x', domain)).objects).map((m) => [m.at.x, m.fill])).toEqual([[expect.closeTo(Math.cbrt(5), 9), fill]])
  })
  it('the chain of 0 <= x < 3 is filled at its closed end and open at its open one', () => {
    const r = run(explicit('2', '0 <= x < 3'))
    expect(marksOf(r.objects).map((m) => [Math.round(m.at.x), m.fill])).toEqual([[0, 'filled'], [3, 'open']])
  })
  it('1 < x^2 <= 2: each edge follows its own operator', () => {
    const r = run(explicit('2', '1 < x^2 <= 2'))
    expect(marksOf(r.objects).map((m) => [Math.round(m.at.x * 100), m.fill])).toEqual([[-141, 'filled'], [-100, 'open'], [100, 'open'], [141, 'filled']])
  })
  it('= and != hold at a point and not on a side: an open hole, and a filled value mark where the curve has a value', () => {
    for (const body of ['{x != 1: x, 5}', '{x = 1: 5, x}']) {
      const r = run(explicit(body))
      expect(marksOf(r.objects).map((m) => [m.role, m.fill, m.at.y]), body).toEqual([['hole', 'open', expect.closeTo(1, 6)], ['value', 'filled', 5]])
    }
  })
  it('two comparisons of one a - b that agree on the owner give it to that side, the two-branch form included', () => {
    // x^2 < 2 is false at the seam and x^2 >= 2 true: both give it to the 1 on the right
    const both = (a: string, b: string, seam: number) => {
      const r = run(explicit(`{${a}: 0, ${b}: 1}`))
      return [endAt(r.objects, seam, 0)?.fill, endAt(r.objects, seam, 1)?.fill]
    }
    expect(both('x^2 < 2', 'x^2 >= 2', Math.SQRT2)).toEqual(['open', 'filled'])
    expect(both('x^2 <= 2', 'x^2 > 2', Math.SQRT2)).toEqual(['filled', 'open'])
    expect(both('x^3 < 5', 'x^3 >= 5', Math.cbrt(5))).toEqual(['open', 'filled'])
    expect(both('x^3 <= 5', 'x^3 > 5', Math.cbrt(5))).toEqual(['filled', 'open'])
    // and facing the other way round: here the 0 is on the right, where x^2 >= 2 holds and is true at the seam
    expect(both('x^2 >= 2', 'x^2 < 2', Math.SQRT2)).toEqual(['filled', 'open'])
  })
  it('two comparisons of two a - b that agree on the owner give it to that side', () => {
    // x^2 - 2 < 0 and 2 - x^2 > 0 both hold left of the root and are false at it: the right owns it
    const r = run(explicit('{x^2 < 2: 0, 1} + {2 - x^2 > 0: 0, 1}'))
    expect([endAt(r.objects, Math.SQRT2, 0)?.fill, endAt(r.objects, Math.SQRT2, 2)?.fill]).toEqual(['open', 'filled'])
    expect(marksOf(r.objects).filter((m) => m.role === 'value')).toEqual([])
    // the inclusive pair
    const inclusive = run(explicit('{x^2 <= 2: 0, 1} + {2 - x^2 >= 0: 0, 1}'))
    expect([endAt(inclusive.objects, Math.SQRT2, 0)?.fill, endAt(inclusive.objects, Math.SQRT2, 2)?.fill]).toEqual(['filled', 'open'])
  })
  it('comparisons that disagree on the owner fall back to the value at the spot', () => {
    // < gives the seam to the right, <= to the left: the curve is 1 + 2 = 3 at x = 1, which is neither limit
    const r = run(explicit('{x < 1: 0, 1} + {x <= 1: 2, 3}'))
    expect(marksOf(r.objects).map((m) => [m.role, m.fill, m.at.y])).toEqual([['endpoint', 'open', 2], ['endpoint', 'open', 4], ['value', 'filled', 3]])
    // < and > of one a - b disagree as well, and the curve has no value at 0: both ends open
    const none = run(explicit('{x < 0: 0, x > 0: 1}'))
    expect(marksOf(none.objects).map((m) => [m.role, m.fill])).toEqual([['endpoint', 'open'], ['endpoint', 'open']])
  })
  it('an end is not filled where the curve has no value: an owner whose branch is 0/0 at the seam', () => {
    const f = 'sin(x^2 - 2x + 1)/(x^2 - 2x + 1)'
    // f(1) is 0/0 and its limit is 1: the seam is the exact double 1, so the value there is the curve's real one
    for (const [body, domain] of [[`{x <= 1: ${f}, 5}`, null], [f, 'x <= 1']] as const) {
      const r = run(explicit(body, domain))
      const end = marksOf(r.objects).find((m) => Math.abs(m.at.x - 1) < 1e-9 && Math.abs(m.at.y - 1) < 1e-6)
      expect(end?.fill, body).toBe('open')
    }
  })
  it('a = zero shared with a natural spot owns it for neither side: both ends open, the value a mark', () => {
    const r = run(explicit('{x = 1: 5, sign(x - 1)}'))
    expect(marksOf(r.objects).map((m) => [m.role, m.fill, m.at.y])).toEqual([['endpoint', 'open', -1], ['endpoint', 'open', 1], ['value', 'filled', 5]])
  })
})

describe('sampleCurve — defined is the curve, not what is visible', () => {
  it('a curve wholly off screen is defined, with no chains', () => {
    const r = run(explicit('x + 100'))
    expect(curveOf(r.objects).chains).toHaveLength(0)
    expect(r.defined).toBe(true)
    expect(r.tested).toBe(true)
  })
  it('a curve undefined everywhere is not, with or without a domain, and a domain it misses is untested', () => {
    expect(run(explicit('sqrt(-1 - x^2)')).defined).toBe(false)
    expect(run(explicit('x', 'x > 100'))).toMatchObject({ defined: false, tested: false })
    // tested, and defined nowhere in it: this is the one the message is for
    expect(run(explicit('sqrt(-x^2 - 1)', 'x > 0'))).toMatchObject({ defined: false, tested: true })
  })
  it('an off-screen parametric curve is defined too', () => {
    const r = run({ kind: 'parametric', param: 't', fx: expr('t + 100'), fy: expr('t'), from: -5, to: 5 })
    expect(curveOf(r.objects).chains).toHaveLength(0)
    expect(r.defined).toBe(true)
  })
  // fix round 1: the 25 % overscan is where the sampler looks, not where the picture is. y = sqrt(x - 12) has a stretch in
  // the overscan of a view of +-10 (x from 12 to 12.5) and none in the view, so it is undefined everywhere in view.
  it('counts the visible range only, for an explicit curve: y = sqrt(x - 12) is undefined in a view of +-10, y = sqrt(x - 9) is not', () => {
    expect(run(explicit('sqrt(x - 12)'))).toMatchObject({ defined: false, tested: true })
    expect(run(explicit('sqrt(x - 9)'))).toMatchObject({ defined: true, tested: true })
    expect(run({ kind: 'explicit', independent: 'y', body: expr('sqrt(y - 12)'), domain: null })).toMatchObject({ defined: false, tested: true })
    // a curve that is defined in view and off screen stays defined (and so silent), and so does one drawn in view
    expect(run(explicit('x + 100'))).toMatchObject({ defined: true, tested: true })
    expect(run(explicit('x'))).toMatchObject({ defined: true, tested: true })
    // a domain that holds only in the overscan tests nothing in view
    expect(run(explicit('x', 'x > 11'))).toMatchObject({ defined: false, tested: false })
  })
  it('polar and parametric keep their whole range', () => {
    // the curve exists only from t = 12, which is off screen (x = t): the whole range is its own, so it is defined
    const r = run({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('sqrt(t - 12)'), from: 0, to: 20 })
    expect(r.defined).toBe(true)
  })
})

// calc P2 task 7, fix round 1 (I1): a capped curve that drew nothing says so, but only if there was something to draw.
describe('sampleCurve — blankInView', () => {
  const tiny = { points: 50, intervals: 50 }
  const go = (body: string, budget = tiny) => sampleCurve(explicit(body), view, scopeOf(), { ...opts, budget })
  it('is true when the budget ran out, nothing was drawn, and the start grid has the curve in view', () => {
    // an integral certifies nothing, so what the cap leaves is nothing
    const r = go('integral(t = 0 to x, 2t)')
    expect(r.capped).toBe(true)
    expect(curveOf(r.objects).chains).toHaveLength(0)
    expect(r.blankInView).toBe(true)
  })
  it('is false for a curve that is not in view at all: the cap hid nothing', () => {
    const r = go('integral(t = 0 to x, 2t) + 1000')
    expect(r.capped).toBe(true)
    expect(curveOf(r.objects).chains).toHaveLength(0)
    expect(r.blankInView).toBe(false)
  })
  it('is false when something was drawn, and when the budget held', () => {
    const drawn = go('sin(3x)')
    expect(drawn.capped).toBe(true)
    expect(curveOf(drawn.objects).chains.length).toBeGreaterThan(0)
    expect(drawn.blankInView).toBe(false)
    expect(run(explicit('x^2')).blankInView).toBe(false)
  })
  // calc P2 final review, I4: it is not the cap's alone. Nothing drawn in view of a curve that has a point in view is a blank, whatever
  // the cause, and what is drawn only in the overscan is not drawing.
  it('is true of a curve the sampler could not certify (not capped), and false once it draws', () => {
    const stairs = run(explicit('floor(1000x)'))
    expect(stairs.capped).toBe(false)
    expect(stairs.drawnInView).toBe(false)
    expect(stairs.blankInView).toBe(true)
    expect(run(explicit('floor(10x)')).drawnInView).toBe(true)
  })
  it('counts only what is in the picture: a chain that is only in the overscan is not drawn in view', () => {
    // y = sqrt(x - 12) exists from x = 12, in the overscan of [-10, 10]; and the grid has no point in view, so it is not a blank either
    const r = run(explicit('sqrt(x - 12)'))
    expect(curveOf(r.objects).chains.length).toBeGreaterThan(0)
    expect(r.drawnInView).toBe(false)
    expect(r.blankInView).toBe(false)
  })
  it('a curve that is a point is defined, drawn (a filled value mark), and has no break and no chain', () => {
    for (const body of ['{x = 1: 5}', '{x = 1.05: 5}']) {
      const r = run(explicit(body))
      expect(r.defined, body).toBe(true)
      expect(r.drawnInView, body).toBe(true)
      expect(r.blankInView, body).toBe(false)
      expect(curveOf(r.objects).chains, body).toEqual([])
      expect(curveOf(r.objects).breaks, body).toEqual([])
      expect(marksOf(r.objects), body).toEqual([expect.objectContaining({ role: 'value', fill: 'filled', exact: true, at: { x: Number(body.match(/= ([\d.]+):/)![1]), y: 5 } })])
    }
  })
  it('and so is a point of a parametric curve: (t, {t = 1: 5}) over [-5, 5]', () => {
    const r = run({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('{t = 1: 5}'), from: -5, to: 5 })
    expect(r.defined).toBe(true)
    expect(marksOf(r.objects).map((m) => [m.role, m.at.x, m.at.y])).toEqual([['value', 1, 5]])
  })
})

describe('sampleCurve — assembly', () => {
  it('x = f(y): a pole breaks the curve and gets a horizontal guide', () => {
    const r = run({ kind: 'explicit', independent: 'y', body: expr('1/(y - 1)'), domain: null })
    expect(curveOf(r.objects).breaks).toEqual([{ at: expect.closeTo(1, 12), kind: 'pole' }])
    expect(guidesOf(r.objects)).toEqual([expect.objectContaining({ through: { x: expect.anything(), y: expect.closeTo(1, 12) }, direction: { x: 1, y: 0 }, id: { statement: 0, object: 'asymptote.0' } })])
    for (const ch of curveOf(r.objects).chains) {
      const ys = chainPoints(ch).map((p) => p.y)
      expect(ys.some((y) => y < 1 - 1e-9) && ys.some((y) => y > 1 + 1e-9)).toBe(false)
    }
  })
  it('a hole in a parametric curve and in a polar one is anchored too, with no guide', () => {
    for (const spec of [
      { kind: 'parametric', param: 't', fx: expr('sin(t)/t'), fy: expr('t'), from: -5, to: 5 },
      { kind: 'polar', body: expr('sin(theta)/theta'), from: -6, to: 6 },
    ] as const) {
      const r = run(spec)
      expect(marksOf(r.objects).filter((m) => m.role === 'hole')).toEqual([expect.objectContaining({ fill: 'open', at: { x: expect.closeTo(1, 6), y: expect.closeTo(0, 6) } })])
      expect(curveOf(r.objects).chains).toHaveLength(1)
      expect(guidesOf(r.objects)).toHaveLength(0)
    }
  })
  it('polar poles in degrees are at the degrees', () => {
    const r = run({ kind: 'polar', body: expr('1/cos(theta)'), from: 0, to: 360 }, '', 'degrees')
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'pole').map((b) => Math.round(b.at))).toEqual([90, 270])
  })
  it('the asymptote guides can be turned off, the typed breaks stay', () => {
    const r = sampleCurve(explicit('tan(x)'), view, scopeOf(), { ...opts, asymptotes: false })
    expect(guidesOf(r.objects)).toHaveLength(0)
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'pole')).toHaveLength(10)
  })
  it('the statement and the colour reach every object; a guide with no colour is gray', () => {
    const r = sampleCurve(explicit('tan(x) + floor(x)'), view, scopeOf(), { ...opts, statement: 7, color: 'red' })
    for (const o of r.objects) {
      expect(o.color).toBe('red')
      expect((o as { id: { statement: number } }).id.statement).toBe(7)
    }
    expect(guidesOf(run(explicit('tan(x)')).objects).every((g) => g.color === 'gray')).toBe(true)
  })
  it('the objects come in the order the contract says, and the breaks are sorted', () => {
    const r = run(explicit('tan(x) + floor(x)'))
    const kinds = r.objects.map((o) => o.kind)
    expect(kinds[0]).toBe('curve')
    expect(kinds.indexOf('line')).toBeGreaterThan(kinds.lastIndexOf('mark'))
    const at = curveOf(r.objects).breaks.map((b) => b.at)
    expect(at).toEqual([...at].sort((a, b) => a - b))
    const xs = marksOf(r.objects).map((m) => m.at.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })
  it('a compile error propagates, in the body and in the domain', () => {
    expect(() => run(explicit('nope(x)'))).toThrow(/nope/)
    expect(() => run(explicit('x', 'nope(x) > 1'))).toThrow(/nope/)
  })
  it('a spent budget still draws, says so, and still breaks at the poles', () => {
    const r = sampleCurve(explicit('tan(x)'), view, scopeOf(), { ...opts, budget: { points: 200, intervals: 200 } })
    expect(r.capped).toBe(true)
    expect(curveOf(r.objects).chains.length).toBeGreaterThan(0)
    for (const b of curveOf(r.objects).breaks.filter((k) => k.kind === 'pole')) noChainCrosses(r.objects, b.at)
    expect(run(explicit('tan(x)')).capped).toBe(false)
  })
  it('the coarse preset draws a smooth curve with fewer evaluations', () => {
    const full = run(explicit('x^2 + sin(3x)'))
    const coarse = sampleCurve(explicit('x^2 + sin(3x)'), view, scopeOf(), { ...opts, quality: 'coarse' })
    expect(curveOf(coarse.objects).chains).toHaveLength(1)
    expect(coarse.stats.points).toBeLessThan(full.stats.points)
  })
  it('a view or a range of no extent draws nothing, but still answers with the curve', () => {
    for (const r of [run(explicit('x'), '', 'radians', { ...view, bounds: { ...view.bounds, xMin: 1, xMax: 1 } }), run({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('t'), from: 2, to: 2 })]) {
      expect(curveOf(r.objects).chains).toEqual([])
      expect(r.defined).toBe(false)
      expect(r.stats).toEqual({ points: 0, intervals: 0 })
    }
  })
  it('reports what it evaluated, and whether anything was drawn', () => {
    const r = run(explicit('(x^2 - 1)/(x - 1)'))
    expect(r.stats.points).toBeGreaterThan(0)
    expect(r.stats.intervals).toBeGreaterThan(0)
    expect(r.defined).toBe(true)
    expect(r.tested).toBe(true)
    expect(run(explicit('x', 'x > 5')).tested).toBe(true)
  })
})

describe('sampleCurve — steep, polar, parametric', () => {
  it('y = 1000x and y = 1e6 (x - 3) draw', () => {
    for (const body of ['1000x', '1e6 (x - 3)']) expect(curveOf(run(explicit(body)).objects).chains.length).toBeGreaterThan(0)
  })
  it('r = 1/cos(theta) is a vertical line with no chord', () => {
    const r = run({ kind: 'polar', body: expr('1/cos(theta)'), from: 0, to: 2 * Math.PI })
    const c = curveOf(r.objects)
    expect(c.breaks.filter((b) => b.kind === 'pole').map((b) => b.at)).toEqual([expect.closeTo(Math.PI / 2, 12), expect.closeTo(3 * Math.PI / 2, 12)])
    for (const p of c.chains.flatMap(chainPoints)) expect(Math.abs(p.x - 1) * 40).toBeLessThanOrEqual(0.5)
  })
  it('a parametric curve with a pole breaks there', () => {
    const r = run({ kind: 'parametric', param: 't', fx: expr('t'), fy: expr('1/t'), from: -5, to: 5 })
    expect(curveOf(r.objects).breaks).toContainEqual({ at: expect.closeTo(0, 12), kind: 'pole' })
  })
  it('ids: the curve, marks by role in order, guides', () => {
    const r = run(explicit('floor(x) + 1/(x - 0.5)'))
    expect(curveOf(r.objects).id).toEqual({ statement: 0, object: 'curve' })
    expect(marksOf(r.objects)[0].id.object).toBe('end.0')
    expect(guidesOf(r.objects)[0].id).toEqual({ statement: 0, object: 'asymptote.0' })
  })
  it('a domain that excludes the whole view is not "tested"', () => {
    expect(run(explicit('x', 'x > 100')).tested).toBe(false)
  })
  it('is deterministic', () => {
    const a = run(explicit('tan(x) + floor(x) + sin(x)/x'))
    const b = run(explicit('tan(x) + floor(x) + sin(x)/x'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// calc P2 task 7, fix round 1 (S1): the twin of an integral says nothing (UNKNOWN), so nothing about it is certified and every
// interval is decided by the jump test at the floor. y = integral(t = 0 to x, 40 cos(t)) is 40 sin(x), which is steeper than 16:1
// over most of the view: it was broken at every floor interval, 8091 jump breaks and nothing drawn in view.
describe('sampleCurve — a smooth curve the twin cannot certify is drawn, not broken at every floor interval', () => {
  const bounds = view.bounds
  // the share of 401 x positions across the view where the true curve is in view that a drawn chain segment covers
  const covered = (objs: SceneObject[], f: (x: number) => number) => {
    const segs: [number, number][] = []
    for (const c of curveOf(objs).chains) {
      const p = chainPoints(c)
      for (let i = 0; i + 1 < p.length; i++) segs.push([Math.min(p[i].x, p[i + 1].x), Math.max(p[i].x, p[i + 1].x)])
    }
    let want = 0
    let have = 0
    for (let i = 0; i <= 400; i++) {
      const x = bounds.xMin + ((bounds.xMax - bounds.xMin) * i) / 400
      if (!(Math.abs(f(x)) <= bounds.yMax)) continue
      want++
      if (segs.some(([a, b]) => a <= x && x <= b)) have++
    }
    return { have, want }
  }
  const jumpsInView = (objs: SceneObject[], f: (x: number) => number) => curveOf(objs).breaks.filter((b) => b.kind === 'jump' && Math.abs(b.at) <= bounds.xMax && Math.abs(f(b.at)) <= bounds.yMax)

  // 40 sin(x) climbs about 9000 px in the box over the range, and under rule 1 every leaf of the floor test is a gap of under a
  // pixel, so what it costs is that travel (about 6 evaluations a pixel of it): 60000 points at FULL, where the budget caps it.
  // What is drawn is the curve, with no jump break in view, from the left; the scene says "drawn coarsely".
  it('y = integral(t = 0 to x, 40 cos(t)) draws at FULL and COARSE, on the curve, with no jump break in view (it caps, and says so)', () => {
    const f = (x: number) => 40 * Math.sin(x)
    for (const quality of ['full', 'coarse'] as const) {
      const r = sampleCurve(explicit('integral(t = 0 to x, 40 cos(t))'), view, scopeOf(), { ...opts, quality })
      const { have, want } = covered(r.objects, f)
      expect(want, quality).toBeGreaterThan(50)
      expect(curveOf(r.objects).chains.length, quality).toBeGreaterThan(0)
      expect(have / want, quality).toBeGreaterThan(quality === 'full' ? 0.8 : 0.1)
      expect(r.capped, quality).toBe(true)
      expect(r.blankInView, quality).toBe(false)
      expect(jumpsInView(r.objects, f), quality).toEqual([])
      // and it is the curve: every vertex within half a pixel of it
      for (const p of curveOf(r.objects).chains.flatMap(chainPoints)) expect(Math.abs(f(p.x) - p.y) * 40, quality).toBeLessThanOrEqual(0.5)
    }
  })
  // calc P2 final review, I5: the columns of an integral were all tried as bands (14 of the 22 evaluations a pixel), and now the
  // ones whose ends and midpoint are in order are not. A band is still a band, whole: the screen alone cut this one in 185.
  it('y = integral(t = 0 to x, 0) + sin(500x): one band at FULL, and no more than a few at COARSE, as before the screen', () => {
    const full = sampleCurve(explicit('integral(t = 0 to x, 0) + sin(500 x)'), view, scopeOf(), opts)
    expect(full.objects.filter((o) => o.kind === 'band')).toHaveLength(1)
    expect(curveOf(full.objects).chains).toHaveLength(0)
    expect(full.stats.points).toBeLessThan(20000)
    const coarse = sampleCurve(explicit('integral(t = 0 to x, 0) + sin(500 x)'), view, scopeOf(), { ...opts, quality: 'coarse' })
    expect(coarse.objects.filter((o) => o.kind === 'band').length).toBeLessThanOrEqual(3)
    expect(coarse.stats.points).toBeLessThan(9000)
  })
  it('the sine integral costs less than it did, and is the same curve: under 12000 points at FULL (it was 26401)', () => {
    const r = sampleCurve(explicit('integral(t = 0 to x, sin(t))'), view, scopeOf(), opts)
    expect(r.capped).toBe(false)
    expect(r.stats.points).toBeLessThan(12000)
    expect(curveOf(r.objects).chains).toHaveLength(1)
    const f = (x: number) => 1 - Math.cos(x)
    for (const p of chainPoints(curveOf(r.objects).chains[0])) expect(Math.abs(f(p.x) - p.y) * 40, `at ${p.x}`).toBeLessThanOrEqual(0.5)
  })
  it('y = integral(t = 0 to x, 2t) is drawn at COARSE, and at FULL', () => {
    const f = (x: number) => x * x
    for (const quality of ['coarse', 'full'] as const) {
      const r = sampleCurve(explicit('integral(t = 0 to x, 2t)'), view, scopeOf(), { ...opts, quality })
      const { have, want } = covered(r.objects, f)
      expect(want, quality).toBeGreaterThan(50)
      expect(have, quality).toBe(want)
      expect(jumpsInView(r.objects, f), quality).toEqual([])
    }
  })
  it('y = integral(t = 0 to x, 20), a straight line of slope 20, is drawn at FULL and COARSE', () => {
    const f = (x: number) => 20 * x
    for (const quality of ['coarse', 'full'] as const) {
      const r = sampleCurve(explicit('integral(t = 0 to x, 20)'), view, scopeOf(), { ...opts, quality })
      const { have, want } = covered(r.objects, f)
      expect(want, quality).toBeGreaterThan(10)
      expect(have, quality).toBe(want)
      expect(jumpsInView(r.objects, f), quality).toEqual([])
    }
  })
  // fix round 3: the depth below the floor is a width (1/1024 px) and not a count of halvings, so COARSE (floor 0.5 px) reaches the
  // leaves FULL does. By count it stopped at 1/128 px, and a slope of 200 or more was broken at every floor interval at COARSE:
  // integral(200) drew 0 of 19 positions in view, integral(1000) 0 of 5, with no budget cap and no message.
  it.each([['200', 19], ['1000', 5]])('y = integral(t = 0 to x, %s) is drawn everywhere it is in view, at COARSE and at FULL', (slope, _wantAtLeast) => {
    const f = (x: number) => Number(slope) * x
    // 41 positions across the stretch of x where the curve is in view (a slope of 1000 is in view for 0.02 of x: 0.8 px)
    const xs = Array.from({ length: 41 }, (_, i) => ((i / 20 - 1) * 10) / Number(slope))
    for (const quality of ['coarse', 'full'] as const) {
      const r = sampleCurve(explicit(`integral(t = 0 to x, ${slope})`), view, scopeOf(), { ...opts, quality })
      const segs = curveOf(r.objects).chains.flatMap((ch) => {
        const p = chainPoints(ch)
        return p.slice(1).map((q, i) => [Math.min(p[i].x, q.x), Math.max(p[i].x, q.x)] as const)
      })
      expect(xs.filter((x) => !segs.some(([a, b]) => a <= x && x <= b)), quality).toEqual([])
      expect(jumpsInView(r.objects, f), quality).toEqual([])
      expect(r.capped, quality).toBe(false)
      expect(r.tooSteep, quality).toBe(false)
    }
  })
  // past 1024:1 the leaves (1/1024 px) are still a pixel and more; the curve is lifted there, and the sampled curve says so
  it('y = integral(t = 0 to x, 2000) is too steep to certify: broken at the depth limit, and tooSteep says so, at both qualities', () => {
    for (const quality of ['coarse', 'full'] as const) {
      const r = sampleCurve(explicit('integral(t = 0 to x, 2000)'), view, scopeOf(), { ...opts, quality })
      expect(curveOf(r.objects).chains, quality).toEqual([])
      expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'jump').length, quality).toBeGreaterThan(0)
      expect(r.tooSteep, quality).toBe(true)
    }
  })
  it('a steep part outside the view is not "too steep to draw here": the curve is in the overscan only', () => {
    // 2000 (x - 12) is steep, and in the box (+-15) for x within 0.0075 of 12, which is the overscan of a view of +-10
    const r = run(explicit('integral(t = 0 to x, 2000) - 24000'))
    expect(r.tooSteep).toBe(false)
  })
  // and a real jump is not steepness: its gap does not shrink at the last level, a steep curve's does
  it('a jump the walk did not find is not "too steep": 200(x - 5) - 0.05 floor(50x) breaks, and tooSteep is false', () => {
    const r = run(explicit('200 (x - 5) - 0.05 floor(50 x)'))
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'jump').length).toBeGreaterThan(0)
    expect(r.tooSteep).toBe(false)
  })

  // fix round 4 (rule 2). The core used to keep the first 64 places where the depth limit was reached with the gaps halving, and
  // the caller then looked for one IN VIEW: the left overscan (x from -15 to -10, a quarter of the box) filled the 64 before x
  // reached the view, and a curve of slope 3000 that was broken at 5466 places in view had no note. The core decides, as each place
  // is recorded, whether it is in the visible view, and carries one boolean.
  describe('the steepness is decided in view, whatever is steep out of it', () => {
    // 60 sin(50x) has slope 3000, and its crossings of the box (every 0.06 of x) are six floor intervals each: the 64 places the core kept
    // were the first ten crossings, in the left overscan, and the first crossing in view (x = -9.95) came after them
    it('y = integral(t = 0 to x, 0) + 60 sin(50 x) is tooSteep at FULL, the overscan first', () => {
      const r = sampleCurve(explicit('integral(t = 0 to x, 0) + 60 sin(50 x)'), view, scopeOf(), { ...opts, quality: 'full' })
      expect(r.tooSteep).toBe(true)
      expect(curveOf(r.objects).chains).toEqual([])
      expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'jump').length).toBeGreaterThan(64)
    })
    // The natural form of the same curve. It is run in a view of +-1 (800 px): an integral of cos(50 t) over [0, x] costs about 6 ms a
    // point at x = 15 (quadrature of 120 periods, cross-checked), and the view of +-10 takes five minutes at FULL.
    it('the natural form, y = integral(t = 0 to x, 3000 cos(50 t)), is tooSteep at FULL', () => {
      const small = { bounds: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, widthPx: 800, heightPx: 800 }
      const r = sampleCurve(explicit('integral(t = 0 to x, 3000 cos(50 t))'), small, scopeOf(), { ...opts, quality: 'full' })
      expect(r.tooSteep).toBe(true)
      expect(curveOf(r.objects).chains).toEqual([])
      expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'jump').length).toBeGreaterThan(0)
    }, 60000)
    it('a steep stretch only in the overscan stays silent, and one that reaches the view does not: 2000 - 24000 and 2000', () => {
      expect(run(explicit('integral(t = 0 to x, 2000) - 24000')).tooSteep).toBe(false)
      expect(run(explicit('integral(t = 0 to x, 2000)')).tooSteep).toBe(true)
    })
  })

  // fix round 4 (rule 2, a false note). A jump riding a slope halves its gap in the 1/1024 px leaf too, if less, to (J + a)/(J + 2a) of its
  // parent's: 0.75 or under for J up to 2a, which the old steepness test (halvingShrink) took for a smooth curve. The test is steepShrink.
  describe('a jump riding a certifiable slope is a jump, not "too steep"', () => {
    it('y = 800 (x - 5) + 0.03 floor(50 x) breaks at its 1.2 px jumps in view and has no steepness note', () => {
      const r = run(explicit('800 (x - 5) + 0.03 floor(50 x)'))
      const f = (x: number) => 800 * (x - 5) + 0.03 * Math.floor(50 * x)
      const inView = curveOf(r.objects).breaks.filter((b) => b.kind === 'jump' && Math.abs(f(b.at)) <= 10)
      expect(inView.length).toBeGreaterThan(0)
      expect(r.tooSteep).toBe(false)
    })
    it.each([[600, 0.0275], [600, 0.03], [800, 0.0275], [800, 0.0375], [1000, 0.03], [1000, 0.0375]])('slope %s with a jump of %s units (1.1 to 1.5 px) is not tooSteep, at both qualities, and breaks', (slope, jump) => {
      const f = (x: number) => slope * (x - 5) + jump * Math.floor(50 * x)
      for (const quality of ['full', 'coarse'] as const) {
        const r = sampleCurve(explicit(`${slope} (x - 5) + ${jump} floor(50 x)`), view, scopeOf(), { ...opts, quality })
        const inView = curveOf(r.objects).breaks.filter((b) => b.kind === 'jump' && Math.abs(f(b.at)) <= 10)
        expect(inView.length, `${slope} ${jump} ${quality}`).toBeGreaterThan(0)
        expect(r.tooSteep, `${slope} ${jump} ${quality}`).toBe(false)
      }
    })
  })

  // fix round 2 (rule 1): 200(x - 5) rises 12.5 px in a floor interval and floor(50x) drops 2 px at every 0.02; the locator's
  // 64-zero cap leaves the jumps near 5 unlocated (it keeps the ones nearest 0), so the core meets them. The floor test followed
  // the larger-gap half only, and a jump against the slope is in the smaller one: 3 of the 5 in view were bridged, with no break.
  it('y = 200(x - 5) - 0.05 floor(50x) breaks at every one of its 2 px jumps in view, and no chain spans one', () => {
    const r = run(explicit('200 (x - 5) - 0.05 floor(50 x)'))
    const jumps = [251, 252, 253, 254, 255].map((k) => k / 50)
    for (const c of jumps) {
      expect(curveOf(r.objects).breaks.some((b) => b.kind === 'jump' && Math.abs(b.at - c) < 0.003), `a jump break at ${c}`).toBe(true)
      for (const ch of curveOf(r.objects).chains) {
        const xs = chainPoints(ch).map((p) => p.x)
        expect(xs.some((x) => x < c - 1e-9) && xs.some((x) => x > c + 1e-9), `a chain spans ${c}`).toBe(false)
      }
    }
  })
  it('an unlocated jump beside the integral is still a break: integral(t = 0 to x, 0) + {x < 0.1234: 0, 1}', () => {
    // (a piecewise seam is found by the walk; the jump test is for what it does not find)
    const r = run(explicit('integral(t = 0 to x, 0) + {x < 0.1234: 0, 1}'))
    for (const c of curveOf(r.objects).chains) {
      const xs = chainPoints(c).map((p) => p.x)
      expect(xs.some((x) => x < 0.1234 - 1e-9) && xs.some((x) => x > 0.1234 + 1e-9)).toBe(false)
    }
  })
})

// calc P2 task 7, rule 2: a curve never blanks silently. The locator's and the classifier's point evaluations used to
// share the counter the core's budget was checked against, so y = sqrt(sin(w x)) for w = 311 to 410 spent 64k to 169k
// points finding its zeros, the core found its budget gone, and the curve drew nothing, with no message. The locator
// has a budget of its own (LOCATE.pointsTotal), the core is checked against what it spends itself, and the stats are
// the total.
describe('sampleCurve — a curve never blanks because the locator spent the budget', () => {
  // what finding and classifying the trouble spots may cost on top of the core's budget: the locator stops between
  // clusters (one cluster's search is under 2500 points), and at most maxZeros spots are classified at under 100
  // points each
  const SPOTS = LOCATE.pointsTotal + 2500 + LOCATE.maxZeros * 100
  const drawn = (objs: SceneObject[]) => curveOf(objs).chains.length + objs.filter((o) => o.kind === 'band').length

  it.each([311, 350, 380, 410])('sqrt(sin(%dx)) draws chains or bands, and its stats stay within the sum of the budgets', (w) => {
    const r = run(explicit(`sqrt(sin(${w}x))`))
    expect(drawn(r.objects), `w = ${w}`).toBeGreaterThan(0)
    expect(r.stats.points, `w = ${w}`).toBeLessThanOrEqual(SPOTS + FULL.budget.points + 1000)
    expect(r.stats.intervals, `w = ${w}`).toBeLessThanOrEqual(LOCATE.intervalsTotal + FULL.budget.intervals + 1000)
  })
  it('the same at the coarse preset, whose core has a quarter of the budget', () => {
    for (const w of [311, 350, 410]) {
      const r = sampleCurve(explicit(`sqrt(sin(${w}x))`), view, scopeOf(), { ...opts, quality: 'coarse' })
      expect(drawn(r.objects), `w = ${w}`).toBeGreaterThan(0)
      expect(r.stats.points, `w = ${w}`).toBeLessThanOrEqual(SPOTS + COARSE.budget.points + 1000)
    }
  })
  it('a core that spends nothing is not reported as capped because the locator did', () => {
    // the budget is the core's: a curve with thousands of zeros and a core that fits is not "drawn coarsely"
    const r = run(explicit('tan(x)'))
    expect(r.capped).toBe(false)
  })
  it('the stats are the total of locating, classifying and sampling, not the core alone', () => {
    // a core budget of 50 is spent at once; locating the ten poles of tan and reading their limits costs far more, and it
    // is in the total
    const r = sampleCurve(explicit('tan(x)'), view, scopeOf(), { ...opts, budget: { points: 50, intervals: 50 } })
    expect(r.stats.points).toBeGreaterThan(500)
    expect(r.stats.intervals).toBeGreaterThan(50)
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'pole')).toHaveLength(10)
  })
})

// The dense-sample check (testing/dense.ts) over a curve built by sampleCurve: the first segment that spans a jump of the true
// curve, if any. y = f(x) only.
function bridgeOf(body: string, v = view, quality: 'full' | 'coarse' = 'full', defs = '') {
  const scope = scopeOf(defs)
  const r = sampleCurve(explicit(body), v, scope, { ...opts, quality })
  const f = trueY(body, scope)
  const { bounds } = v
  const sx = bounds.xMax - bounds.xMin
  const sy = bounds.yMax - bounds.yMin
  const clip = { xMin: bounds.xMin - FULL.overscan * sx, xMax: bounds.xMax + FULL.overscan * sx, yMin: bounds.yMin - FULL.overscan * sy, yMax: bounds.yMax + FULL.overscan * sy }
  const bridge = firstBridge(curveOf(r.objects).chains, (t) => ({ x: t, y: f(t) }), { x: v.widthPx / sx, y: v.heightPx / sy }, anchorSkip(r.objects, 0, 'x', clip))
  return { r, bridge }
}

// calc P2 final review, C1 (rule 1): the exemption for the last stretch to an anchor ran the jump test that follows only
// the larger-gap half of an interval, at anchorShrink, and overrode the floor test that had already found a leaf that does
// not close. On y = floor(1000 x) at COARSE it drew a 480 px chord from (-0.0122, -13) to the anchor of the jump at 0,
// across twelve jumps of 40 px; across floor(N x) false strokes reached 600 px (FULL N >= 5000, COARSE N >= 500). Not one
// segment of a staircase spans a jump now, whatever the density.
describe('sampleCurve — a dense staircase is never bridged to the anchor of its jump at 0', () => {
  it.each([500, 1000, 5000, 20000].flatMap((n) => (['full', 'coarse'] as const).map((q) => [n, q] as const)))('floor(%dx) at %s: no segment spans a jump', (n, q) => {
    const { bridge } = bridgeOf(`floor(${n} x)`, view, q)
    expect(bridge.size, `a segment from ${bridge.from} to ${bridge.to} spans a jump of ${bridge.size} px`).toBe(0)
    expect(bridge.checked).toBeGreaterThanOrEqual(0)
  })
  it('and no stroke of one is longer than a tread, in view or out of it', () => {
    for (const q of ['full', 'coarse'] as const) {
      const r = sampleCurve(explicit('floor(1000 x)'), view, scopeOf(), { ...opts, quality: q })
      let longest = 0
      for (const c of curveOf(r.objects).chains) {
        const p = chainPoints(c)
        for (let i = 0; i + 1 < p.length; i++) longest = Math.max(longest, Math.hypot((p[i + 1].x - p[i].x) * 40, (p[i + 1].y - p[i].y) * 40))
      }
      expect(longest, q).toBeLessThan(1)
    }
  })
})

// calc P2 final review, C2: at a zero that is not an exact double the scalar is not the curve. At the double nearest k pi,
// sin(x) is 1.2e-16, so sin(x)/sin(x) is "defined" there and equal to its limit: the hole was classified regular, with
// no ring and an untyped jump a sixteenth of a pixel wide for the core to find, at every k pi but 0. A denominator is 0
// at the real zero, so there the twin is asked about the curve over a few tolerances round it, and the point is
// undefined unless it says continuous and bounded (curve.ts pointAt).
describe('sampleCurve — a hole at a zero that is not an exact double is a hole, and not a value', () => {
  const inView = (m: { at: { x: number } }) => Math.abs(m.at.x) <= 10
  const holes = (objs: SceneObject[]) => marksOf(objs).filter((m) => m.role === 'hole' && inView(m))
  const PI = Math.PI
  const times = (ks: number[], f: (t: number) => number, scale = PI) => ks.map((k) => [k * scale, f(k * scale)] as const)
  it.each([
    ['sin(x)/sin(x)', times([-3, -2, -1, 0, 1, 2, 3], () => 1)],
    ['sin(2x)/sin(x)', times([-3, -2, -1, 0, 1, 2, 3], (t) => 2 * Math.cos(t))],
    ['cos(x)/cos(x)', times([-2.5, -1.5, -0.5, 0.5, 1.5, 2.5], () => 1)],
    ['(x^2 - 2)/(x^2 - 2)', [[-Math.SQRT2, 1], [Math.SQRT2, 1]] as const],
    ['(x^2 - 2)/(x^2 - 2) + x', [[-Math.SQRT2, 1 - Math.SQRT2], [Math.SQRT2, 1 + Math.SQRT2]] as const],
  ])('%s: every hole comes back, open, at its limit; one unbroken chain; no value mark', (body, want) => {
    const r = run(explicit(body))
    const found = holes(r.objects).sort((a, b) => a.at.x - b.at.x)
    expect(found.map((m) => m.fill)).toEqual(want.map(() => 'open'))
    want.forEach(([x, y], i) => {
      expect(found[i].at.x, body).toBeCloseTo(x, 9)
      expect(found[i].at.y, body).toBeCloseTo(y, 5)
    })
    expect(marksOf(r.objects).filter((m) => m.role !== 'hole'), body).toEqual([])
    expect(curveOf(r.objects).chains, body).toHaveLength(1)
    expect(curveOf(r.objects).breaks, body).toEqual([])
  })
  it('(x - pi)/sin(x): a hole at pi and no filled value dot at (pi, 0); poles where it is a pole', () => {
    const r = run(explicit('(x - pi)/sin(x)'))
    expect(holes(r.objects).map((m) => [m.at.x, m.at.y])).toEqual([[expect.closeTo(PI, 9), expect.closeTo(-1, 5)]])
    expect(marksOf(r.objects).filter((m) => m.role === 'value')).toEqual([])
    // (the sampled range is the view and its overscan: +-15 holds +-4 pi)
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'pole').map((b) => b.at)).toEqual([-4, -3, -2, -1, 0, 2, 3, 4].map((k) => expect.closeTo(k * PI, 9)))
  })
  it('sin(x)/abs(sin(x)): a jump at every k pi with both ends open, none filled, and no value mark', () => {
    const r = run(explicit('sin(x)/abs(sin(x))'))
    const ends = marksOf(r.objects).filter((m) => m.role === 'endpoint' && inView(m))
    expect(ends).toHaveLength(14)
    expect(ends.every((m) => m.fill === 'open')).toBe(true)
    expect(marksOf(r.objects).filter((m) => m.role === 'value')).toEqual([])
  })
  it('tan(x) cos(x): a hole at each pole of the tangent (it is undefined there, whatever sin(x) is)', () => {
    const r = run(explicit('tan(x) cos(x)'))
    expect(holes(r.objects).map((m) => [Math.round((m.at.x / PI) * 2), Math.round(m.at.y)])).toEqual([[-5, -1], [-3, 1], [-1, -1], [1, 1], [3, -1], [5, 1]])
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })
  it('a seam can keep the zero out: {x != pi: sin(x - pi)/sin(x), -1} is -1 AT pi, so there is no hole there', () => {
    const r = run(explicit('{x != pi: sin(x - pi)/sin(x), -1}'))
    expect(holes(r.objects).map((m) => Math.round(m.at.x / PI))).toEqual([-3, -2, -1, 0, 2, 3])
    expect(marksOf(r.objects).filter((m) => Math.abs(m.at.x - PI) < 1e-6)).toEqual([])
    expect(marksOf(r.objects).filter((m) => m.role === 'value')).toEqual([])
  })
  it('1/(1/x) is undefined at 0: a hole at the origin, on one chain', () => {
    const r = run(explicit('1/(1/x)'))
    expect(holes(r.objects)).toHaveLength(1)
    expect(curveOf(r.objects).chains).toHaveLength(1)
  })
  it('leaves the rest as it was: a pole, a hole at an exact zero, a seam, a floor, gamma, a filled value of its own', () => {
    const ends = (body: string) => marksOf(run(explicit(body)).objects).filter(inView).map((m) => [m.role, m.fill, Math.round(m.at.x * 1e6) / 1e6, Math.round(m.at.y * 1e6) / 1e6])
    expect(ends('{x < 1: 1/(x - 2), 5}')).toEqual([['endpoint', 'open', 1, -1], ['endpoint', 'filled', 1, 5]])
    expect(ends('{x != 1: x, 5}')).toEqual([['hole', 'open', 1, 1], ['value', 'filled', 1, 5]])
    expect(ends('x/x')).toEqual([['hole', 'open', 0, 1]])
    expect(ends('1/x')).toEqual([])
    expect(ends('tan(x)')).toEqual([])
    expect(ends('gamma(x)')).toEqual([])
    const floor = marksOf(run(explicit('floor(x)')).objects).filter((m) => Math.abs(m.at.x - 1) < 1e-9)
    expect(floor.map((m) => [m.fill, m.at.y])).toEqual([['open', 0], ['filled', 1]])
  })
})

// calc P2 final review, C2's deferred family (task 5): a seam at an irrational zero that a natural spot has too. The comparison
// says which side owns the zero, but the owner is undefined there ({x^2 <= 2: sin(x^2 - 2)/(x^2 - 2), 5} at the root of 2:
// 0/0) or steps ({x^2 <= 2: floor(x^2), 5}: 2 there, not the 1 of its left limit), and the filled end was where the curve
// is not. Both ends are open, and no value is marked (the scalar's value at the double is rounding).
describe('sampleCurve — a natural spot at an irrational seam opens both ends', () => {
  const at = (body: string) => marksOf(run(explicit(body)).objects).filter((m) => Math.abs(Math.abs(m.at.x) - Math.SQRT2) < 1e-9)
  it.each(['{x^2 <= 2: sin(x^2 - 2)/(x^2 - 2), 5}', '{x^2 <= 2: floor(x^2), 5}'])('%s: four open ends at the two roots, no filled one, no value', (body) => {
    const marks = at(body)
    expect(marks.map((m) => [m.role, m.fill])).toEqual([['endpoint', 'open'], ['endpoint', 'open'], ['endpoint', 'open'], ['endpoint', 'open']])
  })
  it('and where nothing natural shares the seam the owner still fills its end', () => {
    expect(at('{x^2 <= 2: x, 5}').map((m) => m.fill).sort()).toEqual(['filled', 'filled', 'open', 'open'])
    expect(at('{x^2 < 2: x, 5}').map((m) => m.fill).sort()).toEqual(['filled', 'filled', 'open', 'open'])
  })
})

// calc P2 final review, I3: the core starts a singular end a floor's width (1/16 px) from its pole, and the curve is still
// climbing there: 1/x at +-100 stopped at y = 64, 144 px short of the top of the view (397 px at +-1000), tan x at +-100 the
// same, ln|x| 142 px and log|x| 288 px above the bottom of [-10, 10]. The last stretch is walked in certified pieces, toward
// the pole, until the drawn point leaves the clip box.
describe('sampleCurve — a pole is walked to the clip box', () => {
  const squareView = (half: number) => ({ bounds: { xMin: -half, xMax: half, yMin: -half, yMax: half }, widthPx: 800, heightPx: 800 })
  // At every pole of the curve in view, the chain vertex nearest it on each side is on the clip box: the curve has left the picture.
  const reachesBox = (body: string, half: number, quality: 'full' | 'coarse' = 'full') => {
    const r = sampleCurve(explicit(body), squareView(half), scopeOf(), { ...opts, quality })
    const c = curveOf(r.objects)
    const poles = c.breaks.filter((b) => b.kind === 'pole' && Math.abs(b.at) <= half).map((b) => b.at)
    const vertices = c.chains.flatMap(chainPoints)
    // (the clip box is the view widened by a quarter of its span on each side)
    const box = 1.5 * half
    const short: string[] = []
    for (const p of poles) {
      for (const side of [-1, 1]) {
        const mine = vertices.filter((v) => (v.x - p) * side > 0)
        const nearest = mine.reduce((a, b) => (Math.abs(b.x - p) < Math.abs(a.x - p) ? b : a))
        if (Math.abs(nearest.y) !== box) short.push(`${p} ${side > 0 ? 'right' : 'left'}: nearest vertex (${nearest.x}, ${nearest.y})`)
      }
    }
    return { poles, short }
  }
  it.each([
    ['1/x', 10],
    ['1/x', 100],
    ['1/x', 1000],
    ['1/(x - 1)', 100],
    ['1/x^2', 100],
    ['tan(x)', 100],
    ['tan(x)', 30],
  ])('%s at +-%d reaches the clip box at every pole, at FULL and COARSE', (body, half) => {
    for (const quality of ['full', 'coarse'] as const) {
      const { poles, short } = reachesBox(body, half, quality)
      expect(poles.length, `${body} at ${half}`).toBeGreaterThan(0)
      // (a pole of 1/x^2 is on one side of the axis only: both sides climb the same way)
      expect(short, `${body} at +-${half}, ${quality}`).toEqual([])
    }
  })
  it('ln|x|, log|x| and ln(x^2) dive to the bottom of the clip box, at FULL and COARSE', () => {
    for (const body of ['ln(abs(x))', 'log(abs(x))', 'ln(x^2)']) {
      for (const quality of ['full', 'coarse'] as const) {
        const r = sampleCurve(explicit(body), squareView(10), scopeOf(), { ...opts, quality })
        expect(Math.min(...curveOf(r.objects).chains.flatMap(chainPoints).map((p) => p.y)), `${body}, ${quality}`).toBe(-15)
      }
    }
  })
  it('a log of a wider view dives as far as the located pole is exact: the walk goes on until the doubles run out, not to a floor', () => {
    // (the pole of ln|x| is located to 1e-12, and the walk comes to it in halves: ln|x| at +-100 is 30 below where it was
    // 1/16 px from the pole (-4.2), and the clip box is 150 down)
    const r = sampleCurve(explicit('ln(abs(x))'), squareView(100), scopeOf(), opts)
    expect(Math.min(...curveOf(r.objects).chains.flatMap(chainPoints).map((p) => p.y))).toBeLessThan(-30)
  })
  it('no stroke is drawn through a second pole the walk does not know of', () => {
    // 1/x + 1/(x - 0.0011) has a pole at 0.0011, inside the stretch a pole at 0 is walked: the piece that holds it is not certified
    const r = run(explicit('1/x + 1/(x - 0.0011)'))
    noChainCrosses(r.objects, 0.0011)
  })
})

// calc P2 final review, minor 2: the locator reports 256 zeros, not 64, so tan x across +-200 (160 poles in the view and its
// overscan, +-300: 191) has a typed pole and a guide at every one.
describe('sampleCurve — every pole of tan x across +-200 is typed', () => {
  it('has a pole break and a guide at each pole of the sampled range, and no jump break the core had to find', () => {
    const v = { bounds: { xMin: -200, xMax: 200, yMin: -200, yMax: 200 }, widthPx: 800, heightPx: 800 }
    const r = sampleCurve(explicit('tan(x)'), v, scopeOf(), opts)
    const want: number[] = []
    for (let k = -200; k <= 200; k++) if (Math.abs((k + 0.5) * Math.PI) < 300 - 1e-6) want.push((k + 0.5) * Math.PI)
    expect(want.length).toBeGreaterThan(LOCATE.maxZeros / 2)
    expect(want.length).toBeLessThanOrEqual(LOCATE.maxZeros)
    const poles = curveOf(r.objects).breaks.filter((b) => b.kind === 'pole').map((b) => b.at)
    expect(poles).toHaveLength(want.length)
    want.forEach((p, i) => expect(poles[i]).toBeCloseTo(p, 8))
    expect(guidesOf(r.objects)).toHaveLength(want.length)
    expect(curveOf(r.objects).breaks.filter((b) => b.kind === 'jump')).toEqual([])
    for (const p of want) noChainCrosses(r.objects, p)
  })
})

// calc P2 final review, minor 1: COARSE's chords are 16 px, so a start grid of 8 px is accepted where it is flat: it was bisected
// whole (a chord of at most 8 px across an 8 px interval is level), and a smooth curve cost twice what it needed. spikeFactor went
// down as the chord went up (4 * 16 is the 8 * 8 it was: the tallest enclosure an interval can have and be flat), because
// with 8 and 16 px chords a fast oscillation sampled at the grid's spacing passed for flat, and was drawn as aliased chords.
describe('sampleCurve — COARSE chords are 16 px', () => {
  const coarse = { ...opts, quality: 'coarse' as const }
  it('a smooth curve costs about what the start grid does: sin x, x^2 and tan x', () => {
    expect(sampleCurve(explicit('sin(x)'), view, scopeOf(), coarse).stats.points).toBeLessThanOrEqual(320)
    expect(sampleCurve(explicit('x^2'), view, scopeOf(), coarse).stats.points).toBeLessThanOrEqual(350)
    expect(sampleCurve(explicit('tan(x)'), view, scopeOf(), coarse).stats.points).toBeLessThanOrEqual(3100)
  })
  it('and a fast oscillation is still one band, not bands with aliased chords between them: sin(wx) for w = 500 to 3000', () => {
    for (const w of [500, 1000, 1800, 3000]) {
      const r = sampleCurve(explicit(`sin(${w}x)`), view, scopeOf(), coarse)
      expect(r.objects.filter((o) => o.kind === 'band'), `w = ${w}`).toHaveLength(1)
      expect(curveOf(r.objects).chains, `w = ${w}`).toHaveLength(0)
    }
  })
  it('the chords of a smooth curve are up to 16 px, and no more', () => {
    let longest = 0
    for (const c of curveOf(sampleCurve(explicit('sin(x)'), view, scopeOf(), coarse).objects).chains) {
      const p = chainPoints(c)
      for (let i = 0; i + 1 < p.length; i++) longest = Math.max(longest, Math.hypot((p[i + 1].x - p[i].x) * 40, (p[i + 1].y - p[i].y) * 40))
    }
    expect(longest).toBeGreaterThan(8)
    expect(longest).toBeLessThanOrEqual(16)
  })
})

// calc P2 final review, I3: a steep root's tip that classify cannot call converged (a tail a little too long for convergePx)
// is anchored at its extrapolated limit, and the stretch to it is certified by the floor test (every half).
describe('sampleCurve — steep root tips are reached', () => {
  const tips: [string, { xMin: number; xMax: number; yMin: number; yMax: number; widthPx: number; heightPx: number }, number[]][] = [
    ['x sqrt(9 - x^2)', { xMin: -4, xMax: 4, yMin: -4, yMax: 4, widthPx: 800, heightPx: 800 }, [3, -3]],
    ['5 sqrt(1 - x^2)', { xMin: -2, xMax: 2, yMin: -2, yMax: 2, widthPx: 800, heightPx: 800 }, [1, -1]],
    ['(4 - x^2)^(1/4)', { xMin: -3, xMax: 3, yMin: -3, yMax: 3, widthPx: 800, heightPx: 800 }, [2, -2]],
    ['(4 - x^2)^(1/4)', { xMin: -3, xMax: 3, yMin: -1, yMax: 2, widthPx: 240, heightPx: 120 }, [2, -2]],
  ].map(([body, b, at]) => [body as string, b as never, at as number[]])
  it.each(tips.flatMap(([body, b, at]) => [0, 0.013, 0.037].flatMap((off) => (['full', 'coarse'] as const).map((q) => [body, b.widthPx, b, at, off, q] as const))))('%s at %d px, shifted by %#: within a pixel of both tips, edge breaks only (%s)', (body, _width, b, at, off, quality) => {
    const v = { bounds: { xMin: b.xMin + off, xMax: b.xMax + off, yMin: b.yMin, yMax: b.yMax }, widthPx: b.widthPx, heightPx: b.heightPx }
    const r = sampleCurve(explicit(body), v, scopeOf(), { ...opts, quality })
    const px = b.widthPx / (b.xMax - b.xMin)
    for (const x of at) expect(nearestPx(r.objects, x, 0, px), `${body} at ${x}, shifted by ${off}, ${quality}`).toBeLessThan(1)
    expect(curveOf(r.objects).breaks.map((br) => br.kind), body).toEqual(['edge', 'edge'])
  })
  it('a root too slow to draw to is not given an anchor it has not earned: (1 - x^2)^0.1 is drawn as it was, short of its tips', () => {
    const r = sampleCurve(explicit('(1 - x^2)^0.1'), viewOf(2), scopeOf(), opts)
    expect(nearestPx(r.objects, 1, 0, 200)).toBeGreaterThan(10)
  })
})
