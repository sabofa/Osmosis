import { describe, expect, it } from 'vitest'
import { authorPlane, authorToWorld, describeAuthorPlane, worldToAuthor } from './authorFrame'
import { ISOMETRIC_CAMERA, type Vec3 } from './project3d'
import { solidDimensionSegment } from './solids'

// S1 — authors write z-up; the solid-figure engine stays y-up inside. These
// tests pin the one map between the two, and what it means for a reader:
// X toward the viewer and left, Y right, Z up.

const SAMPLES: Vec3[] = [
  { x: 1, y: 2, z: 3 },
  { x: -4.5, y: 0.25, z: 7 },
  { x: 0, y: -1, z: 0 },
  { x: 1e-3, y: 1e3, z: -2.75 },
]

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function det3(c0: Vec3, c1: Vec3, c2: Vec3): number {
  // Columns c0, c1, c2: the images of the author basis vectors.
  return c0.x * (c1.y * c2.z - c2.y * c1.z) - c1.x * (c0.y * c2.z - c2.y * c0.z) + c2.x * (c0.y * c1.z - c1.y * c0.z)
}

describe('the author frame (S1)', () => {
  it('maps author (X, Y, Z) to internal (Y, Z, X), and back', () => {
    expect(authorToWorld({ x: 1, y: 2, z: 3 })).toEqual({ x: 2, y: 3, z: 1 })
    expect(worldToAuthor({ x: 2, y: 3, z: 1 })).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('has two maps that are inverses of each other on arbitrary points', () => {
    for (const p of SAMPLES) {
      expect(worldToAuthor(authorToWorld(p))).toEqual(p)
      expect(authorToWorld(worldToAuthor(p))).toEqual(p)
    }
  })

  it('is a proper rotation: determinant +1, and it preserves cross products', () => {
    const e = [authorToWorld({ x: 1, y: 0, z: 0 }), authorToWorld({ x: 0, y: 1, z: 0 }), authorToWorld({ x: 0, y: 0, z: 1 })]
    expect(det3(e[0], e[1], e[2])).toBe(1)
    // A reflection would satisfy the inverse test above and still mirror
    // every drawing; the cross product is what tells them apart.
    for (const a of SAMPLES) {
      for (const b of SAMPLES) {
        const lhs = authorToWorld(cross(a, b))
        const rhs = cross(authorToWorld(a), authorToWorld(b))
        expect(lhs.x).toBeCloseTo(rhs.x, 9)
        expect(lhs.y).toBeCloseTo(rhs.y, 9)
        expect(lhs.z).toBeCloseTo(rhs.z, 9)
      }
    }
  })

  it("puts the isometric camera in the author's (+,+,+) octant", () => {
    const d = worldToAuthor(ISOMETRIC_CAMERA.direction)
    const k = 1 / Math.sqrt(3)
    expect(d.x).toBeCloseTo(k, 12)
    expect(d.y).toBeCloseTo(k, 12)
    expect(d.z).toBeCloseTo(k, 12)
  })

  it('maps each author axis-plane to the internal one', () => {
    expect(authorPlane('z', 1)).toEqual({ axis: 'y', at: 1 })
    expect(authorPlane('x', 2)).toEqual({ axis: 'z', at: 2 })
    expect(authorPlane('y', -3)).toEqual({ axis: 'x', at: -3 })
  })

  it('describes an internal plane in the author frame, for error messages', () => {
    expect(describeAuthorPlane({ axis: 'y', at: 1 })).toBe('z = 1')
    expect(describeAuthorPlane({ axis: 'z', at: 2 })).toBe('x = 2')
    expect(describeAuthorPlane({ axis: 'x', at: -3 })).toBe('y = -3')
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(describeAuthorPlane(authorPlane(axis, 4))).toBe(`${axis} = 4`)
    }
  })

  it("runs a prism's width along Y, its depth along X and its height along Z", () => {
    const spec = { kind: 'prism' as const, width: 8, height: 5, depth: 6 }
    const along = (dimension: string): Vec3 => {
      const segment = solidDimensionSegment(spec, dimension)
      if (!segment) throw new Error(`no ${dimension}`)
      const [a, b] = segment.map(worldToAuthor)
      return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    }
    expect(along('width')).toEqual({ x: 0, y: 8, z: 0 })
    expect(along('depth')).toEqual({ x: 6, y: 0, z: 0 })
    expect(along('height')).toEqual({ x: 0, y: 0, z: 5 })
  })
})
