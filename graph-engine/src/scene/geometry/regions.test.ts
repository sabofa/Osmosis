import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../types'
import { arcBetween } from './circles'
import { circle } from './objects'
import {
  circularSegmentRegion,
  combineRegions,
  diskRegion,
  interiorLabelPoint,
  loopArea,
  polygonRegion,
  regionArea,
  sectorRegion,
  type Region,
} from './regions'

// Phase 12 (F1–F3) — the region engine. Every expected area below is worked
// by hand from the figure, never read back off the engine:
//
//   triangle (0,0),(4,0),(0,3)          ½·4·3                         = 6
//   unit disk                           π·1²                          = π
//   sector r = 2, 90°                   ½·2²·(π/2)                    = π
//   circular segment r = 2, 90°         ½·2²·(π/2 − sin(π/2))         = π − 2
//   square side 4 minus inscribed r = 2 4² − π·2²                     = 16 − 4π
//   annulus R = 3, r = 2                π(9 − 4)                      = 5π
//   lens, unit circles 1 apart          2·(½·1²·(2π/3 − sin(2π/3)))   = 2π/3 − √3/2
//     (each circle's chord through the two crossings subtends 120° at its centre)
//   crescent                            π − lens                      = π/3 + √3/2
//   arbelos, R = 2 minus two r = 1      ½π·4 − 2·(½π·1)               = π
//   two 2×2 squares sharing an edge     4 + 4                         = 8
//   two 2×2 squares offset by (1, 1)    4 + 4 − 1·1                   = 7

const P = (x: number, y: number): Vec2 => ({ x, y })

function square(x: number, y: number, side: number): Region {
  return polygonRegion([P(x, y), P(x + side, y), P(x + side, y + side), P(x, y + side)])
}

const CLOSE = 12

describe('primitives and their exact areas (F1, F3)', () => {
  it('a triangle', () => {
    expect(regionArea(polygonRegion([P(0, 0), P(4, 0), P(0, 3)]))).toBeCloseTo(6, CLOSE)
  })

  it('a triangle written clockwise is turned counter-clockwise, so its area is still positive', () => {
    const region = polygonRegion([P(0, 0), P(0, 3), P(4, 0)])
    expect(regionArea(region)).toBeCloseTo(6, CLOSE)
    expect(region.loops).toHaveLength(1)
  })

  it('the unit disk', () => {
    expect(regionArea(diskRegion(circle(P(0, 0), 1)))).toBeCloseTo(Math.PI, CLOSE)
  })

  it('a sector of radius 2 and 90 degrees', () => {
    const arc = arcBetween(circle(P(0, 0), 2), P(2, 0), P(0, 2), 'minor')
    expect(regionArea(sectorRegion(arc))).toBeCloseTo(Math.PI, CLOSE)
  })

  it('a circular segment of radius 2 and 90 degrees', () => {
    const arc = arcBetween(circle(P(0, 0), 2), P(2, 0), P(0, 2), 'minor')
    expect(regionArea(circularSegmentRegion(arc))).toBeCloseTo(Math.PI - 2, CLOSE)
  })

  it('a sector and a segment drawn clockwise are the same regions as drawn counter-clockwise', () => {
    const cw = arcBetween(circle(P(0, 0), 2), P(0, 2), P(2, 0), 'cw')
    expect(regionArea(sectorRegion(cw))).toBeCloseTo(Math.PI, CLOSE)
    expect(regionArea(circularSegmentRegion(cw))).toBeCloseTo(Math.PI - 2, CLOSE)
  })

  it('a major sector', () => {
    const arc = arcBetween(circle(P(0, 0), 2), P(2, 0), P(0, 2), 'major')
    expect(regionArea(sectorRegion(arc))).toBeCloseTo(3 * Math.PI, CLOSE)
  })
})

