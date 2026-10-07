import { describe, expect, it } from 'vitest'
import type { PxScale } from '../sample/types'
import { buildChains, buildTouchCurves } from './chains'
import { lengthOf, signedArea, verticesOf } from './testkit'
import type { Segment } from './types'

const PX: PxScale = { x: 40, y: 40 }

// A polyline of points as the segments between consecutive ones (the same point objects are not shared: the chains join
// on equal coordinates).
function path(...pts: [number, number][]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i + 1 < pts.length; i++) out.push({ a: { x: pts[i][0], y: pts[i][1] }, b: { x: pts[i + 1][0], y: pts[i + 1][1] } })
  return out
}

function xy(c: { xy: Float64Array }): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < c.xy.length; i += 2) out.push([c.xy[i], c.xy[i + 1]])
  return out
}

describe('buildChains: joining segments', () => {
  it('joins segments given in any order and direction into one open chain', () => {
    const segs = [...path([2, 2], [3, 1]), ...path([0, 0], [1, 2]), ...path([2, 2], [1, 2])]
    const chains = buildChains(segs, PX)
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(false)
    expect(xy(chains[0])).toEqual([
      [0, 0],
      [1, 2],
      [2, 2],
      [3, 1],
    ])
  })

  it('starts an open chain at its end with the smaller x, then the smaller y', () => {
    const forward = buildChains(path([0, 5], [1, 6], [2, 5]), PX)
    const backward = buildChains(path([2, 5], [1, 6], [0, 5]), PX)
    expect(xy(forward[0])).toEqual([[0, 5], [1, 6], [2, 5]])
    expect(xy(backward[0])).toEqual(xy(forward[0]))
    // equal x: the smaller y first
    const vertical = buildChains(path([1, 4], [1, 3], [1, 2]), PX)
    expect(xy(vertical[0])).toEqual([[1, 2], [1, 3], [1, 4]])
  })

  it('gives each vertex the arc length from the start, in world units', () => {
    const c = buildChains(path([0, 0], [3, 4], [3, 10]), PX)[0]
    expect(Array.from(c.param)).toEqual([0, 5, 11])
    // the pixel scale only orients the junctions: the parameter is world arc length whatever it is
    const wide = buildChains(path([0, 0], [3, 4], [3, 10]), { x: 400, y: 1 })[0]
    expect(Array.from(wide.param)).toEqual([0, 5, 11])
  })

  it('makes a closed chain from a loop: first vertex not repeated, from the smallest (x, y), counter-clockwise', () => {
    const square = (...pts: [number, number][]) => buildChains(path(...pts, pts[0]), PX)
    const ccw = square([1, 0], [1, 1], [0, 1], [0, 0])
    const cw = square([0, 0], [0, 1], [1, 1], [1, 0])
    for (const chains of [ccw, cw]) {
      expect(chains.length).toBe(1)
      expect(chains[0].closed).toBe(true)
      expect(chains[0].param.length).toBe(4)
      // from (0, 0), counter-clockwise: the next is (1, 0)
      expect(xy(chains[0])).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
      expect(signedArea(chains[0])).toBe(1)
    }
    // the parameter of a closed chain stops at its last vertex: the closing stretch is not counted
    expect(Array.from(ccw[0].param)).toEqual([0, 1, 2, 3])
  })

  it('starts a closed chain at the smaller y when two vertices tie on x', () => {
    const c = buildChains(path([0, 1], [1, 2], [1, 0], [0, 1]), PX)[0]
    expect(c.closed).toBe(true)
    expect(xy(c)[0]).toEqual([0, 1])
    expect(signedArea(c)).toBeGreaterThan(0)
  })

  it('keeps separate pieces separate, and drops a zero-length or repeated segment', () => {
    const segs = [...path([0, 0], [1, 0]), ...path([5, 5], [5, 5]), ...path([1, 0], [0, 0]), ...path([3, 3], [4, 3])]
    const chains = buildChains(segs, PX)
    expect(chains.map(xy)).toEqual([[[0, 0], [1, 0]], [[3, 3], [4, 3]]])
  })

  it('returns nothing for no segments', () => {
    expect(buildChains([], PX)).toEqual([])
  })

  it('does not join across a gap: pieces whose ends are not the same point stay apart', () => {
    const chains = buildChains([...path([0, 0], [1, 0]), ...path([1 + 1e-12, 0], [2, 0])], PX)
    expect(chains.length).toBe(2)
  })
})

