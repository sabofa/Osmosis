import { describe, expect, it } from 'vitest'
import { arrowsOf, expectClose, expectParallel, kernelOf, labelOf, lineOf, meshOf, pointsOf, sceneOf, vertices } from './testing'

// f = x^2 - y^2 at (1, 2): ∇f = (2, -4), |∇f| = √20 = 4.472, f = -3. A tool
// is drawn beside its surface, which sizes the box (the box pass, J1): the
// surface z = x^2 - y^2 over [-5, 5]^2, written after the tool so the tool
// keeps line 1, spans z in [-25, 25], so the box floor is z = -25.
const SADDLE = '\nz = x^2 - y^2'

// The distance from p to the nearest segment of a polyline in the plane.
function distanceToPolyline(p: readonly number[], points: readonly (readonly number[])[]): number {
  let best = Infinity
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]))
  }
  return best
}

describe('gradient: x^2 - y^2 at (1, 2)', () => {
  const scene = sceneOf(`gradient: x^2 - y^2 at (1, 2)${SADDLE}`)

  it('draws ∇f = (2, -4, 0) at true length from (1, 2) on the floor', () => {
    expect(scene.errors).toEqual([])
    const arrow = arrowsOf(scene, 's1')
    expect(Array.from(arrow.tails)).toEqual([1, 2, -25])
    expect(Array.from(arrow.vectors)).toEqual([2, -4, 0])
  })

  it('draws the level curve through (1, 2) on the floor: x^2 - y^2 = -3', () => {
    const level = lineOf(scene, 's1.level')
    const points = vertices(level.positions)
    for (const [x, y, z] of points) {
      expect(z).toBe(-25)
      expect(Math.abs(x * x - y * y + 3)).toBeLessThanOrEqual(1e-8)
    }
    // The branch through (1, 2) is one polyline; (1, 2) is on it to the
    // chord error of a 1/16 grid.
    let nearest = Infinity
    for (let k = 0; k < level.starts.length; k++) {
      const end = k + 1 < level.starts.length ? level.starts[k + 1] : points.length
      nearest = Math.min(nearest, distanceToPolyline([1, 2], points.slice(level.starts[k], end)))
    }
    expect(nearest).toBeLessThan(1e-3)
  })

  it('marks the right angle where they meet: sides of 0.04 x 10 = 0.4 along the level curve and along ∇f', () => {
    const [t, corner, g] = vertices(lineOf(scene, 's1.square').positions)
    for (const v of [t, corner, g]) expect(v[2]).toBe(-25)
    const along = [t[0] - 1, t[1] - 2]
    const up = [g[0] - 1, g[1] - 2]
    expectParallel(up, [2, -4])
    expect(up[0] * 2 + up[1] * -4).toBeGreaterThan(0)
    expect(Math.abs(along[0] * 2 + along[1] * -4)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(Math.hypot(...along) - 0.4)).toBeLessThanOrEqual(1e-12)
    expect(Math.abs(Math.hypot(...up) - 0.4)).toBeLessThanOrEqual(1e-12)
    expectClose([corner[0] - t[0], corner[1] - t[1]], up)
  })

  it('reads out ∇f, |∇f| = √20 and the direction of steepest ascent, atan2(-4, 2)', () => {
    expect(labelOf(scene, 's1.readout').text).toBe('∇f = (2, −4), |∇f| = 4.472, steepest ascent at θ = −1.107 rad')
  })

  it('gives the angle in degrees under @angle: degrees', () => {
    expect(labelOf(sceneOf('@angle: degrees\ngradient: x^2 - y^2 at (1, 2)'), 's2.readout').text).toBe(
      '∇f = (2, −4), |∇f| = 4.472, steepest ascent at θ = −63.43°'
    )
  })
})

