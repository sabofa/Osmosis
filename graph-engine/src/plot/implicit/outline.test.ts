import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../scene/types'
import { EdgePool } from './outline'
import type { Box } from './types'

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 })
const p = (x: number, y: number): Vec2 => ({ x, y })

function area(ring: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const q = ring[(i + 1) % ring.length]
    a += ring[i].x * q.y - q.x * ring[i].y
  }
  return a / 2
}

const xy = (ring: readonly Vec2[]) => ring.map((v) => [v.x, v.y])

describe('EdgePool: rings from the edges of kept pieces', () => {
  it('makes a cell one ring, counter-clockwise from its smallest vertex', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 2, 1))
    const { rings, stats } = pool.finish()
    expect(rings.map(xy)).toEqual([[[0, 0], [2, 0], [2, 1], [0, 1]]])
    expect(area(rings[0])).toBe(2)
    expect(stats).toMatchObject({ edges: 4, cancelled: 0, outline: 4, rings: 1, broken: 0 })
  })

  it('cancels the edge two cells share, by the exact coordinates of its ends, and drops the vertices it leaves in a straight run', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 1, 1))
    pool.addBox(box(1, 0, 2, 1))
    const { rings, stats } = pool.finish()
    expect(rings.map(xy)).toEqual([[[0, 0], [2, 0], [2, 1], [0, 1]]])
    expect(stats.cancelled).toBe(1)
    expect(stats.outline).toBe(6)
  })

  it('splits a whole cell\'s edge at the vertices of the pieces it meets, so the pieces meet vertex to vertex (no T-junction)', () => {
    // a 2 x 2 cell and, on its right, two 1 x 1 leaves: its edge x = 2 is cut at y = 1 and each half cancels one leaf's left edge (and the
    // leaves cancel the edge they share: three pairs)
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 2, 2))
    pool.addBox(box(2, 0, 3, 1))
    pool.addBox(box(2, 1, 3, 2))
    const { rings, stats } = pool.finish()
    expect(stats.cancelled).toBe(3)
    expect(rings.map(xy)).toEqual([[[0, 0], [3, 0], [3, 2], [0, 2]]])
    expect(area(rings[0])).toBe(6)
  })

  it('splits on a vertical edge and for edges that run the other way too', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 2, 2))
    pool.addBox(box(0, 2, 1, 3))
    pool.addBox(box(1, 2, 2, 3))
    const { rings, stats } = pool.finish()
    expect(stats.cancelled).toBe(3)
    expect(rings.map(xy)).toEqual([[[0, 0], [2, 0], [2, 3], [0, 3]]])
  })

  it('makes a hole a clockwise ring, so the signed areas add up to the region', () => {
    // a 3 x 3 cell with the middle unit cell taken out: the eight cells round it
    const pool = new EdgePool()
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (i !== 1 || j !== 1) pool.addBox(box(i, j, i + 1, j + 1))
    const { rings } = pool.finish()
    expect(rings.length).toBe(2)
    const areas = rings.map(area).sort((a, b) => a - b)
    expect(areas).toEqual([-1, 9])
    expect(areas[0] + areas[1]).toBe(8)
  })

  it('keeps two cells that meet at a corner as two rings, not a figure eight (the sharpest left turn at the pinch)', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 1, 1))
    pool.addBox(box(1, 1, 2, 2))
    const { rings } = pool.finish()
    expect(rings.length).toBe(2)
    expect(rings.map(area)).toEqual([1, 1])
    expect(rings.map((r) => r.length)).toEqual([4, 4])
  })

  it('lists the rings by their first vertex, whatever order the pieces came in', () => {
    const cells = [box(5, 5, 6, 6), box(0, 0, 1, 1), box(2, 3, 3, 4), box(-4, 1, -3, 2)]
    const make = (order: Box[]) => {
      const pool = new EdgePool()
      for (const c of order) pool.addBox(c)
      return pool.finish().rings.map(xy)
    }
    const one = make(cells)
    expect(one.map((r) => r[0])).toEqual([[-4, 1], [0, 0], [2, 3], [5, 5]])
    expect(make([...cells].reverse())).toEqual(one)
    expect(make([cells[2], cells[0], cells[3], cells[1]])).toEqual(one)
  })

  it('starts a ring that passes its smallest vertex twice at the sequence that is smallest', () => {
    // a bow tie of two triangles joined at (0, 0) as ONE ring of five vertices is not what the pinch rule makes; pieces that touch at a vertex are two rings
    const pool = new EdgePool()
    pool.add(p(0, 0), p(2, 0))
    pool.add(p(2, 0), p(1, 1))
    pool.add(p(1, 1), p(0, 0))
    const { rings } = pool.finish()
    expect(rings.map(xy)).toEqual([[[0, 0], [2, 0], [1, 1]]])
  })
})

