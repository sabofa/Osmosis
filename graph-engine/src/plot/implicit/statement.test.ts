import { describe, expect, it } from 'vitest'
import { CONTINUOUS } from '../../math/interval'
import type { View } from '../sample/curve'
import type { EvalCounter } from '../sample/types'
import { gridPoints, inView, pictureFirst, prepare, walk } from './statement'
import { COARSE, FULL, GRID, STATEMENT } from './tuning'
import type { Leaf, StatementOptions } from './types'

const view = (xMin = -10, xMax = 10, yMin = -10, yMax = 10, widthPx = 800, heightPx = 800): View => ({ bounds: { xMin, xMax, yMin, yMax }, widthPx, heightPx })
const options = (o: Partial<StatementOptions> = {}): StatementOptions => ({ statement: 0, color: null, quality: 'full', ...o })

describe('prepare', () => {
  it('takes the tuning of the quality, the scale of the viewport and the view widened by the overscan', () => {
    const p = prepare(view(), options())
    expect(p?.tuning).toBe(FULL)
    expect(p?.px).toEqual({ x: 40, y: 40 })
    expect(p?.root).toEqual({ x0: -15, x1: 15, y0: -15, y1: 15 })
    expect(p?.budget).toEqual(FULL.statement)
    expect(prepare(view(), options({ quality: 'coarse' }))?.tuning).toBe(COARSE)
    expect(prepare(view(0, 10, 0, 5, 1000, 250), options())?.px).toEqual({ x: 100, y: 50 })
  })

  it('takes the budget a caller gives instead of the tuning\'s', () => {
    expect(prepare(view(), options({ budget: { points: 10, intervals: 20 } }))?.budget).toEqual({ points: 10, intervals: 20 })
  })

  it('is null for a view that is not a finite box of positive size, and for a viewport that is not a number of px', () => {
    expect(prepare(view(NaN), options())).toBeNull()
    expect(prepare(view(0, 0), options())).toBeNull()
    expect(prepare(view(5, 1), options())).toBeNull()
    expect(prepare(view(-Infinity, 1), options())).toBeNull()
    expect(prepare(view(-10, 10, -10, 10, 0, 800), options())).toBeNull()
    expect(prepare(view(-10, 10, -10, 10, 800, -1), options())).toBeNull()
    expect(prepare(view(-10, 10, -10, 10, Infinity, 800), options())).toBeNull()
    expect(prepare(view(-1e308, 1e308), options())).toBeNull()
  })
})

describe('walk: the quadtree under the statement\'s budget', () => {
  const always = () => 'split' as const
  const run = (budget: { points: number; intervals: number }, comparisons = 0, quadtree = 1e9) => {
    const p = prepare(view(), options({ budget, quality: 'full' }))
    if (!p) throw new Error('prepare')
    // leaves of 100 px: levels of 1, 4, 16, 64, 256 cells
    const q = { ...p, tuning: { ...p.tuning, leafPx: 100, budget: { intervals: quadtree } } }
    const counter: EvalCounter = { points: 0, intervals: 0 }
    return { sub: walk(always, q, counter, comparisons), counter }
  }

  it('may spend the tuning\'s own budget of twin evaluations, and no more', () => {
    // five levels of 1, 4, 16, 64, 256 cells cost 341 evaluations
    const { sub, counter } = run({ points: 1e9, intervals: 1e9 }, 0, 341)
    expect(sub?.capped).toBe(false)
    expect(counter.intervals).toBe(341)
    const short = run({ points: 1e9, intervals: 1e9 }, 0, 340)
    expect(short.sub?.capped).toBe(true)
    expect(short.counter.intervals).toBe(85)
  })

  it('may spend the statement\'s twin evaluations only by the subdivision\'s share of them', () => {
    // 600 of them is a share of 300: 85 evaluations pay the level of 64 cells, and 341 are more than 300
    const { sub, counter } = run({ points: 1e9, intervals: 600 / STATEMENT.subdivisionShare / 2 })
    expect(sub?.capped).toBe(true)
    expect(counter.intervals).toBeLessThanOrEqual(300)
    expect(STATEMENT.subdivisionShare).toBe(0.5)
  })

  it('holds a level to the leaves the points budget can contour', () => {
    const { sub } = run({ points: 100 * STATEMENT.pointsPerLeaf, intervals: 1e9 })
    // 100 cells allowed: the level of 64, not the level of 256
    expect(sub?.capped).toBe(true)
    expect(sub?.leaves).toHaveLength(64)
    const exact = run({ points: 256 * STATEMENT.pointsPerLeaf, intervals: 1e9 })
    expect(exact.sub?.capped).toBe(false)
    expect(exact.sub?.leaves).toHaveLength(256)
  })

  it('holds a level to the leaves the rest of the twin evaluations can pay for, each costing the contour\'s and one for each comparison', () => {
    const per = STATEMENT.intervalsPerLeaf
    const enough = run({ points: 1e9, intervals: (256 * per) / (1 - STATEMENT.subdivisionShare) })
    expect(enough.sub?.capped).toBe(false)
    const less = run({ points: 1e9, intervals: (255 * per) / (1 - STATEMENT.subdivisionShare) })
    expect(less.sub?.leaves).toHaveLength(64)
    // a region of two comparisons asks the twin of each of them over every leaf
    const two = run({ points: 1e9, intervals: (256 * per) / (1 - STATEMENT.subdivisionShare) }, 2)
    expect(two.sub?.capped).toBe(true)
  })

  it('does not let the quadtree\'s RangeError out for a root that is not a size', () => {
    const p = prepare(view(), options())
    if (!p) throw new Error('prepare')
    const odd = { ...p, px: { x: 1e300, y: 40 }, root: { x0: 0, x1: 1e300, y0: 0, y1: 1 } }
    expect(walk(always, odd, { points: 0, intervals: 0 })).toBeNull()
  })
})

describe('pictureFirst', () => {
  const leaf = (x0: number, y0: number): Leaf => ({ x0, x1: x0 + 1, y0, y1: y0 + 1, stop: 'size', verdict: CONTINUOUS })
  const bounds = { xMin: 0, xMax: 4, yMin: 0, yMax: 4 }

  it('puts the leaves that touch the picture first, each group in the order it came', () => {
    const leaves = [leaf(-5, 0), leaf(1, 1), leaf(9, 9), leaf(2, 2), leaf(-1, -1), leaf(3, 3)]
    expect(pictureFirst(leaves, bounds)).toEqual([leaves[1], leaves[3], leaves[4], leaves[5], leaves[0], leaves[2]])
    expect(inView(leaves[4], bounds)).toBe(true)
    expect(inView(leaves[0], bounds)).toBe(false)
  })
})

describe('gridPoints', () => {
  it('is the same GRID.samples by GRID.samples points across the view, the edges included', () => {
    const pts = gridPoints({ xMin: -10, xMax: 10, yMin: -4, yMax: 4 })
    expect(pts).toHaveLength(GRID.samples * GRID.samples)
    expect(pts[0]).toEqual({ x: -10, y: -4 })
    expect(pts[GRID.samples - 1]).toEqual({ x: 10, y: -4 })
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 4 })
    expect(gridPoints({ xMin: -10, xMax: 10, yMin: -4, yMax: 4 })).toEqual(pts)
  })
})
