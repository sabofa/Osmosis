import { describe, expect, it } from 'vitest'
import { compileScalar } from '../../math/compile'
import { CONTINUOUS, compileInterval, DEFINED, iv, PARTIAL, UNKNOWN } from '../../math/interval'
import type { Bounds } from '../../scene/types'
import { expr, scopeOf } from '../sample/testkit'
import type { EvalCounter, PxScale } from '../sample/types'
import { implicitClassifier, rootBox, subdivide } from './quadtree'
import { COARSE, FULL, type ImplicitTuning } from './tuning'
import type { Box, Cell, CellClass, Leaf } from './types'

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
function expectCovers(h: string, samples: [number, number][], leaves: Leaf[], root: Box, min = 1000) {
  const H = compileScalar(expr(h), ['x', 'y'], scopeOf())
  const covered = leafIndex(leaves, root)
  expect(samples.length).toBeGreaterThanOrEqual(min)
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
    // every sample in the root, up to |y| = 15 at the poles: none is left out for being near one
    expectCovers('tan(x) - y', samples.filter(inRoot), tan.leaves, tan.root)
  })

  // The twin's enclosure of a form that cancels is loose (it repeats a variable), so it clears fewer cells; what it
  // does clear must still be only cells with no zero.
  it('covers a form that cancels: (x + 1)^2 - x^2 - 2x - 1 + y = 0, which is y = 0', () => {
    const h = '(x + 1)^2 - x^2 - 2*x - 1 + y'
    const r = run(h)
    expectCovers(h, Array.from({ length: 8000 }, (_, i): [number, number] => [-15 + (30 * i) / 7999, 0]), r.leaves, r.root)
  })

  it('covers a curve that touches itself without crossing: the double line (x - y)^2 = 0', () => {
    const r = run('(x - y)^2')
    expectCovers('(x - y)^2', Array.from({ length: 8000 }, (_, i): [number, number] => {
      const x = -15 + (30 * i) / 7999
      return [x, x]
    }), r.leaves, r.root)
  })

  it('covers a single point off the grid: (x - 0.3)^2 + (y - 0.7)^2 = 0 is the point (0.3, 0.7)', () => {
    const h = '(x - 0.3)^2 + (y - 0.7)^2'
    const r = run(h)
    expectCovers(h, [[0.3, 0.7]], r.leaves, r.root, 1)
    expect(r.leaves.length).toBeGreaterThan(0)
    // and finds it for the price of a point: a few levels of the cells that can hold it, not the lattice
    expect(r.counter.intervals).toBeLessThan(400)
    const coarse = run(h, COARSE)
    expectCovers(h, [[0.3, 0.7]], coarse.leaves, coarse.root, 1)
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

    // and nowhere near the cells of the root at leaf size (about a million at 1.17 px)
    const leafPx = (small.leaves[0].x1 - small.leaves[0].x0) * PX.x
    expect(small.counter.intervals).toBeLessThan(0.02 * (1200 / leafPx) ** 2)
  })

  it('costs under half at COARSE (4 px leaves; about a quarter measured), with under a third of the leaves', () => {
    const full = run('x^2 + y^2 - 25', FULL)
    const coarse = run('x^2 + y^2 - 25', COARSE)
    expect(coarse.counter.intervals).toBeLessThan(0.5 * full.counter.intervals)
    expect(coarse.leaves.length).toBeLessThan(0.3 * full.leaves.length)
    expectCovers('x^2 + y^2 - 25', circle(5), coarse.leaves, coarse.root)
  })

  it('stays under 70 % of the budget, at FULL and at COARSE, on a circle, xy = 1, the lattice sin(x) = cos(y) and two expanded forms', () => {
    // the expanded forms are the review's: the twin's enclosure of a cancelling form is loose, so a band of cells it cannot
    // clear runs along the line (x^2 - 2xy + y^2 cost 147 % of the first FULL budget)
    for (const tuning of [FULL, COARSE]) {
      for (const h of ['x^2 + y^2 - 25', 'x*y - 1', 'sin(x) - cos(y)', 'x^2 - 2*x*y + y^2', '(x + 1)^2 - x^2 - 2*x - 1 + y']) {
        const r = run(h, tuning)
        expect(r.capped, `${h} at ${tuning.leafPx} px`).toBe(false)
        expect(r.counter.intervals, `${h} at ${tuning.leafPx} px`).toBeLessThan(0.7 * tuning.budget.intervals)
      }
    }
  })

  it('is not capped on a lattice of poles (tan(x) = tan(y)) or a pole at every period (y = tan x), at either quality', () => {
    for (const tuning of [FULL, COARSE]) {
      for (const h of ['tan(x) - tan(y)', 'tan(x) - y']) {
        const r = run(h, tuning)
        expect(r.capped, `${h} at ${tuning.leafPx} px`).toBe(false)
        expect(r.counter.intervals, `${h} at ${tuning.leafPx} px`).toBeLessThan(tuning.budget.intervals)
      }
    }
  })
})

