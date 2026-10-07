import { describe, expect, it } from 'vitest'
import { compileScalar } from '../../math/compile'
import { compileInterval } from '../../math/interval'
import type { Bounds } from '../../scene/types'
import { expr, scopeOf } from '../sample/testkit'
import type { EvalCounter, PxScale } from '../sample/types'
import { implicitClassifier, rootBox, subdivide } from './quadtree'
import { COARSE, FULL, type ImplicitTuning } from './tuning'
import type { Box, CellClass, Leaf } from './types'

// The default view of the corpus: [-10, 10]^2 at 800 px, so 40 px per unit, and the 25 % overscan makes the root [-15, 15]^2.
const VIEW: Bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
const PX: PxScale = { x: 40, y: 40 }

// H = F - G over the root box of `view`, subdivided with the implicit classifier at `tuning`'s leaf size.
function run(h: string, tuning: ImplicitTuning = FULL, budget = tuning.budget, view: Bounds = VIEW, px: PxScale = PX) {
  const H = compileInterval(expr(h), ['x', 'y'], scopeOf())
  const counter: EvalCounter = { points: 0, intervals: 0 }
  const root = rootBox(view, tuning.overscan)
  const result = subdivide(implicitClassifier(H), root, { x: tuning.leafPx, y: tuning.leafPx }, px, counter, budget)
  return { ...result, counter, root }
}

// Whether a point lies in some leaf (closed boxes: a point on a shared edge is in both). The leaves are indexed on a
// grid of buckets, so that a hundred thousand points against fifty thousand leaves is not their product.
function leafIndex(leaves: Leaf[], root: Box, n = 64) {
  const buckets: number[][] = Array.from({ length: n * n }, () => [])
  const bx = (x: number) => Math.max(0, Math.min(n - 1, Math.floor(((x - root.x0) / (root.x1 - root.x0)) * n)))
  const by = (y: number) => Math.max(0, Math.min(n - 1, Math.floor(((y - root.y0) / (root.y1 - root.y0)) * n)))
  leaves.forEach((l, k) => {
    for (let j = by(l.y0); j <= by(l.y1); j++) for (let i = bx(l.x0); i <= bx(l.x1); i++) buckets[j * n + i].push(k)
  })
  return (x: number, y: number) =>
    buckets[by(y) * n + bx(x)].some((k) => {
      const l = leaves[k]
      return x >= l.x0 && x <= l.x1 && y >= l.y0 && y <= l.y1
    })
}

// Every sample must lie in a leaf; the first that does not is reported. The samples themselves are checked to be
// zeros of H (|H| tiny), so that a test of "covers every true zero" is not a test of covering something near one.
function expectCovers(h: string, samples: [number, number][], leaves: Leaf[], root: Box) {
  const H = compileScalar(expr(h), ['x', 'y'], scopeOf())
  const covered = leafIndex(leaves, root)
  expect(samples.length).toBeGreaterThan(1000)
  let worstH = 0
  for (const [x, y] of samples) worstH = Math.max(worstH, Math.abs(H(x, y)))
  expect(worstH).toBeLessThan(1e-9)
  const missed = samples.filter(([x, y]) => !covered(x, y))
  expect(missed.slice(0, 3)).toEqual([])
}

const inRoot = ([x, y]: [number, number]) => Math.abs(x) <= 15 && Math.abs(y) <= 15

function circle(r: number, n = 8000): [number, number][] {
  return Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]).filter(inRoot)
}

