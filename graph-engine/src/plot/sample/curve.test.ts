import { describe, expect, it } from 'vitest'
import { chainPoints } from '../../scene/chains'
import type { SceneObject } from '../../scene/types'
import { sampleCurve, type CurveSpec } from './curve'
import { condition, expr, scopeOf } from './testkit'

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
  ])('{%s < %i: 0, 1} is open on its own side and its <= twin is filled', (lhs, rhs, seam) => {
    // the comparison holds to the left of the positive seam: that piece is 0
    const strict = run(explicit(`{${lhs} < ${rhs}: 0, 1}`))
    const inclusive = run(explicit(`{${lhs} <= ${rhs}: 0, 1}`))
    expect(endAt(strict.objects, seam, 0)?.fill).toBe('open')
    expect(endAt(inclusive.objects, seam, 0)?.fill).toBe('filled')
    // the other piece does not own the seam when the comparison is inclusive
    expect(endAt(inclusive.objects, seam, 1)?.fill).toBe('open')
  })
  it('sin(x) >= 0 against sin(x) > 0 at pi', () => {
    const inclusive = run(explicit('{sin(x) >= 0: 0, 1}'))
    const strict = run(explicit('{sin(x) > 0: 0, 1}'))
    // sin is positive to the left of pi, so that is the piece whose end is the comparison's
    expect(endAt(inclusive.objects, Math.PI, 0)?.fill).toBe('filled')
    expect(endAt(inclusive.objects, Math.PI, 1)?.fill).toBe('open')
    expect(endAt(strict.objects, Math.PI, 0)?.fill).toBe('open')
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
  it('a zero two comparisons share has no comparison to follow, and the value decides, as before', () => {
    // != is both sides: the point is out, and the value mark says what is there
    const r = run(explicit('{x != 1: x, 5}'))
    expect(marksOf(r.objects).map((m) => [m.role, m.fill])).toEqual([['hole', 'open'], ['value', 'filled']])
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
