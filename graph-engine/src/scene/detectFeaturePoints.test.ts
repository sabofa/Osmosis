import { describe, expect, it } from 'vitest'
import { detectFeaturePoints } from './detectFeaturePoints'

describe('detectFeaturePoints', () => {
  it('finds no points when no kinds are requested', () => {
    const points = [{ x: -1, y: -1 }, { x: 1, y: 1 }]
    expect(detectFeaturePoints(points, new Set())).toEqual([])
  })

  it('finds an x-axis and y-axis intercept on a line through the origin', () => {
    const points = [{ x: -2, y: -2 }, { x: 0, y: 0 }, { x: 2, y: 2 }]
    const found = detectFeaturePoints(points, new Set(['intercepts']))
    expect(found).toContainEqual({ x: 0, y: 0 })
  })

  it('finds a y-intercept via linear interpolation on a sampled curve', () => {
    // y = x - 1, sampled coarsely: crosses y=0 at x=1
    const points = [{ x: 0, y: -1 }, { x: 2, y: 1 }]
    const found = detectFeaturePoints(points, new Set(['intercepts']))
    expect(found.some((p) => Math.abs(p.x - 1) < 1e-9 && p.y === 0)).toBe(true)
  })

  it('finds a local minimum vertex', () => {
    // y = x^2 sampled around x=0
    const points = [{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }]
    const found = detectFeaturePoints(points, new Set(['vertices']))
    expect(found).toContainEqual({ x: 0, y: 0 })
  })

  it('does not report a monotonic segment as a vertex', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]
    expect(detectFeaturePoints(points, new Set(['vertices']))).toEqual([])
  })
})