describe('subdivide with the implicit classifier: covering the zero set', () => {
  it('covers every point of a circle, at leaf size and uncapped', () => {
    const r = run('x^2 + y^2 - 25')
    expectCovers('x^2 + y^2 - 25', circle(5), r.leaves, r.root)
    expect(r.capped).toBe(false)
    expect(r.whole).toEqual([])
    expect(r.leaves.length).toBeGreaterThan(1000)
    expect(r.leaves.every((l) => l.stop === 'size')).toBe(true)
  })

  it('covers the lines y = 2x + 1, x = 3 and y = x', () => {
    const slope = run('y - 2*x - 1')
    expectCovers('y - 2*x - 1', Array.from({ length: 6000 }, (_, i): [number, number] => {
      const x = -7.4 + (14.39 * i) / 5999
      return [x, 2 * x + 1]
    }).filter(inRoot), slope.leaves, slope.root)

    const vertical = run('x - 3')
    expectCovers('x - 3', Array.from({ length: 6000 }, (_, i): [number, number] => [3, -15 + (30 * i) / 5999]), vertical.leaves, vertical.root)

    const diagonal = run('x - y')
    expectCovers('x - y', Array.from({ length: 6000 }, (_, i): [number, number] => {
      const x = -15 + (30 * i) / 5999
      return [x, x]
    }), diagonal.leaves, diagonal.root)
  })

  it('covers both branches of xy = 1', () => {
    const r = run('x*y - 1')
    const samples: [number, number][] = []
    for (let i = 0; i < 20000; i++) {
      const s = Math.log(15) * (-1 + (2 * i) / 19999) // x = e^s runs from 1/15 to 15
      const x = Math.exp(s)
      samples.push([x, 1 / x], [-x, -1 / x])
    }
    expectCovers('x*y - 1', samples.filter(inRoot), r.leaves, r.root)
  })

  it('covers the whole lattice of sin(x) = cos(y)', () => {
    // cos(y) = sin(x) = cos(pi/2 - x), so y = +-(pi/2 - x) + 2 pi k
    const r = run('sin(x) - cos(y)')
    const samples: [number, number][] = []
    for (let k = -6; k <= 6; k++) {
      for (let i = 0; i < 4000; i++) {
        const x = -15 + (30 * i) / 3999
        samples.push([x, Math.PI / 2 - x + 2 * Math.PI * k], [x, -(Math.PI / 2 - x) + 2 * Math.PI * k])
      }
    }
    expectCovers('sin(x) - cos(y)', samples.filter(inRoot), r.leaves, r.root)
    expect(r.capped).toBe(false)
  })

  it('covers a curve with a domain edge (y = ln x) and one with poles (y = tan x)', () => {
    const ln = run('ln(x) - y')
    expectCovers('ln(x) - y', Array.from({ length: 12000 }, (_, i): [number, number] => {
      const x = Math.exp(-15 + (15 + Math.log(15)) * (i / 11999))
      return [x, Math.log(x)]
    }).filter(inRoot), ln.leaves, ln.root)

    const tan = run('tan(x) - y')
    const samples: [number, number][] = []
    for (let i = 0; i < 60000; i++) {
      const x = -15 + (30 * i) / 59999
      samples.push([x, Math.tan(x)])
    }
    // away from a pole's own rounding, where tan is the huge value a double makes of it
    expectCovers('tan(x) - y', samples.filter(([x, y]) => inRoot([x, y]) && Math.abs(y) < 14), tan.leaves, tan.root)
  })

  it('gives no leaves where H has no zero (x^2 + y^2 = -1), after one evaluation', () => {
    const r = run('x^2 + y^2 + 1')
    expect(r.leaves).toEqual([])
    expect(r.whole).toEqual([])
    expect(r.capped).toBe(false)
    expect(r.counter.intervals).toBe(1)
  })

  it('drops a cell the twin says is undefined (empty) and keeps nothing there', () => {
    // ln(-1 - x^2 - y^2) is NaN everywhere (the argument is below -1), so the twin's enclosure of the root is empty (lo > hi)
    const r = run('ln(-1 - x^2 - y^2)')
    expect(r.leaves).toEqual([])
    expect(r.counter.intervals).toBe(1)
  })
})

