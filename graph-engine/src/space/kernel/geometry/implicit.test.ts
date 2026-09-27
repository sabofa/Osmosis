import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { kernelOf, marksOf, sceneOf, vertexOf, vertices } from '../../testing/kernel'
import { levelsInside } from './levelSurfaces'
import { KUHN_TETS, marchingTets, sampleGrid } from './marchingTets'

const CUBE3 = '@bounds3d: x [-3, 3], y [-3, 3], z [-3, 3]'
const CUBE2 = '@bounds3d: x [-2, 2], y [-2, 2], z [-2, 2]'

function onlyMesh(spec: string): MeshMark {
  const scene = sceneOf(spec)
  expect(scene.errors).toEqual([])
  const meshes = marksOf(scene, 'mesh')
  expect(meshes).toHaveLength(1)
  return meshes[0]
}

function triangles(mesh: MeshMark): [number, number, number][] {
  return Array.from({ length: mesh.indices.length / 3 }, (_, t) => [mesh.indices[3 * t], mesh.indices[3 * t + 1], mesh.indices[3 * t + 2]])
}

// How many triangles use each undirected edge.
function edgeUses(mesh: MeshMark): Map<string, number> {
  const uses = new Map<string, number>()
  for (const [a, b, c] of triangles(mesh)) {
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  }
  return uses
}

function faceNormal(mesh: MeshMark, [a, b, c]: [number, number, number]): [number, number, number] {
  const [ax, ay, az] = vertexOf(mesh.positions, a)
  const [bx, by, bz] = vertexOf(mesh.positions, b)
  const [cx, cy, cz] = vertexOf(mesh.positions, c)
  const e1 = [bx - ax, by - ay, bz - az]
  const e2 = [cx - ax, cy - ay, cz - az]
  return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
}

function area(mesh: MeshMark): number {
  return triangles(mesh).reduce((sum, t) => sum + Math.hypot(...faceNormal(mesh, t)) / 2, 0)
}

describe('the Kuhn split', () => {
  it('is six tetrahedra, one per ordering of the axes, each from corner 0 to corner 7 along cube edges', () => {
    expect(KUHN_TETS).toHaveLength(6)
    for (const [a, b, c, d] of KUHN_TETS) {
      expect([a, d]).toEqual([0, 7])
      // each step adds one axis bit
      expect([b, c ^ b, d ^ c].every((bit) => [1, 2, 4].includes(bit))).toBe(true)
    }
    const orders = KUHN_TETS.map(([, b, c]) => `${b},${c ^ b}`)
    expect(new Set(orders).size).toBe(6)
  })
})