describe('booleans over segments and arcs (F2)', () => {
  it('a square minus its inscribed circle: 16 − 4π, one outer loop and one hole', () => {
    const region = combineRegions('difference', square(-2, -2, 4), diskRegion(circle(P(0, 0), 2)))
    expect(regionArea(region)).toBeCloseTo(16 - 4 * Math.PI, CLOSE)
    expect(region.loops).toHaveLength(2)
    const outer = region.loops.filter((loop) => loopArea(loop) > 0)
    const holes = region.loops.filter((loop) => loopArea(loop) < 0)
    expect(outer).toHaveLength(1)
    expect(holes).toHaveLength(1)
    // The square's sides were split where the circle touches them and are
    // merged back; the circle's four quarter arcs are merged into one turn.
    expect(outer[0].map((piece) => piece.kind)).toEqual(['segment', 'segment', 'segment', 'segment'])
    expect(loopArea(outer[0])).toBeCloseTo(16, CLOSE)
    expect(holes[0].map((piece) => piece.kind)).toEqual(['arc'])
    expect(loopArea(holes[0])).toBeCloseTo(-4 * Math.PI, CLOSE)
  })

  it('an annulus: 5π, the hole found by containment with no intersection points', () => {
    const region = combineRegions('difference', diskRegion(circle(P(0, 0), 3)), diskRegion(circle(P(0, 0), 2)))
    expect(regionArea(region)).toBeCloseTo(5 * Math.PI, CLOSE)
    expect(region.loops).toHaveLength(2)
    expect(region.loops.map((loop) => Math.sign(loopArea(loop))).sort()).toEqual([-1, 1])
  })

  it('two disks touching from outside unite into two loops, not one figure of eight', () => {
    // r = 2 at the origin and r = 1 at (0, 3) touch at (0, 2): 4π + π.
    const region = combineRegions('union', diskRegion(circle(P(0, 0), 2)), diskRegion(circle(P(0, 3), 1)))
    expect(regionArea(region)).toBeCloseTo(5 * Math.PI, CLOSE)
    expect(region.loops).toHaveLength(2)
    expect(region.loops.map((loop) => loopArea(loop)).sort((a, b) => a - b)).toEqual([
      expect.closeTo(Math.PI, CLOSE),
      expect.closeTo(4 * Math.PI, CLOSE),
    ])
  })

  it('a disk minus a disk it does not meet is the first disk, whole', () => {
    const region = combineRegions('difference', diskRegion(circle(P(0, 0), 1)), diskRegion(circle(P(5, 0), 1)))
    expect(regionArea(region)).toBeCloseTo(Math.PI, CLOSE)
    expect(region.loops).toHaveLength(1)
  })

  it('the lens of two unit circles 1 apart: 2π/3 − √3/2, one loop of two arcs', () => {
    const region = combineRegions('intersection', diskRegion(circle(P(0, 0), 1)), diskRegion(circle(P(1, 0), 1)))
    expect(regionArea(region)).toBeCloseTo((2 * Math.PI) / 3 - Math.sqrt(3) / 2, CLOSE)
    expect(region.loops).toHaveLength(1)
    expect(region.loops[0].map((piece) => piece.kind)).toEqual(['arc', 'arc'])
  })

  it('the crescent: π/3 + √3/2', () => {
    const region = combineRegions('difference', diskRegion(circle(P(0, 0), 1)), diskRegion(circle(P(1, 0), 1)))
    expect(regionArea(region)).toBeCloseTo(Math.PI / 3 + Math.sqrt(3) / 2, CLOSE)
    expect(region.loops).toHaveLength(1)
  })

  it('the arbelos: π — a shared diameter, shared endpoints and tangent arcs', () => {
    const big = circularSegmentRegion(arcBetween(circle(P(0, 0), 2), P(2, 0), P(-2, 0), 'ccw'))
    const left = circularSegmentRegion(arcBetween(circle(P(-1, 0), 1), P(0, 0), P(-2, 0), 'ccw'))
    const right = circularSegmentRegion(arcBetween(circle(P(1, 0), 1), P(2, 0), P(0, 0), 'ccw'))
    expect(regionArea(big)).toBeCloseTo(2 * Math.PI, CLOSE)
    const region = combineRegions('difference', combineRegions('difference', big, left), right)
    expect(regionArea(region)).toBeCloseTo(Math.PI, CLOSE)
    // Nothing is left on the diameter: the boundary is the three arcs.
    expect(region.loops).toHaveLength(1)
    expect(region.loops[0].map((piece) => piece.kind)).toEqual(['arc', 'arc', 'arc'])
  })
})

describe('the exact winding number', () => {
  // The disk of radius 5 united with the rectangle [2, 7] × [−3, 3]: the
  // circle is cut at (4, ±3) (a 3-4-5 triangle, so exactly), leaving a major
  // arc whose chord is the line x = 4. The square [3, 5] × [0, 2] lies inside
  // it and meets its boundary nowhere, and its first side's midpoint, (4, 0),
  // is exactly on that chord — where the chord alone sees its two ends in
  // opposite directions and cannot say which way round the arc went.
  it('classifies a point exactly on the chord of an arc by the arc', () => {
    const b = combineRegions('union', diskRegion(circle(P(0, 0), 5)), polygonRegion([P(2, -3), P(7, -3), P(7, 3), P(2, 3)]))
    const a = square(3, 0, 2)
    expect(regionArea(combineRegions('intersection', a, b))).toBeCloseTo(4, CLOSE)
    expect(() => combineRegions('difference', a, b)).toThrow(/nothing to shade/)
    // The same shape as a HOLE in a larger square: its arc now runs
    // clockwise, and the chord alone would read the half turn the wrong way.
    const holed = combineRegions('difference', square(-10, -10, 20), b)
    expect(regionArea(combineRegions('difference', a, holed))).toBeCloseTo(4, CLOSE)
    expect(() => combineRegions('intersection', a, holed)).toThrow(/nothing to shade/)
  })
})