describe('subdivide: leaves', () => {
  it('are all the same size, within a factor of sqrt 2 of the leaf size (above and below), on each axis', () => {
    // a cell is halved while it is wider than sqrt 2 times the leaf size, so what is left is in (leaf / sqrt 2, leaf sqrt 2]:
    // the 1200 px root is 1.17 px at 10 halvings, and the 0.586 px of an 11th is not taken
    const r = run('x^2 + y^2 - 25')
    for (const l of r.leaves) {
      const w = (l.x1 - l.x0) * PX.x
      const h = (l.y1 - l.y0) * PX.y
      expect(w).toBeLessThanOrEqual(FULL.leafPx * Math.SQRT2 * (1 + 1e-9))
      expect(w).toBeGreaterThan(FULL.leafPx / Math.SQRT2)
      expect(h).toBeLessThanOrEqual(FULL.leafPx * Math.SQRT2 * (1 + 1e-9))
      expect(h).toBeGreaterThan(FULL.leafPx / Math.SQRT2)
    }
    expect((r.leaves[0].x1 - r.leaves[0].x0) * PX.x).toBeCloseTo(1200 / 1024, 9)
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
    // 10 px a unit across, 160 down: the root [-15, 15]^2 is 300 by 4800 px; leaf 2 by 1 px, so 2.34 by 1.17 px cells
    const view: Bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
    const H = compileInterval(expr('x^2/100 + y^2 - 1'), ['x', 'y'], scopeOf())
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const px: PxScale = { x: 10, y: 160 }
    const r = subdivide(implicitClassifier(H), rootBox(view, 0.25), { x: 2, y: 1 }, px, counter, { intervals: 1e6 })
    expect(r.leaves.length).toBeGreaterThan(100)
    for (const l of r.leaves) {
      const w = (l.x1 - l.x0) * px.x
      const h = (l.y1 - l.y0) * px.y
      expect(w).toBeLessThanOrEqual(2 * Math.SQRT2 * (1 + 1e-9))
      expect(w).toBeGreaterThan(2 / Math.SQRT2)
      expect(h).toBeLessThanOrEqual(Math.SQRT2 * (1 + 1e-9))
      expect(h).toBeGreaterThan(1 / Math.SQRT2)
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
    // the toy classifier says nothing of the twin, so the verdict is the weakest: UNKNOWN
    expect(r.leaves).toEqual([{ x0: 0, x1: 0.5, y0: 0, y1: 0.5, stop: 'size', verdict: UNKNOWN }])
    expect(counter.intervals).toBe(1)
  })

  it('make the root a leaf at 1.4 leaf sizes, and halve it at 1.5 (the sqrt 2 rule, to its edge)', () => {
    const run1 = (w: number) => subdivide(() => 'split', { x0: 0, x1: w, y0: 0, y1: w }, { x: 1, y: 1 }, { x: 1, y: 1 }, { points: 0, intervals: 0 }, { intervals: 100 })
    expect(run1(1.4).leaves).toHaveLength(1)
    expect(run1(Math.SQRT2).leaves).toHaveLength(1)
    expect(run1(1.5).leaves).toHaveLength(4)
  })
})

describe('subdivide: leaves carry the twin verdict', () => {
  const verdictsOf = (h: string, tuning: ImplicitTuning = COARSE) => {
    const r = run(h, tuning)
    const H = compileInterval(expr(h), ['x', 'y'], scopeOf())
    const out = iv()
    // each leaf's verdict is the one the twin gives over that very box
    for (const l of r.leaves) {
      H(out, l.x0, l.x1, l.y0, l.y1)
      expect(l.verdict).toBe(out.v)
    }
    return new Set(r.leaves.map((l) => l.verdict))
  }

  it('is CONTINUOUS on every leaf of a circle (no pole or seam anywhere)', () => {
    expect(verdictsOf('x^2 + y^2 - 25')).toEqual(new Set([CONTINUOUS]))
  })
  it('is PARTIAL where a leaf holds the edge of the domain (ln x) or a pole (tan x), and CONTINUOUS elsewhere', () => {
    const ln = verdictsOf('ln(x) - y')
    expect(ln.has(PARTIAL)).toBe(true)
    expect(ln.has(CONTINUOUS)).toBe(true)
    const tan = verdictsOf('tan(x) - y')
    expect(tan.has(PARTIAL)).toBe(true)
    expect(tan.has(CONTINUOUS)).toBe(true)
  })
  it('is DEFINED where a leaf holds a step (floor)', () => {
    const floor = verdictsOf('floor(x) - y')
    expect(floor.has(DEFINED)).toBe(true)
    expect(floor.has(CONTINUOUS)).toBe(true)
  })
  it('is carried by a budget leaf too', () => {
    const r = run('x^2 + y^2 - 25', FULL, { intervals: 700 })
    expect(r.leaves.length).toBeGreaterThan(0)
    expect(r.leaves.every((l) => l.stop === 'budget' && l.verdict === CONTINUOUS)).toBe(true)
  })
  it('is whatever a classifier writes on the cell, and UNKNOWN when it writes nothing', () => {
    const none = subdivide(() => 'split', rootBox(VIEW, 0.25), { x: 300, y: 300 }, PX, { points: 0, intervals: 0 }, { intervals: 1e6 })
    expect(none.leaves.length).toBe(16)
    expect(none.leaves.every((l) => l.verdict === UNKNOWN)).toBe(true)
    const wrote = subdivide((c: Cell) => { c.verdict = DEFINED; return 'split' }, rootBox(VIEW, 0.25), { x: 300, y: 300 }, PX, { points: 0, intervals: 0 }, { intervals: 1e6 })
    expect(wrote.leaves.every((l) => l.verdict === DEFINED)).toBe(true)
  })
})

describe('subdivide: order', () => {
  // leaf size 100 px in a 1200 px root: 4 halvings per axis, a 16 x 16 lattice of 75 px cells
  const always = (budget = 1e6) => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(() => 'split', rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, counter, { intervals: budget })
    return { ...r, counter }
  }

  it('is level by level, a level in the order its parents were and each parent\'s children low-low, high-low, low-high, high-high', () => {
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
    // and the whole of that quadrant (64 leaves) before any of the next: a level keeps its parents' order
    expect(r.leaves.slice(0, 64).every((l) => l.x1 <= 0 && l.y1 <= 0)).toBe(true)
    expect(r.leaves[64].x0).toBe(0)
    expect(r.leaves[64].y0).toBe(-15)
  })

  it('reports the cells kept whole from the biggest level to the smallest, the leaves after all of them having been walked', () => {
    // a classifier that proves a cell whole only when it is wholly inside a disc and splits what crosses it: the cells of
    // a coarser level are found before those of a finer one
    const disc = (b: Box): CellClass => {
      const far = Math.hypot(Math.max(Math.abs(b.x0), Math.abs(b.x1)), Math.max(Math.abs(b.y0), Math.abs(b.y1)))
      const near = Math.hypot(Math.max(b.x0, Math.min(0, b.x1)), Math.max(b.y0, Math.min(0, b.y1)))
      return near > 5 ? 'drop' : far < 5 ? 'keep-whole' : 'split'
    }
    const r = subdivide(disc, rootBox(VIEW, 0.25), { x: 8, y: 8 }, PX, { points: 0, intervals: 0 }, { intervals: 1e6 })
    const widths = r.whole.map((b) => b.x1 - b.x0)
    expect(widths.length).toBeGreaterThan(20)
    expect(widths).toEqual([...widths].sort((a, b) => b - a))
    expect(new Set(widths).size).toBeGreaterThan(2)
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
  const allOneSize = (leaves: Leaf[]) => leaves.every((l) => Math.abs(l.x1 - l.x0 - (leaves[0].x1 - leaves[0].x0)) < 1e-12 && Math.abs(l.y1 - l.y0 - (leaves[0].y1 - leaves[0].y0)) < 1e-12)

  it('counts every classifier call against counter.intervals, from where the counter stood, and leaves points alone', () => {
    // always-split on a 4 x 4 lattice: levels of 1, 4, 16, 64 cells (85 evaluations). The next level (256 cells) does not fit
    // in 100, so the walk stops at the end of the level of 64, having spent 85 of the 100.
    const counter: EvalCounter = { points: 5, intervals: 1000 }
    let calls = 0
    const r = subdivide(() => { calls++; return 'split' }, rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, counter, { intervals: 100 })
    expect(calls).toBe(85)
    expect(counter.intervals).toBe(1085)
    expect(counter.points).toBe(5)
    expect(r.capped).toBe(true)
    // the same budget, counted from a counter at zero, buys the same walk
    const fresh: EvalCounter = { points: 0, intervals: 0 }
    subdivide(() => 'split', rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, fresh, { intervals: 100 })
    expect(fresh.intervals).toBe(85)
  })

  it('stops at the last level that fits: the cells that level could not clear are leaves of one size, all classified, and tile the root', () => {
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const root = rootBox(VIEW, 0.25)
    const r = subdivide(() => 'split', root, { x: 100, y: 100 }, PX, counter, { intervals: 100 })
    expect(r.capped).toBe(true)
    expect(counter.intervals).toBe(85)
    // the 64 cells of the third level, each 150 px, and nothing at a finer size
    expect(r.leaves).toHaveLength(64)
    expect(r.leaves.every((l) => l.stop === 'budget')).toBe(true)
    expect(allOneSize(r.leaves)).toBe(true)
    expect((r.leaves[0].x1 - r.leaves[0].x0) * PX.x).toBeCloseTo(150, 9)
    // nothing was dropped, so the leaves tile the root: their areas add up to its
    const area = r.leaves.reduce((s, l) => s + (l.x1 - l.x0) * (l.y1 - l.y0), 0)
    expect(area).toBeCloseTo((root.x1 - root.x0) * (root.y1 - root.y0), 9)
    // and none is a cell that was never looked at: the spend is the cells of every level up to this one
    expect(counter.intervals).toBe(1 + 4 + 16 + 64)
  })

  it('never spends more than the budget, and stops only where the next level would', () => {
    for (const intervals of [1, 4, 5, 20, 21, 84, 85, 340, 341]) {
      const counter: EvalCounter = { points: 0, intervals: 0 }
      const r = subdivide(() => 'split', rootBox(VIEW, 0.25), { x: 100, y: 100 }, PX, counter, { intervals })
      expect(counter.intervals).toBeLessThanOrEqual(intervals)
      // the cumulative cost of a level is 1, 5, 21, 85, 341: the walk is at the greatest of them that is within the budget
      const fits = [1, 5, 21, 85, 341].filter((n) => n <= intervals)
      expect(counter.intervals).toBe(fits[fits.length - 1])
      expect(r.capped).toBe(intervals < 341)
      expect(allOneSize(r.leaves)).toBe(true)
    }
  })

  it('leaves a capped run only budget leaves of one size, every one classified, and still covering the zero set', () => {
    const capped = run('x^2 + y^2 - 25', FULL, { intervals: 700 })
    expect(capped.capped).toBe(true)
    expect(capped.counter.intervals).toBeLessThanOrEqual(700)
    expect(capped.leaves.length).toBeGreaterThan(0)
    expect(capped.leaves.every((l) => l.stop === 'budget')).toBe(true)
    expect(allOneSize(capped.leaves)).toBe(true)
    // classified: the twin's verdict is on it (the circle is CONTINUOUS everywhere; an unclassified leaf would say UNKNOWN)
    expect(capped.leaves.every((l) => l.verdict === CONTINUOUS)).toBe(true)
    expectCovers('x^2 + y^2 - 25', circle(5), capped.leaves, capped.root)
  })

  // The review's cases: the first walk went deep first, spent the whole budget in one corner of the overscan and left the
  // curve in view as a few cells of up to 600 px that were never looked at (0 % of exp(x^2) - exp(x^2) + x - y's in-view
  // curve at leaf size, 10 % of sin(10x) = cos(10y)'s). Level by level, the whole curve is in leaves of one size, coarser,
  // and every one classified.
  it('coarsens a curve that costs more than the budget, evenly and the whole of it, and does not cut it off', () => {
    // [expression, samples of its zero set, the fraction of the budget it is given]: the first and last cost more than
    // the whole of either budget; the expanded square costs under it (64 % of FULL's), so it is given a fifth
    const cases: [string, [number, number][], number][] = [
      ['exp(x^2) - exp(x^2) + x - y', Array.from({ length: 6000 }, (_, i): [number, number] => {
        const x = -15 + (30 * i) / 5999
        return [x, x]
      }), 1],
      ['x^2 - 2*x*y + y^2', Array.from({ length: 6000 }, (_, i): [number, number] => {
        const x = -15 + (30 * i) / 5999
        return [x, x]
      }), 0.2],
      ['sin(10*x) - cos(10*y)', (() => {
        // cos(10y) = sin(10x) = cos(pi/2 - 10x), so y = +-(pi/2 - 10x) / 10 + 2 pi k / 10
        const s: [number, number][] = []
        for (let k = -25; k <= 25; k++) {
          for (let i = 0; i < 2000; i++) {
            const x = -15 + (30 * i) / 1999
            s.push([x, (Math.PI / 2 - 10 * x) / 10 + (2 * Math.PI * k) / 10], [x, -(Math.PI / 2 - 10 * x) / 10 + (2 * Math.PI * k) / 10])
          }
        }
        return s
      })(), 1],
    ]
    for (const tuning of [FULL, COARSE]) {
      for (const [h, samples, fraction] of cases) {
        const budget = { intervals: fraction * tuning.budget.intervals }
        const r = run(h, tuning, budget)
        const label = `${h} at ${tuning.leafPx} px`
        expect(r.capped, label).toBe(true)
        expect(r.leaves.length, label).toBeGreaterThan(0)
        expect(r.leaves.every((l) => l.stop === 'budget'), label).toBe(true)
        expect(allOneSize(r.leaves), label).toBe(true)
        expect(r.counter.intervals, label).toBeLessThanOrEqual(budget.intervals)
        // coarser than asked, but by halvings and not by a corner: within 8 leaf sizes (4.69 and 9.38 px measured)
        expect((r.leaves[0].x1 - r.leaves[0].x0) * PX.x, label).toBeLessThanOrEqual(8 * tuning.leafPx)
        // every point of the curve in the root, in or out of view, is in a leaf, and none of the in-view curve is missing
        expectCovers(h, samples.filter(inRoot), r.leaves, r.root)
        const inView = samples.filter(([x, y]) => Math.abs(x) <= 10 && Math.abs(y) <= 10)
        expect(inView.length, label).toBeGreaterThan(300)
      }
    }
  })

  it('is capped by one evaluation less than the run needs and by no less than it needs', () => {
    const free = run('x^2 + y^2 - 25')
    const needs = free.counter.intervals
    const exact = run('x^2 + y^2 - 25', FULL, { intervals: needs })
    expect(exact.capped).toBe(false)
    expect(exact.leaves).toEqual(free.leaves)
    expect(exact.counter.intervals).toBe(needs)
    const short = run('x^2 + y^2 - 25', FULL, { intervals: needs - 1 })
    expect(short.capped).toBe(true)
    expect(short.leaves.length).toBeGreaterThan(0)
    expect(short.leaves.every((l) => l.stop === 'budget')).toBe(true)
    // it stopped a level up: coarser, by one halving (a factor of 2 in the cell's width), and spent less than the budget
    expect(short.counter.intervals).toBeLessThanOrEqual(needs - 1)
    const w = (l: Leaf) => l.x1 - l.x0
    expect(w(short.leaves[0]) / w(free.leaves[0])).toBeCloseTo(2, 9)
  })

  it('with no budget at all makes the root one leaf, evaluating nothing and saying nothing of it', () => {
    const r = run('x^2 + y^2 - 25', FULL, { intervals: 0 })
    expect(r.capped).toBe(true)
    expect(r.counter.intervals).toBe(0)
    // it was never classified: the weakest verdict
    expect(r.leaves).toEqual([{ x0: -15, x1: 15, y0: -15, y1: 15, stop: 'budget', verdict: UNKNOWN }])
  })

  it('with a budget of one classifies the root and makes it the one leaf, with the verdict of what was seen', () => {
    const r = run('x^2 + y^2 - 25', FULL, { intervals: 1 })
    expect(r.capped).toBe(true)
    expect(r.counter.intervals).toBe(1)
    expect(r.leaves).toEqual([{ x0: -15, x1: 15, y0: -15, y1: 15, stop: 'budget', verdict: CONTINUOUS }])
  })

  it('is not capped when the cells that are left are not wanted: the root dropped at a budget of one', () => {
    const r = run('x^2 + y^2 + 1', FULL, { intervals: 1 })
    expect(r.capped).toBe(false)
    expect(r.leaves).toEqual([])
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
    // a leaf is 1.17 px (0.029 units) a side and may reach 0.041 past the circle along its diagonal
    expect(area).toBeLessThan(Math.PI * 3.05 ** 2)
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

  it('is deterministic: the same whole cells and leaves, in the same order', () => {
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
  const cell = (x0: number, x1: number, y0: number, y1: number): Cell => ({ x0, x1, y0, y1, verdict: UNKNOWN })
  it('drops a cell the discard rule clears (lo > 0, hi < 0, empty) and splits one it cannot', () => {
    const H = compileInterval(expr('x - 5'), ['x', 'y'], scopeOf())
    const c = implicitClassifier(H)
    expect(c(cell(6, 7, 0, 1))).toBe('drop') // lo > 0
    expect(c(cell(1, 2, 0, 1))).toBe('drop') // hi < 0
    expect(c(cell(4, 6, 0, 1))).toBe('split') // 0 inside
    expect(c(cell(5, 5.5, 0, 1))).toBe('split') // 0 at the bottom (the twin widens it outward)
    const E = compileInterval(expr('sqrt(x)'), ['x', 'y'], scopeOf())
    expect(implicitClassifier(E)(cell(-3, -1, 0, 1))).toBe('drop') // empty: NaN everywhere
    expect(implicitClassifier(E)(cell(-1, 1, 0, 1))).toBe('split') // partly undefined: the twin cannot clear it
  })
  it('never says keep-whole, even where H is proven non-zero (only the curve is wanted)', () => {
    const H = compileInterval(expr('x^2 + y^2 - 25'), ['x', 'y'], scopeOf())
    const c = implicitClassifier(H)
    const answers = new Set<CellClass>()
    for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) answers.add(c(cell(i / 4, (i + 1) / 4, j / 4, (j + 1) / 4)))
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
    expect(implicitClassifier(H, s)(cell(1, 2, 3, 4))).toBe('split')
    expect(seen).toEqual([[1, 2, 3, 4]])
    expect(s).toEqual({ lo: -1, hi: 1, v: 3 })
  })
  it('writes the twin\'s verdict onto the cell it classified, whatever it answers', () => {
    // a twin that says PARTIAL over a box with a zero in it, and DEFINED over one without
    const H = (out: { lo: number; hi: number; v: 0 | 1 | 2 | 3 }, xLo?: number) => {
      const zero = (xLo as number) < 5
      out.lo = zero ? -1 : 1
      out.hi = 2
      out.v = zero ? PARTIAL : DEFINED
      return out
    }
    const c = implicitClassifier(H, scratchOf())
    const a = cell(0, 1, 0, 1)
    expect(c(a)).toBe('split')
    expect(a.verdict).toBe(PARTIAL)
    const b = cell(6, 7, 0, 1)
    expect(c(b)).toBe('drop')
    expect(b.verdict).toBe(DEFINED)
  })
})
