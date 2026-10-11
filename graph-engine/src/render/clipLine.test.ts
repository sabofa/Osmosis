import { describe, expect, it } from 'vitest'
import { clipLineToBounds } from './clipLine'

const VIEW = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 }

describe('clipLineToBounds', () => {
  it('clips an infinite non-axis-aligned line to the view, symmetrically about a point on it', () => {
    // Through the origin with slope 1/2: it leaves the box through the left
    // and right walls at x = -10 and x = 10, so y = -5 and y = 5.
    const clipped = clipLineToBounds({ x: 0, y: 0 }, { x: 2, y: 1 }, 'infinite', VIEW)
    expect(clipped).not.toBeNull()
    const [from, to] = clipped as [{ x: number; y: number }, { x: number; y: number }]
    expect(from.x).toBeCloseTo(-10, 10)
    expect(from.y).toBeCloseTo(-5, 10)
    expect(to.x).toBeCloseTo(10, 10)
    expect(to.y).toBeCloseTo(5, 10)
  })

  it('leaves through the top and bottom walls when the slope is steep', () => {
    const clipped = clipLineToBounds({ x: 0, y: 0 }, { x: 1, y: 4 }, 'infinite', VIEW)
    const [from, to] = clipped as [{ x: number; y: number }, { x: number; y: number }]
    expect(from.y).toBeCloseTo(-10, 10)
    expect(from.x).toBeCloseTo(-2.5, 10)
    expect(to.y).toBeCloseTo(10, 10)
    expect(to.x).toBeCloseTo(2.5, 10)
  })

  it('re-clips to a different answer when the bounds change', () => {
    const through = { x: 0, y: 0 }
    const direction = { x: 2, y: 1 }
    const wide = clipLineToBounds(through, direction, 'infinite', VIEW)
    const zoomed = clipLineToBounds(through, direction, 'infinite', { xMin: -2, xMax: 2, yMin: -2, yMax: 2 })
    const panned = clipLineToBounds(through, direction, 'infinite', { xMin: 100, xMax: 120, yMin: 50, yMax: 60 })

    expect(zoomed).not.toBeNull()
    expect((zoomed as [{ x: number }, { x: number }])[1].x).toBeCloseTo(2, 10)
    // The same stored object gives a different drawn extent under each view —
    // which is the whole reason the scene keeps the line unclipped.
    expect((wide as [{ x: number }, { x: number }])[1].x).not.toBeCloseTo(2, 3)
    // Panned along the line, it is still visible, and at the panned position.
    expect(panned).not.toBeNull()
    expect((panned as [{ x: number }, { x: number }])[0].x).toBeCloseTo(100, 10)
  })

  it('returns null for a line that misses the view entirely', () => {
    // Horizontal at y = 50, far above the box.
    expect(clipLineToBounds({ x: 0, y: 50 }, { x: 1, y: 0 }, 'infinite', VIEW)).toBeNull()
    // ...and a non-axis-aligned one that passes the corner outside it.
    expect(clipLineToBounds({ x: 0, y: 40 }, { x: 2, y: 1 }, 'infinite', VIEW)).toBeNull()
  })

  it('draws a ray only forward from its origin', () => {
    // Origin inside the view, pointing up-right: the drawn piece starts at
    // the origin itself, not at the far wall behind it.
    const clipped = clipLineToBounds({ x: 0, y: 0 }, { x: 2, y: 1 }, 'ray', VIEW)
    const [from, to] = clipped as [{ x: number; y: number }, { x: number; y: number }]
    expect(from.x).toBeCloseTo(0, 10)
    expect(from.y).toBeCloseTo(0, 10)
    expect(to.x).toBeCloseTo(10, 10)
    expect(to.y).toBeCloseTo(5, 10)
  })

  it('clips a ray whose origin is outside the view but which enters it', () => {
    const clipped = clipLineToBounds({ x: -40, y: -20 }, { x: 2, y: 1 }, 'ray', VIEW)
    const [from, to] = clipped as [{ x: number; y: number }, { x: number; y: number }]
    expect(from.x).toBeCloseTo(-10, 10)
    expect(from.y).toBeCloseTo(-5, 10)
    expect(to.x).toBeCloseTo(10, 10)
  })

  it('returns null for a ray pointing away from the view', () => {
    expect(clipLineToBounds({ x: 40, y: 20 }, { x: 2, y: 1 }, 'ray', VIEW)).toBeNull()
  })

  it('returns null for a zero-length direction rather than dividing by it', () => {
    expect(clipLineToBounds({ x: 0, y: 0 }, { x: 0, y: 0 }, 'infinite', VIEW)).toBeNull()
  })
})