describe('a sphere: x^2 + y^2 + z^2 = 4 at res 24 over [-3, 3]^3', () => {
  const mesh = onlyMesh(`${CUBE3}\nx^2 + y^2 + z^2 = 4 res: 24`)

  it('puts every vertex on the true sphere, by bisection: ||p| - 2| <= 1e-8', () => {
    let worst = 0
    for (const p of vertices(mesh.positions)) worst = Math.max(worst, Math.abs(Math.hypot(...p) - 2))
    expect(worst).toBeLessThanOrEqual(1e-8)
    expect(mesh.positions.length / 3).toBeGreaterThan(500)
  })

  it('is closed: every edge is shared by exactly two triangles', () => {
    const uses = edgeUses(mesh)
    expect(uses.size).toBeGreaterThan(1000)
    const bad = [...uses].filter(([, n]) => n !== 2)
    expect(bad).toEqual([])
  })

  it('points outward, toward increasing F: every vertex normal and every face winding', () => {
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const p = vertexOf(mesh.positions, v)
      const n = vertexOf(mesh.normals, v)
      expect(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]).toBeGreaterThan(0)
      expect(Math.hypot(...n)).toBeCloseTo(1, 12)
    }
    for (const t of triangles(mesh)) {
      const n = faceNormal(mesh, t)
      const centroid = [0, 1, 2].map((c) => t.reduce((s, v) => s + mesh.positions[3 * v + c], 0) / 3)
      expect(n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2]).toBeGreaterThan(0)
    }
  })

  it('has an area within 2% of 16 pi', () => {
    expect(Math.abs(area(mesh) - 16 * Math.PI) / (16 * Math.PI)).toBeLessThan(0.02)
  })

  it('draws flat by slot at opacity 1, with an implicit pick of F and its gradient', () => {
    expect(mesh.source.object).toBe('s2')
    expect(mesh.style).toEqual({ color: { author: null, slot: 0 }, opacity: 1, colorScale: null, meshLines: null })
    expect(mesh.scalars).toBeNull()
    expect(mesh.uv).toBeNull()
    const pick = mesh.pick!
    expect(pick.kind).toBe('implicit')
    if (pick.kind !== 'implicit') return
    // F = x^2 + y^2 + z^2 - 4, grad F = (2x, 2y, 2z)
    expect(pick.F(1, 2, 3)).toBe(10)
    expect(pick.grad(1, 2, 3)).toEqual([2, 4, 6])
  })

  it('is deterministic: the same spec gives the same arrays', () => {
    const again = onlyMesh(`${CUBE3}\nx^2 + y^2 + z^2 = 4 res: 24`)
    expect(again.positions).toEqual(mesh.positions)
    expect(again.indices).toEqual(mesh.indices)
    expect(again.normals).toEqual(mesh.normals)
  })
})

describe('a hyperboloid of one sheet: x^2 + y^2 - z^2 = 1 over [-2, 2]^3', () => {
  const mesh = onlyMesh(`${CUBE2}\nx^2 + y^2 - z^2 = 1 res: 32`)

  it('puts every vertex on the true surface: |x^2 + y^2 - z^2 - 1| <= 1e-8', () => {
    let worst = 0
    for (const [x, y, z] of vertices(mesh.positions)) worst = Math.max(worst, Math.abs(x * x + y * y - z * z - 1))
    expect(worst).toBeLessThanOrEqual(1e-8)
  })

  it('is open at the box: its boundary edges lie on the box faces', () => {
    const boundary = [...edgeUses(mesh)].filter(([, n]) => n === 1)
    expect(boundary.length).toBeGreaterThan(0)
    for (const [key] of boundary) {
      for (const v of key.split(',').map(Number)) {
        const p = vertexOf(mesh.positions, v)
        expect(p.some((c) => Math.abs(Math.abs(c) - 2) < 1e-12)).toBe(true)
      }
    }
    expect([...edgeUses(mesh)].every(([, n]) => n === 1 || n === 2)).toBe(true)
  })
})

describe("a cone's apex: x^2 + y^2 = z^2", () => {
  const mesh = onlyMesh(`${CUBE2}\nx^2 + y^2 = z^2 res: 16`)

  it('has a vertex at the apex, where grad F = 0, whose normal is the non-zero face fallback', () => {
    const apex = vertices(mesh.positions).findIndex((p) => p[0] === 0 && p[1] === 0 && p[2] === 0)
    expect(apex).toBeGreaterThanOrEqual(0)
    expect(Math.hypot(...vertexOf(mesh.normals, apex))).toBeCloseTo(1, 12)
  })

  it('has a unit normal at every vertex', () => {
    for (let v = 0; v < mesh.normals.length / 3; v++) expect(Math.hypot(...vertexOf(mesh.normals, v))).toBeCloseTo(1, 12)
  })
})

describe('the forced reading: implicit: x^2 + y^2 = 4', () => {
  const mesh = onlyMesh('implicit: x^2 + y^2 = 4 res: 20')

  it('is a cylinder of radius 2 across the whole box z range, [-5, 5] by default', () => {
    const zs = vertices(mesh.positions).map((p) => p[2])
    for (const [x, y] of vertices(mesh.positions)) expect(Math.abs(Math.hypot(x, y) - 2)).toBeLessThanOrEqual(1e-8)
    expect(Math.min(...zs)).toBe(-5)
    expect(Math.max(...zs)).toBe(5)
  })
})

