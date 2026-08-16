import { describe, expect, it } from 'vitest'
import { traceImplicitCurve, traceImplicitRegion } from './marchingSquares'

const bounds = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }
const circle = (x: number, y: number) => x * x + y * y - 4 // r = 2

describe('traceImplicitCurve', () => {
  it('traces a circle whose boundary points all sit close to the true radius', () => {
    const segments = traceImplicitCurve(circle, bounds, 80)
    expect(segments.length).toBeGreaterThan(0)
    for (const [a, b] of segments) {
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(2, 1)
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(2, 1)
    }
  })

  it('produces no segments when the function never crosses zero over the bounds', () => {
    const alwaysPositive = () => 1
    expect(traceImplicitCurve(alwaysPositive, bounds, 20)).toEqual([])
  })
})

describe('traceImplicitRegion', () => {
  it('fills a circle with a triangle area close to pi*r^2', () => {
    // traceImplicitRegion fills where f > 0, so the *inside* of the r=2
    // circle needs the sign flipped relative to the boundary-only f above
    // (same "flip" buildRegion does in buildScene.ts for "<"/"<=").
    const insideCircle = (x: number, y: number) => -circle(x, y)
    const { triangles, boundarySegments } = traceImplicitRegion(insideCircle, bounds, 120)
    expect(boundarySegments.length).toBeGreaterThan(0)
    let area = 0
    for (let i = 0; i < triangles.length; i += 3) {
      const [p0, p1, p2] = [triangles[i], triangles[i + 1], triangles[i + 2]]
      area += Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) / 2
    }
    expect(area).toBeCloseTo(Math.PI * 4, 0)
  })

  it('fills nothing when the function is negative everywhere', () => {
    const { triangles, boundarySegments } = traceImplicitRegion(() => -1, bounds, 20)
    expect(triangles).toEqual([])
    expect(boundarySegments).toEqual([])
  })
})