describe('buildChains: junctions', () => {
  it('passes straight through a crossing: an X of four segments is two chains, not four', () => {
    const segs = [...path([-1, 0], [0, 0]), ...path([0, 0], [1, 0]), ...path([0, -1], [0, 0]), ...path([0, 0], [0, 1])]
    const chains = buildChains(segs, PX)
    expect(chains.length).toBe(2)
    const sets = chains.map(xy)
    expect(sets).toContainEqual([[-1, 0], [0, 0], [1, 0]])
    expect(sets).toContainEqual([[0, -1], [0, 0], [0, 1]])
  })

  it('pairs the most opposite arms, not the order they came in', () => {
    // arms to the NE, SW, NW, SE: NE pairs with SW and NW with SE, whatever order the segments are given in
    const arms: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
    for (const order of [[0, 1, 2, 3], [3, 1, 0, 2], [2, 0, 3, 1]]) {
      const segs = order.flatMap((k) => path([0, 0], arms[k]))
      const chains = buildChains(segs, PX).map(xy)
      expect(chains.length).toBe(2)
      expect(chains).toContainEqual([[-1, -1], [0, 0], [1, 1]])
      expect(chains).toContainEqual([[-1, 1], [0, 0], [1, -1]])
    }
  })

  it('uses the pixel scale to say which arms are opposite', () => {
    // two arms close to each other in the world but 400:1 apart in px: with x drawn 400 times wider than y the arms
    // (1, 0.001) and (-1, 0.001) are opposite on screen, and (0, 1) is not opposite either of them
    const segs = [...path([0, 0], [1, 0.001]), ...path([0, 0], [-1, 0.001]), ...path([0, 0], [0, 1])]
    const chains = buildChains(segs, { x: 400, y: 1 }).map(xy)
    expect(chains.length).toBe(2)
    expect(chains).toContainEqual([[-1, 0.001], [0, 0], [1, 0.001]])
    expect(chains).toContainEqual([[0, 0], [0, 1]])
  })

  it('leaves the odd arm of a T as an end', () => {
    const chains = buildChains([...path([-1, 0], [0, 0]), ...path([0, 0], [1, 0]), ...path([0, 0], [0, 1])], PX).map(xy)
    expect(chains.length).toBe(2)
    expect(chains).toContainEqual([[-1, 0], [0, 0], [1, 0]])
    expect(chains).toContainEqual([[0, 0], [0, 1]])
  })

  it('makes a figure eight one closed chain that passes its crossing twice', () => {
    // two squares sharing the corner (0, 0): the right one counter-clockwise, the left one clockwise
    const right = path([0, 0], [1, -1], [2, 0], [1, 1], [0, 0])
    const left = path([0, 0], [-1, 1], [-2, 0], [-1, -1], [0, 0])
    const chains = buildChains([...right, ...left], PX)
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(true)
    const v = xy(chains[0])
    expect(v.length).toBe(8)
    expect(v.filter(([x, y]) => x === 0 && y === 0).length).toBe(2)
    // from the smallest vertex, (-2, 0)
    expect(v[0]).toEqual([-2, 0])
  })

  it('is the same for any order of the segments', () => {
    const segs = [...path([-1, 0], [0, 0]), ...path([0, 0], [1, 0]), ...path([0, -1], [0, 0]), ...path([0, 0], [0, 1]), ...path([4, 4], [5, 4], [5, 5], [4, 4]), ...path([7, 7], [8, 9])]
    const key = (cs: ReturnType<typeof buildChains>) => JSON.stringify(cs.map((c) => [xy(c), Array.from(c.param), c.closed]))
    const base = key(buildChains(segs, PX))
    const reversed = [...segs].reverse().map((s) => ({ a: s.b, b: s.a }))
    const rotated = [...segs.slice(5), ...segs.slice(0, 5)]
    expect(key(buildChains(reversed, PX))).toBe(base)
    expect(key(buildChains(rotated, PX))).toBe(base)
  })

  it('orders the chains by their first vertex', () => {
    const chains = buildChains([...path([9, 9], [10, 9]), ...path([0, 5], [1, 5]), ...path([0, 1], [1, 1])], PX)
    expect(chains.map((c) => xy(c)[0])).toEqual([[0, 1], [0, 5], [9, 9]])
  })

  it('treats a point where an open chain turns back on itself as one chain with a repeated vertex', () => {
    // a lasso: an arm from (0, 0) to (1, 0), a loop (1, 0) (2, 1) (2, -1) back to (1, 0): a T at (1, 0) with a loop
    const segs = [...path([0, 0], [1, 0]), ...path([1, 0], [2, 1], [2, -1], [1, 0])]
    const chains = buildChains(segs, PX)
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(false)
    expect(xy(chains[0])[0]).toEqual([0, 0])
    expect(xy(chains[0]).filter(([x, y]) => x === 1 && y === 0).length).toBe(2)
  })
})

