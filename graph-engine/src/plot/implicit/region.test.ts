import { describe, expect, it } from 'vitest'
import { compileInterval, CONTINUOUS, DEFINED, PARTIAL, UNKNOWN } from '../../math/interval'
import { compare, and } from '../../math/reserved'
import { condition, expr, scopeOf } from '../sample/testkit'
import type { EvalCounter } from '../sample/types'
import { analyseCondition, comparisonsOf, conditionClassifier, LeafGrid, truthOf } from './region'
import { rootBox, subdivide } from './quadtree'
import type { Cell, Leaf } from './types'

const cell = (x0: number, x1: number, y0: number, y1: number): Cell => ({ x0, x1, y0, y1, verdict: UNKNOWN })
const classifierOf = (text: string) => conditionClassifier(compileInterval(condition(text), ['x', 'y'], scopeOf()))

describe('analyseCondition', () => {
  it('lists the comparisons depth first, left to right, each as h op 0 with h = a - b', () => {
    const c = analyseCondition(condition('1 < x^2 + y^2 < 4'))
    expect(c.comparisons.map((q) => q.op)).toEqual(['<', '<'])
    // 1 < x^2 + y^2 is 1 - (x^2 + y^2) < 0; x^2 + y^2 < 4 is x^2 + y^2 - 4 < 0
    expect(c.comparisons[0].h).toEqual({ kind: 'binary', op: '-', left: expr('1'), right: expr('x^2 + y^2') })
    expect(c.comparisons[1].h).toEqual({ kind: 'binary', op: '-', left: expr('x^2 + y^2'), right: expr('4') })
    expect(c.tree).toEqual({ kind: 'and', a: { kind: 'cmp', k: 0 }, b: { kind: 'cmp', k: 1 } })
  })

  it('reads the `if` clause of a statement as part of the condition, whatever the combination', () => {
    const c = analyseCondition(and(compare('<=', expr('x^2 + y^2'), expr('1')), condition('x > 0 or y > 0')))
    expect(c.comparisons.map((q) => q.op)).toEqual(['<=', '>', '>'])
    expect(c.tree).toEqual({ kind: 'and', a: { kind: 'cmp', k: 0 }, b: { kind: 'or', a: { kind: 'cmp', k: 1 }, b: { kind: 'cmp', k: 2 } } })
  })

  it('knows which comparisons are under a not: their zero set belongs to the condition where the operator does not include it', () => {
    const c = analyseCondition(condition('not x < 1 and y > 2'))
    expect(c.comparisons.map((q) => q.op)).toEqual(['<', '>'])
    expect(c.negated).toEqual([true, false])
    const d = analyseCondition(condition('not (x < 1 or y > 2)'.replace(/[()]/g, '')))
    // (without parentheses `not` binds to the first comparison)
    expect(d.negated[0]).toBe(true)
  })

  it('takes anything else in the skeleton for a truth value in its own right, nonzero true (e != 0)', () => {
    const c = analyseCondition(expr('x - y'))
    expect(c.comparisons).toHaveLength(1)
    expect(c.comparisons[0].op).toBe('!=')
    expect(c.tree).toEqual({ kind: 'cmp', k: 0 })
  })

  it('comparisonsOf is the list', () => {
    const c = condition('y < ln(x) and x > 1')
    expect(comparisonsOf(c)).toEqual(analyseCondition(c).comparisons)
  })
})

describe('truthOf', () => {
  it('evaluates the skeleton as the kernel does: NaN in, NaN out', () => {
    const t = analyseCondition(condition('x < 1 and y > 2 or x > 5')).tree
    expect(truthOf(t, [1, 1, 0])).toBe(1)
    expect(truthOf(t, [1, 0, 0])).toBe(0)
    expect(truthOf(t, [0, 0, 1])).toBe(1)
    expect(truthOf(t, [Number.NaN, 1, 1])).toBeNaN()
    const n = analyseCondition(condition('not x < 1')).tree
    expect(truthOf(n, [0])).toBe(1)
    expect(truthOf(n, [Number.NaN])).toBeNaN()
  })
})