describe('subdivide: the cost follows the curve', () => {
  it('spends under 20 evaluations a pixel of perimeter on x^2 + y^2 = 25, and scales with the length, not the area', () => {
    const small = run('x^2 + y^2 - 25')
    const perimeterPx = 2 * Math.PI * 5 * 40
    expect(small.counter.intervals).toBeLessThanOrEqual(20 * perimeterPx)

    // twice the radius is twice the length and four times the area
    const big = run('x^2 + y^2 - 100')
    const ratio = big.counter.intervals / small.counter.intervals
    expect(ratio).toBeGreaterThan(1.5)
    expect(ratio).toBeLessThan(2.6)

    // and nowhere near the cells of the root at leaf size (about 3.2 million at 0.586 px)
    expect(small.counter.intervals).toBeLessThan(0.02 * (1200 / 0.586) ** 2)
  })

  it('costs under half at COARSE (4 px leaves; about a quarter measured), with under a third of the leaves', () => {
    const full = run('x^2 + y^2 - 25', FULL)
    const coarse = run('x^2 + y^2 - 25', COARSE)
    expect(coarse.counter.intervals).toBeLessThan(0.5 * full.counter.intervals)
    expect(coarse.leaves.length).toBeLessThan(0.3 * full.leaves.length)
    expectCovers('x^2 + y^2 - 25', circle(5), coarse.leaves, coarse.root)
  })

  it('stays under 70 % of the budget, at FULL and at COARSE, on a circle, xy = 1 and the lattice sin(x) = cos(y)', () => {
    for (const tuning of [FULL, COARSE]) {
      for (const h of ['x^2 + y^2 - 25', 'x*y - 1', 'sin(x) - cos(y)']) {
        const r = run(h, tuning)
        expect(r.capped, `${h} at ${tuning.leafPx} px`).toBe(false)
        expect(r.counter.intervals, `${h} at ${tuning.leafPx} px`).toBeLessThan(0.7 * tuning.budget.intervals)
      }
    }
  })
})

describe('subdivide: leaves', () => {
  it('are all the same size, at most the leaf size and more than half of it, on each axis', () => {
    const r = run('x^2 + y^2 - 25')
    for (const l of r.leaves) {
      const w = (l.x1 - l.x0) * PX.x
      const h = (l.y1 - l.y0) * PX.y
      expect(w).toBeLessThanOrEqual(FULL.leafPx * (1 + 1e-9))
      expect(w).toBeGreaterThan(FULL.leafPx / 2)
      expect(h).toBeLessThanOrEqual(FULL.leafPx * (1 + 1e-9))
      expect(h).toBeGreaterThan(FULL.leafPx / 2)
    }
    const w0 = r.leaves[0].x1 - r.leaves[0].x0
    expect(r.leaves.every((l) => Math.abs(l.x1 - l.x0 - w0) < 1e-12)).toBe(true)
  })

  it('share their edges exactly with a neighbour of the same size', () => {
    // y = 0 is a halving of the root, so both the row of leaves under it and the row over it touch the line; take the row
    // under. Side by side, one's x1 is the next one's x0, to the bit, across the whole of the root, which is the edge a
    // contour's crossing is keyed by.
    const r = run('y')
    const row = r.leaves.filter((l) => l.y1 === 0).sort((a, b) => a.x0 - b.x0)
    expect(row.length).toBeGreaterThan(1000)
    expect(row[0].x0).toBe(-15)
    expect(row[row.length - 1].x1).toBe(15)
    for (let i = 1; i < row.length; i++) expect(row[i].x0).toBe(row[i - 1].x1)
    // and the row over the line is the same cells shifted up by one leaf, with the same x edges
    const above = r.leaves.filter((l) => l.y0 === 0).sort((a, b) => a.x0 - b.x0)
    expect(above.map((l) => l.x0)).toEqual(row.map((l) => l.x0))
  })

  it('halve only the axes still over the leaf size (an anisotropic view)', () => {
    // 10 px a unit across, 160 down: the root [-15, 15]^2 is 300 by 4800 px; leaf 2 by 1 px
    const view: Bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    const H = compileInterval(expr('x^2/100 + y^2 - 1'), ['x', 'y'], scopeOf())
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const px: PxScale = { x: 10, y: 160 }
    const r = subdivide(implicitClassifier(H), rootBox(view, 0.25), { x: 2, y: 1 }, px, counter, { intervals: 1e6 })
    expect(r.leaves.length).toBeGreaterThan(100)
    for (const l of r.leaves) {
      const w = (l.x1 - l.x0) * px.x
      const h = (l.y1 - l.y0) * px.y
      expect(w).toBeLessThanOrEqual(2 * (1 + 1e-9))
      expect(w).toBeGreaterThan(1)
      expect(h).toBeLessThanOrEqual(1 * (1 + 1e-9))
      expect(h).toBeGreaterThan(0.5)
    }
    expect(r.capped).toBe(false)
  })

  it('stop being halved where the doubles run out, and are then leaves of size', () => {
    // a root 4 ulps wide at 1: 1 ulp is as fine as a cell gets, though the leaf size is far finer
    const root: Box = { x0: 1, x1: 1 + 4 * Number.EPSILON, y0: 1, y1: 1 + 4 * Number.EPSILON }
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(() => 'split', root, { x: 1, y: 1 }, { x: 1e20, y: 1e20 }, counter, { intervals: 1e6 })
    expect(r.leaves).toHaveLength(16)
    expect(r.capped).toBe(false)
    expect(r.leaves.every((l) => l.stop === 'size' && l.x1 > l.x0 && l.y1 > l.y0)).toBe(true)
  })

  it('make the root itself a leaf when it is already at the leaf size', () => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(() => 'split', { x0: 0, x1: 0.5, y0: 0, y1: 0.5 }, { x: 1, y: 1 }, { x: 1, y: 1 }, counter, { intervals: 10 })
    expect(r.leaves).toEqual([{ x0: 0, x1: 0.5, y0: 0, y1: 0.5, stop: 'size' }])
    expect(counter.intervals).toBe(1)
  })
})

