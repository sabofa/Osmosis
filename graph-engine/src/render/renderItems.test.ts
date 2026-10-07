import { describe, expect, it } from 'vitest'
import { chainOf } from '../scene/chains'
import type { Chain, SceneObject, Vec2 } from '../scene/types'
import { type GeometryItem, toRenderItems } from './renderItems'

const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }
const id = (object: string) => ({ statement: 0, object })

// A regular polygon whose area is exactly pi r^2: its circumradius is stretched to make it so. An annulus
// of two of them then has the area 3 pi to rounding, so the triangulation is held to the figure the
// contour says and not to the polygon's own deficit from the circle it approximates.
function disc(cx: number, cy: number, r: number, options: { n?: number; clockwise?: boolean } = {}): Chain {
  const n = options.n ?? 360
  const circumradius = r * Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n)))
  const sense = options.clockwise ? -1 : 1
  const points = Array.from({ length: n }, (_, i) => ({ x: cx + circumradius * Math.cos((sense * 2 * Math.PI * i) / n), y: cy + circumradius * Math.sin((sense * 2 * Math.PI * i) / n) }))
  return chainOf(points, points.map((_, i) => i), true)
}

const region = (outline: Chain[], extra: { color?: string | null } = {}): SceneObject => ({ kind: 'region', id: id('region'), outline, boundary: [], ...extra })

// The twice-signed area of each triangle, summed: positive when the triangles wind counter-clockwise (the
// front face to the camera), and equal to the sum of absolute areas only when none of them is flipped.
function areas(triangles: readonly Vec2[]): { signed: number; absolute: number } {
  let signed = 0
  let absolute = 0
  for (let i = 0; i < triangles.length; i += 3) {
    const a = ((triangles[i + 1].x - triangles[i].x) * (triangles[i + 2].y - triangles[i].y) - (triangles[i + 2].x - triangles[i].x) * (triangles[i + 1].y - triangles[i].y)) / 2
    signed += a
    absolute += Math.abs(a)
  }
  return { signed, absolute }
}

function covers(triangles: readonly Vec2[], p: Vec2): boolean {
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]]
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
    const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)
    const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)
    if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true
  }
  return false
}

// The one triangle fill an outline becomes.
function fillOf(object: SceneObject): Extract<GeometryItem, { kind: 'region' }> {
  const { geometry } = toRenderItems([object], bounds)
  expect(geometry).toHaveLength(1)
  const item = geometry[0]
  if (item.kind !== 'region') throw new Error('expected a region fill')
  return item
}