describe('implicit surfaces: holes, style, parameters and refusals', () => {
  it('a non-finite sample voids the cubes it touches: a hole, and no error', () => {
    // sqrt(x) is NaN for x < 0, so only the half with x >= 0 is drawn.
    const mesh = onlyMesh(`${CUBE3}\nx^2 + y^2 + z^2 + 0*sqrt(x) = 4 res: 24`)
    const xs = vertices(mesh.positions).map((p) => p[0])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeCloseTo(2, 8)
  })

  it('colormap: height colours by z on a scale', () => {
    const scene = sceneOf(`${CUBE3}\nx^2 + y^2 + z^2 = 4 res: 12 colormap: height`)
    const mesh = marksOf(scene, 'mesh')[0]
    expect(scene.colorScales).toHaveLength(1)
    expect(mesh.style.colorScale).toBe(0)
    for (let v = 0; v < mesh.positions.length / 3; v++) expect(mesh.scalars![v]).toBe(mesh.positions[3 * v + 2])
  })

  it('opacity: applies', () => {
    expect(onlyMesh(`${CUBE3}\nx^2 + y^2 + z^2 = 4 res: 12 opacity: 0.4`).style.opacity).toBe(0.4)
  })

  it('a parameter moves the surface through setValue', () => {
    const kernel = kernelOf(`${CUBE3}\n@param a = 1 range [0.5, 2.5]\nx^2 + y^2 + z^2 = a^2 res: 12`)
    const radius = () => Math.hypot(...vertexOf((kernel.scene().marks[0] as MeshMark).positions, 0))
    expect(radius()).toBeCloseTo(1, 8)
    kernel.setValue('a', 2)
    expect(radius()).toBeCloseTo(2, 8)
  })

  it('refuses mesh: on, a resolution over the sampling limit, and a surface that misses the box — on its line', () => {
    expect(sceneOf(`${CUBE3}\nx^2 + y^2 + z^2 = 4 mesh: on`).errors).toEqual([{ line: 2, message: expect.stringMatching(/mesh: on needs a parametrisation/) }])
    expect(sceneOf(`${CUBE3}\nx^2 + y^2 + z^2 = 4 res: 300`).errors).toEqual([{ line: 2, message: expect.stringMatching(/res 300 is over the 160/) }])
    expect(sceneOf(`${CUBE3}\nx^2 + y^2 + z^2 = -1 res: 8`).errors).toEqual([{ line: 2, message: expect.stringMatching(/no points in the box/) }])
  })
})

describe('marchingTets on its own', () => {
  it('meets a plane x + y + z = 0.5 in a flat sheet, every vertex on it', () => {
    const box = { x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, z: { min: 0, max: 1 } }
    const F = (x: number, y: number, z: number) => x + y + z
    const iso = marchingTets(F, sampleGrid(F, box, 4), 0.5)
    expect(iso.indices.length).toBeGreaterThan(0)
    for (let v = 0; v < iso.positions.length / 3; v++) {
      const [x, y, z] = vertexOf(iso.positions, v)
      expect(Math.abs(x + y + z - 0.5)).toBeLessThan(1e-9)
    }
  })
})

