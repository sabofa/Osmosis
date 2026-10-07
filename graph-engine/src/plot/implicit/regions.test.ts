import { describe, expect, it } from 'vitest'
import { compare, and } from '../../math/reserved'
import type { Bounds } from '../../scene/types'
import { condition, expr, scopeOf } from '../sample/testkit'
import { sampleRegion } from './regions'
import { comparisonsOf } from './region'
import { BOUNDS, boundaryCurves, chainVertices, distToRings, evenOddArea, falseFill, outlineArea, regionObject, regionOf, regionOfCondition, ringsOf, scalarArea, signedArea, VIEW_800 } from './regionkit'
import { COARSE, FULL } from './tuning'

const near = (a: number, b: number, rel = 0.005) => Math.abs(a - b) <= rel * Math.abs(b)

// The area of a region inside the root box [-15, 15]^2, measured on its own scalar kernel, a grid of 1500 by 1500.
const ROOT: Bounds = { xMin: -15, xMax: 15, yMin: -15, yMax: 15 }

describe('sampleRegion: the acceptance cases', () => {
  it('1 < x^2 + y^2 < 4: the annulus, area 3 pi within half a percent, both boundaries dashed', () => {
    const r = regionOf('1 < x^2 + y^2 < 4')
    expect(r.capped).toBe(false)
    expect(r.badView).toBe(false)
    expect(r.defined).toBe(true)
    expect(r.tested).toBe(true)
    expect(near(outlineArea(r), 3 * Math.PI)).toBe(true)
    const curves = boundaryCurves(r)
    expect(curves.map((c) => c.dashed)).toEqual([true, true])
    expect(curves.map((c) => c.id)).toEqual([
      { statement: 0, object: 'boundary.0' },
      { statement: 0, object: 'boundary.1' },
    ])
    expect(regionObject(r).boundary).toEqual(curves.map((c) => c.id))
    expect(regionObject(r).id).toEqual({ statement: 0, object: 'region' })
    // the outer circle runs counter-clockwise, the inner one (the hole) clockwise
    const areas = ringsOf(r).map(signedArea).sort((a, b) => a - b)
    expect(areas.length).toBe(2)
    expect(areas[0]).toBeLessThan(0)
    expect(areas[1]).toBeGreaterThan(0)
    expect(near(areas[1], 4 * Math.PI)).toBe(true)
    expect(near(areas[0], -Math.PI)).toBe(true)
    // and the even-odd rule the renderer fills by gives the same area
    expect(near(evenOddArea(ringsOf(r), { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, 600), 3 * Math.PI, 0.01)).toBe(true)
    // each boundary is one closed chain on its circle
    const [inner, outer] = curves
    expect(inner.chains.length).toBe(1)
    expect(inner.chains[0].closed).toBe(true)
    expect(Math.max(...chainVertices(inner.chains).map((v) => Math.abs(Math.hypot(v.x, v.y) - 1)))).toBeLessThan(1e-4)
    expect(Math.max(...chainVertices(outer.chains).map((v) => Math.abs(Math.hypot(v.x, v.y) - 2)))).toBeLessThan(1e-4)
  })

  it('x^2 + y^2 < 4 and y > 0: the half-disk, area 2 pi, the arc dashed and the diameter dashed', () => {
    const r = regionOf('x^2 + y^2 < 4 and y > 0')
    expect(near(outlineArea(r), 2 * Math.PI)).toBe(true)
    const [arc, diameter] = boundaryCurves(r)
    expect(arc.dashed).toBe(true)
    expect(diameter.dashed).toBe(true)
    // the arc is the upper half of the circle, from (-2, 0) to (2, 0), one open chain
    expect(arc.chains.length).toBe(1)
    expect(arc.chains[0].closed).toBe(false)
    const av = chainVertices(arc.chains)
    expect(Math.max(...av.map((v) => Math.abs(Math.hypot(v.x, v.y) - 2)))).toBeLessThan(1e-4)
    expect(Math.min(...av.map((v) => v.y))).toBeGreaterThanOrEqual(0)
    // the diameter is y = 0 from x = -2 to 2
    expect(diameter.chains.length).toBe(1)
    const dv = chainVertices(diameter.chains)
    expect(Math.max(...dv.map((v) => Math.abs(v.y)))).toBeLessThan(1e-9)
    expect(Math.abs(Math.min(...dv.map((v) => v.x)) + 2)).toBeLessThan(0.03)
    expect(Math.abs(Math.max(...dv.map((v) => v.x)) - 2)).toBeLessThan(0.03)
    // one ring: the half-disk
    expect(ringsOf(r).length).toBe(1)
  })

  it('y < ln(x): nothing outlined at x <= 0, and the area under the curve on the right', () => {
    const r = regionOf('y < ln(x)')
    expect(r.capped).toBe(false)
    expect(r.defined).toBe(true)
    const rings = ringsOf(r)
    expect(rings.length).toBe(1)
    expect(Math.min(...rings.flat().map((v) => v.x))).toBeGreaterThanOrEqual(0)
    expect(evenOddArea(rings, { xMin: -15, xMax: 0, yMin: -15, yMax: 15 }, 300)).toBe(0)
    // 15 ln 15 - 15 + 225: the integral of ln x + 15 over (0, 15]
    expect(near(outlineArea(r), 15 * Math.log(15) - 15 + 225)).toBe(true)
    // the boundary is dashed (strict) and is the curve, to the bottom of the view's overscan
    const [curve] = boundaryCurves(r)
    expect(curve.dashed).toBe(true)
    expect(Math.min(...chainVertices(curve.chains).map((v) => v.y))).toBe(-15)
    expect(falseFill(r, 'y < ln(x)', ROOT, 400, 0.05)).toBe(0)
  })

  it('xy > 1: two components, dashed', () => {
    const r = regionOf('x*y > 1')
    const rings = ringsOf(r)
    expect(rings.length).toBe(2)
    // one in the first quadrant, one in the third
    const centre = (ring: { x: number; y: number }[]) => ({ x: ring.reduce((s, v) => s + v.x, 0) / ring.length, y: ring.reduce((s, v) => s + v.y, 0) / ring.length })
    const quadrants = rings.map((ring) => Math.sign(centre(ring).x) * Math.sign(centre(ring).y))
    expect(quadrants).toEqual([1, 1])
    expect(rings.map((ring) => Math.sign(centre(ring).x)).sort()).toEqual([-1, 1])
    // 2 (15 (15 - 1/15) - ln 225)
    expect(near(outlineArea(r), 2 * (15 * (15 - 1 / 15) - Math.log(225)))).toBe(true)
    const [curve] = boundaryCurves(r)
    expect(curve.dashed).toBe(true)
    expect(curve.chains.length).toBe(2)
    expect(curve.chains.every((c) => !c.closed)).toBe(true)
  })

  it('y >= x^2: a solid boundary, the parabola, and the area under y = 15', () => {
    const r = regionOf('y >= x^2')
    const curves = boundaryCurves(r)
    expect(curves.length).toBe(1)
    expect(curves[0].dashed).toBe(false)
    expect(curves[0].chains.length).toBe(1)
    expect(near(outlineArea(r), 20 * Math.sqrt(15))).toBe(true)
    // every vertex is on the parabola, to a thousandth of a unit
    expect(Math.max(...chainVertices(curves[0].chains).map((v) => Math.abs(v.y - v.x * v.x)))).toBeLessThan(1e-3)
    expect(falseFill(r, 'y >= x^2', ROOT, 400, 0.05)).toBe(0)
  })

  it('x^2 + y^2 < 1 if x > 0: the half-disk (the `if` clause is part of the condition)', () => {
    const c = and(compare('<', expr('x^2 + y^2'), expr('1')), condition('x > 0'))
    const r = regionOfCondition(c)
    expect(near(outlineArea(r), Math.PI / 2)).toBe(true)
    // nothing of it at x <= 0
    expect(Math.min(...ringsOf(r).flat().map((v) => v.x))).toBeGreaterThanOrEqual(0)
    expect(boundaryCurves(r).length).toBe(2)
  })

  it('draws the same twice', () => {
    for (const text of ['1 < x^2 + y^2 < 4', 'y < ln(x)', 'x*y > 1']) {
      const a = regionOf(text)
      const b = regionOf(text)
      expect(b).toEqual(a)
    }
  })
})

describe('sampleRegion: fill and boundary agree', () => {
  it('has every boundary vertex on an edge of the outline', () => {
    for (const text of ['1 < x^2 + y^2 < 4', 'x^2 + y^2 < 4 and y > 0', 'y < ln(x)', 'x*y > 1', 'y >= x^2', 'y < sqrt(x)', 'x >= 0 and y >= 0', 'y > 1/x']) {
      const r = regionOf(text)
      const rings = ringsOf(r)
      expect(rings.length, text).toBeGreaterThan(0)
      const curves = boundaryCurves(r)
      expect(curves.length, text).toBeGreaterThan(0)
      for (const c of curves) {
        for (const v of chainVertices(c.chains)) expect(distToRings(rings, v), text).toBeLessThan(1e-9)
      }
    }
  })

  it('draws no fill where the condition is false, to within the chord: a point inside the outline and not inside the condition is on an edge of it', () => {
    for (const text of ['1 < x^2 + y^2 < 4', 'x^2 + y^2 < 4 and y > 0', 'x*y > 1', 'x < -5 or x > 5', 'not x^2 + y^2 < 4', 'sin(x) < cos(y)']) {
      const r = regionOf(text)
      expect(falseFill(r, text, ROOT, 450, 0.03), text).toBe(0)
    }
  })

  it('has area where the scalar kernel finds it (an independent grid)', () => {
    for (const text of ['1 < x^2 + y^2 < 4', 'x*y > 1', 'sin(x) < cos(y)', 'y < sqrt(x)', 'x < -5 or x > 5', 'x^2 - y^2 > 1']) {
      const r = regionOf(text)
      const grid = scalarArea(text, ROOT, 1500)
      expect(Math.abs(outlineArea(r) - grid) / grid, text).toBeLessThan(0.01)
    }
  })
})

describe('sampleRegion: any boolean combination, with no polygon booleans', () => {
  it('draws an or: two half-planes, two rings, each boundary dashed', () => {
    const r = regionOf('x < -5 or x > 5')
    expect(ringsOf(r).length).toBe(2)
    expect(near(outlineArea(r), 600, 1e-4)).toBe(true)
    const curves = boundaryCurves(r)
    expect(curves.map((c) => c.dashed)).toEqual([true, true])
    const xs = curves.map((c) => chainVertices(c.chains).map((v) => v.x))
    expect(xs.map((list) => Math.max(...list.map((x) => Math.abs(Math.abs(x) - 5)))).every((e) => e < 1e-4)).toBe(true)
  })

  it('draws a not: the plane without the disk, a hole, and the boundary solid (the circle is in it)', () => {
    const r = regionOf('not x^2 + y^2 < 4')
    expect(near(outlineArea(r), 900 - 4 * Math.PI)).toBe(true)
    const [circle] = boundaryCurves(r)
    expect(circle.dashed).toBe(false)
    expect(ringsOf(r).length).toBe(2)
  })

  it('does not draw a boundary where both sides are inside: an or of two half-planes that overlap is one region', () => {
    const r = regionOf('x < 2 or x > -2')
    expect(near(outlineArea(r), 900, 1e-4)).toBe(true)
    expect(boundaryCurves(r).length).toBe(0)
    expect(ringsOf(r).length).toBe(1)
  })

  it('draws a system\'s feasible region: three half-planes', () => {
    const r = regionOf('y >= 0 and x >= 0 and x + y <= 4')
    // the triangle (0, 0), (4, 0), (0, 4)
    expect(near(outlineArea(r), 8, 1e-3)).toBe(true)
    expect(boundaryCurves(r).map((c) => c.dashed)).toEqual([false, false, false])
    expect(ringsOf(r).length).toBe(1)
    expect(ringsOf(r)[0].length).toBe(3)
  })
})

describe('sampleRegion: edges on the grid and cells kept whole', () => {
  it('y >= 0: the half-plane, solid boundary along the grid line y = 0, one straight chain across the root', () => {
    const r = regionOf('y >= 0')
    expect(near(outlineArea(r), 450, 1e-6)).toBe(true)
    const [curve] = boundaryCurves(r)
    expect(curve.dashed).toBe(false)
    expect(curve.chains.length).toBe(1)
    const v = chainVertices(curve.chains)
    expect(Math.max(...v.map((q) => Math.abs(q.y)))).toBe(0)
    expect(Math.min(...v.map((q) => q.x))).toBe(-15)
    expect(Math.max(...v.map((q) => q.x))).toBe(15)
    // the outline is the half of the root: a rectangle
    expect(ringsOf(r)).toHaveLength(1)
    expect(ringsOf(r)[0]).toHaveLength(4)
  })

  it('y > 0: the same boundary, dashed, and the same area (the line itself is not in the region)', () => {
    const r = regionOf('y > 0')
    expect(near(outlineArea(r), 450, 1e-6)).toBe(true)
    const [curve] = boundaryCurves(r)
    expect(curve.dashed).toBe(true)
    expect(curve.chains.length).toBe(1)
  })

  it('x >= 0 and y >= 0: the quadrant, with the boundary the two axes', () => {
    const r = regionOf('x >= 0 and y >= 0')
    expect(near(outlineArea(r), 225, 1e-6)).toBe(true)
    expect(boundaryCurves(r).map((c) => c.chains.length)).toEqual([1, 1])
    expect(ringsOf(r)[0]).toHaveLength(4)
  })

  it('draws a condition that holds everywhere as the root, one ring of four vertices, no boundary', () => {
    const r = regionOf('y > -100')
    expect(ringsOf(r).map((ring) => ring.length)).toEqual([4])
    expect(outlineArea(r)).toBe(900)
    expect(boundaryCurves(r)).toEqual([])
    // and costs nothing but the one evaluation that proves it
    expect(r.stats).toEqual({ points: 0, intervals: 1 })
  })

  it('draws a condition that holds nowhere as no ring at all', () => {
    const r = regionOf('x^2 + y^2 < 0')
    expect(regionObject(r).outline).toEqual([])
    expect(r.defined).toBe(true)
    expect(r.drawnInView).toBe(false)
    expect(r.blankInView).toBe(false)
  })

  it('draws a region in a view that is panned off the grid lines as well', () => {
    const view = { bounds: { xMin: -9.73, xMax: 10.27, yMin: -9.31, yMax: 10.69 }, widthPx: 800, heightPx: 800 }
    const root = { xMin: -14.73, xMax: 15.27, yMin: -14.31, yMax: 15.69 }
    for (const text of ['1 < x^2 + y^2 < 4', 'x^2 + y^2 < 4 and y > 0', 'y >= 0', 'y < ln(x)', 'x*y > 1']) {
      const r = regionOf(text, { view })
      const grid = scalarArea(text, root, 1200)
      expect(Math.abs(outlineArea(r) - grid) / grid, text).toBeLessThan(0.01)
      expect(falseFill(r, text, root, 300, 0.03), text).toBe(0)
    }
  })

  it('draws a node of the boundary inside a leaf as the crossing it is: xy > 0 off the grid is two quadrants and two whole axes', () => {
    const view = { bounds: { xMin: -9.73, xMax: 10.27, yMin: -9.31, yMax: 10.69 }, widthPx: 800, heightPx: 800 }
    const root = { xMin: -14.73, xMax: 15.27, yMin: -14.31, yMax: 15.69 }
    for (const text of ['x*y > 0', '(x - 0.37)*(y + 0.21) > 0', 'sin(x)*sin(y) > 0']) {
      const r = regionOf(text, { view })
      expect(r.leftOut, text).toBe(0)
      const grid = scalarArea(text, root, 1200)
      expect(Math.abs(outlineArea(r) - grid) / grid, text).toBeLessThan(0.005)
      expect(falseFill(r, text, root, 300, 0.05), text).toBe(0)
    }
    // the axes of the first are each ONE chain through the node, which no leaf's arcs break
    const [axes] = boundaryCurves(regionOf('x*y > 0', { view }))
    expect(axes.chains.length).toBe(2)
    expect(ringsOf(regionOf('x*y > 0', { view })).length).toBe(2)
  })

  it('draws a band thinner than a pixel: its face between two chords has no corner of the leaf to say which side of each it is on', () => {
    // 0.0126 < y < 0.0166 is 0.16 px a unit high across the whole root: inside one leaf (0.029 units), both chords run from edge to edge and
    // the strip between them touches none of its corners, so its sign is read across a chord from the face that does
    const r = regionOf('y > 0.0126 and y < 0.0166')
    expect(near(outlineArea(r), 30 * 0.004, 0.02)).toBe(true)
    expect(boundaryCurves(r).length).toBe(2)
    expect(ringsOf(r).length).toBe(1)
    expect(falseFill(r, 'y > 0.0126 and y < 0.0166', { xMin: -15, xMax: 15, yMin: -0.1, yMax: 0.1 }, 600, 1e-3)).toBe(0)
  })

  it('keeps the axes of a view that is not square: 40 by 10 px a unit', () => {
    const view = { bounds: BOUNDS, widthPx: 800, heightPx: 200 }
    const r = regionOf('x^2 + y^2 < 4', { view })
    expect(near(outlineArea(r), 4 * Math.PI)).toBe(true)
  })
})

describe('sampleRegion: nothing is joined across a pole or an undefined cell', () => {
  it('y < tan(x): a ring between each two poles, and no outline edge across one', () => {
    const r = regionOf('y < tan(x)')
    const rings = ringsOf(r)
    // ten poles in [-15, 15]: eleven pieces
    expect(rings.length).toBe(11)
    expect(near(outlineArea(r), 450, 1e-3)).toBe(true)
    const poles = Array.from({ length: 10 }, (_, k) => Math.PI / 2 + (k - 5) * Math.PI)
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const lo = Math.min(a.x, b.x)
        const hi = Math.max(a.x, b.x)
        for (const p of poles) expect(lo < p - 1e-4 && hi > p + 1e-4, `an edge across the pole at ${p}`).toBe(false)
      }
    }
    // the boundary is the branches, one chain each, and none crosses a pole
    const [curve] = boundaryCurves(r)
    expect(curve.chains.length).toBe(11)
    for (const chain of curve.chains) {
      const xs = chainVertices([chain]).map((v) => v.x)
      for (const p of poles) expect(Math.min(...xs) < p - 1e-4 && Math.max(...xs) > p + 1e-4).toBe(false)
    }
    expect(falseFill(r, 'y < tan(x)', ROOT, 300, 0.03)).toBe(0)
  }, 60000)

  it('y < sqrt(x): the fill ends at the domain edge x = 0, with an outline edge there that is nobody\'s boundary', () => {
    const r = regionOf('y < sqrt(x)')
    const rings = ringsOf(r)
    // (the domain edge x = 0 is a column of leaf corners: a corner on the cut says nothing of the face, so no leaf is left out for it)
    expect(r.leftOut).toBe(0)
    expect(Math.min(...rings.flat().map((v) => v.x))).toBeGreaterThanOrEqual(0)
    expect(near(outlineArea(r), (2 / 3) * 15 ** 1.5 + 225)).toBe(true)
    // the edge along x = 0
    const onAxis = rings.flat().filter((v) => v.x === 0)
    expect(onAxis.length).toBeGreaterThanOrEqual(2)
    // the boundary curve is the parabola's branch only: every vertex of it has x > 0 and y = sqrt x
    const [curve] = boundaryCurves(r)
    expect(boundaryCurves(r).length).toBe(1)
    expect(Math.max(...chainVertices(curve.chains).map((v) => Math.abs(v.y - Math.sqrt(v.x))))).toBeLessThan(1e-3)
  })

  it('shades nothing of a condition that is undefined everywhere, and says so (defined false)', () => {
    const r = regionOf('sqrt(-1 - x^2) > y')
    expect(regionObject(r).outline).toEqual([])
    expect(r.tested).toBe(true)
    expect(r.defined).toBe(false)
    expect(r.objects.length).toBe(1)
  })

  it('says defined for a condition that is undefined in most of the view but not all of it', () => {
    expect(regionOf('y < ln(x)').defined).toBe(true)
    expect(regionOf('sqrt(x - 9.5) > y', {}).defined).toBe(true)
  })
})