describe('toRenderItems', () => {
  it('draws each chain of a curve as its own ribbon, closing closed chains', () => {
    const curve: SceneObject = {
      kind: 'curve', id: id('curve'), breaks: [], color: null,
      chains: [
        chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1]),
        chainOf([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], [0, 1, 2], true),
      ],
    }
    const { geometry } = toRenderItems([curve], bounds)
    expect(geometry.map((g) => g.kind)).toEqual(['curve', 'curve'])
    if (geometry[1].kind !== 'curve') throw new Error('unreachable')
    expect(geometry[1].points).toHaveLength(4)
    expect(geometry[1].points[3]).toEqual({ x: 2, y: 0 })
  })
  it('skips a chain with fewer than two vertices', () => {
    const curve: SceneObject = { kind: 'curve', id: id('curve'), breaks: [], chains: [chainOf([{ x: 0, y: 0 }], [0])] }
    expect(toRenderItems([curve], bounds).geometry).toHaveLength(0)
  })
  it('clips an asymptote line to the view as a dashed segment', () => {
    const line: SceneObject = { kind: 'line', id: id('asymptote.0'), through: { x: 1, y: 0 }, direction: { x: 0, y: 1 }, extent: 'infinite', role: 'asymptote', color: 'gray' }
    const { geometry } = toRenderItems([line], bounds)
    expect(geometry).toHaveLength(1)
    const seg = geometry[0]
    if (seg.kind !== 'segment') throw new Error('expected a segment')
    expect(seg.dashed).toBe(true)
    expect(Math.min(seg.from.y, seg.to.y)).toBeCloseTo(-10)
    expect(Math.max(seg.from.y, seg.to.y)).toBeCloseTo(10)
  })
  it('keeps a plain construction line solid, and drops a line that misses the view', () => {
    const solid: SceneObject = { kind: 'line', through: { x: 0, y: 0 }, direction: { x: 1, y: 1 }, extent: 'infinite' }
    const missing: SceneObject = { kind: 'line', through: { x: 0, y: 50 }, direction: { x: 1, y: 0 }, extent: 'infinite' }
    const { geometry } = toRenderItems([solid, missing], bounds)
    expect(geometry).toHaveLength(1)
    expect(geometry[0].kind === 'segment' && !geometry[0].dashed).toBe(true)
  })
  it('fills a band as triangles covering its outline', () => {
    const band: SceneObject = {
      kind: 'band', id: id('band.0'),
      outline: [chainOf([{ x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [0, 1, 1, 0], true)],
    }
    const { geometry } = toRenderItems([band], bounds)
    expect(geometry).toHaveLength(1)
    if (geometry[0].kind !== 'region') throw new Error('expected a region')
    expect(geometry[0].triangles.length % 3).toBe(0)
    let area = 0
    const t = geometry[0].triangles
    for (let i = 0; i < t.length; i += 3) area += Math.abs((t[i + 1].x - t[i].x) * (t[i + 2].y - t[i].y) - (t[i + 2].x - t[i].x) * (t[i + 1].y - t[i].y)) / 2
    expect(area).toBeCloseTo(2, 10)
  })
  it('passes marks and points to the misc group untouched', () => {
    const mark: SceneObject = { kind: 'mark', id: id('hole.0'), at: { x: 1, y: 2 }, role: 'hole', fill: 'open', exact: true }
    const { geometry, misc } = toRenderItems([mark], bounds)
    expect(geometry).toHaveLength(0)
    expect(misc).toEqual([mark])
  })

  describe('dashed curves', () => {
    it('carries a curve\'s dashed flag onto each ribbon it becomes', () => {
      const curve: SceneObject = {
        kind: 'curve', id: id('boundary.0'), breaks: [], dashed: true, color: 'red',
        chains: [chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1]), chainOf([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }], [0, 1, 2], true)],
      }
      const { geometry } = toRenderItems([curve], bounds)
      expect(geometry).toHaveLength(2)
      for (const item of geometry) {
        if (item.kind !== 'curve') throw new Error('expected a curve ribbon')
        expect(item.dashed).toBe(true)
        expect(item.color).toBe('red')
      }
    })
    it('leaves a plain curve solid', () => {
      const plain: SceneObject = { kind: 'curve', id: id('curve'), breaks: [], chains: [chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1])] }
      const explicit: SceneObject = { kind: 'curve', id: id('curve'), breaks: [], dashed: false, chains: [chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1])] }
      for (const object of [plain, explicit]) {
        const [item] = toRenderItems([object], bounds).geometry
        if (item.kind !== 'curve') throw new Error('expected a curve ribbon')
        expect(item.dashed).toBeFalsy()
      }
    })
  })

  describe('region outlines', () => {
    it('triangulates an annulus to the area 3 pi, whichever way either ring runs', () => {
      for (const [outerClockwise, clockwise] of [[false, true], [false, false], [true, true], [true, false]]) {
        const fill = fillOf(region([disc(0, 0, 2, { clockwise: outerClockwise }), disc(0, 0, 1, { clockwise })]))
        expect(fill.triangles.length % 3).toBe(0)
        const { signed, absolute } = areas(fill.triangles)
        expect(Math.abs(absolute - 3 * Math.PI) / (3 * Math.PI)).toBeLessThan(1e-9)
        // every triangle faces the camera, and none overlaps another or covers the hole
        expect(Math.abs(signed - absolute) / absolute).toBeLessThan(1e-12)
        expect(covers(fill.triangles, { x: 0, y: 0 })).toBe(false)
        expect(covers(fill.triangles, { x: 0.5, y: 0.5 })).toBe(false)
        expect(covers(fill.triangles, { x: 1.5, y: 0.2 })).toBe(true)
        expect(covers(fill.triangles, { x: 2.5, y: 0 })).toBe(false)
      }
    })

    it('fills a ring in a hole in a ring by even-odd depth, whatever order the rings come in', () => {
      const outer = disc(0, 0, 3)
      const hole = disc(0, 0, 2)
      const island = disc(0, 0, 1)
      // and with the rings running either way: the direction of a ring means nothing to an even-odd fill
      const mixed = [disc(0, 0, 3, { clockwise: true }), disc(0, 0, 2), disc(0, 0, 1, { clockwise: true })]
      for (const outline of [[outer, hole, island], [island, hole, outer], [hole, island, outer], mixed]) {
        const fill = fillOf(region(outline))
        const { signed, absolute } = areas(fill.triangles)
        // 9 pi - 4 pi + pi
        expect(Math.abs(absolute - 6 * Math.PI) / (6 * Math.PI)).toBeLessThan(1e-9)
        expect(Math.abs(signed - absolute) / absolute).toBeLessThan(1e-12)
        expect(covers(fill.triangles, { x: 0.3, y: 0.2 })).toBe(true)
        expect(covers(fill.triangles, { x: 1.5, y: 0 })).toBe(false)
        expect(covers(fill.triangles, { x: 2.5, y: 0 })).toBe(true)
        expect(covers(fill.triangles, { x: 3.5, y: 0 })).toBe(false)
      }
    })

    it('gives each hole to the ring that holds it, not to another that stands beside it', () => {
      // a disc with a hole on the left, a bare disc on the right, and a small hole in a third, far away: the
      // hole of the left disc must not be taken out of the right one, whose own area would then be wrong
      const outline = [disc(-5, 0, 2), disc(5, 0, 2), disc(-5, 0, 1), disc(0, 6, 1.5), disc(0, 6, 0.5)]
      const fill = fillOf(region(outline))
      // (4 - 1) pi + 4 pi + (2.25 - 0.25) pi
      const expected = 9 * Math.PI
      expect(Math.abs(areas(fill.triangles).absolute - expected) / expected).toBeLessThan(1e-9)
      expect(covers(fill.triangles, { x: -5, y: 0 })).toBe(false)
      expect(covers(fill.triangles, { x: 5, y: 0 })).toBe(true)
      expect(covers(fill.triangles, { x: 0, y: 6 })).toBe(false)
      expect(covers(fill.triangles, { x: 0, y: 7 })).toBe(true)
    })

    it('nests hundreds of rings correctly: a square with a lattice of square holes, each with an island in it', () => {
      const square = (cx: number, cy: number, half: number, clockwise = false): Chain => {
        const corners = [{ x: cx - half, y: cy - half }, { x: cx + half, y: cy - half }, { x: cx + half, y: cy + half }, { x: cx - half, y: cy + half }]
        if (clockwise) corners.reverse()
        return chainOf(corners, [0, 1, 2, 3], true)
      }
      const outline: Chain[] = [square(0, 0, 10)]
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) outline.push(square(-9.5 + i, -9.5 + j, 0.3, (i + j) % 2 === 0), square(-9.5 + i, -9.5 + j, 0.1))
      }
      // a shuffle that is the same every time, so no ring's holder comes before it by luck
      let seed = 12345
      const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
      for (let k = outline.length - 1; k > 0; k--) {
        const m = Math.floor(next() * (k + 1))
        ;[outline[k], outline[m]] = [outline[m], outline[k]]
      }
      const fill = fillOf(region(outline))
      // 400 - 400 * 0.36 + 400 * 0.04
      expect(Math.abs(areas(fill.triangles).absolute - 272) / 272).toBeLessThan(1e-9)
      expect(covers(fill.triangles, { x: 0.5, y: 0.5 })).toBe(true)
      expect(covers(fill.triangles, { x: 0.7, y: 0.5 })).toBe(false)
      expect(covers(fill.triangles, { x: 0, y: 0 })).toBe(true)
    })

    it('keeps a hole that touches its ring at a vertex a hole of it', () => {
      const outer = chainOf([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], [0, 1, 2, 3], true)
      // a diamond whose first vertex lies on the outer ring's right edge, where a ray cast to the right from it
      // crosses nothing and would call it outside: only the vertices it does not share with the ring decide
      const diamond = chainOf([{ x: 4, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 1 }], [0, 1, 2, 3], true)
      const fill = fillOf(region([outer, diamond]))
      expect(areas(fill.triangles).absolute).toBeCloseTo(14, 12)
      expect(covers(fill.triangles, { x: 3, y: 2 })).toBe(false)
      expect(covers(fill.triangles, { x: 1, y: 2 })).toBe(true)
    })

    it('leaves out a ring with a vertex that is not a number, and fills the others', () => {
      const bad = chainOf([{ x: 0, y: 0 }, { x: Number.NaN, y: 1 }, { x: 1, y: 0 }], [0, 1, 2], true)
      const fill = fillOf(region([disc(0, 0, 1), bad]))
      expect(Math.abs(areas(fill.triangles).absolute - Math.PI) / Math.PI).toBeLessThan(1e-9)
    })

    it('fills a single ring, an L shape, as it stands', () => {
      const l = chainOf([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }], [0, 1, 2, 3, 4, 5], true)
      const fill = fillOf(region([l]))
      expect(areas(fill.triangles).absolute).toBeCloseTo(3, 12)
      expect(covers(fill.triangles, { x: 1.5, y: 1.5 })).toBe(false)
      expect(covers(fill.triangles, { x: 1.5, y: 0.5 })).toBe(true)
    })

    it('carries the colour onto the fill, and draws nothing for an empty outline or a ring of two vertices', () => {
      expect(fillOf(region([disc(0, 0, 1)], { color: 'teal' })).color).toBe('teal')
      const two = chainOf([{ x: 0, y: 0 }, { x: 1, y: 1 }], [0, 1], true)
      expect(toRenderItems([region([])], bounds).geometry).toHaveLength(0)
      expect(toRenderItems([region([two])], bounds).geometry).toHaveLength(0)
      // the two-vertex ring does not make the ring it lies in a hole or break its fill
      const fill = fillOf(region([disc(0, 0, 1), two]))
      expect(Math.abs(areas(fill.triangles).absolute - Math.PI) / Math.PI).toBeLessThan(1e-9)
    })

    it('does not draw a region\'s boundary: the boundary curves are objects of their own', () => {
      const outline = [disc(0, 0, 1)]
      const withBoundary: SceneObject = { kind: 'region', id: id('region'), outline, boundary: [id('boundary.0')] }
      const { geometry, misc } = toRenderItems([withBoundary], bounds)
      expect(geometry.map((g) => g.kind)).toEqual(['region'])
      expect(misc).toEqual([])
    })
  })

  // The earcut bundled with three (3.0.1) leaves its first vertex out of the box it hashes the vertices into,
  // so an outer ring that starts at the only vertex to reach an extreme of x or y (its leftmost tip) is
  // triangulated wrongly once there are more than 80 vertices: ears are accepted that hold another vertex,
  // and the fill overflows. A ring's start means nothing to the shape, so the renderer starts it elsewhere.
  describe('a ring that starts at an extreme vertex', () => {
    const shoelace = (ring: readonly Vec2[]) => {
      let s = 0
      for (let i = 0; i < ring.length; i++) {
        const next = ring[(i + 1) % ring.length]
        s += ring[i].x * next.y - next.x * ring[i].y
      }
      return s / 2
    }
    const ringOf = (points: readonly Vec2[]) => chainOf(points, points.map((_, i) => i), true)

    // The tip (0, 0), then down the lower edge, round the bulging right side and back along the upper edge, with
    // a notch reaching in to x = 2: the tip is the leftmost vertex and comes first, and the ear it makes holds
    // the notch's vertex. 89 vertices, and a polygon, not a disc, so its area is the shoelace area.
    function dart(): Vec2[] {
      const arc = Array.from({ length: 100 }, (_, i) => {
        const a = -Math.PI / 2 + (Math.PI * i) / 99
        return { x: 10 + 3 * Math.cos(a), y: 5 * Math.sin(a) }
      })
      return [{ x: 0, y: 0 }, ...arc.filter((p) => p.y < -1.2), { x: 10, y: -1 }, { x: 2, y: 0 }, { x: 10, y: 1 }, ...arc.filter((p) => p.y > 1.2)]
    }

    it('fills a dart with no holes whose leftmost tip comes first, as a region and as a band', () => {
      const points = dart()
      expect(points.length).toBeGreaterThan(80)
      const exact = Math.abs(shoelace(points))
      const chain = ringOf(points)
      const band: SceneObject = { kind: 'band', id: id('band.0'), outline: [chain] }
      for (const object of [region([chain]), band]) {
        const { signed, absolute } = areas(fillOf(object).triangles)
        expect(Math.abs(absolute - exact) / exact).toBeLessThan(1e-9)
        expect(Math.abs(signed - absolute) / absolute).toBeLessThan(1e-12)
      }
    })

    it('fills a wobbly disc with several holes, whichever vertex of the outer ring comes first', () => {
      let seed = 4242
      const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
      for (let trial = 0; trial < 40; trial++) {
        const n = 16 + Math.floor(random() * 80)
        const wobble = 0.15 * random()
        const outer = Array.from({ length: n }, (_, i) => {
          const a = (2 * Math.PI * i) / n
          const r = 10 * (1 + wobble * Math.sin(5 * a + trial))
          return { x: r * Math.cos(a), y: r * Math.sin(a) }
        })
        // 2 to 12 disc holes of 8 to 47 vertices each, inside the outer ring and clear of one another
        const holes: Vec2[][] = []
        const discs: { x: number; y: number; r: number }[] = []
        const wanted = 2 + Math.floor(random() * 11)
        for (let tries = 0; discs.length < wanted && tries < 500; tries++) {
          const c = { x: (random() * 2 - 1) * 7, y: (random() * 2 - 1) * 7, r: 0.3 + random() * 2 }
          if (Math.hypot(c.x, c.y) + c.r > 10 * (1 - wobble) * 0.95) continue
          if (discs.some((e) => Math.hypot(c.x - e.x, c.y - e.y) < c.r + e.r + 0.05)) continue
          discs.push(c)
          const m = 8 + Math.floor(random() * 40)
          const turn = random() * 2 * Math.PI
          const hole = Array.from({ length: m }, (_, i) => ({ x: c.x + c.r * Math.cos((2 * Math.PI * i) / m + turn), y: c.y + c.r * Math.sin((2 * Math.PI * i) / m + turn) }))
          holes.push(random() < 0.5 ? hole : hole.reverse())
        }
        const exact = Math.abs(shoelace(outer)) - holes.reduce((sum, h) => sum + Math.abs(shoelace(h)), 0)
        // from the leftmost vertex, the lowest, the highest and the rightmost, which are what the box is made of
        const extreme = (better: (a: Vec2, b: Vec2) => boolean) => outer.reduce((best, p, i) => (better(p, outer[best]) ? i : best), 0)
        const starts = [extreme((a, b) => a.x < b.x), extreme((a, b) => a.y < b.y), extreme((a, b) => a.y > b.y), extreme((a, b) => a.x > b.x)]
        for (const start of starts) {
          const ring = [...outer.slice(start), ...outer.slice(0, start)]
          const { signed, absolute } = areas(fillOf(region([ringOf(ring), ...holes.map(ringOf)])).triangles)
          expect(Math.abs(absolute - exact) / exact, `trial ${trial}, ${n} vertices, start ${start}`).toBeLessThan(1e-9)
          expect(Math.abs(signed - absolute) / absolute).toBeLessThan(1e-12)
        }
      }
    })

    it('fills a ring of four or fewer vertices, each the only one to reach an extreme, whichever it starts at', () => {
      // a diamond and a triangle: every vertex is the sole holder of an extreme of x or y, so there is no start
      // that is not one (the ring's first edge is split instead); their areas are 2 and 5
      const diamond = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }]
      const triangle = [{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 2, y: 3 }]
      for (const [ring, exact] of [[diamond, 2], [triangle, 5]] as const) {
        for (let start = 0; start < ring.length; start++) {
          const points = [...ring.slice(start), ...ring.slice(0, start)]
          const { signed, absolute } = areas(fillOf(region([ringOf(points)])).triangles)
          expect(absolute).toBeCloseTo(exact, 12)
          expect(signed).toBeCloseTo(exact, 12)
        }
      }
    })
  })

  describe('a ring of three vertices round a hole of many', () => {
    it('fills a triangle with a 132-vertex hole whichever vertex comes first, though each is the only one at an extreme', () => {
      // over 80 vertices in all, so earcut hashes, and the outer ring has no start away from its extremes
      const shoelace = (ring: readonly Vec2[]) => ring.reduce((sum, p, i) => sum + (p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y), 0) / 2
      const triangle = [{ x: -10, y: -8 }, { x: 11, y: -6 }, { x: 0, y: 12 }]
      const hole = Array.from({ length: 132 }, (_, i) => ({ x: 0.3 + 2 * Math.cos((2 * Math.PI * i) / 132), y: -0.7 + 2 * Math.sin((2 * Math.PI * i) / 132) }))
      const exact = Math.abs(shoelace(triangle)) - Math.abs(shoelace(hole))
      for (let start = 0; start < 3; start++) {
        const outer = [...triangle.slice(start), ...triangle.slice(0, start)]
        const outline = [outer, hole].map((ring) => chainOf(ring, ring.map((_, i) => i), true))
        const { signed, absolute } = areas(fillOf(region(outline)).triangles)
        expect(Math.abs(absolute - exact) / exact, `start ${start}`).toBeLessThan(1e-9)
        expect(Math.abs(signed - absolute) / absolute).toBeLessThan(1e-12)
      }
    })
  })

  describe('a hole that lies on its ring everywhere', () => {
    it('is a hole of it when every vertex is on the ring, as a diamond on the midpoints of a square\'s edges', () => {
      const square = chainOf([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], [0, 1, 2, 3], true)
      const diamond = chainOf([{ x: 2, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 2 }], [0, 1, 2, 3], true)
      const { signed, absolute } = areas(fillOf(region([square, diamond])).triangles)
      expect(absolute).toBeCloseTo(8, 12)
      expect(signed).toBeCloseTo(8, 12)
    })
  })
})
