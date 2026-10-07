import { describe, expect, it } from 'vitest'
import { CONTINUOUS, PARTIAL, UNKNOWN } from '../../math/interval'
import type { Verdict } from '../../math/interval'
import type { Bounds, Chain, Vec2 } from '../../scene/types'
import { expr, scopeOf } from '../sample/testkit'
import type { EvalCounter, PxScale } from '../sample/types'
import { buildChains } from './chains'
import { type ContourBudget, type ContourResult, compileContour, contourLeaves, Crossings, newStats } from './contour'
import { allVertices, arms, curveDistPx, firstCrossing, lengthOf, nearestPx, nearestVertex, PX, segmentsOf, signedArea, trace, verticesOf, worstPx } from './testkit'
import { COARSE, FULL } from './tuning'
import type { Box, Leaf, LeafStop } from './types'

// ---------------------------------------------------------------------------------------------------------------
// The crossing of one edge
// ---------------------------------------------------------------------------------------------------------------

function crossingsOf(h: string, px: PxScale = PX) {
  const fns = compileContour(expr(h), scopeOf())
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const stats = newStats()
  return { cr: new Crossings(fns, px, counter, stats), counter, stats }
}

describe('Crossings: one edge', () => {
  it('locates a root by bisection, not interpolation', () => {
    // x^3 - 8 along y = 0 from 0 to 4: interpolating the ends (-8 and 56) puts the root at 0.5; it is at 2
    const { cr } = crossingsOf('x^3 - 8')
    const r = cr.crossing(cr.corner(0, 0), cr.corner(4, 0), true)
    expect(r && r.ok).toBe(true)
    if (!r || !r.ok) return
    expect(Math.abs(r.x - 2)).toBeLessThan(1e-4)
    expect(r.y).toBe(0)
  })

  it('is exact to a thousandth of a px, on horizontal and vertical edges', () => {
    const { cr } = crossingsOf('x^2 + y^2 - 25')
    const h = cr.crossing(cr.corner(4, 0), cr.corner(6, 0), true)
    const v = cr.crossing(cr.corner(0, 4), cr.corner(0, 6), true)
    if (!h || !h.ok || !v || !v.ok) throw new Error('no crossing')
    expect(Math.abs(h.x - 5) * PX.x).toBeLessThan(1e-3)
    expect(h.y).toBe(0)
    expect(v.x).toBe(0)
    expect(Math.abs(v.y - 5) * PX.y).toBeLessThan(1e-3)
  })

  it('takes about 12 steps from a 1 px edge', () => {
    // a 1 px edge at 40 px a unit, with a root inside it
    const { cr, counter } = crossingsOf('x - 0.01')
    const r = cr.crossing(cr.corner(0, 0), cr.corner(1 / 40, 0), true)
    expect(r && r.ok).toBe(true)
    // 2 corners, then a bisection to 2^-12 px of a 1 px edge: 12 or 13 steps
    expect(counter.points).toBeGreaterThanOrEqual(2 + 12)
    expect(counter.points).toBeLessThanOrEqual(2 + 13)
    expect(counter.intervals).toBe(0)
  })

  it('takes two steps more from an edge four times as long', () => {
    const { cr, counter } = crossingsOf('x - 0.04')
    cr.crossing(cr.corner(0, 0), cr.corner(4 / 40, 0), true)
    expect(counter.points).toBeGreaterThanOrEqual(2 + 14)
    expect(counter.points).toBeLessThanOrEqual(2 + 15)
  })

  it('gives the same crossing object whichever way the edge is asked for', () => {
    const { cr, counter } = crossingsOf('y - x')
    const a = cr.corner(0.5, 0.2)
    const b = cr.corner(0.5, 0.9)
    const r1 = cr.crossing(a, b, true)
    const spent = counter.points
    const r2 = cr.crossing(b, a, true)
    expect(r2).toBe(r1)
    expect(counter.points).toBe(spent)
    expect(cr.corner(0.5, 0.2)).toBe(a)
  })

  it('finds nothing without a sign change, or at an undefined corner', () => {
    const { cr } = crossingsOf('sqrt(x) - 1')
    expect(cr.crossing(cr.corner(2, 0), cr.corner(3, 0), true)).toBeNull()
    expect(cr.crossing(cr.corner(-1, 0), cr.corner(4, 0), true)).toBeNull()
    expect(cr.corner(-1, 0).v).toBeNaN()
  })

  it('puts the crossing at a corner where H is exactly zero, with no bisection', () => {
    const { cr, counter } = crossingsOf('y - x')
    const zero = cr.corner(0, 0)
    const below = cr.corner(1, 0)
    expect(zero.v).toBe(0)
    const r = cr.crossing(zero, below, true)
    expect(r).toEqual({ ok: true, x: 0, y: 0 })
    expect(counter.points).toBe(2)
  })

  it('counts the twin only where the leaf is not known continuous', () => {
    const a = crossingsOf('x^2 + y^2 - 25')
    a.cr.crossing(a.cr.corner(4, 0), a.cr.corner(6, 0), true)
    expect(a.counter.intervals).toBe(0)
    const b = crossingsOf('x^2 + y^2 - 25')
    b.cr.crossing(b.cr.corner(4, 0), b.cr.corner(6, 0), false)
    // the twin proves the first bracket continuous: one evaluation
    expect(b.counter.intervals).toBe(1)
    expect(b.stats.crossings).toBe(1)
  })

  it('rejects a pole: y - tan x changes sign across one, and is not zero there', () => {
    const { cr, counter, stats } = crossingsOf('y - tan(x)')
    const a = cr.corner(1.5, 0)
    const b = cr.corner(1.7, 0)
    expect(a.v >= 0).not.toBe(b.v >= 0)
    const r = cr.crossing(a, b, false)
    expect(r).toEqual({ ok: false, why: 'pole' })
    expect(stats.poles).toBe(1)
    // the chase to machine width is bounded: the bisection, then at most maxChase more steps and a handful of twin checks
    expect(counter.points).toBeLessThan(2 + 64 + 80 + 1)
    expect(counter.intervals).toBeLessThan(12)
    // and the verdict is kept for the leaf on the other side
    expect(cr.crossing(b, a, true)).toBe(r)
  })

  it('accepts a root of the same expression away from the pole', () => {
    const { cr, stats } = crossingsOf('y - tan(x)')
    const r = cr.crossing(cr.corner(1, 2), cr.corner(1.2, 2), false)
    expect(r && r.ok).toBe(true)
    if (!r || !r.ok) return
    expect(Math.abs(r.x - Math.atan(2))).toBeLessThan(1e-5)
    expect(stats.poles).toBe(0)
  })

  it('rejects a jump: floor(x) - y changes sign across the integers and is not zero there', () => {
    const { cr, stats } = crossingsOf('floor(x) - y')
    const r = cr.crossing(cr.corner(0.5, 0.5), cr.corner(1.5, 0.5), false)
    expect(r).toEqual({ ok: false, why: 'jump' })
    expect(stats.jumps).toBe(1)
    // along a plateau it is a root
    const s = crossingsOf('floor(x) - y')
    const plateau = s.cr.crossing(s.cr.corner(0.5, -0.5), s.cr.corner(0.5, 0.5), false)
    expect(plateau && plateau.ok).toBe(true)
    if (plateau && plateau.ok) expect(Math.abs(plateau.y)).toBeLessThan(1e-4)
  })

  it('rejects an edge that is undefined in the middle, though both ends are defined', () => {
    // sqrt(sin(10x)) is defined at 0 and at 0.7 and NaN between, at the midpoint 0.35
    const { cr, stats } = crossingsOf('sqrt(sin(10*x)) - 0.5')
    const a = cr.corner(0, 0)
    const b = cr.corner(0.7, 0)
    expect(a.v < 0 && b.v > 0).toBe(true)
    expect(cr.crossing(a, b, true)).toEqual({ ok: false, why: 'undefined' })
    expect(stats.undefinedEdges).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// One leaf, one piece
// ---------------------------------------------------------------------------------------------------------------

function leaf(x0: number, x1: number, y0: number, y1: number, verdict: Verdict = CONTINUOUS, stop: LeafStop = 'size'): Leaf {
  return { x0, x1, y0, y1, stop, verdict }
}

const CLIP: Box = { x0: -100, x1: 100, y0: -100, y1: 100 }

function contour(h: string, leaves: Leaf[], px: PxScale = PX, budget?: ContourBudget, clip: Box = CLIP) {
  const fns = compileContour(expr(h), scopeOf())
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const result = contourLeaves(leaves, fns, { px, clip }, counter, budget)
  return { ...result, counter }
}

function pairs(r: ContourResult): string[] {
  return r.segments.map((s) => {
    const a = [Math.round(s.a.x * 1e4) / 1e4 + 0, Math.round(s.a.y * 1e4) / 1e4 + 0]
    const b = [Math.round(s.b.x * 1e4) / 1e4 + 0, Math.round(s.b.y * 1e4) / 1e4 + 0]
    return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}-${b}` : `${b}-${a}`
  })
}

describe('contourLeaves: a piece in one leaf', () => {
  it('draws the line y = 0.3 through the unit leaf as one piece between the two crossings', () => {
    const r = contour('y - 0.3', [leaf(0, 1, 0, 1)])
    expect(r.segments.length).toBe(1)
    expect(pairs(r)).toEqual(['0,0.3-1,0.3'])
    expect(r.touches).toEqual([])
    expect(r.capped).toBe(false)
  })

  it('draws a curve through a corner of the leaf as a piece between the two crossings', () => {
    const r = contour('x + y - 0.5', [leaf(0, 1, 0, 1)])
    expect(pairs(r)).toEqual(['0,0.5-0.5,0'])
  })

  it('draws an X through the saddle point where the corners alternate and the saddle value is nothing', () => {
    const r = contour('(x - 0.5) * (y - 0.5)', [leaf(0, 1, 0, 1)])
    expect(r.segments.length).toBe(4)
    expect(r.stats.crosses).toBe(1)
    expect(r.stats.saddles).toBe(1)
    for (const s of r.segments) expect(s.b).toEqual({ x: 0.5, y: 0.5 })
    expect(pairs(r).sort()).toEqual(['0,0.5-0.5,0.5', '0.5,0-0.5,0.5', '0.5,0.5-0.5,1', '0.5,0.5-1,0.5'])
  })

  it('puts the X at the saddle of the interpolant, off the centre of the leaf', () => {
    // (x - 0.3)(y - 0.6): the saddle is at (0.3, 0.6)
    const r = contour('(x - 0.3) * (y - 0.6)', [leaf(0, 1, 0, 1)])
    expect(r.stats.crosses).toBe(1)
    expect(r.segments.every((s) => Math.abs(s.b.x - 0.3) < 1e-12 && Math.abs(s.b.y - 0.6) < 1e-12)).toBe(true)
  })

  // The X is certified: H must alternate in sign half a px (0.0125 units at 40 px a unit) from its centre along the bisectors of its arms. For
  // the branches xy = e that is e under (0.0125 / sqrt 2)^2 = 7.8e-5, which puts the centre sqrt(2e) = half a px or less from them.
  const probeE = (0.5 / 40 / Math.SQRT2) ** 2

  it('certifies an X at COARSE, wherever in the leaf its node is: the centre is within half a px of both branches, or the leaf draws two arcs', () => {
    // a COARSE leaf is 4.69 px, 0.1172 units at 40 px a unit; the branches (x - a)(y - a) = e, the node a fraction f of the leaf from its corner
    const h = 4.6875 / 40
    const px = { x: 40, y: 40 }
    for (const f of [0.5, 0.25, 0.1]) {
      const a = f * h
      for (const [e, drawn] of [
        [0.9 * probeE, true],
        [1.1 * probeE, false],
      ] as const) {
        // (toFixed: the parser would read the e of 6.8e-5 as Euler's constant)
        const text = `(x - ${a.toFixed(12)}) * (y - ${a.toFixed(12)}) - ${e.toFixed(12)}`
        const r = contour(text, [leaf(0, h, 0, h)], px)
        expect(r.stats.crosses, `f ${f}, e ${e}`).toBe(drawn ? 1 : 0)
        if (drawn) {
          // the centre is the one end that all four pieces share; sqrt(2e) from the branches
          const centre = r.segments[0].b
          expect(r.segments.every((s) => s.b === centre || (s.b.x === centre.x && s.b.y === centre.y))).toBe(true)
          expect(Math.sqrt(2 * e) * px.x).toBeLessThan(0.5)
        }
        // every other end is on a branch
        const ends = r.segments.flatMap((s) => [s.a, s.b]).filter((p) => Math.hypot(p.x - a, p.y - a) > 1e-9)
        for (const p of ends) expect(Math.abs((p.x - a) * (p.y - a) - e)).toBeLessThan(1e-6)
      }
    }
  })

  it('certifies the X of the corners as well, where the kernel has no second partials to find it by', () => {
    const h = 4.6875 / 40
    const px = { x: 40, y: 40 }
    // (the corners' own gate comes first: crossRel of the corner values is 0.02 (h/2)^2 = 6.9e-5, a little under the certificate's 7.8e-5)
    for (const [e, drawn] of [
      [0.8 * probeE, true],
      [0.95 * probeE, false],
      [1.1 * probeE, false],
    ] as const) {
      const text = `x * y - ${e.toFixed(12)}`
      const fns = { ...compileContour(expr(text), scopeOf()), hess: null }
      const counter: EvalCounter = { points: 0, intervals: 0 }
      const r = contourLeaves([leaf(-h / 2, h / 2, -h / 2, h / 2)], fns, { px, clip: CLIP }, counter)
      expect(r.stats.crosses, `e ${e}`).toBe(drawn ? 1 : 0)
      expect(r.stats.critical).toBe(0)
    }
  })

  it('does not take the corners for an X when H is not zero at the saddle: the centre H = -0.1 and no sign change round it', () => {
    // alternating corners and a bilinear saddle value of 0, but H is -0.1 at the centre and negative a half px round it
    const text = '(x - 0.5) * (y - 0.5) - 0.1 * (1 - 4 * (x - 0.5)^2) * (1 - 4 * (y - 0.5)^2)'
    const full = contour(text, [leaf(0, 1, 0, 1)])
    expect(full.stats.crosses).toBe(0)
    expect(full.stats.saddles).toBe(1)
    expect(full.segments.length).toBe(2)
    const noHess = contourLeaves([leaf(0, 1, 0, 1)], { ...compileContour(expr(text), scopeOf()), hess: null }, { px: PX, clip: CLIP }, { points: 0, intervals: 0 })
    expect(noHess.stats.crosses).toBe(0)
    expect(noHess.segments.length).toBe(2)
  })

  it('pairs a saddle whose value is under zero by cutting off the + corners: no arcs cross over', () => {
    // (x - .5)(y - .5) - 0.1 is negative at the saddle: the - corners (BR, TL) are joined, and the arcs round BL and TR
    const r = contour('(x - 0.5) * (y - 0.5) - 0.1', [leaf(0, 1, 0, 1)])
    expect(r.stats.crosses).toBe(0)
    expect(pairs(r).sort()).toEqual(['0,0.3-0.3,0', '0.7,1-1,0.7'])
  })

  it('pairs a saddle whose value is over zero by cutting off the - corners', () => {
    const r = contour('(x - 0.5) * (y - 0.5) + 0.1', [leaf(0, 1, 0, 1)])
    expect(r.stats.crosses).toBe(0)
    expect(pairs(r).sort()).toEqual(['0,0.7-0.3,1', '0.7,0-1,0.3'])
  })

  it('reads the saddle from the corner values, so the pairing follows the values and not the order of the corners', () => {
    // the same saddles with the roles of x and y swapped: the pairing swaps with them
    const r = contour('(y - 0.5) * (x - 0.5) + 0.1', [leaf(0, 1, 0, 1)])
    expect(pairs(r).sort()).toEqual(['0,0.7-0.3,1', '0.7,0-1,0.3'])
  })

  it('draws nothing in a leaf that holds a pole, and says so', () => {
    const r = contour('y - tan(x)', [leaf(1.5, 1.7, 0, 0.1, PARTIAL)])
    expect(r.segments).toEqual([])
    expect(r.stats.poles).toBeGreaterThan(0)
    expect(r.touches).toEqual([])
  })

  it('skips a leaf with an undefined corner, and counts it', () => {
    const r = contour('sqrt(x) - y', [leaf(-0.5, 0.5, 0, 1, PARTIAL)])
    expect(r.segments).toEqual([])
    expect(r.stats.undefinedLeaves).toBe(1)
    expect(r.touches).toEqual([])
  })

  it('draws a leaf whose verdict is not CONTINUOUS only through crossings the twin vouches for', () => {
    const r = contour('x^2 + y^2 - 0.25', [leaf(0, 1, 0, 1, PARTIAL)])
    expect(r.segments.length).toBe(1)
    expect(r.counter.intervals).toBeGreaterThan(0)
    const c = contour('x^2 + y^2 - 0.25', [leaf(0, 1, 0, 1, CONTINUOUS)])
    expect(c.counter.intervals).toBe(0)
  })

  it('every end of a piece is a zero of H', () => {
    const r = contour('x^2 + y^2 - 0.5', [leaf(0, 1, 0, 1)])
    const H = (x: number, y: number) => x * x + y * y - 0.5
    for (const s of r.segments) {
      expect(Math.abs(H(s.a.x, s.a.y))).toBeLessThan(1e-4)
      expect(Math.abs(H(s.b.x, s.b.y))).toBeLessThan(1e-4)
    }
  })
})

describe('contourLeaves: exact zeros at corners', () => {
  const h = 0.5
  // the four leaves round the origin
  const around = [leaf(-h, 0, -h, 0), leaf(0, h, -h, 0), leaf(-h, 0, 0, h), leaf(0, h, 0, h)]

  it('draws xy = 0 round a corner as the four edges that are zero, once each', () => {
    const r = contour('x * y', around)
    expect(pairs(r).sort()).toEqual(['-0.5,0-0,0', '0,-0.5-0,0', '0,0-0,0.5', '0,0-0.5,0'])
    expect(r.touches).toEqual([])
    // all four meet at the origin: two straight chains through it
    const chains = buildChains(r.segments, PX)
    expect(chains.length).toBe(2)
    expect(arms(chains, { x: 0, y: 0 })).toBe(4)
  })

  it('draws y^2 = x^2 round a corner as the diagonals, through the corners they pass', () => {
    const r = contour('y^2 - x^2', around)
    expect(pairs(r).sort()).toEqual(['-0.5,-0.5-0,0', '-0.5,0.5-0,0', '0,0-0.5,-0.5', '0,0-0.5,0.5'])
    const chains = buildChains(r.segments, PX)
    expect(chains.length).toBe(2)
  })

  it('draws the lemniscate round its node as four arms that start at the corner', () => {
    const r = contour('(x^2 + y^2)^2 - 2*(x^2 - y^2)', around)
    expect(r.segments.length).toBe(4)
    for (const s of r.segments) expect([s.a, s.b].some((p) => p.x === 0 && p.y === 0)).toBe(true)
    expect(arms(buildChains(r.segments, PX), { x: 0, y: 0 })).toBe(4)
  })

  it('draws a line through corners as one piece from corner to corner (y = x)', () => {
    const r = contour('y - x', [leaf(0, 1, 0, 1), leaf(1, 2, 1, 2), leaf(1, 2, 0, 1), leaf(0, 1, 1, 2)])
    expect(pairs(r).sort()).toEqual(['0,0-1,1', '1,1-2,2'])
  })

  it('draws a zero edge once when both leaves on its sides hold it', () => {
    // -y^2 is zero on the axis and negative on both sides: both leaves hold the zero edge
    const r = contour('-(y^2)', [leaf(0, 1, 0, 1), leaf(0, 1, -1, 0)])
    expect(pairs(r)).toEqual(['0,0-1,0'])
  })

  it('draws the double line y^2 = 0 on a grid line as its zero edge, not as touch points', () => {
    const r = contour('y^2', [leaf(0, 1, 0, 1), leaf(0, 1, -1, 0)])
    expect(pairs(r)).toEqual(['0,0-1,0'])
    expect(r.touches).toEqual([])
    expect(r.stats.touchCandidates).toBe(0)
  })

  it('draws no edges for a leaf that is zero throughout: a plateau is not a curve', () => {
    const r = contour('0 * x * y', [leaf(0, 1, 0, 1)])
    expect(r.segments).toEqual([])
  })

  it('joins a curve that meets a zero edge (a T) to the end of the edge nearer where it leaves it', () => {
    // x (y - 0.3): the zero edge is x = 0 (both its corners are zero); the curve y = 0.3 leaves it at height 0.3, near (0, 0)
    const low = contour('x * (y - 0.3)', [leaf(-1, 0, 0, 1)])
    expect(pairs(low).sort()).toEqual(['-1,0.3-0,0', '0,0-0,1'])
    // and at height 0.8, near (0, 1)
    const high = contour('x * (y - 0.8)', [leaf(-1, 0, 0, 1)])
    expect(pairs(high).sort()).toEqual(['-1,0.8-0,1', '0,0-0,1'])
    // the same on the other side of the edge
    const right = contour('x * (y - 0.3)', [leaf(0, 1, 0, 1)])
    expect(pairs(right).sort()).toEqual(['0,0-0,1', '0,0-1,0.3'])
  })

  it('leaves a leaf that only touches at a corner with nothing to draw', () => {
    const r = contour('x^2 + y^2', [leaf(0, 1, 0, 1)])
    expect(r.segments).toEqual([])
  })
})

describe('contourLeaves: the spend', () => {
  const row = Array.from({ length: 6 }, (_, i) => leaf(i * 0.01, (i + 1) * 0.01, -0.5, 0.5))

  it('counts points and twin evaluations on the counter it is given', () => {
    const r = contour('x - 0.025', row)
    expect(r.counter.points).toBeGreaterThan(0)
    expect(r.counter.intervals).toBe(0)
    const p = contour('x - 0.025', row.map((l) => ({ ...l, verdict: PARTIAL })))
    expect(p.counter.intervals).toBeGreaterThan(0)
  })

  it('stops before the leaf the budget has not paid for, and says it was capped', () => {
    const whole = contour('x - 0.025', row)
    const cut = contour('x - 0.025', row, PX, { points: 1, intervals: 1e9 })
    expect(whole.capped).toBe(false)
    expect(cut.capped).toBe(true)
    expect(cut.stats.leaves).toBeLessThan(row.length)
    expect(cut.counter.points).toBeLessThan(whole.counter.points)
    // a budget counts from where the counter stood
    const fns = compileContour(expr('x - 0.025'), scopeOf())
    const counter: EvalCounter = { points: 1000, intervals: 1000 }
    const late = contourLeaves(row, fns, { px: PX, clip: CLIP }, counter, { points: 1e9, intervals: 1e9 })
    expect(late.capped).toBe(false)
    expect(late.stats.leaves).toBe(row.length)
  })

  it('stops on the twin budget as well', () => {
    const r = contour('x - 0.025', row.map((l) => ({ ...l, verdict: PARTIAL })), PX, { points: 1e9, intervals: 1 })
    expect(r.capped).toBe(true)
  })
})

describe('contourLeaves: the clip box', () => {
  it('clips a piece to the box and keeps every vertex finite', () => {
    const r = contour('y - 0.5', [leaf(0, 4, 0, 1)], PX, undefined, { x0: 1, x1: 3, y0: -1, y1: 2 })
    expect(r.segments.length).toBe(1)
    expect([r.segments[0].a.x, r.segments[0].b.x].sort()).toEqual([1, 3])
    expect(r.segments[0].a.y).toBe(0.5)
    expect(r.segments[0].b.y).toBe(0.5)
    for (const s of r.segments) for (const p of [s.a, s.b]) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it('draws nothing of a piece wholly outside it', () => {
    const r = contour('y - 0.5', [leaf(0, 1, 0, 1)], PX, undefined, { x0: 5, x1: 6, y0: 0, y1: 1 })
    expect(r.segments).toEqual([])
  })
})

describe('contourLeaves: touch points', () => {
  it('finds the double line (y - 0.3)^2 = 0 in a leaf with no sign change', () => {
    const r = contour('(y - 0.3)^2', [leaf(0, 1, 0, 1)])
    expect(r.segments).toEqual([])
    expect(r.touches.length).toBe(1)
    expect(Math.abs(r.touches[0].y - 0.3) * PX.y).toBeLessThan(0.05)
    expect(r.touches[0].est).toBeLessThan(0.5)
    expect(r.stats.touchCandidates).toBe(1)
    expect(r.stats.touchPoints).toBe(1)
  })

  it('finds a point (x - 0.3)^2 + (y - 0.7)^2 = 0 off the corners of the leaf', () => {
    const r = contour('(x - 0.3)^2 + (y - 0.7)^2', [leaf(0, 1, 0, 1)])
    expect(r.touches.length).toBe(1)
    expect(Math.hypot(r.touches[0].x - 0.3, r.touches[0].y - 0.7) * PX.x).toBeLessThan(0.05)
  })

  it('takes an exact zero for a touch point even where the gradient vanishes', () => {
    // x^2 + y^2 at the centre of a leaf centred on the origin
    const r = contour('x^2 + y^2', [leaf(-0.5, 0.5, -0.5, 0.5)])
    expect(r.touches).toEqual([{ x: 0, y: 0, est: 0 }])
  })

  it('finds no touch point in a leaf far from the zero set', () => {
    // 1 + x^2 + y^2 has no zero: the iterate comes to rest at the minimum, where the gradient is nothing
    expect(contour('1 + x^2 + y^2', [leaf(0, 1, 0, 1)]).touches).toEqual([])
    // a zero 2 px beyond the leaf: the iterate stops at its edge, further than half a px
    expect(contour('(y - 1.05)^2', [leaf(0, 1, 0, 1)]).touches).toEqual([])
  })

  it('finds a zero just outside the leaf when it is within half a px of it', () => {
    // 0.3 px beyond the edge at 40 px a unit
    const r = contour('(y - 1.0075)^2', [leaf(0, 1, 0, 1)])
    expect(r.touches.length).toBe(1)
    expect(r.touches[0].y).toBe(1)
  })

  it('does not take a leaf beside a pole for a touch point', () => {
    // all negative: H = y - tan x is -90 at the centre, the gradient 8300 (207 per px): |H| / |grad H| is 0.43 px there, but
    // the zero is nowhere near, and the iterate that Newton's step carries away from the pole stops at the edge of the leaf
    const r = contour('y - tan(x)', [leaf(1.55, 1.568, 0, 1)])
    expect(r.stats.touchCandidates).toBe(1)
    expect(r.touches).toEqual([])
  })

  it('finds a root the signs of the corners hide, beside a pole in the same leaf, as a piece of the contour and not a touch point', () => {
    // the pole at pi/2 and the curve at x = pi/2 + 0.067 are both on every horizontal edge of this leaf: two sign changes
    // along an edge, so none at its ends. The twin finds the pole as a gap in each edge and the root beside it.
    const r = contour('y - tan(x)', [leaf(Math.PI / 2 - 0.01, Math.PI / 2 + 0.107, -15, -14.8, PARTIAL)])
    expect(r.touches).toEqual([])
    expect(r.segments.length).toBe(1)
    expect(r.stats.gaps).toBeGreaterThan(0)
    for (const p of [r.segments[0].a, r.segments[0].b]) {
      expect(Math.abs(Math.tan(p.x) - p.y)).toBeLessThan(1e-3)
      expect(p.x).toBeGreaterThan(Math.PI / 2)
    }
  })

  it('does not look in a leaf that shares a corner with a leaf that drew a piece', () => {
    // y = 0.995 crosses the lower leaf; the upper is 0.2 px from it, but the contour speaks for it
    const both = contour('y - 0.995', [leaf(0, 1, 0, 1), leaf(0, 1, 1, 2)])
    expect(both.segments.length).toBe(1)
    expect(both.touches).toEqual([])
    expect(both.stats.touchCandidates).toBe(1)
    // alone, the upper leaf has a zero within half a px, and is a touch point
    const alone = contour('y - 0.995', [leaf(0, 1, 1, 2)])
    expect(alone.touches.length).toBe(1)
  })

  it('links the touch points of leaves that share a corner', () => {
    const r = contour('(y - 0.3)^2', [leaf(0, 1, 0, 1), leaf(1, 2, 0, 1), leaf(5, 6, 0, 1)])
    expect(r.touches.length).toBe(3)
    expect(r.touchLinks).toEqual([[0, 1]])
  })

  it('does not look for touch points where the kernel has no gradient, and counts the leaves it left', () => {
    // gamma has no derivative rule
    const fns = compileContour(expr('gamma(x) - y'), scopeOf())
    expect(fns.grad).toBeNull()
    const counter: EvalCounter = { points: 0, intervals: 0 }
    // gamma(x) is under 6 on [3, 4]: H is negative at every corner, no crossing
    const r = contourLeaves([leaf(3, 4, 20, 21)], fns, { px: PX, clip: CLIP }, counter)
    expect(r.touches).toEqual([])
    expect(r.stats.touchUnchecked).toBe(r.stats.touchCandidates)
    expect(r.stats.touchCandidates).toBe(1)
  })

  it('finds nothing where H is undefined at the centre', () => {
    const r = contour('sqrt(x*y - 0.5) + (x - y)^2', [leaf(0, 1, 0, 1)])
    expect(r.touches).toEqual([])
  })

  it('spends points for each Newton step on the counter', () => {
    const r = contour('(y - 0.3)^2', [leaf(0, 1, 0, 1)])
    // four corners and the two partials at each (the critical-point pass reads them), then 3 evaluations (H and the two partials) at each iterate
    expect(r.counter.points).toBeGreaterThanOrEqual(4 + 8 + 3 * 3)
    expect(r.counter.points).toBeLessThanOrEqual(4 + 8 + 3 * 9)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// The acceptance cases, through the quadtree, the contour and the chains
// ---------------------------------------------------------------------------------------------------------------

describe('implicit curves: the acceptance cases', () => {
  it('x^2 - y^2 = 1: both branches, every vertex on the curve', () => {
    const t = trace('x^2 - y^2 - 1')
    expect(t.chains.length).toBe(2)
    expect(t.chains.every((c) => !c.closed)).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    const sides = t.chains.map((c) => Math.sign(verticesOf(c)[0].x)).sort()
    expect(sides).toEqual([-1, 1])
    // each branch runs the width of the root and out through its edge, through its vertex at (+-1, 0)
    for (const c of t.chains) {
      const v = verticesOf(c)
      const ends = [v[0], v[v.length - 1]]
      for (const e of ends) expect(Math.abs(e.x)).toBe(15)
      expect(nearestPx([c], { x: Math.sign(v[0].x), y: 0 })).toBeLessThan(0.5)
    }
    expect(t.touch.chains).toEqual([])
    expect(t.touch.points).toEqual([])
    expect(t.capped).toBe(false)
  })

  it('y^2 = x^3 - x: the oval and the branch', () => {
    const t = trace('y^2 - x^3 + x')
    const closed = t.chains.filter((c) => c.closed)
    const open = t.chains.filter((c) => !c.closed)
    expect(closed.length).toBe(1)
    expect(open.length).toBe(1)
    expect(worstPx(t)).toBeLessThan(0.01)
    // the oval lies in -1 <= x <= 0 and the branch in x >= 1
    const oval = verticesOf(closed[0])
    expect(Math.min(...oval.map((v) => v.x))).toBeGreaterThan(-1.001)
    expect(Math.min(...oval.map((v) => v.x))).toBeLessThan(-0.99)
    expect(Math.max(...oval.map((v) => v.x))).toBeLessThan(1e-9)
    const branch = verticesOf(open[0])
    expect(Math.min(...branch.map((v) => v.x))).toBeGreaterThan(0.99)
    expect(Math.min(...branch.map((v) => v.x))).toBeLessThan(1.001)
    // the branch leaves through the top and the bottom of the root
    expect(Math.abs(branch[0].y)).toBe(15)
    expect(Math.abs(branch[branch.length - 1].y)).toBe(15)
    // the oval passes through the origin, a corner of the grid where H is exactly zero
    expect(nearestPx(closed, { x: 0, y: 0 })).toBe(0)
    expect(t.touch.points).toEqual([])
  })

  it('the lemniscate (x^2+y^2)^2 = 2(x^2-y^2): an X at the origin, four arms meet there', () => {
    const t = trace('(x^2 + y^2)^2 - 2*(x^2 - y^2)')
    expect(worstPx(t)).toBeLessThan(0.01)
    expect(arms(t.chains, { x: 0, y: 0 })).toBe(4)
    // one closed figure eight that passes the origin twice, from the tip of the left lobe
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    const v = verticesOf(t.chains[0])
    expect(v.filter((p) => p.x === 0 && p.y === 0).length).toBe(2)
    expect(Math.min(...v.map((p) => p.x))).toBeGreaterThan(-Math.SQRT2 - 1e-3)
    expect(Math.min(...v.map((p) => p.x))).toBeLessThan(-Math.SQRT2 + 1e-2)
    expect(Math.max(...v.map((p) => p.x))).toBeGreaterThan(Math.SQRT2 - 1e-2)
    expect(v[0].x).toBe(Math.min(...v.map((p) => p.x)))
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains).toEqual([])
  })

  it('xy = 0: the two axes cross at the origin, four arms', () => {
    const t = trace('x*y')
    expect(arms(t.chains, { x: 0, y: 0 })).toBe(4)
    expect(t.chains.length).toBe(2)
    expect(worstPx(t)).toBe(0)
    // both axes in full, to the edge of the root
    const spans = t.chains.map((c) => {
      const v = verticesOf(c)
      return [v[0], v[v.length - 1]]
    })
    for (const [a, b] of spans) {
      const horizontal = a.y === 0 && b.y === 0
      const vertical = a.x === 0 && b.x === 0
      expect(horizontal || vertical).toBe(true)
      if (horizontal) expect([a.x, b.x]).toEqual([-15, 15])
      else expect([a.y, b.y]).toEqual([-15, 15])
    }
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains).toEqual([])
  })

  it('y^2 = x^2: the two diagonals cross at the origin, four arms', () => {
    const t = trace('y^2 - x^2')
    expect(arms(t.chains, { x: 0, y: 0 })).toBe(4)
    expect(t.chains.length).toBe(2)
    expect(worstPx(t)).toBe(0)
    for (const c of t.chains) {
      const v = verticesOf(c)
      expect(Math.abs(v[0].x)).toBe(15)
      expect(Math.abs(v[v.length - 1].x)).toBe(15)
    }
    expect(t.touch.points).toEqual([])
  })

  it('xy = 0 with the origin inside a leaf: one X, exactly at the origin', () => {
    // the view is shifted so that no grid line is x = 0 or y = 0
    const view: Bounds = { xMin: -9.7, xMax: 10.3, yMin: -9.3, yMax: 10.7 }
    const t = trace('x*y', { view })
    expect(worstPx(t)).toBeLessThan(1e-3)
    let centre: Vec2 | null = null
    for (const v of allVertices(t.chains)) if (Math.abs(v.x) < 0.05 && Math.abs(v.y) < 0.05 && arms(t.chains, v) === 4) centre = v
    expect(centre).not.toBeNull()
    expect(Math.hypot((centre as Vec2).x, (centre as Vec2).y) * PX.x).toBeLessThan(1e-3)
    expect(t.chains.length).toBe(2)
  })

  it('(x - y)^2 = 0 is the line, from the touch points', () => {
    const t = trace('(x - y)^2')
    expect(t.chains).toEqual([])
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains.length).toBe(1)
    const c = t.touch.chains[0]
    expect(c.closed).toBe(false)
    const v = verticesOf(c)
    // every vertex within half a px of y = x
    for (const p of v) expect((Math.abs(p.x - p.y) / Math.SQRT2) * PX.x).toBeLessThan(0.5)
    // it runs the length of the diagonal of the root, to within two leaves of its corners (the leaves on the edge of the
    // root are not searched)
    expect(v[0].x).toBeLessThan(-14.9)
    expect(v[v.length - 1].x).toBeGreaterThan(14.9)
    expect(lengthOf(c)).toBeGreaterThan(30 * Math.SQRT2 * 0.99)
    expect(lengthOf(c)).toBeLessThan(30 * Math.SQRT2 * 1.002)
  })

  it('draws no dot where a conic only grazes the edge of the root: its tip pokes a px out of it', () => {
    // the ellipse's cap beyond x = 15 is between y = 12.16 and 13.28; the leaves of the root's edge in the cap have no sign
    // change, no drawn neighbour, and a zero 0.4 px outside the box
    const t = trace('0.823*x^2 + -1.442*x*y + 0.901*y^2 + -2.207*x + -1.295*y + -6.529')
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(false)
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains).toEqual([])
  })

  it('draws random conics true: on the curve, closed ones counter-clockwise, open ones to the edge of the root', () => {
    // a seeded stream of coefficients (no Math.random: a run is a run)
    let s = 12345
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    const coef = () => ((next() * 2 - 1) * 3).toFixed(3)
    for (let k = 0; k < 30; k++) {
      const h = `${coef()}*x^2 + ${coef()}*x*y + ${coef()}*y^2 + ${coef()}*x + ${coef()}*y + ${(next() * 20 - 10).toFixed(3)}`
      const t = trace(h)
      let worst = 0
      for (const v of allVertices(t.chains)) {
        const d = t.distPx(v.x, v.y)
        if (Number.isFinite(d)) worst = Math.max(worst, d)
      }
      expect(worst, h).toBeLessThan(0.5)
      for (const c of t.chains) {
        const v = verticesOf(c)
        if (c.closed) expect(signedArea(c), h).toBeGreaterThan(0)
        else for (const e of [v[0], v[v.length - 1]]) expect(Math.abs(e.x) === 15 || Math.abs(e.y) === 15, `${h}: open end ${e.x}, ${e.y}`).toBe(true)
      }
      expect(firstCrossing(t.chains), h).toBeNull()
      expect(t.touch.points, h).toEqual([])
      expect(t.touch.chains, h).toEqual([])
    }
  }, 30000)

  it('x^2 + y^2 = 0 is one filled point at the origin', () => {
    const t = trace('x^2 + y^2')
    expect(t.chains).toEqual([])
    expect(t.touch.chains).toEqual([])
    expect(t.touch.points.length).toBe(1)
    expect(Math.hypot(t.touch.points[0].x, t.touch.points[0].y) * PX.x).toBeLessThan(0.05)
  })

  it('(x - 0.3)^2 + (y - 0.7)^2 = 0 is one point, off the grid', () => {
    const t = trace('(x - 0.3)^2 + (y - 0.7)^2')
    expect(t.touch.points.length).toBe(1)
    expect(Math.hypot(t.touch.points[0].x - 0.3, t.touch.points[0].y - 0.7) * PX.x).toBeLessThan(0.05)
    expect(t.chains).toEqual([])
  })

  it('sin(x) = cos(y): the lattice of X, with no arcs crossing over', () => {
    // The lines cross at (pi/2 + pi j, pi n) for j + n even. They run along the diagonals of the leaves, so the corners never show four sign
    // changes; the critical points do. Each node is an X: the curve passes through it and four arms meet there, and each line runs straight
    // through every node it meets, from one edge of the root to the other, so no cell of the lattice is outlined.
    const nodes = (onGridLine: boolean) => {
      const out: Vec2[] = []
      for (let j = -3; j <= 3; j++) {
        for (let n = -3; n <= 3; n++) {
          if (Math.abs(j + n) % 2 === 0 && (onGridLine || n !== 0)) out.push({ x: Math.PI / 2 + Math.PI * j, y: Math.PI * n })
        }
      }
      return out
    }
    for (const tuning of [FULL, COARSE]) {
      // the view moved by (0.35, 0.9): no node is on a grid line, and none is just outside the root (a node a hair beyond its edge, as (3 pi / 2,
      // 5 pi) is beyond the top of the root of the view moved by (0.3, 0.7), joins its two lines by a U-turn at the edge, in the overscan)
      const t = trace('sin(x) - cos(y)', { view: { xMin: -9.65, xMax: 10.35, yMin: -9.1, yMax: 10.9 }, tuning })
      expect(worstPx(t)).toBeLessThan(0.5)
      expect(firstCrossing(t.chains)).toBeNull()
      expect(t.capped).toBe(false)
      expect(nodes(true).length).toBe(25)
      for (const at of nodes(true)) {
        expect(curveDistPx(t.chains, at)).toBeLessThan(0.5)
        expect(arms(t.chains, nearestVertex(t.chains, at), 1e-12)).toBe(4)
      }
      expect(t.contour.stats.critical).toBeGreaterThanOrEqual(25)
      // nine lines of one slope and ten of the other cross the root, each whole
      expect(t.chains.every((c) => !c.closed && isStraight(c))).toBe(true)
      expect(t.chains.length).toBe(19)

      // the default view: the nodes of the x-axis (y = 0, a grid line, the edge of the leaves above and below) are not found from a critical
      // point, which a leaf holds only inside it: they are drawn from the corners, within a px of the node (a known limit); the others are X
      const d = trace('sin(x) - cos(y)', { tuning })
      expect(worstPx(d)).toBeLessThan(0.5)
      expect(firstCrossing(d.chains)).toBeNull()
      expect(nodes(false).length).toBe(22)
      for (const at of nodes(false)) expect(arms(d.chains, nearestVertex(d.chains, at), 1e-12)).toBe(4)
      for (const at of nodes(true)) expect(curveDistPx(d.chains, at)).toBeLessThan(2.5)
    }
  })

  it('sin(x) sin(y) = 0: the lines cross at right angles, each crossing an X, and every line is whole', () => {
    const t = trace('sin(x) * sin(y)')
    expect(worstPx(t)).toBeLessThan(0.5)
    // 81 crossings: the 64 that are inside a leaf are paired as an X; the 17 on the axes (x = 0 or y = 0, grid lines where
    // H is exactly zero) are where a curve meets a zero edge
    expect(t.contour.stats.saddles).toBe(64)
    expect(t.contour.stats.crosses).toBe(64)
    // nine vertical and nine horizontal lines, each straight through every crossing it meets
    expect(t.chains.length).toBe(18)
    expect(firstCrossing(t.chains)).toBeNull()
    for (const c of t.chains) {
      const v = verticesOf(c)
      expect(c.closed).toBe(false)
      const horizontal = Math.abs(v[0].y - v[v.length - 1].y) < 1e-9
      const end = horizontal ? [v[0].x, v[v.length - 1].x] : [v[0].y, v[v.length - 1].y]
      expect(end).toEqual([-15, 15])
    }
    for (let m = -4; m <= 4; m++) for (let n = -4; n <= 4; n++) expect(arms(t.chains, nearestVertex(t.chains, { x: m * Math.PI, y: n * Math.PI }), 1e-12)).toBe(4)
  })

  it('y - tan(x) = 0: no piece reaches a pole, and the branches between them are whole', () => {
    const t = trace('y - tan(x)')
    const poles = Array.from({ length: 10 }, (_, k) => -14.137166941154069 + k * Math.PI)
    for (const v of allVertices(t.chains)) for (const p of poles) expect(Math.abs(v.x - p)).toBeGreaterThan(1e-9)
    // no piece spans a pole
    for (const c of t.chains) {
      const v = verticesOf(c)
      for (let i = 0; i + 1 < v.length; i++) {
        const lo = Math.min(v[i].x, v[i + 1].x)
        const hi = Math.max(v[i].x, v[i + 1].x)
        for (const p of poles) expect(lo < p && p < hi).toBe(false)
      }
    }
    // eleven branches, each open, from the bottom of the root to the top
    expect(t.chains.length).toBe(11)
    expect(t.chains.every((c) => !c.closed)).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.5)
    expect(t.contour.stats.poles).toBeGreaterThan(5000)
    for (const c of t.chains) {
      const v = verticesOf(c)
      const ys = [v[0].y, v[v.length - 1].y].map(Math.abs)
      // a branch ends at the top and the bottom, except the two pieces at the ends of the root, which end at its sides
      expect(ys[0] === 15 || Math.abs(v[0].x) === 15).toBe(true)
      expect(ys[1] === 15 || Math.abs(v[v.length - 1].x) === 15).toBe(true)
    }
  })

  it('x^y = y^x: the line y = x and the curve crossing it near (e, e)', () => {
    const t = trace('x^y - y^x')
    expect(worstPx(t)).toBeLessThan(0.5)
    // the line y = x: vertices on it, along the width of the first quadrant
    const onLine = allVertices(t.chains).filter((v) => Math.abs(v.x - v.y) < 1e-9)
    expect(onLine.length).toBeGreaterThan(300)
    expect(Math.max(...onLine.map((v) => v.x))).toBeGreaterThan(14.9)
    // the other branch, through (2, 4) and (4, 2)
    expect(curveDistPx(t.chains, { x: 4, y: 2 })).toBeLessThan(0.5)
    expect(curveDistPx(t.chains, { x: 2, y: 4 })).toBeLessThan(0.5)
    expect(curveDistPx(t.chains, { x: 3, y: 3 })).toBeLessThan(0.5)
    // and the two meet at (e, e): the drawn curve passes through it, and no piece crosses another
    expect(curveDistPx(t.chains, { x: Math.E, y: Math.E })).toBeLessThan(0.5)
    expect(firstCrossing(t.chains)).toBeNull()
    // the other branch is a chain of its own, running up to the top of the root beside x = 1
    const second = t.chains.filter((c) => verticesOf(c).some((v) => Math.abs(v.x - v.y) > 1))
    expect(second.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...second.flatMap((c) => verticesOf(c).map((v) => v.y)))).toBe(15)
  })

  it('abs(x) + abs(y) = 1: sharp corners, one closed chain', () => {
    const t = trace('abs(x) + abs(y) - 1')
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    for (const at of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) expect(nearestPx(t.chains, at)).toBeLessThan(0.5)
    expect(signedArea(t.chains[0])).toBeCloseTo(2, 2)
  })

  it('a circle is one closed chain, counter-clockwise, from its smallest vertex', () => {
    const t = trace('x^2 + y^2 - 25')
    expect(t.chains.length).toBe(1)
    const c = t.chains[0]
    expect(c.closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    expect(signedArea(c)).toBeGreaterThan(0)
    expect(signedArea(c)).toBeCloseTo(Math.PI * 25, 1)
    const v = verticesOf(c)
    // it starts at the vertex with the smallest x (then y)
    for (const p of v) expect(p.x > v[0].x || (p.x === v[0].x && p.y >= v[0].y)).toBe(true)
    // the parameter is the arc length
    expect(c.param[0]).toBe(0)
    for (let i = 1; i < c.param.length; i++) expect(c.param[i]).toBeGreaterThan(c.param[i - 1])
    expect(lengthOf(c)).toBeCloseTo(2 * Math.PI * 5, 1)
    expect(c.param[c.param.length - 1] + Math.hypot(v[0].x - v[v.length - 1].x, v[0].y - v[v.length - 1].y)).toBeCloseTo(lengthOf(c), 9)
  })

  it('a line is one open chain from the smaller (x, y) end, with the parameter the length along it', () => {
    const t = trace('y - 2*x - 1')
    expect(t.chains.length).toBe(1)
    const c = t.chains[0]
    expect(c.closed).toBe(false)
    expect(worstPx(t)).toBeLessThan(0.01)
    const v = verticesOf(c)
    expect(v[0].x).toBeLessThan(v[v.length - 1].x)
    expect(c.param[c.param.length - 1]).toBeCloseTo(lengthOf(c), 9)
  })

  it('y = ln x: nothing where it is undefined, and the curve to the edge of the domain', () => {
    const t = trace('ln(x) - y')
    expect(worstPx(t)).toBeLessThan(0.5)
    for (const v of allVertices(t.chains)) expect(v.x).toBeGreaterThan(0)
    expect(curveDistPx(t.chains, { x: 1, y: 0 })).toBeLessThan(0.5)
    expect(curveDistPx(t.chains, { x: 0.1, y: Math.log(0.1) })).toBeLessThan(0.5)
    // it runs down beside x = 0 to the bottom of the root: the leaves that hold the edge have H = -infinity at its corners
    const v = verticesOf(t.chains[0])
    expect(t.chains.length).toBe(1)
    expect(v[0].y).toBe(-15)
    expect(v[0].x).toBeLessThan(1e-6)
  })

  it('y = sqrt(x) as sqrt(x) - y: starts at the origin, a corner of the grid, and nothing left of it', () => {
    const t = trace('sqrt(x) - y')
    expect(t.chains.length).toBe(1)
    expect(worstPx(t)).toBeLessThan(0.5)
    for (const p of allVertices(t.chains)) expect(p.x).toBeGreaterThanOrEqual(0)
    expect(nearestPx(t.chains, { x: 0, y: 0 })).toBe(0)
  })

  it('y = floor(x): the steps, and no riser at a jump', () => {
    const t = trace('floor(x) - y')
    expect(t.contour.stats.jumps).toBeGreaterThan(20)
    expect(worstPx(t)).toBeLessThan(0.5)
    // every vertex is on a tread, at an integer height, and no piece rises: the sign change across a jump is not a zero
    for (const v of allVertices(t.chains)) expect(Math.abs(v.y - Math.round(v.y))).toBeLessThan(1e-4)
    for (const c of t.chains) for (const [a, b] of segmentsOf(c)) expect(Math.abs(a.y - b.y)).toBeLessThan(1e-4)
    // one tread for each integer from -15 to 14, each about a unit long (a gap of a leaf at each jump, which is not drawn)
    expect(t.chains.length).toBe(30)
    for (const c of t.chains) expect(lengthOf(c)).toBeGreaterThan(0.9)
  })

  it('y^2 = x^3: the cusp is one chain through the origin and no dot beside it', () => {
    const t = trace('y^2 - x^3')
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(false)
    expect(arms(t.chains, { x: 0, y: 0 })).toBe(2)
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains).toEqual([])
  })

  it('the lemniscate with its node inside a leaf draws no dot there either', () => {
    const view: Bounds = { xMin: -9.7, xMax: 10.3, yMin: -9.3, yMax: 10.7 }
    const t = trace('(x^2 + y^2)^2 - 2*(x^2 - y^2)', { view })
    expect(worstPx(t)).toBeLessThan(0.5)
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains).toEqual([])
  })

  it('the double circle (x^2 + y^2 - 25)^2 = 0 is a ring of touch points', () => {
    const t = trace('(x^2 + y^2 - 25)^2')
    expect(t.chains).toEqual([])
    expect(t.touch.points).toEqual([])
    expect(t.touch.chains.length).toBe(1)
    expect(t.touch.chains[0].closed).toBe(true)
    for (const v of verticesOf(t.touch.chains[0])) expect(Math.abs(Math.hypot(v.x, v.y) - 5) * PX.x).toBeLessThan(0.5)
    expect(lengthOf(t.touch.chains[0])).toBeGreaterThan(2 * Math.PI * 5 * 0.98)
  })

  it('x^2 + y^2 = -1 and x^2 + y^2 = 0 off the view draw nothing', () => {
    expect(trace('x^2 + y^2 + 1').chains).toEqual([])
    const far = trace('(x - 40)^2 + y^2')
    expect(far.chains).toEqual([])
    expect(far.touch.points).toEqual([])
  })
})

describe('implicit curves: cost, quality and determinism', () => {
  it('a circle costs about 15 point evaluations a leaf and no twin evaluation in the contour', () => {
    const t = trace('x^2 + y^2 - 25')
    expect(t.spent.intervals).toBe(0)
    expect(t.spent.points).toBeLessThan(25 * t.leaves.length)
    expect(t.spent.points).toBeGreaterThan(5 * t.leaves.length)
  })

  it('at COARSE the vertices are as exact: only the pieces are longer', () => {
    const t = trace('x^2 + y^2 - 25', { tuning: COARSE })
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    expect(t.leaves.length).toBeLessThan(trace('x^2 + y^2 - 25', { tuning: FULL }).leaves.length / 3)
  })

  it('contours the coarse leaves of a capped quadtree as they are: the vertices are as exact', () => {
    const t = trace('x^2 + y^2 - 25', { tuning: { ...FULL, budget: { intervals: 700 } } })
    expect(t.capped).toBe(true)
    expect(t.leaves.every((l) => l.stop === 'budget')).toBe(true)
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
  })

  it('keeps the vertices on the curve when the axes are not 1:1 (an ellipse at 40 by 10 px a unit)', () => {
    const view: Bounds = { xMin: -10, xMax: 10, yMin: -40, yMax: 40 }
    const t = trace('x^2/25 + y^2/400 - 1', { view, px: { x: 40, y: 10 } })
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    expect(signedArea(t.chains[0])).toBeCloseTo(Math.PI * 5 * 20, 0)
    // xy = 0 with leaves four times as tall as wide in the world: still one X, still two lines
    const x = trace('x*y', { view, px: { x: 40, y: 10 } })
    expect(x.chains.length).toBe(2)
    expect(arms(x.chains, { x: 0, y: 0 })).toBe(4)
  })

  it('works far from the origin: a circle at x = 1010', () => {
    const view: Bounds = { xMin: 1000, xMax: 1020, yMin: -10, yMax: 10 }
    const t = trace('(x - 1010)^2 + y^2 - 25', { view })
    expect(t.chains.length).toBe(1)
    expect(t.chains[0].closed).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    expect(signedArea(t.chains[0])).toBeCloseTo(Math.PI * 25, 1)
  })

  it('draws the same chains twice', () => {
    for (const h of ['x^2 + y^2 - 25', 'x*y', 'sin(x) - cos(y)', '(x - y)^2', 'y - tan(x)', '(x^2+y^2)^2 - 2*(x^2-y^2)']) {
      const a = trace(h)
      const b = trace(h)
      const dump = (t: typeof a) => JSON.stringify([t.chains, t.touch.chains, t.touch.points].map((x) => JSON.parse(JSON.stringify(x, (_, v) => (v instanceof Float64Array ? Array.from(v) : v)))))
      expect(dump(b)).toBe(dump(a))
      expect(b.counter).toEqual(a.counter)
    }
  })

  it('a budget stops the contour and says so; the part it drew is true', () => {
    const t = trace('x^2 + y^2 - 25', { budget: { points: 5000, intervals: 1e9 } })
    expect(t.contour.capped).toBe(true)
    expect(worstPx(t)).toBeLessThan(0.01)
    const full = trace('x^2 + y^2 - 25')
    expect(full.contour.capped).toBe(false)
    expect(allVertices(t.chains).length).toBeLessThan(allVertices(full.chains).length)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1: crossings the corners cannot show, X that are certified, chords that stay on defined ground, leaves not left blank
// ---------------------------------------------------------------------------------------------------------------

// the default view moved by (0.3, 0.7): the origin is no corner of the grid, and no grid line is an axis
const PANNED: Bounds = { xMin: -9.7, xMax: 10.3, yMin: -9.3, yMax: 10.7 }

// which of the lines y = x (1) and y = -x (-1) a vertex is on, or 0
// (the roots are located to 2^-12 px of the edge's length, about 1e-5 units at a leaf of 4.7 px)
const diagonal = (p: Vec2) => (Math.abs(p.x - p.y) < 1e-4 ? 1 : Math.abs(p.x + p.y) < 1e-4 ? -1 : 0)

// whether a chain is a straight line: every vertex within `tol` of the chord from its first vertex to its last
function isStraight(c: Chain, tol = 1e-4): boolean {
  const v = verticesOf(c)
  const a = v[0]
  const b = v[v.length - 1]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return v.every((p) => Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len < tol)
}

describe('crossings the corners cannot show', () => {
  it('draws the lemniscate in a panned view as a figure eight with an X at the origin', () => {
    for (const tuning of [FULL, COARSE]) {
      const t = trace('(x^2 + y^2)^2 - 2*(x^2 - y^2)', { view: PANNED, tuning })
      expect(t.chains.length).toBe(1)
      expect(t.chains[0].closed).toBe(true)
      const v = verticesOf(t.chains[0])
      const origin = nearestVertex(t.chains, { x: 0, y: 0 })
      expect(Math.hypot(origin.x, origin.y) * PX.x).toBeLessThan(1e-3)
      // the origin is passed twice, the arms straight through it
      expect(v.filter((p) => p.x === origin.x && p.y === origin.y).length).toBe(2)
      expect(arms(t.chains, origin, 1e-12)).toBe(4)
      expect(worstPx(t)).toBeLessThan(0.5)
      expect(Math.min(...v.map((p) => p.x))).toBeLessThan(-Math.SQRT2 + 0.02)
      expect(Math.max(...v.map((p) => p.x))).toBeGreaterThan(Math.SQRT2 - 0.02)
      expect(t.touch.points).toEqual([])
      expect(t.touch.chains).toEqual([])
      expect(t.contour.stats.critical).toBe(1)
    }
  })

  it('draws y^2 = x^2 in a panned view as two straight lines through an X', () => {
    for (const tuning of [FULL, COARSE]) {
      const t = trace('y^2 - x^2', { view: PANNED, tuning })
      expect(t.chains.length).toBe(2)
      const origin = nearestVertex(t.chains, { x: 0, y: 0 })
      expect(Math.hypot(origin.x, origin.y) * PX.x).toBeLessThan(1e-3)
      expect(arms(t.chains, origin, 1e-12)).toBe(4)
      // each chain runs along one diagonal from the root's edge to its edge, not along one and then the other
      for (const c of t.chains) {
        const v = verticesOf(c)
        expect(c.closed).toBe(false)
        expect(diagonal(v[0])).not.toBe(0)
        expect(diagonal(v[v.length - 1])).toBe(diagonal(v[0]))
        // (the centre of the X is on both)
        expect(v.every((p) => Math.hypot(p.x, p.y) < 1e-3 || diagonal(p) === diagonal(v[0]))).toBe(true)
      }
      expect(new Set(t.chains.map((c) => diagonal(verticesOf(c)[0]))).size).toBe(2)
    }
  })

  it('draws two perpendicular lines tilted 27 degrees as an X: each line whole, whichever leaf the node falls in', () => {
    const line1 = (p: Vec2) => Math.abs(p.y - 0.5 * p.x - 0.0071)
    const line2 = (p: Vec2) => Math.abs(p.y + 2 * p.x - 0.0013)
    const node = { x: (0.0013 - 0.0071) / 2.5, y: 0 }
    node.y = 0.5 * node.x + 0.0071
    for (const view of [undefined, PANNED]) {
      for (const tuning of [FULL, COARSE]) {
        const t = trace('(y - 0.5*x - 0.0071)*(y + 2*x - 0.0013)', { view, tuning })
        expect(t.chains.length).toBe(2)
        expect(curveDistPx(t.chains, node)).toBeLessThan(0.5)
        expect(arms(t.chains, nearestVertex(t.chains, node), 1e-12)).toBe(4)
        expect(firstCrossing(t.chains)).toBeNull()
        const onOne = t.chains.map((c) => (verticesOf(c).every((p) => line1(p) < 1e-3) ? 1 : verticesOf(c).every((p) => line2(p) < 1e-3) ? 2 : 0))
        expect(onOne.sort()).toEqual([1, 2])
        expect(worstPx(t)).toBeLessThan(0.5)
      }
    }
  })

  it('puts the node of x^y = y^x at (e, e) on the curve whichever leaf it falls in', () => {
    for (const view of [undefined, PANNED]) {
      for (const tuning of [FULL, COARSE]) {
        const t = trace('x^y - y^x', { view, tuning })
        const e = { x: Math.E, y: Math.E }
        expect(curveDistPx(t.chains, e)).toBeLessThan(0.5)
        expect(arms(t.chains, nearestVertex(t.chains, e), 1e-12)).toBe(4)
        expect(firstCrossing(t.chains)).toBeNull()
        // the line y = x runs through it in one chain, from below and above
        const through = t.chains.filter((c) => {
          const along = verticesOf(c).filter((p) => Math.abs(p.x - p.y) < 1e-4)
          return along.some((p) => p.x < 2.5) && along.some((p) => p.x > 3)
        })
        expect(through.length).toBe(1)
      }
    }
  })

  it('finds the X of a handmade 3 x 3 block whose centre leaf has the origin off its middle, and joins it straight through to the leaves beyond', () => {
    // H = y^2 - x^2: the corners of the centre leaf show only two sign changes, and its bottom edge holds two arms
    const xs = [-1.3, -0.3, 0.7, 1.7]
    const ys = [-1.2, -0.2, 0.8, 1.8]
    const leaves: Leaf[] = []
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) leaves.push(leaf(xs[i], xs[i + 1], ys[j], ys[j + 1]))
    const r = contour('y^2 - x^2', leaves)
    expect(r.stats.critical).toBe(1)
    const chains = buildChains(r.segments, PX)
    expect(chains.length).toBe(2)
    expect(arms(chains, { x: 0, y: 0 }, 1e-9)).toBe(4)
    for (const c of chains) {
      const v = verticesOf(c)
      expect(v.every((p) => Math.hypot(p.x, p.y) < 1e-3 || (diagonal(p) === diagonal(v[0]) && diagonal(p) !== 0))).toBe(true)
    }
  })

  it('does not take the saddle of sin(3x) sin(3y) = 0.001 for a crossing: its branches never meet', () => {
    // the X it would draw is 0.6 px from either branch at COARSE; at FULL (1.2 px leaves) it is not drawn either
    for (const tuning of [COARSE, FULL]) {
      const t = trace('sin(3*x) * sin(3*y) - 0.001', { tuning })
      expect(t.contour.stats.crosses).toBe(0)
      expect(t.contour.stats.critical).toBe(0)
      expect(worstPx(t)).toBeLessThan(0.5)
      expect(firstCrossing(t.chains)).toBeNull()
    }
  })

  it('draws no X on sin(x^2 + y^2) = 0.3 when the quadtree is capped: the rings never cross', () => {
    for (const tuning of [FULL, COARSE]) {
      const t = trace('sin(x^2 + y^2) - 0.3', { tuning })
      expect(t.capped).toBe(true)
      expect(t.contour.stats.crosses).toBe(0)
      expect(worstPx(t)).toBeLessThan(0.5)
    }
  })

  it('still draws the axis-aligned X of xy = 0 with the origin inside a leaf, and gives the lattice sin(x) sin(y) its 81 nodes', () => {
    const t = trace('x*y', { view: PANNED })
    expect(t.chains.length).toBe(2)
    expect(t.contour.stats.crosses).toBe(1)
    const s = trace('sin(x) * sin(y)', { tuning: COARSE })
    expect(s.chains.length).toBe(18)
    for (let m = -4; m <= 4; m++) for (let n = -4; n <= 4; n++) expect(arms(s.chains, nearestVertex(s.chains, { x: m * Math.PI, y: n * Math.PI }), 1e-12)).toBe(4)
  })
})

describe('Crossings: gaps, cuts and arms', () => {
  it('finds a root beside a pole on an edge that shows no sign change (1/x - y at y = 20: the pole at 0, the root at 0.05)', () => {
    const { cr, stats } = crossingsOf('1/x - y')
    const a = cr.corner(-0.22, 20)
    const b = cr.corner(0.07, 20)
    expect(a.v >= 0).toBe(b.v >= 0)
    const info = cr.edge(a, b, false)
    expect(info.gap).toBe(true)
    expect(info.roots.length).toBe(1)
    expect(Math.abs(info.roots[0].x - 0.05)).toBeLessThan(1e-5)
    expect(info.roots[0].y).toBe(20)
    expect(stats.gaps).toBe(1)
    // a leaf the twin proved continuous has nothing hidden to look for
    const { cr: cr2 } = crossingsOf('x^2 - y - 1')
    expect(cr2.edge(cr2.corner(-3, 20), cr2.corner(3, 20), true).roots.length).toBe(0)
  })

  it('finds nothing on an edge whose only sign change is a pole, with or without the pole being found by the bisection', () => {
    // 1/x: -infinity to +infinity; the roots of (x^2 - 0.0009)/x at -0.03 and 0.03 are on one edge with the pole, and the bisection settles on
    // the root nearest its first midpoint: one sign change is found, and it is a root
    const { cr, stats } = crossingsOf('1/x')
    const info = cr.edge(cr.corner(-0.07, 0), cr.corner(0.07, 0), false)
    expect(info.roots).toEqual([])
    expect(info.fail).toEqual({ ok: false, why: 'pole' })
    expect(stats.poles).toBe(1)
    const { cr: three } = crossingsOf('(x^2 - 0.0009)/x')
    const t = three.edge(three.corner(-0.07, 0), three.corner(0.07, 0), false)
    expect(t.roots.length).toBe(1)
    expect(Math.abs(Math.abs(t.roots[0].x) - 0.03)).toBeLessThan(1e-5)
  })

  it('reuses the gap it found on the next edge of a column, and still checks both sides of it', () => {
    const { cr, counter } = crossingsOf('1/x - y')
    cr.edge(cr.corner(-0.22, 20), cr.corner(0.07, 20), false)
    const first = counter.intervals
    const info = cr.edge(cr.corner(-0.22, 30), cr.corner(0.07, 30), false)
    expect(info.roots.length).toBe(1)
    expect(Math.abs(info.roots[0].x - 1 / 30)).toBeLessThan(1e-5)
    // the whole edge, the gap, and the two stretches: not the dozens of a subdivision from the top
    expect(counter.intervals - first).toBeLessThanOrEqual(6)
  })

  it('cuts an edge with an undefined end at the domain edge and finds the root on the defined part', () => {
    const { cr } = crossingsOf('sqrt(x) - y')
    const a = cr.corner(-0.5, 0.3)
    const b = cr.corner(0.5, 0.3)
    expect(a.v).toBeNaN()
    const info = cr.edge(a, b, false)
    expect(info.gap).toBe(true)
    expect(info.roots.length).toBe(1)
    expect(Math.abs(info.roots[0].x - 0.09)).toBeLessThan(1e-4)
    // and a curve that runs down beside the domain edge is followed to the bottom: ln x = -14 at x = 8e-7
    const { cr: ln } = crossingsOf('ln(x) - y')
    const low = ln.edge(ln.corner(-0.03, -14), ln.corner(0.03, -14), false)
    expect(low.roots.length).toBe(1)
    expect(Math.abs(low.roots[0].x - Math.exp(-14)) / Math.exp(-14)).toBeLessThan(1e-3)
  })

  it('keeps the roots put on an edge, in order from the end with the smaller (x, y), and says they are arms', () => {
    const { cr } = crossingsOf('x - y')
    const a = cr.corner(0, 0)
    const b = cr.corner(1, 0)
    const r1 = { ok: true as const, x: 0.2, y: 0 }
    const r2 = { ok: true as const, x: 0.7, y: 0 }
    expect(cr.maybeRegistered(a, b)).toBe(false)
    // given from b to a
    expect(cr.register(b, a, [r2, r1])).toBe(true)
    expect(cr.maybeRegistered(a, b)).toBe(true)
    expect(cr.edge(a, b, true).roots).toEqual([r1, r2])
    expect(cr.edge(b, a, true).roots[0]).toBe(r1)
    expect(cr.isArm(r1) && cr.isArm(r2)).toBe(true)
    expect(cr.isArm({ x: 0.2, y: 0 })).toBe(false)
    // an edge that is known is not registered again
    expect(cr.register(a, b, [r1])).toBe(false)
  })

  it('takes an edge for a zero edge only if H is zero at its midpoint too', () => {
    const h = 30 / 1024
    const { cr } = crossingsOf(`y - 1000*x*(x - ${h.toFixed(12)})`)
    // zero at both ends of [0, h] on y = 0, and 0.2 between
    expect(cr.zeroEdge(cr.corner(0, 0), cr.corner(h, 0))).toBe(false)
    const { cr: line } = crossingsOf('y')
    expect(line.zeroEdge(line.corner(0, 0), line.corner(h, 0))).toBe(true)
  })
})

describe('pieces on defined ground', () => {
  it('draws no chord across an undefined strip narrower than a leaf: y = sqrt((x - c)^2 - r^2) is two branches', () => {
    for (const [tuning, w] of [
      [FULL, 30 / 1024],
      [COARSE, 30 / 256],
    ] as const) {
      const c = w / 2
      const r = w * 0.35
      const t = trace(`sqrt((x - ${c.toFixed(12)})^2 - ${(r * r).toFixed(12)}) - y`, { tuning })
      expect(t.chains.length).toBe(2)
      expect(t.contour.stats.chordsRejected).toBeGreaterThanOrEqual(1)
      for (const ch of t.chains) {
        for (const [a, b] of segmentsOf(ch)) expect(Math.min(a.x, b.x) <= c - r && Math.max(a.x, b.x) >= c + r).toBe(false)
      }
      expect(worstPx(t)).toBeLessThan(0.5)
    }
  })

  it('asks the twin of a piece only in a leaf it did not prove, and lets a UNKNOWN twin through', () => {
    const proven = contour('x + y - 0.5', [leaf(0, 1, 0, 1, CONTINUOUS)])
    expect(proven.counter.intervals).toBe(0)
    const loose = contour('x + y - 0.5', [leaf(0, 1, 0, 1, PARTIAL)])
    expect(loose.segments.length).toBe(1)
    // the 2 roots (twin on each bracket) and the box of the piece
    expect(loose.counter.intervals).toBeGreaterThan(proven.counter.intervals)
    // an integral is UNKNOWN everywhere: its curves are not blocked by a twin that says nothing
    const integral = contour('integral(t = 0 to x, 2 * t) + y - 0.5', [leaf(0, 1, 0, 1, UNKNOWN)])
    expect(integral.segments.length).toBe(1)
    expect(integral.stats.chordsRejected).toBe(0)
  })

  it('draws no false zero edge: a parabola through two adjacent corners is not zero between them', () => {
    const h = 30 / 1024
    const t = trace(`y - 1000*x*(x - ${h.toFixed(12)})`)
    for (const s of t.contour.segments) expect(s.a.y === 0 && s.b.y === 0 && Math.min(s.a.x, s.b.x) === 0 && Math.max(s.a.x, s.b.x) === h).toBe(false)
    expect(worstPx(t)).toBeLessThan(0.5)
    const leafBelow = contour(`y - 1000*x*(x - ${h.toFixed(12)})`, [leaf(0, h, -h, 0)])
    expect(leafBelow.segments).toEqual([])
  })
})

describe('leaves are not left blank beside a domain edge or a pole', () => {
  it('follows y = ln x, y = sqrt(x) and the semicircle to their ends in a panned view, within a leaf', () => {
    for (const [tuning, h] of [
      [FULL, 30 / 1024],
      [COARSE, 30 / 256],
    ] as const) {
      const ln = trace('ln(x) - y', { view: PANNED, tuning })
      const lnv = allVertices(ln.chains)
      expect(ln.chains.length).toBe(1)
      // down to the bottom of the root, y = -14.3, beside x = 0
      expect(Math.min(...lnv.map((p) => p.y))).toBeLessThan(-14.3 + h)
      expect(Math.min(...lnv.map((p) => p.x))).toBeLessThan(1e-5)
      expect(worstPx(ln)).toBeLessThan(0.5)

      const sq = trace('sqrt(x) - y', { view: PANNED, tuning })
      const sqv = allVertices(sq.chains)
      expect(sq.chains.length).toBe(1)
      // it starts at the origin, to within a leaf
      expect(Math.min(...sqv.map((p) => p.y))).toBeLessThan(h + 1e-9)
      expect(Math.min(...sqv.map((p) => p.x))).toBeLessThan(h * h * 4 + 1e-9)
      expect(worstPx(sq)).toBeLessThan(0.5)

      const arc = trace('sqrt(1 - x^2) - y', { view: PANNED, tuning })
      const av = allVertices(arc.chains)
      expect(arc.chains.length).toBe(1)
      // from near (-1, 0) to near (1, 0), each end within a leaf of it
      expect(Math.max(...av.map((p) => p.x))).toBeGreaterThan(1 - h)
      expect(Math.min(...av.map((p) => p.x))).toBeLessThan(-1 + h)
      expect(Math.min(...av.map((p) => p.y))).toBeLessThan(h + 1e-9)
      expect(worstPx(arc)).toBeLessThan(0.5)
    }
  })

  it('draws y = 1/x zoomed out to the edge of the root, though its pole and its root share the leaves beside x = 0', () => {
    const view: Bounds = { xMin: -97, xMax: 103, yMin: -100, yMax: 100 }
    for (const tuning of [FULL, COARSE]) {
      const t = trace('1/x - y', { view, px: { x: 4, y: 4 }, tuning })
      expect(t.chains.length).toBe(2)
      expect(Math.max(...allVertices(t.chains).map((p) => Math.abs(p.y)))).toBe(150)
      // each branch from the far side of the root to its top or bottom
      for (const c of t.chains) {
        const v = verticesOf(c)
        expect(Math.abs(v[0].y) === 150 || Math.abs(v[v.length - 1].y) === 150).toBe(true)
      }
      expect(t.touch.chains).toEqual([])
      expect(t.touch.points).toEqual([])
      expect(worstPx(t)).toBeLessThan(0.5)
    }
  })

  it('draws the branches of y = tan x at COARSE whole, with no touch curves', () => {
    const t = trace('y - tan(x)', { tuning: COARSE })
    expect(t.chains.length).toBe(11)
    expect(t.touch.chains).toEqual([])
    expect(t.touch.points).toEqual([])
    // every branch runs from the bottom of the root to its top
    for (const c of t.chains) {
      const v = verticesOf(c)
      expect(Math.abs(v[0].y) === 15 || Math.abs(v[0].x) === 15).toBe(true)
      expect(Math.abs(v[v.length - 1].y) === 15 || Math.abs(v[v.length - 1].x) === 15).toBe(true)
    }
  })
})

describe('leaves too coarse to contour', () => {
  it('leaves out a leaf the quadtree stopped halving that is wider than the limit, and says so', () => {
    const wide = leaf(-100, 100, -100, 100, UNKNOWN, 'budget')
    const r = contour('y - 0.3', [wide], PX, undefined, { x0: -200, x1: 200, y0: -200, y1: 200 })
    expect(r.segments).toEqual([])
    expect(r.refused).toBe(true)
    expect(r.stats.oversized).toBe(1)
    expect(r.stats.leaves).toBe(0)
    // a leaf of the same size that the quadtree halved down to is the caller's own choice of leaf size
    const chosen = contour('y - 0.3', [leaf(-100, 100, -100, 100, UNKNOWN, 'size')], PX, undefined, { x0: -200, x1: 200, y0: -200, y1: 200 })
    expect(chosen.segments.length).toBe(1)
    expect(chosen.refused).toBe(false)
    // a leaf the budget stopped, within the limit, is contoured
    const near = contour('y - 0.3', [leaf(0, 18.75 / 40, 0, 18.75 / 40, CONTINUOUS, 'budget')])
    expect(near.refused).toBe(false)
  })

  it('refuses the leaves of a starved quadtree, so that no chord is drawn across hundreds of px', () => {
    const t = trace('(x - 8)^2 + y^2 - 9', { tuning: { ...FULL, budget: { intervals: 20 } } })
    expect(t.capped).toBe(true)
    expect(t.contour.refused).toBe(true)
    expect(t.contour.segments).toEqual([])
    expect(t.chains).toEqual([])
    // a budget that leaves leaves within the limit draws the circle
    const ok = trace('(x - 8)^2 + y^2 - 9', { tuning: { ...FULL, budget: { intervals: 700 } } })
    expect(ok.contour.refused).toBe(false)
    expect(ok.chains.length).toBe(1)
  })
})