describe('sampleRegion: the view', () => {
  const ok = { statement: 0, color: null, quality: 'full' as const }
  const c = condition('x^2 + y^2 < 4')
  const bad = (bounds: Bounds, widthPx = 800, heightPx = 800) => sampleRegion(c, comparisonsOf(c), { bounds, widthPx, heightPx }, scopeOf(), ok)

  it('draws nothing and says badView for a view that is not a finite box of positive size', () => {
    for (const bounds of [
      { xMin: NaN, xMax: 10, yMin: -10, yMax: 10 },
      { xMin: -10, xMax: Infinity, yMin: -10, yMax: 10 },
      { xMin: 10, xMax: -10, yMin: -10, yMax: 10 },
      { xMin: -10, xMax: 10, yMin: 3, yMax: 3 },
      { xMin: -1e308, xMax: 1e308, yMin: -10, yMax: 10 },
    ]) {
      const r = bad(bounds)
      expect(r.badView).toBe(true)
      expect(r.objects).toEqual([])
      expect(r.capped).toBe(false)
    }
  })

  it('says badView for a viewport of no px, or of not a number of them', () => {
    for (const [w, h] of [
      [0, 800],
      [800, 0],
      [-5, 800],
      [NaN, 800],
      [800, Infinity],
    ]) {
      const r = bad(BOUNDS, w, h)
      expect(r.badView, `${w} by ${h}`).toBe(true)
      expect(r.objects).toEqual([])
    }
  })

  it('does not let the quadtree\'s RangeError out', () => {
    expect(() => bad({ xMin: 0, xMax: 1e-320, yMin: 0, yMax: 1 })).not.toThrow()
  })

  it('refuses a condition the kernel refuses, whatever the view: the error is the compile\'s own', () => {
    const z = condition('z < 1')
    expect(() => sampleRegion(z, comparisonsOf(z), { bounds: { xMin: NaN, xMax: 1, yMin: 0, yMax: 1 }, widthPx: 100, heightPx: 100 }, scopeOf(), ok)).toThrow()
  })

  it('refuses comparisons that are not the condition\'s own', () => {
    const two = condition('x < 1 and y < 1')
    expect(() => sampleRegion(two, comparisonsOf(condition('x < 1')), VIEW_800, scopeOf(), ok)).toThrow(/comparisons/)
    expect(() => sampleRegion(condition('x < 1'), comparisonsOf(condition('x > 1')), VIEW_800, scopeOf(), ok)).toThrow(/comparisons/)
  })
})