describe('coincident boundaries (F2)', () => {
  it('two 2×2 squares sharing an edge unite into one loop of four sides, area 8', () => {
    const region = combineRegions('union', square(0, 0, 2), square(2, 0, 2))
    expect(regionArea(region)).toBeCloseTo(8, CLOSE)
    expect(region.loops).toHaveLength(1)
    expect(region.loops[0].map((piece) => piece.kind)).toEqual(['segment', 'segment', 'segment', 'segment'])
  })

  it('two 2×2 squares offset by (1, 1) unite to area 7', () => {
    const region = combineRegions('union', square(0, 0, 2), square(1, 1, 2))
    expect(regionArea(region)).toBeCloseTo(7, CLOSE)
    expect(region.loops).toHaveLength(1)
  })

  it('a square minus a square sharing one of its edges keeps that edge', () => {
    const region = combineRegions('difference', square(0, 0, 2), square(2, 0, 2))
    expect(regionArea(region)).toBeCloseTo(4, CLOSE)
    expect(region.loops[0]).toHaveLength(4)
  })

  it('a square minus the same square is refused as empty', () => {
    expect(() => combineRegions('difference', square(0, 0, 2), square(0, 0, 2), 'square ABCD minus square ABCD')).toThrow(
      'square ABCD minus square ABCD leaves nothing to shade'
    )
  })
})

describe('polygons must be simple (F1)', () => {
  it('refuses the bow-tie, naming the crossing edges', () => {
    expect(() => polygonRegion([P(0, 0), P(2, 2), P(2, 0), P(0, 2)], ['A', 'B', 'C', 'D'])).toThrow(/A-B and C-D cross/)
  })

  it('refuses a repeated point and a polygon with no area', () => {
    expect(() => polygonRegion([P(0, 0), P(0, 0), P(1, 1)], ['A', 'B', 'C'])).toThrow(/A and B are the same point/)
    expect(() => polygonRegion([P(0, 0), P(1, 1), P(2, 2)], ['A', 'B', 'C'])).toThrow(/no area/)
  })
})

describe('F6 — the interior point an area label hangs at', () => {
  // By hand (see figure/area.test.ts for the working): the seven lines at
  // i·h/8 up the largest component, the longest inside chord's midpoint,
  // ties to the lowest line, then the leftmost chord.
  it('an annulus: (0, −2.25), in the ring', () => {
    const p = interiorLabelPoint(combineRegions('difference', diskRegion(circle(P(0, 0), 3)), diskRegion(circle(P(0, 0), 2))))
    expect(p.x).toBeCloseTo(0, CLOSE)
    expect(p.y).toBeCloseTo(-2.25, CLOSE)
  })

  it('a square minus its inscribed circle: (−(2 + √1.75)/2, −1.5)', () => {
    const p = interiorLabelPoint(combineRegions('difference', square(-2, -2, 4), diskRegion(circle(P(0, 0), 2))))
    expect(p.x).toBeCloseTo(-(2 + Math.sqrt(1.75)) / 2, CLOSE)
    expect(p.y).toBeCloseTo(-1.5, CLOSE)
  })

  it('the largest component: a unit disk beside a 2×2 square hangs in the square, on its lowest line', () => {
    // π < 4, so the square; every line's chord is the square's width, 2, and
    // the lowest line is y = −1 + 2/8 = −0.75.
    const p = interiorLabelPoint(combineRegions('union', diskRegion(circle(P(0, 0), 1)), square(3, -1, 2)))
    expect(p.x).toBeCloseTo(4, CLOSE)
    expect(p.y).toBeCloseTo(-0.75, CLOSE)
  })
})

describe('determinism', () => {
  it('the same input gives identical piece lists', () => {
    const build = () => combineRegions('difference', square(-2, -2, 4), diskRegion(circle(P(0, 0), 2)))
    expect(build()).toEqual(build())
  })

  it('swapping the operands of a commutative operator gives the same area', () => {
    const a = diskRegion(circle(P(0, 0), 1))
    const b = square(0, -0.5, 2)
    expect(regionArea(combineRegions('union', a, b))).toBeCloseTo(regionArea(combineRegions('union', b, a)), CLOSE)
    expect(regionArea(combineRegions('intersection', a, b))).toBeCloseTo(regionArea(combineRegions('intersection', b, a)), CLOSE)
  })
})
