import { describe, expect, it } from 'vitest'
import { CONTINUOUS, PARTIAL } from '../../math/interval'
import type { Verdict } from '../../math/interval'
import type { Bounds, Vec2 } from '../../scene/types'
import { expr, scopeOf } from '../sample/testkit'
import type { EvalCounter, PxScale } from '../sample/types'
import { buildChains } from './chains'
import { type ContourBudget, type ContourResult, compileContour, contourLeaves, Crossings, newStats } from './contour'
import { allVertices, arms, curveDistPx, firstCrossing, lengthOf, nearestPx, nearestVertex, PX, segmentsOf, signedArea, trace, verticesOf, worstPx } from './testkit'
import { COARSE, FULL } from './tuning'
import type { Box, Leaf } from './types'

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

function leaf(x0: number, x1: number, y0: number, y1: number, verdict: Verdict = CONTINUOUS): Leaf {
  return { x0, x1, y0, y1, stop: 'size', verdict }
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

  it('keeps the X within half a px of the zero set at COARSE: two branches just apart are two arcs, not an X a px from them', () => {
    // a COARSE leaf is 4.69 px, 0.1172 units at 40 px a unit; xy = e at its centre, e a hair under and over crossRel (h/2)^2
    const h = 4.6875 / 40
    const corner = (h / 2) ** 2
    const px = { x: 40, y: 40 }
    for (const e of [0.0199 * corner, 0.021 * corner]) {
      // (toFixed: the parser would read the e of 6.8e-5 as Euler's constant)
      const r = contour(`x * y - ${e.toFixed(12)}`, [leaf(-h / 2, h / 2, -h / 2, h / 2)], px)
      // the centre of the X, if it is one, is sqrt(2e) from the branches xy = e; the arcs' ends are on them
      const verts = r.segments.flatMap((s) => [s.a, s.b]).filter((p) => Math.hypot(p.x, p.y) > 1e-12)
      const worst = Math.max(...verts.map((p) => Math.abs(p.x * p.y - e) / Math.hypot(p.x, p.y)))
      const centreOff = r.stats.crosses === 1 ? Math.sqrt(2 * e) * px.x : 0
      expect(Math.max(worst * px.x, centreOff)).toBeLessThan(0.5)
      expect(r.stats.crosses).toBe(e < 0.02 * corner ? 1 : 0)
    }
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

  it('finds a root the signs of the corners hide, beside a pole in the same leaf', () => {
    // the pole at pi/2 and the curve at x = pi/2 + 0.067 are both on every horizontal edge of this leaf: two sign changes
    // along an edge, so none at its ends. The iterate comes down to the curve, and |H| falls with it.
    const r = contour('y - tan(x)', [leaf(Math.PI / 2 - 0.01, Math.PI / 2 + 0.107, -15, -14.8, PARTIAL)])
    expect(r.segments).toEqual([])
    expect(r.touches.length).toBe(1)
    expect(Math.abs(Math.tan(r.touches[0].x) - r.touches[0].y)).toBeLessThan(1e-3)
    expect(r.touches[0].x).toBeGreaterThan(Math.PI / 2)
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
    // four corners, then 3 evaluations (H and the two partials) at each iterate
    expect(r.counter.points).toBeGreaterThanOrEqual(4 + 3 * 3)
    expect(r.counter.points).toBeLessThanOrEqual(4 + 3 * 9)
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

  it('sin(x) = cos(y): the lattice, with no arcs crossing over', () => {
    const t = trace('sin(x) - cos(y)')
    expect(worstPx(t)).toBeLessThan(0.5)
    expect(t.chains.length).toBeGreaterThan(10)
    expect(firstCrossing(t.chains)).toBeNull()
    expect(t.capped).toBe(false)
    // The lines cross at (pi/2 + pi j, pi n) for j + n even. The curve passes within a px of each node (a leaf is 1.17 px:
    // where the lines cross inside one, running along its diagonals, the corners cannot show four sign changes, and the
    // piece that cuts the leaf's corner misses the node by up to half the leaf's width).
    let nodes = 0
    for (let j = -3; j <= 3; j++) {
      for (let n = -3; n <= 3; n++) {
        if (Math.abs(j + n) % 2 !== 0) continue
        nodes++
        expect(curveDistPx(t.chains, { x: Math.PI / 2 + Math.PI * j, y: Math.PI * n })).toBeLessThan(1)
      }
    }
    expect(nodes).toBe(25)
    // the lines run along the diagonals of the leaves, so no leaf has four crossings to pair
    expect(t.contour.stats.saddles).toBe(0)
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