describe('contour: of three variables draws level surfaces', () => {
  const G = 'g(x, y, z) = x^2 + y^2 + z^2'

  it('levels 1, 4, 9: three meshes of radii 1, 2, 3, at opacity 0.45, coloured by value', () => {
    const scene = sceneOf(`${CUBE3}\n${G}\ncontour: g levels 1, 4, 9 res: 24`)
    expect(scene.errors).toEqual([])
    const meshes = marksOf(scene, 'mesh')
    expect(meshes.map((m) => m.source.object)).toEqual(['s3.level1', 's3.level2', 's3.level3'])
    meshes.forEach((mesh, i) => {
      const r = i + 1
      for (const p of vertices(mesh.positions)) expect(Math.abs(Math.hypot(...p) - r)).toBeLessThanOrEqual(1e-8)
      expect(mesh.style.opacity).toBe(0.45)
      expect(mesh.style.colorScale).toBe(0)
      expect([...new Set(mesh.scalars)]).toEqual([r * r])
    })
    expect(scene.colorScales).toEqual([{ id: 0, title: 'g', map: 'viridis', domain: { min: 1, max: 9 }, diverging: false }])
  })

  it('levels 3 over [-3, 3]^3: the range sampled on 16^3 runs from about 0 to 27, so the levels are 10 and 20', () => {
    // niceStep(27, 3) = 10; its multiples strictly inside (0.12, 27) are 10 and 20.
    const scene = sceneOf(`${CUBE3}\n${G}\ncontour: g levels 3 labels res: 16`)
    expect(scene.errors).toEqual([])
    const meshes = marksOf(scene, 'mesh')
    expect(meshes.map((m) => m.scalars![0])).toEqual([10, 20])
    expect(scene.labels.map((l) => l.text)).toEqual(['10', '20'])
  })

  it('an inline expression reading z has three variables; one level draws flat at opacity 1', () => {
    const scene = sceneOf(`${CUBE3}\ncontour: x^2 + y^2 + z^2 level 4 res: 16`)
    expect(scene.errors).toEqual([])
    const [mesh] = marksOf(scene, 'mesh')
    expect(mesh.style).toMatchObject({ opacity: 1, colorScale: null })
    expect(scene.colorScales).toEqual([])
  })

  it('a color: clause draws every level flat in that colour', () => {
    const scene = sceneOf(`${CUBE3}\n${G}\ncontour: g levels 1, 4 res: 12 color: red`)
    expect(scene.colorScales).toEqual([])
    for (const mesh of marksOf(scene, 'mesh')) expect(mesh.style).toMatchObject({ color: { author: 'red' }, colorScale: null, opacity: 0.45 })
  })

  it('levels a..b step s', () => {
    const scene = sceneOf(`${CUBE3}\n${G}\ncontour: g levels 2..8 step 3 res: 12`)
    expect(marksOf(scene, 'mesh').map((m) => m.scalars![0])).toEqual([2, 5, 8])
  })

  it('a two-variable target is an error on its line until phase S4b', () => {
    expect(sceneOf('f(x, y) = x^2 - y^2\ncontour: f levels 5').errors).toEqual([{ line: 2, message: 'level curves arrive with phase S4b' }])
    expect(sceneOf('contour: x^2 + y^2 levels 1, 4').errors).toEqual([{ line: 1, message: 'level curves arrive with phase S4b' }])
  })

  it('refuses in its own words: floor and width on level surfaces, a level outside the box, a one-variable function', () => {
    expect(sceneOf(`${G}\ncontour: g levels 3 floor`).errors[0].message).toMatch(/"floor" projects level curves/)
    expect(sceneOf(`${G}\ncontour: g levels 3 width: 2`).errors[0].message).toMatch(/width: applies to level curves/)
    expect(sceneOf(`${CUBE3}\n${G}\ncontour: g levels 4, 100 res: 12`).errors).toEqual([{ line: 3, message: 'The level 100 of g does not meet the box' }])
    expect(sceneOf('k(t) = t^2\ncontour: k levels 3').errors[0].message).toMatch(/k takes 1 variable/)
  })
})

describe('levelsInside', () => {
  it('takes the multiples of the nice step strictly inside the range', () => {
    expect(levelsInside({ min: 0.12, max: 27 }, 3)).toEqual([10, 20])
    // the ends are excluded even when they are multiples
    expect(levelsInside({ min: 0, max: 30 }, 3)).toEqual([10, 20])
    // niceStep(1, 10) = 0.1: 0.3, not 0.30000000000000004
    expect(levelsInside({ min: 0, max: 1 }, 10)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9])
    expect(levelsInside({ min: -4.5, max: 4.5 }, 4)).toEqual([-4, -2, 0, 2, 4])
  })
})
