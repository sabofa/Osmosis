import { describe, expect, it } from 'vitest'
import { angleArcPoints, angleBisectorPoint, rightAngleSquarePoints, tickMarkSegments } from './geometryMarks'

describe('angleArcPoints', () => {
  it('sweeps a 90-degree interior angle from one ray to the other', () => {
    const points = angleArcPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 1, 4)
    expect(points[0].x).toBeCloseTo(1, 5)
    expect(points[0].y).toBeCloseTo(0, 5)
    expect(points[points.length - 1].x).toBeCloseTo(0, 5)
    expect(points[points.length - 1].y).toBeCloseTo(1, 5)
  })

  // Regression guard for the "always sweep the interior angle" design: a
  // naive end-start (no wraparound normalization) would sweep the *reflex*
  // (270-degree) angle here instead of the 90-degree interior one, since
  // atan2 for (0,-1) is -pi/2 and for (1,0) is 0, a raw difference of pi/2 —
  // that particular case coincidentally comes out right, so this uses an
  // obtuse case (135 degrees) that actually exercises the wraparound.
  it('sweeps the shorter (interior) angle, not the reflex angle, for an obtuse vertex', () => {
    const from = { x: 1, y: 0 }
    const to = { x: -1, y: 1 } // 135 degrees counureclockwise from `from`
    const points = angleArcPoints({ x: 0, y: 0 }, from, to, 1, 8)
    // Every sampled point should sit on the unit circle within the swept
    // 135-degree wedge (angle in [0, 3pi/4]), never in the reflex remainder.
    for (const p of points) {
      const angle = Math.atan2(p.y, p.x)
      const normalized = angle < -1e-6 ? angle + 2 * Math.PI : angle
      expect(normalized).toBeGreaterThanOrEqual(-1e-6)
      expect(normalized).toBeLessThanOrEqual((3 * Math.PI) / 4 + 1e-6)
    }
  })

  it('is independent of which ray is passed as from vs to (same arc, reversed order)', () => {
    const a = angleArcPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 1, 4)
    const b = angleArcPoints({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, 1, 4)
    // Same two endpoints, swept in the opposite direction.
    expect(a[0].x).toBeCloseTo(b[b.length - 1].x, 5)
    expect(a[0].y).toBeCloseTo(b[b.length - 1].y, 5)
  })
})

describe('angleBisectorPoint', () => {
  it('sits exactly between the two rays for a 90-degree angle', () => {
    const p = angleBisectorPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 1)
    expect(p.x).toBeCloseTo(Math.SQRT1_2, 5)
    expect(p.y).toBeCloseTo(Math.SQRT1_2, 5)
  })
})

describe('rightAngleSquarePoints', () => {
  it('builds the small square offset from an axis-aligned vertex', () => {
    const [p1, corner, p2] = rightAngleSquarePoints({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }, 1)
    expect(p1).toEqual({ x: 1, y: 0 })
    expect(p2).toEqual({ x: 0, y: 1 })
    expect(corner.x).toBeCloseTo(1, 5)
    expect(corner.y).toBeCloseTo(1, 5)
  })
})

describe('tickMarkSegments', () => {
  it('draws a single tick centered on the segment midpoint, perpendicular to it', () => {
    const segments = tickMarkSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 0.5, 0.3)
    expect(segments).toHaveLength(1)
    const [a, b] = segments[0]
    // Midpoint of the tick itself should be the segment's own midpoint.
    expect((a.x + b.x) / 2).toBeCloseTo(5, 5)
    expect((a.y + b.y) / 2).toBeCloseTo(0, 5)
    // Perpendicular to a horizontal segment means purely vertical.
    expect(a.x).toBeCloseTo(b.x, 5)
    expect(Math.abs(a.y - b.y)).toBeCloseTo(1, 5) // 2 * tickLength
  })

  it('spaces multiple ticks symmetrically around the midpoint', () => {
    const segments = tickMarkSegments({ x: 0, y: 0 }, { x: 10, y: 0 }, 2, 0.5, 1)
    expect(segments).toHaveLength(2)
    const centerX = (c: [{ x: number }, { x: number }]) => (c[0].x + c[1].x) / 2
    const midpointOfCenters = (centerX(segments[0]) + centerX(segments[1])) / 2
    expect(midpointOfCenters).toBeCloseTo(5, 5)
    expect(Math.abs(centerX(segments[0]) - centerX(segments[1]))).toBeCloseTo(1, 5) // the gap
  })
})