describe('subdivide: order', () => {
  // leaf size 100 px in a 1200 px root: 4 halvings per axis, a 16 x 16 lattice of 75 px cells
  const always = (budget = 1e6) => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(() => 'split', rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, counter, { intervals: budget })
    return { ...r, counter }
  }

  it('is depth-first with the quadrants low-low, high-low, low-high, high-high', () => {
    const r = always()
    expect(r.leaves).toHaveLength(256)
    expect(r.counter.intervals).toBe(1 + 4 + 16 + 64 + 256)
    const [a, b, c, d] = r.leaves
    // the four siblings of the first 2 x 2 block, in the fixed order
    expect(a.x0).toBe(-15)
    expect(a.y0).toBe(-15)
    expect(b.x0).toBe(a.x1)
    expect(b.y0).toBe(a.y0)
    expect(c.x0).toBe(a.x0)
    expect(c.y0).toBe(a.y1)
    expect(d.x0).toBe(a.x1)
    expect(d.y0).toBe(a.y1)
    // and the whole of that quadrant (64 leaves) before any of the next
    expect(r.leaves.slice(0, 64).every((l) => l.x1 <= 0 && l.y1 <= 0)).toBe(true)
    expect(r.leaves[64].x0).toBe(0)
    expect(r.leaves[64].y0).toBe(-15)
  })

  it('is deterministic: two runs give the same leaves in the same order and the same count', () => {
    const one = run('sin(x) - cos(y)')
    const two = run('sin(x) - cos(y)')
    expect(two.leaves).toEqual(one.leaves)
    expect(two.counter).toEqual(one.counter)
    expect(two.capped).toBe(one.capped)
  })
})