describe('EdgePool: the boundary of each comparison', () => {
  it('gives an edge made by a comparison to that comparison, and no other to any', () => {
    // a triangle with its slanted side the chord of comparison 3
    const pool = new EdgePool()
    pool.add(p(0, 0), p(2, 0))
    pool.add(p(2, 0), p(0, 1), [3])
    pool.add(p(0, 1), p(0, 0))
    const { boundary } = pool.finish()
    expect([...boundary.keys()]).toEqual([3])
    expect(boundary.get(3)?.map((s) => [s.a.x, s.a.y, s.b.x, s.b.y])).toEqual([[2, 0, 0, 1]])
  })

  it('gives an edge to every comparison it is a chord of', () => {
    const pool = new EdgePool()
    pool.add(p(0, 0), p(2, 0))
    pool.add(p(2, 0), p(0, 1), [1, 4])
    pool.add(p(0, 1), p(0, 0))
    const { boundary } = pool.finish()
    expect([...boundary.keys()].sort()).toEqual([1, 4])
  })

  it('takes the edge along a zero set for that comparison\'s boundary, with the edges of a whole cell that border it cut where it ends', () => {
    // y >= 0 on a grid line: the leaf below holds the zero edge (0, 0)-(1, 0); the whole cell above has the edge (0, 0)-(2, 0)
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 2, 1))
    pool.zero(p(0, 0), p(1, 0), 0)
    const { boundary } = pool.finish()
    expect(boundary.get(0)?.map((s) => [s.a.x, s.a.y, s.b.x, s.b.y])).toEqual([[0, 0, 1, 0]])
  })

  it('merges zero segments that touch, so a long edge of a cell is covered whole by the leaves along it', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 3, 1))
    for (let i = 0; i < 3; i++) pool.zero(p(i, 0), p(i + 1, 0), 2)
    const { boundary } = pool.finish()
    const segs = boundary.get(2) ?? []
    // the cell's bottom edge is cut at 1 and at 2 (each zero segment ends there), and each piece is covered
    expect(segs.map((s) => [s.a.x, s.b.x]).sort((a, b) => a[0] - b[0])).toEqual([[0, 1], [1, 2], [2, 3]])
  })

  it('does not put a zero set the region lies on both sides of on any boundary: the edge cancels', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 1, 1))
    pool.addBox(box(1, 0, 2, 1))
    pool.zero(p(1, 0), p(1, 1), 0)
    const { boundary } = pool.finish()
    expect(boundary.size).toBe(0)
  })

  it('does not take an edge that is not on the zero line, nor one on another line', () => {
    const pool = new EdgePool()
    pool.addBox(box(0, 0, 2, 1))
    pool.zero(p(0, 5), p(1, 5), 0)
    pool.zero(p(5, 0), p(5, 1), 0)
    expect(pool.finish().boundary.size).toBe(0)
  })
})

describe('EdgePool: odd input', () => {
  it('ignores an edge of no length and a ring of no area', () => {
    const pool = new EdgePool()
    pool.add(p(0, 0), p(0, 0))
    pool.add(p(0, 0), p(1, 0))
    pool.add(p(1, 0), p(0, 0))
    const { rings, stats } = pool.finish()
    expect(rings).toEqual([])
    expect(stats.cancelled).toBe(1)
  })

  it('counts a run of edges that does not close, and draws no ring from it', () => {
    const pool = new EdgePool()
    pool.add(p(0, 0), p(1, 0))
    pool.add(p(1, 0), p(1, 1))
    const { rings, stats } = pool.finish()
    expect(rings).toEqual([])
    expect(stats.broken).toBeGreaterThan(0)
  })

  it('treats -0 and 0 as one vertex', () => {
    const pool = new EdgePool()
    pool.addBox(box(-0, -0, 1, 1))
    pool.addBox(box(0, 1, 1, 2))
    expect(pool.finish().rings.map(xy)).toEqual([[[0, 0], [1, 0], [1, 2], [0, 2]]])
  })
})