describe('gradient: … lifted', () => {
  it('puts the arrow and the level curve in the plane z = f(1, 2) = -3', () => {
    const scene = sceneOf('gradient: x^2 - y^2 at (1, 2) lifted')
    expect(Array.from(arrowsOf(scene, 's1').tails)).toEqual([1, 2, -3])
    for (const [, , z] of vertices(lineOf(scene, 's1.level').positions)) expect(z).toBe(-3)
  })
})

describe('gradient of a function of three variables', () => {
  it('gradient: xyz at (1, 2, 3) is the arrow (yz, xz, xy) = (6, 3, 2) from the point, |∇F| = 7', () => {
    const scene = sceneOf('gradient: x*y*z at (1, 2, 3)')
    expect(scene.errors).toEqual([])
    const arrow = arrowsOf(scene, 's1')
    expect(Array.from(arrow.tails)).toEqual([1, 2, 3])
    expect(Array.from(arrow.vectors)).toEqual([6, 3, 2])
    expect(labelOf(scene, 's1.readout').text).toBe('∇F = (6, 3, 2), |∇F| = 7')
  })

  // Integration J3: "surface" meshes the level surface through the point by
  // S4a's marching tetrahedra. F = x^2 + y^2 + z^2 at (1, 1, 1) is 3: the
  // sphere of radius √3, with ∇F = (2, 2, 2) pointing out of it.
  it('"surface" draws the level surface through the point: the sphere |p| = √3, closed, normals outward', () => {
    const scene = sceneOf('@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]\ngradient: x^2 + y^2 + z^2 at (1, 1, 1) surface res: 24')
    expect(scene.errors).toEqual([])
    expect(Array.from(arrowsOf(scene, 's2').vectors)).toEqual([2, 2, 2])
    const mesh = meshOf(scene, 's2.surface')
    expect(mesh.style.opacity).toBe(0.45)
    const points = vertices(mesh.positions)
    expect(points.length).toBeGreaterThan(100)
    points.forEach((p, v) => {
      expect(Math.abs(Math.hypot(...p) - Math.sqrt(3))).toBeLessThanOrEqual(1e-8)
      const n = [mesh.normals[3 * v], mesh.normals[3 * v + 1], mesh.normals[3 * v + 2]]
      expect(Math.abs(Math.hypot(...n) - 1)).toBeLessThanOrEqual(1e-12)
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0)
    })
    // Closed: every edge is shared by exactly two triangles.
    const edges = new Map<string, number>()
    for (let t = 0; t < mesh.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = mesh.indices[t + k]
        const b = mesh.indices[t + ((k + 1) % 3)]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    expect([...new Set(edges.values())]).toEqual([2])
  })

  it('"surface" whose level set meets no cell says so, naming res: a strict extremum is a point', () => {
    const scene = sceneOf('@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]\ngradient: x^2 + y^2 + z^2 at (0, 0, 0) surface res: 8')
    expect(scene.errors).toEqual([
      {
        line: 2,
        message: 'gradient: the level set through (0, 0, 0) meets no cell at res 8 — at an extremum of F it is a single point; otherwise raise res:',
      },
    ])
    expect(labelOf(scene, 's2.readout').text).toBe('∇F = 0 (a critical point)')
  })

  it('a real level surface smaller than a cell is not called a point: the sphere of radius 0.1 at res 7 over [-2, 2]^3', () => {
    // F = x^2 + y^2 + z^2 at (0.1, 0, 0) is 0.01. At res 7 the grid points
    // are -2 + 4k/7, the nearest to the origin (±2/7, ±2/7, ±2/7), where
    // F = 12/49 > 0.01: none is inside the sphere, so no cell is crossed. At
    // res 64 (cells 1/16, a grid point at the origin) it is meshed.
    const coarse = sceneOf('@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]\ngradient: x^2 + y^2 + z^2 at (0.1, 0, 0) surface res: 7')
    expect(coarse.errors[0].message).toMatch(/meets no cell at res 7 — at an extremum of F it is a single point; otherwise raise res:$/)
    const fine = sceneOf('@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]\ngradient: x^2 + y^2 + z^2 at (0.1, 0, 0) surface res: 64')
    expect(fine.errors).toEqual([])
    for (const p of vertices(meshOf(fine, 's2.surface').positions)) expect(Math.abs(Math.hypot(...p) - 0.1)).toBeLessThanOrEqual(1e-8)
  })

  it('"surface" takes S4a’s limit on res:', () => {
    expect(sceneOf('gradient: x*y*z at (1, 2, 3) surface res: 200').errors).toEqual([
      { line: 1, message: 'res 200 is over the 160 cubes per axis an implicit surface is sampled at — lower the resolution' },
    ])
  })

  // S6 plan V11: the same marching tetrahedra as implicit.ts, so it is owed
  // the same half-resolution-while-held (implicit.test.ts proves the
  // mechanism itself; this proves gradients.ts actually wires it in).
  it('meshes the level surface coarser while held, full res on the next release', () => {
    const BOX = { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -2, max: 2 } }
    const spec = '@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]\n@param a = 1 range [0.5, 1.5]\ngradient: x^2 + y^2 + z^2 at (a, 1, 1) surface res: 24'
    const kernel = kernelOf(spec)
    const held = kernel.setValue('a', 1.1, { holdBox: BOX })
    const heldMesh = meshOf(held, 's3.surface')
    const released = kernel.setValues(new Map())
    const releasedMesh = meshOf(released, 's3.surface')
    expect(releasedMesh).not.toBe(heldMesh)
    expect(heldMesh.positions.length).toBeLessThan(releasedMesh.positions.length * 0.5)
  })
})