describe('subdivide: the budget', () => {
  it('counts every classifier call against counter.intervals, from where the counter stood, and leaves points alone', () => {
    const counter: EvalCounter = { points: 5, intervals: 1000 }
    let calls = 0
    const r = subdivide(() => { calls++; return 'split' }, rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, counter, { intervals: 50 })
    expect(calls).toBe(50)
    expect(counter.intervals).toBe(1050)
    expect(counter.points).toBe(5)
    expect(r.capped).toBe(true)
  })

  it('turns the cells still pending into leaves at their current size, which still partition the root, and says so', () => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const root = rootBox(VIEW, 0.25)
    const r = subdivide(() => 'split', root, { x: 100, y: 100 }, PX, counter, { intervals: 100 })
    expect(r.capped).toBe(true)
    expect(counter.intervals).toBe(100)
    expect(r.leaves.some((l) => l.stop === 'budget')).toBe(true)
    // nothing was dropped, so the leaves tile the root: their areas add up to its
    const area = r.leaves.reduce((s, l) => s + (l.x1 - l.x0) * (l.y1 - l.y0), 0)
    expect(area).toBeCloseTo((root.x1 - root.x0) * (root.y1 - root.y0), 9)
    // a budget leaf is larger than a size leaf, unless it is one of the cells that was already that small
    const sizeW = Math.max(...r.leaves.filter((l) => l.stop === 'size').map((l) => l.x1 - l.x0))
    expect(Math.max(...r.leaves.filter((l) => l.stop === 'budget').map((l) => l.x1 - l.x0))).toBeGreaterThan(sizeW)
  })

  it('still covers the zero set when it is capped', () => {
    const capped = run('x^2 + y^2 - 25', FULL, { intervals: 700 })
    expect(capped.capped).toBe(true)
    expect(capped.counter.intervals).toBe(700)
    expect(capped.leaves.some((l) => l.stop === 'budget')).toBe(true)
    expectCovers('x^2 + y^2 - 25', circle(5), capped.leaves, capped.root)
  })

  it('is capped by one evaluation less than the run needs and by no less than it needs', () => {
    const free = run('x^2 + y^2 - 25')
    const needs = free.counter.intervals
    const exact = run('x^2 + y^2 - 25', FULL, { intervals: needs })
    expect(exact.capped).toBe(false)
    expect(exact.leaves).toEqual(free.leaves)
    const short = run('x^2 + y^2 - 25', FULL, { intervals: needs - 1 })
    expect(short.capped).toBe(true)
    expect(short.leaves.some((l) => l.stop === 'budget')).toBe(true)
  })

  it('with no budget at all makes the root one leaf, evaluating nothing', () => {
    const r = run('x^2 + y^2 - 25', FULL, { intervals: 0 })
    expect(r.capped).toBe(true)
    expect(r.counter.intervals).toBe(0)
    expect(r.leaves).toEqual([{ x0: -15, x1: 15, y0: -15, y1: 15, stop: 'budget' }])
  })
})

