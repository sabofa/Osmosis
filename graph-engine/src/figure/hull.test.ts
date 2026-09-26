import { describe, expect, it } from 'vitest'
import { maxOutsideDistance } from './convexity.testkit'
import { hullOf } from './hull'
import { faceNormal, type Solid3D, type Vec3 } from './project3d'

// P3 — the one exact convex-hull builder. Every expectation is about the
// polyhedron's STRUCTURE (how many faces, of how many sides, wound which
// way), because a hull that returns "some faces" is still wrong if a cube's
// face comes back as two triangles.

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

const CUBE_NAMES = 'ABCDEFGH'.split('')
const CUBE: Vec3[] = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0), v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)]

function centroidOf(points: Vec3[]): Vec3 {
  const n = points.length
  return points.reduce((acc, p) => v(acc.x + p.x / n, acc.y + p.y / n, acc.z + p.z / n), v(0, 0, 0))
}

function edgeCount(solid: Solid3D): number {
  const edges = new Set<string>()
  for (const face of solid.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`)
    }
  }
  return edges.size
}

// A face as its names, rotated to start at the alphabetically first, winding
// kept — so two lists of faces over the same NAMES compare as sets however
// the input was ordered.
function nameCycles(solid: Solid3D, names: string[]): string[] {
  return solid.faces
    .map((face) => {
      const cycle = face.map((i) => names[i])
      let start = 0
      for (let i = 1; i < cycle.length; i++) if (cycle[i] < cycle[start]) start = i
      return [...cycle.slice(start), ...cycle.slice(0, start)].join('')
    })
    .sort()
}

describe('the unit cube as a hull', () => {
  const cube = hullOf(CUBE, CUBE_NAMES)

  it('has six faces, each ONE quad — never two triangles', () => {
    expect(cube.faces).toHaveLength(6)
    for (const face of cube.faces) expect(face).toHaveLength(4)
  })

  it('has exactly twelve edges', () => {
    expect(edgeCount(cube)).toBe(12)
  })

  it('winds every face counter-clockwise from outside: its normal points away from the centre', () => {
    const centre = centroidOf(CUBE)
    cube.faces.forEach((face, f) => {
      const n = faceNormal(cube, f)
      const faceCentre = centroidOf(face.map((i) => CUBE[i]))
      const out = (faceCentre.x - centre.x) * n.x + (faceCentre.y - centre.y) * n.y + (faceCentre.z - centre.z) * n.z
      expect(out).toBeGreaterThan(0)
    })
  })

  it('keeps the input order as the vertex order', () => {
    expect(cube.vertices).toEqual(CUBE)
  })

  it('starts each face at its lowest vertex and sorts the faces by their sequences', () => {
    for (const face of cube.faces) expect(face[0]).toBe(Math.min(...face))
    const keys = cube.faces.map((face) => face.join(','))
    const sorted = cube.faces
      .slice()
      .sort((a, b) => {
        for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
        return a.length - b.length
      })
      .map((face) => face.join(','))
    expect(keys).toEqual(sorted)
  })
})

describe('other hulls', () => {
  it('builds a regular octahedron as eight triangles', () => {
    const points = [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)]
    const octahedron = hullOf(points, 'ABCDEF'.split(''))
    expect(octahedron.faces).toHaveLength(8)
    for (const face of octahedron.faces) expect(face).toHaveLength(3)
    expect(edgeCount(octahedron)).toBe(12)
  })

  it('builds a square pyramid from five points as one quad and four triangles', () => {
    const points = [v(0, 0, 0), v(2, 0, 0), v(2, 2, 0), v(0, 2, 0), v(1, 1, 3)]
    const pyramid = hullOf(points, 'ABCDE'.split(''))
    expect(pyramid.faces.map((face) => face.length).sort()).toEqual([3, 3, 3, 3, 4])
  })
})

describe('what the hull refuses, naming the point', () => {
  it('refuses a ninth point at the centre of the cube: it is inside', () => {
    expect(() => hullOf([...CUBE, v(0.5, 0.5, 0.5)], [...CUBE_NAMES, 'I'])).toThrow(
      /I lies inside the solid on A-B-C-D-E-F-G-H-I, so it is not a corner — every named vertex must be a corner/
    )
  })

  it('refuses a point at the middle of an edge: it is on an edge, not a corner', () => {
    expect(() => hullOf([...CUBE, v(0.5, 0, 0)], [...CUBE_NAMES, 'M'])).toThrow(/M lies on an edge of the solid .* not a corner/)
  })

  it('refuses a point in the middle of a face', () => {
    expect(() => hullOf([...CUBE, v(0.5, 0.5, 0)], [...CUBE_NAMES, 'P'])).toThrow(/P lies on a face of the solid .* not a corner/)
  })

  it('refuses four coplanar points: a solid needs volume', () => {
    expect(() => hullOf([v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0)], 'ABCD'.split(''))).toThrow(
      /The points A-B-C-D all lie in one plane — a solid needs volume/
    )
  })

  it('refuses three points', () => {
    expect(() => hullOf([v(0, 0, 0), v(1, 0, 0), v(0, 1, 0)], 'ABC'.split(''))).toThrow(/at least 4 corners/)
  })

  it('refuses two names at one place', () => {
    expect(() => hullOf([...CUBE, v(1, 1, 1)], [...CUBE_NAMES, 'J'])).toThrow(/G and J are the same point/)
  })
})

describe('determinism', () => {
  it('gives an identical face list for the same input in the same order', () => {
    expect(JSON.stringify(hullOf(CUBE, CUBE_NAMES))).toBe(JSON.stringify(hullOf(CUBE, CUBE_NAMES)))
  })

  it('gives the same SET of faces for a permuted input', () => {
    const order = [5, 2, 7, 0, 3, 6, 1, 4]
    const permuted = hullOf(
      order.map((i) => CUBE[i]),
      order.map((i) => CUBE_NAMES[i])
    )
    expect(nameCycles(permuted, order.map((i) => CUBE_NAMES[i]))).toEqual(nameCycles(hullOf(CUBE, CUBE_NAMES), CUBE_NAMES))
  })
})

// A fixed-seed generator (mulberry32). The seed is a test INPUT — it fixes
// which point sets are tried — and never an answer.
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('the convexity invariant over hulls (H4)', () => {
  const next = random(20260926)
  for (let trial = 0; trial < 20; trial++) {
    // 5 to 12 points on a sphere of radius 3 about an off-origin centre: all
    // in convex position, so every one is a corner.
    const count = 5 + Math.floor(next() * 8)
    const points: Vec3[] = []
    for (let i = 0; i < count; i++) {
      const z = 2 * next() - 1
      const phi = 2 * Math.PI * next()
      const r = Math.sqrt(1 - z * z)
      points.push(v(1 + 3 * r * Math.cos(phi), -2 + 3 * r * Math.sin(phi), 0.5 + 3 * z))
    }
    it(`holds for random set ${trial} (${count} points)`, () => {
      const hull = hullOf(
        points,
        points.map((_, i) => `P${i}`)
      )
      expect(maxOutsideDistance(hull)).toBeLessThan(1e-9)
      // A closed polyhedron: Euler's V - E + F = 2.
      expect(hull.vertices.length - edgeCount(hull) + hull.faces.length).toBe(2)
    })
  }
})