describe('buildTouchCurves', () => {
  const pt = (x: number, y: number) => ({ x, y, est: 0 })

  it('chains touch points that are linked, along the curve', () => {
    // points on the line y = x, 0.05 apart (2 px at 40 px a unit), linked to their neighbours
    const touches = Array.from({ length: 30 }, (_, i) => pt(0.05 * i, 0.05 * i))
    const links: [number, number][] = touches.slice(1).map((_, i) => [i, i + 1])
    const { chains, points } = buildTouchCurves(touches, links, PX)
    expect(points).toEqual([])
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(false)
    expect(verticesOf(chains[0]).length).toBe(30)
    expect(xy(chains[0])[0]).toEqual([0, 0])
    expect(lengthOf(chains[0])).toBeCloseTo(Math.SQRT2 * 0.05 * 29, 9)
  })

  it('takes a cluster no longer than a mark for one point', () => {
    const { chains, points } = buildTouchCurves([pt(1, 1), pt(1 + 1 / 80, 1), pt(1, 1 + 1 / 80), pt(1 + 1 / 80, 1 + 1 / 80)], [[0, 1], [1, 3], [3, 2], [2, 0]], PX)
    expect(chains).toEqual([])
    expect(points.length).toBe(1)
    expect(points[0].x).toBeCloseTo(1 + 1 / 160, 12)
    expect(points[0].y).toBeCloseTo(1 + 1 / 160, 12)
  })

  it('merges touch points under mergePx of each other before chaining', () => {
    // two columns of points 1/400 units (0.1 px) apart: one chain of the columns' means, not a ladder
    const touches = [...Array.from({ length: 20 }, (_, i) => pt(-1 / 800, 0.05 * i)), ...Array.from({ length: 20 }, (_, i) => pt(1 / 800, 0.05 * i))]
    const links: [number, number][] = []
    for (let i = 0; i < 20; i++) {
      links.push([i, 20 + i])
      if (i + 1 < 20) links.push([i, i + 1], [20 + i, 20 + i + 1], [i, 20 + i + 1], [20 + i, i + 1])
    }
    const { chains, points } = buildTouchCurves(touches, links, PX)
    expect(points).toEqual([])
    expect(chains.length).toBe(1)
    expect(verticesOf(chains[0]).length).toBe(20)
    expect(verticesOf(chains[0]).every((v) => Math.abs(v.x) < 1e-12)).toBe(true)
  })

  it('closes a ring of linked touch points', () => {
    const n = 60
    const touches = Array.from({ length: n }, (_, i): { x: number; y: number; est: number } => pt(Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n)))
    const links: [number, number][] = touches.map((_, i) => [i, (i + 1) % n])
    const { chains } = buildTouchCurves(touches, links, PX)
    expect(chains.length).toBe(1)
    expect(chains[0].closed).toBe(true)
    expect(verticesOf(chains[0]).length).toBe(n)
    expect(signedArea(chains[0])).toBeGreaterThan(0)
  })

  it('keeps clusters that are not linked apart, and orders chains and points', () => {
    const line = (x0: number) => Array.from({ length: 10 }, (_, i) => pt(x0, 0.05 * i))
    const touches = [...line(5), pt(3, 3), ...line(-5)]
    const links: [number, number][] = []
    for (let i = 0; i < 9; i++) links.push([i, i + 1], [11 + i, 11 + i + 1])
    const { chains, points } = buildTouchCurves(touches, links, PX)
    expect(points).toEqual([{ x: 3, y: 3 }])
    expect(chains.map((c) => xy(c)[0])).toEqual([[-5, 0], [5, 0]])
  })

  it('returns nothing for no touch points', () => {
    expect(buildTouchCurves([], [], PX)).toEqual({ chains: [], points: [] })
  })

  it('does not chain across a gap: unlinked points stay in their own clusters', () => {
    const touches = [...Array.from({ length: 10 }, (_, i) => pt(0.05 * i, 0)), ...Array.from({ length: 10 }, (_, i) => pt(0.05 * i + 1, 0))]
    const links: [number, number][] = []
    for (let i = 0; i < 9; i++) links.push([i, i + 1], [10 + i, 10 + i + 1])
    expect(buildTouchCurves(touches, links, PX).chains.length).toBe(2)
  })
})