describe('subdivide: keep-whole, for a classifier that can prove a cell inside', () => {
  // a disc of radius 3: a cell wholly inside is kept whole, one wholly outside dropped, one the circle crosses split
  const disc = (b: Box): CellClass => {
    const nx = Math.max(b.x0, Math.min(0, b.x1))
    const ny = Math.max(b.y0, Math.min(0, b.y1))
    const near = Math.hypot(nx, ny)
    const far = Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1)))
    if (near > 3) return 'drop'
    if (far < 3) return 'keep-whole'
    return 'split'
  }
  const farOf = (b: Box) => Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1)))
  const nearOf = (b: Box) => Math.hypot(Math.max(b.x0, Math.min(0, b.x1)), Math.max(b.y0, Math.min(0, b.y1)))

  it('records a proven cell in whole without subdividing it, and subdivides only the cells the circle crosses', () => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(disc, rootBox(VIEW, 0.25), { x: 1, y: 1 }, PX, counter, { intervals: 1e6 })
    expect(r.capped).toBe(false)
    expect(r.whole.length).toBeGreaterThan(10)
    expect(r.whole.every((b) => farOf(b) < 3)).toBe(true)
    expect(r.leaves.length).toBeGreaterThan(100)
    expect(r.leaves.every((l) => l.stop === 'size' && nearOf(l) <= 3 && farOf(l) >= 3)).toBe(true)
    // a proven cell is kept as the big cell it was found at, not cut down to the leaf size
    const leafW = r.leaves[0].x1 - r.leaves[0].x0
    expect(Math.max(...r.whole.map((b) => b.x1 - b.x0))).toBeGreaterThan(8 * leafW)
    // whole and leaves together cover the disc, and not much more than it
    const area = [...r.whole, ...r.leaves].reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0), 0)
    expect(area).toBeGreaterThanOrEqual(Math.PI * 9)
    expect(area).toBeLessThan(Math.PI * 3.03 ** 2)
    // cheap: far under the cells a leaf-size lattice would classify
    expect(counter.intervals).toBeLessThan(20000)
  })

  it('keeps the root whole when everything is proven inside, and drops it when nothing is', () => {
    const root = rootBox(VIEW, 0.25)
    const a: EvalCounter = { points: 0, intervals: 0 }
    const inside = subdivide(() => 'keep-whole', root, { x: 1, y: 1 }, PX, a, { intervals: 10 })
    expect(inside.whole).toEqual([root])
    expect(inside.leaves).toEqual([])
    expect(a.intervals).toBe(1)
    const b: EvalCounter = { points: 0, intervals: 0 }
    const outside = subdivide(() => 'drop', root, { x: 1, y: 1 }, PX, b, { intervals: 10 })
    expect(outside.whole).toEqual([])
    expect(outside.leaves).toEqual([])
    expect(b.intervals).toBe(1)
  })

  it('does not alias the root it was given: a kept root is a copy', () => {
    const root = rootBox(VIEW, 0.25)
    const r = subdivide(() => 'keep-whole', root, { x: 1, y: 1 }, PX, { points: 0, intervals: 0 }, { intervals: 10 })
    expect(r.whole[0]).not.toBe(root)
  })

  it('keeps the whole cells in depth-first order and is deterministic', () => {
    const run1 = () => subdivide(disc, rootBox(VIEW, 0.25), { x: 4, y: 4 }, PX, { points: 0, intervals: 0 }, { intervals: 1e6 })
    const one = run1()
    const two = run1()
    expect(two.whole).toEqual(one.whole)
    expect(two.leaves).toEqual(one.leaves)
  })

  it('hands the classifier a box of its own: one kept after the call is not changed by the next', () => {
    const seen: Box[] = []
    subdivide((b) => { seen.push(b); return 'split' }, rootBox(VIEW, 0.25), { x: 300, y: 300 }, PX, { points: 0, intervals: 0 }, { intervals: 1e6 })
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen[0]).toMatchObject({ x0: -15, x1: 15, y0: -15, y1: 15 })
  })
})

describe('subdivide: bad arguments are errors, never an empty answer', () => {
  const ok = { points: 0, intervals: 0 }
  const root = rootBox(VIEW, 0.25)
  it('refuses a root that is not a finite box', () => {
    for (const bad of [
      { x0: NaN, x1: 1, y0: 0, y1: 1 },
      { x0: 0, x1: Infinity, y0: 0, y1: 1 },
      { x0: 1, x1: 1, y0: 0, y1: 1 },
      { x0: 0, x1: 1, y0: 2, y1: 1 },
    ]) expect(() => subdivide(() => 'split', bad, { x: 1, y: 1 }, PX, { ...ok }, { intervals: 10 })).toThrow(RangeError)
  })
  it('refuses a root that is finite but an infinite number of px (it would take no number of halvings)', () => {
    expect(() => subdivide(() => 'split', { x0: 0, x1: 1e300, y0: 0, y1: 1 }, { x: 1, y: 1 }, { x: 1e300, y: 1 }, { ...ok }, { intervals: 10 })).toThrow(RangeError)
  })
  it('refuses a leaf size, a scale or a budget that is not a positive finite number (the budget: not NaN, not negative)', () => {
    expect(() => subdivide(() => 'split', root, { x: 0, y: 1 }, PX, { ...ok }, { intervals: 10 })).toThrow(RangeError)
    expect(() => subdivide(() => 'split', root, { x: 1, y: NaN }, PX, { ...ok }, { intervals: 10 })).toThrow(RangeError)
    expect(() => subdivide(() => 'split', root, { x: 1, y: 1 }, { x: 0, y: 40 }, { ...ok }, { intervals: 10 })).toThrow(RangeError)
    expect(() => subdivide(() => 'split', root, { x: 1, y: 1 }, { x: 40, y: Infinity }, { ...ok }, { intervals: 10 })).toThrow(RangeError)
    expect(() => subdivide(() => 'split', root, { x: 1, y: 1 }, PX, { ...ok }, { intervals: NaN })).toThrow(RangeError)
    expect(() => subdivide(() => 'split', root, { x: 1, y: 1 }, PX, { ...ok }, { intervals: -1 })).toThrow(RangeError)
  })
})