describe('gradient: points outside, and parameters', () => {
  it('refuses a point outside the domain, or the box (M2)', () => {
    expect(sceneOf('gradient: x^2 - y^2 at (7, 0)').errors).toEqual([{ line: 1, message: 'gradient: (7, 0) is outside the domain' }])
    expect(sceneOf('gradient: x*y*z at (1, 2, 9)').errors).toEqual([{ line: 1, message: 'gradient: (1, 2, 9) is outside the box' }])
  })

  it('rebuilds when the point reads a parameter (M3): a = 1/2 moves the arrow to (1/2, 2), ∇f = (1, -4)', () => {
    const kernel = kernelOf(`@param a = 1 range [-2, 2]
gradient: x^2 - y^2 at (a, 2)${SADDLE}`)
    const scene = kernel.setValue('a', 0.5)
    const arrow = arrowsOf(scene, 's2')
    expect(Array.from(arrow.tails)).toEqual([0.5, 2, -25])
    expect(Array.from(arrow.vectors)).toEqual([1, -4, 0])
  })
})

describe('a zero gradient', () => {
  it('draws the point and the readout "∇f = 0 (a critical point)", and no arrow', () => {
    // Beside z = x^2 + y^2 over [-5, 5]^2, z in [0, 50]: the floor is 0.
    const scene = sceneOf('gradient: x^2 + y^2 at (0, 0)\nz = x^2 + y^2')
    expect(scene.marks.filter((m) => m.source.line === 1).map((m) => m.source.object)).toEqual(['s1.point'])
    expect(Array.from(pointsOf(scene, 's1.point').positions)).toEqual([0, 0, 0])
    expect(labelOf(scene, 's1.readout').text).toBe('∇f = 0 (a critical point)')
  })
})

// Fix round 1 on the box pass (Important 1): a tool's box is its "over"
// rectangle in x and y, and the scene's box in z.
describe('gradient of three variables over a rectangle', () => {
  it('refuses a point outside the rectangle, worded "the domain" (S6 carried item: an authored over is not literally "the box")', () => {
    expect(sceneOf('gradient: x^2 + y^2 + z^2 at (3, 0, 0) over x in [-1, 1], y in [-1, 1]').errors).toEqual([
      { line: 1, message: 'gradient: (3, 0, 0) is outside the domain' },
    ])
  })
})