describe('sampleRegion: the spend, one budget for the whole statement', () => {
  it('draws every acceptance case uncapped, at FULL and at COARSE, inside the statement\'s budget', () => {
    for (const quality of ['full', 'coarse'] as const) {
      const tuning = quality === 'full' ? FULL : COARSE
      for (const text of ['1 < x^2 + y^2 < 4', 'x^2 + y^2 < 4 and y > 0', 'y < ln(x)', 'x*y > 1', 'y >= x^2', 'y < sqrt(x)', 'x < -5 or x > 5']) {
        const r = regionOf(text, { quality })
        expect(r.capped, `${text} ${quality}`).toBe(false)
        expect(r.stats.points, `${text} ${quality}`).toBeLessThan(tuning.statement.points)
        expect(r.stats.intervals, `${text} ${quality}`).toBeLessThan(tuning.statement.intervals)
      }
    }
  })

  it('costs, counted (points / twin evaluations, FULL then COARSE), under 1.5 times what it was measured to', () => {
    const measured: [string, number, number, number, number][] = [
      ['1 < x^2 + y^2 < 4', 12360, 4981, 3536, 1253],
      ['x^2 + y^2 < 4 and y > 0', 4541, 2465, 1317, 613],
      ['y < ln(x)', 18491, 6822, 5206, 1728],
      ['x*y > 1', 30600, 10131, 8704, 2491],
      ['y >= x^2', 19125, 6583, 5363, 1685],
    ]
    for (const [text, fp, fi, cp, ci] of measured) {
      const f = regionOf(text, { quality: 'full' })
      const c = regionOf(text, { quality: 'coarse' })
      expect(f.stats.points, text).toBeLessThan(1.5 * fp)
      expect(f.stats.intervals, text).toBeLessThan(1.5 * fi)
      expect(c.stats.points, text).toBeLessThan(1.5 * cp)
      expect(c.stats.intervals, text).toBeLessThan(1.5 * ci)
    }
  })

  it('draws on bigger leaves at the cap, all of it, and says so; the fill it draws is never a false one', () => {
    const budget = { points: 20000, intervals: 6000 }
    const full = regionOf('1 < x^2 + y^2 < 4')
    const r = regionOf('1 < x^2 + y^2 < 4', { budget })
    expect(r.capped).toBe(true)
    expect(r.badView).toBe(false)
    expect(r.drawnInView).toBe(true)
    expect(r.blankInView).toBe(false)
    expect(r.stats.points).toBeLessThanOrEqual(budget.points)
    expect(r.stats.intervals).toBeLessThanOrEqual(budget.intervals)
    // still the annulus, to a few percent, and with its two boundaries
    expect(near(outlineArea(r), 3 * Math.PI, 0.05)).toBe(true)
    expect(boundaryCurves(r).length).toBe(2)
    expect(falseFill(r, '1 < x^2 + y^2 < 4', ROOT, 450, 0.03)).toBe(0)
    // and it is coarser: fewer vertices than the fine one
    expect(ringsOf(r).flat().length).toBeLessThan(ringsOf(full).flat().length / 2)
  })

  it('never draws a false fill whatever the budget, and never blank without saying so', () => {
    for (const intervals of [1, 5, 50, 300, 1500, 4000]) {
      for (const text of ['1 < x^2 + y^2 < 4', 'x^2 + y^2 < 4 and y > 0', 'y < ln(x)', 'x*y > 1']) {
        const budget = { points: intervals * 6, intervals }
        const r = regionOf(text, { budget })
        expect(r.badView).toBe(false)
        expect(falseFill(r, text, ROOT, 200, 0.2), `${text} at ${intervals}`).toBe(0)
        if (r.capped) {
          // a picture with nothing in view says why: the picture was not resolved
          if (!r.drawnInView) expect(r.blankInView || regionObject(r).outline.length === 0, `${text} at ${intervals}`).toBe(true)
        }
      }
    }
  })

  it('draws a coarsened region as a smaller fill, never a false one: sin(x^2 + y^2) < 0.3 and sin(10x) < cos(10y), capped', () => {
    for (const [text, qualities] of [['sin(x^2 + y^2) < 0.3', ['full', 'coarse']], ['sin(10*x) < cos(10*y)', ['coarse']]] as const) {
      for (const quality of qualities) {
        const r = regionOf(text, { quality })
        expect(r.capped, `${text} ${quality}`).toBe(true)
        expect(falseFill(r, text, BOUNDS, 300, 0.05), `${text} ${quality}`).toBe(0)
      }
    }
  })

  it('says a blank view was starved, not empty: a budget too small to cut a leaf', () => {
    const r = regionOf('1 < x^2 + y^2 < 4', { budget: { points: 300, intervals: 120 } })
    expect(r.capped).toBe(true)
    expect(r.drawnInView).toBe(false)
    expect(r.blankInView).toBe(true)
  })

  it('does not say a region that is empty is starved', () => {
    const r = regionOf('x^2 + y^2 < -1')
    expect(r.drawnInView).toBe(false)
    expect(r.blankInView).toBe(false)
    expect(r.capped).toBe(false)
  })

  it('draws the coarse pass as the same region on bigger leaves, for about a quarter of the work', () => {
    const f = regionOf('1 < x^2 + y^2 < 4', { quality: 'full' })
    const c = regionOf('1 < x^2 + y^2 < 4', { quality: 'coarse' })
    expect(near(outlineArea(c), 3 * Math.PI, 0.01)).toBe(true)
    expect(c.stats.points).toBeLessThan(f.stats.points / 2.5)
    expect(ringsOf(c).flat().length).toBeLessThan(ringsOf(f).flat().length / 2)
  })
})