describe('rootBox', () => {
  it('widens the view by the overscan fraction of its size on every side', () => {
    expect(rootBox({ xMin: -10, xMax: 10, yMin: -4, yMax: 4 }, 0.25)).toEqual({ x0: -15, x1: 15, y0: -6, y1: 6 })
    expect(rootBox({ xMin: 0, xMax: 8, yMin: 0, yMax: 8 }, 0)).toEqual({ x0: 0, x1: 8, y0: 0, y1: 8 })
  })
})

describe('the implicit classifier', () => {
  const scratchOf = () => ({ lo: 0, hi: 0, v: 3 as const })
  it('drops a cell the discard rule clears (lo > 0, hi < 0, empty) and splits one it cannot', () => {
    const H = compileInterval(expr('x - 5'), ['x', 'y'], scopeOf())
    const c = implicitClassifier(H)
    expect(c({ x0: 6, x1: 7, y0: 0, y1: 1 })).toBe('drop') // lo > 0
    expect(c({ x0: 1, x1: 2, y0: 0, y1: 1 })).toBe('drop') // hi < 0
    expect(c({ x0: 4, x1: 6, y0: 0, y1: 1 })).toBe('split') // 0 inside
    expect(c({ x0: 5, x1: 5.5, y0: 0, y1: 1 })).toBe('split') // 0 at the bottom (the twin widens it outward)
    const E = compileInterval(expr('sqrt(x)'), ['x', 'y'], scopeOf())
    expect(implicitClassifier(E)({ x0: -3, x1: -1, y0: 0, y1: 1 })).toBe('drop') // empty: NaN everywhere
    expect(implicitClassifier(E)({ x0: -1, x1: 1, y0: 0, y1: 1 })).toBe('split') // partly undefined: the twin cannot clear it
  })
  it('never says keep-whole, even where H is proven non-zero (only the curve is wanted)', () => {
    const H = compileInterval(expr('x^2 + y^2 - 25'), ['x', 'y'], scopeOf())
    const c = implicitClassifier(H)
    const answers = new Set<CellClass>()
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) answers.add(c({ x0: i / 4, x1: (i + 1) / 4, y0: j / 4, y1: (j + 1) / 4 }))
    expect(answers).toEqual(new Set(['drop', 'split']))
  })
  it('passes both boxes to the twin and writes into the scratch it is given', () => {
    const seen: [number, number, number, number][] = []
    const H = (out: { lo: number; hi: number; v: 0 | 1 | 2 | 3 }, xLo?: number, xHi?: number, yLo?: number, yHi?: number) => {
      seen.push([xLo as number, xHi as number, yLo as number, yHi as number])
      out.lo = -1
      out.hi = 1
      out.v = 3
      return out
    }
    const s = scratchOf()
    expect(implicitClassifier(H, s)({ x0: 1, x1: 2, y0: 3, y1: 4 })).toBe('split')
    expect(seen).toEqual([[1, 2, 3, 4]])
    expect(s).toEqual({ lo: -1, hi: 1, v: 3 })
  })
})