describe('conditionClassifier: three-valued', () => {
  it('keeps whole a cell where the condition is proven true, drops one where it is proven false, splits the rest', () => {
    const c = classifierOf('x^2 + y^2 < 4')
    expect(c(cell(-0.5, 0.5, -0.5, 0.5))).toBe('keep-whole')
    expect(c(cell(3, 4, 3, 4))).toBe('drop')
    expect(c(cell(1, 2, 1, 2))).toBe('split')
  })

  it('works for a chain, an and, an or and a not', () => {
    expect(classifierOf('1 < x^2 + y^2 < 4')(cell(1.2, 1.4, 0, 0.1))).toBe('keep-whole')
    expect(classifierOf('1 < x^2 + y^2 < 4')(cell(-0.1, 0.1, -0.1, 0.1))).toBe('drop')
    expect(classifierOf('x^2 + y^2 < 4 and y > 0')(cell(-0.5, 0.5, -1, -0.5))).toBe('drop')
    expect(classifierOf('x^2 + y^2 < 4 and y > 0')(cell(-0.5, 0.5, 0.5, 1))).toBe('keep-whole')
    expect(classifierOf('x < -5 or x > 5')(cell(6, 7, 0, 1))).toBe('keep-whole')
    expect(classifierOf('x < -5 or x > 5')(cell(-1, 1, 0, 1))).toBe('drop')
    expect(classifierOf('not x^2 + y^2 < 4')(cell(3, 4, 3, 4))).toBe('keep-whole')
    expect(classifierOf('not x^2 + y^2 < 4')(cell(-0.5, 0.5, -0.5, 0.5))).toBe('drop')
  })

  it('drops a cell where the condition is undefined everywhere: undefined is outside', () => {
    const c = classifierOf('y < ln(x)')
    expect(c(cell(-3, -1, -5, 5))).toBe('drop')
  })

  it('does not keep whole a cell where the condition is true wherever it is defined but may not be defined everywhere', () => {
    // sqrt(x) is a number for x >= 0: over [-1, 1] the enclosure of y < sqrt(x) is true (y is below 0) with a PARTIAL verdict, which may be a NaN
    const c = classifierOf('y < sqrt(x)')
    const a = cell(-1, 1, -5, -4)
    expect(c(a)).toBe('split')
    expect(a.verdict).toBe(PARTIAL)
    // where it is defined it is kept
    const b = cell(1, 2, -5, -4)
    expect(c(b)).toBe('keep-whole')
    expect(b.verdict).toBeGreaterThanOrEqual(DEFINED)
  })

  it('splits what the twin cannot say anything of (an integral: UNKNOWN)', () => {
    const c = classifierOf('integral(t = 0 to x, t) < 1')
    const a = cell(0, 1, 0, 1)
    expect(c(a)).toBe('split')
    expect(a.verdict).toBe(UNKNOWN)
  })

  it('writes the twin\'s verdict on the cell, whatever it answers', () => {
    const c = classifierOf('x^2 + y^2 < 4')
    const a = cell(-0.5, 0.5, -0.5, 0.5)
    c(a)
    expect(a.verdict).toBe(CONTINUOUS)
  })

  it('does not touch the counter: subdivide counts one evaluation for each cell and no more', () => {
    // the classifier is handed no counter, and the spend is what subdivide counted: one for each call
    let calls = 0
    const twin = compileInterval(condition('x^2 + y^2 < 4'), ['x', 'y'], scopeOf())
    const inner = conditionClassifier(twin)
    const counter: EvalCounter = { points: 0, intervals: 0 }
    const r = subdivide(
      (c) => {
        calls++
        return inner(c)
      },
      rootBox({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, 0.25),
      { x: 1, y: 1 },
      { x: 40, y: 40 },
      counter,
      { intervals: 1e6 },
    )
    expect(counter.intervals).toBe(calls)
    expect(counter.points).toBe(0)
    expect(r.whole.length).toBeGreaterThan(0)
    expect(r.leaves.length).toBeGreaterThan(0)
    // proven-inside cells are kept at the size they were found, the largest first
    expect(r.whole[0].x1 - r.whole[0].x0).toBeGreaterThan(r.leaves[0].x1 - r.leaves[0].x0)
  })

  it('gives a region leaf the condition\'s verdict: DEFINED where it may go either way (a truth value is never better), not UNKNOWN', () => {
    const twin = compileInterval(condition('x^2 + y^2 < 4'), ['x', 'y'], scopeOf())
    const r = subdivide(conditionClassifier(twin), rootBox({ xMin: -10, xMax: 10, yMin: -10, yMax: 10 }, 0.25), { x: 1, y: 1 }, { x: 40, y: 40 }, { points: 0, intervals: 0 }, { intervals: 1e6 })
    expect(r.leaves.length).toBeGreaterThan(0)
    expect(r.leaves.every((l) => l.verdict === DEFINED)).toBe(true)
  })
})

describe('LeafGrid', () => {
  const leaf = (x0: number, y0: number): Leaf => ({ x0, x1: x0 + 1, y0, y1: y0 + 1, stop: 'size', verdict: CONTINUOUS })
  const leaves: Leaf[] = []
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) leaves.push(leaf(i, j))

  it('finds the leaf a point is inside', () => {
    const grid = new LeafGrid(leaves)
    expect(grid.at(2.5, 1.5)).toEqual([1 * 4 + 2])
  })

  it('finds every leaf a point on a shared edge or corner is in (the boxes are closed)', () => {
    const grid = new LeafGrid(leaves)
    expect(grid.at(2, 1.5).sort((a, b) => a - b)).toEqual([4 + 1, 4 + 2])
    expect(grid.at(2, 1).sort((a, b) => a - b)).toEqual([1, 2, 4 + 1, 4 + 2])
  })

  it('finds no leaf for a point outside them', () => {
    expect(new LeafGrid(leaves).at(9, 9)).toEqual([])
  })

  it('works with no leaves', () => {
    expect(new LeafGrid([]).at(0, 0)).toEqual([])
  })
})
