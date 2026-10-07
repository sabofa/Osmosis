import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { parametricMesh } from '../../testing/marks'
import { graphMesh, quadMesh, sphereMesh } from '../model/testing'
import { closedForm, locate, normalOf, pointOf, refineSurface, refineWhere, type RefinedSurface, type SurfacePoint } from './surface'

// A flat quad [-2, 2]² as two triangles (normal +z), with a scalar x + 2y.
function quad(zeroNormals = false): MeshMark {
  const base = sphereMesh({ nu: 2, nv: 2 })
  const positions = Float64Array.from([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0])
  return {
    ...base,
    positions,
    normals: zeroNormals ? new Float64Array(12) : Float64Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    scalars: Float64Array.from([-2 - 4, 2 - 4, 2 + 4, -2 + 4]),
    uv: null,
  }
}

interface Edges {
  // canonical edge -> how many triangles have it
  count: Map<string, number>
  // the longest edge, by vertex positions
  longest: number
}
function edgesOf(s: RefinedSurface): Edges {
  const count = new Map<string, number>()
  let longest = 0
  for (let t = 0; t < s.indices.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const a = s.indices[3 * t + e]
      const b = s.indices[3 * t + ((e + 1) % 3)]
      const key = [s.canon[a], s.canon[b]].sort((x, y) => x - y).join('-')
      count.set(key, (count.get(key) ?? 0) + 1)
      longest = Math.max(longest, Math.hypot(s.positions[3 * a] - s.positions[3 * b], s.positions[3 * a + 1] - s.positions[3 * b + 1], s.positions[3 * a + 2] - s.positions[3 * b + 2]))
    }
  }
  return { count, longest }
}

// The adjacency is symmetric and across the edge it names.
function adjacencyHolds(s: RefinedSurface): boolean {
  for (let t = 0; t < s.indices.length / 3; t++) {
    for (let e = 0; e < 3; e++) {
      const u = s.adj[3 * t + e]
      if (u < 0) continue
      const ca = s.canon[s.indices[3 * t + e]]
      const cb = s.canon[s.indices[3 * t + ((e + 1) % 3)]]
      let back = false
      for (let f = 0; f < 3; f++) {
        const x = s.canon[s.indices[3 * u + f]]
        const y = s.canon[s.indices[3 * u + ((f + 1) % 3)]]
        if (s.adj[3 * u + f] === t && ((x === ca && y === cb) || (x === cb && y === ca))) back = true
      }
      if (!back) return false
    }
  }
  return true
}

const totalArea = (s: RefinedSurface) => s.area.reduce((a, b) => a + b, 0)

describe('refineSurface: a flat quad', () => {
  const s = refineSurface(quad(), 3, 0.5, 100_000)

  it('has every edge at most maxEdge', () => {
    expect(edgesOf(s).longest).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(s.indices.length / 3).toBeGreaterThan(200)
    expect(s.budgetHit).toBe(false)
  })

  it('is conforming: every edge is shared by 2 triangles inside and by 1 on the border (no T-junctions)', () => {
    const { count } = edgesOf(s)
    let border = 0
    for (const [key, n] of count) {
      expect(n === 1 || n === 2, key).toBe(true)
      if (n === 1) {
        border++
        // a border edge lies along the square's boundary, whole: both its ends on the same side
        const [a, b] = key.split('-').map((c) => s.canon.indexOf(Number(c)))
        const on = (v: number, axis: number, side: number) => Math.abs(s.positions[3 * v + axis] - side) < 1e-12
        const along = [0, 1].some((axis) => [-2, 2].some((side) => on(a, axis, side) && on(b, axis, side)))
        expect(along, key).toBe(true)
      }
    }
    // the boundary is 4 sides of 4 units cut at 0.5 or less: at least 32 border edges
    expect(border).toBeGreaterThanOrEqual(32)
    expect(adjacencyHolds(s)).toBe(true)
  })

  it('keeps the area (16), is open, and puts every vertex on the plane with a unit normal and the scalar linear in position', () => {
    expect(Math.abs(totalArea(s) - 16)).toBeLessThan(1e-9)
    expect(s.closed).toBe(false)
    expect(s.scalars).not.toBeNull()
    for (let i = 0; i < s.positions.length / 3; i++) {
      expect(s.positions[3 * i + 2]).toBe(0)
      expect(Math.hypot(s.normals[3 * i], s.normals[3 * i + 1], s.normals[3 * i + 2])).toBeCloseTo(1, 12)
      expect(s.normals[3 * i + 2]).toBeCloseTo(1, 12)
      expect(s.scalars![i]).toBeCloseTo(s.positions[3 * i] + 2 * s.positions[3 * i + 1], 9)
    }
  })

  it('has well-shaped triangles: every one has an angle of at least 40 degrees (a right-angle grid bisects into right-angle triangles)', () => {
    let worst = Math.PI
    for (let t = 0; t < s.indices.length / 3; t++) {
      const p = [0, 1, 2].map((k) => [0, 1, 2].map((a) => s.positions[3 * s.indices[3 * t + k] + a]))
      for (let k = 0; k < 3; k++) {
        const a = p[k]
        const b = p[(k + 1) % 3]
        const c = p[(k + 2) % 3]
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
        const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))
        worst = Math.min(worst, Math.acos(Math.max(-1, Math.min(1, cos))))
      }
    }
    expect((worst * 180) / Math.PI).toBeGreaterThan(40)
  })

  it('stands the face normal in where the source normal is zero', () => {
    const z = refineSurface(quad(true), 3, 1, 100_000)
    for (let i = 0; i < z.positions.length / 3; i++) expect([z.normals[3 * i], z.normals[3 * i + 1], z.normals[3 * i + 2]]).toEqual([0, 0, 1])
  })

  it('returns a surface already fine enough as it is', () => {
    const t = refineSurface(quad(), 3, 100, 100_000)
    expect(t.indices.length / 3).toBe(2)
    expect(t.budgetHit).toBe(false)
    expect(t.adj[0 + 2]).toBe(1) // the two triangles share the diagonal (edge v2v0 of the first)
  })
})

describe('refineSurface: closed meshes', () => {
  it('a UV sphere, with its seam and its poles, is closed once the coincident vertices are merged', () => {
    const mesh = sphereMesh({ radius: 1, nu: 24, nv: 16 })
    const s = refineSurface(mesh, 0, 100, 100_000)
    expect(s.closed).toBe(true)
    expect(s.adj.every((a) => a >= 0)).toBe(true)
    // the seam and the pole fans merged: fewer canonical vertices than vertices, and no triangle without area
    const canons = new Set(Array.from(s.canon)).size
    expect(canons).toBeLessThan(s.positions.length / 3)
    expect(canons).toBe(2 + 24 * 15) // two poles, 15 rings of 24
    expect(s.area.every((a) => a > 0)).toBe(true)
    expect(s.indices.length / 3).toBe(24 * 16 * 2 - 2 * 24) // the 2·24 pole-fan triangles had no area
    expect(adjacencyHolds(s)).toBe(true)
  })

  it('a refined sphere stays closed and conforming across the seam and at the poles, with every edge short', () => {
    const mesh = sphereMesh({ radius: 1, nu: 24, nv: 16 })
    const s = refineSurface(mesh, 0, 0.12, 200_000)
    expect(s.closed).toBe(true)
    expect(s.budgetHit).toBe(false)
    const { count, longest } = edgesOf(s)
    expect(longest).toBeLessThanOrEqual(0.12 + 1e-9)
    for (const [key, n] of count) expect(n, key).toBe(2)
    expect(adjacencyHolds(s)).toBe(true)
    // on the source triangles: the faceted sphere's area is kept
    const source = refineSurface(mesh, 0, 100, 100_000)
    expect(Math.abs(totalArea(s) - totalArea(source))).toBeLessThan(1e-9)
    // the seam's two sides were refined together: no vertex of the seam stands alone on one side
    const seam = [] as number[]
    for (let i = 0; i < s.positions.length / 3; i++) if (Math.abs(s.positions[3 * i + 1]) < 1e-9 && s.positions[3 * i] > 1e-6) seam.push(i) // (not the pole, which is on the axis)
    expect(seam.length).toBeGreaterThan(10)
    for (const i of seam) {
      const mates = seam.filter((j) => s.canon[j] === s.canon[i]).length
      expect(mates === 1 || mates === 2, `vertex ${i}`).toBe(true)
    }
  })

  it('a torus (a seam each way) is closed', () => {
    const torus = parametricMesh(
      (u, v) => [(2 + 0.7 * Math.cos(v)) * Math.cos(u), (2 + 0.7 * Math.cos(v)) * Math.sin(u), 0.7 * Math.sin(v)],
      (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
      0, 2 * Math.PI, 0, 2 * Math.PI, 20, 12,
    )
    const s = refineSurface(torus, 0, 0.3, 200_000)
    expect(s.closed).toBe(true)
    for (const n of edgesOf(s).count.values()) expect(n).toBe(2)
  })

  it('an open graph surface is not closed, and its border edges are the only ones with no neighbour', () => {
    const g = graphMesh((x, y) => 0.3 * Math.sin(3 * x) * y, { half: 1, n: 8 })
    const s = refineSurface(g, 0, 0.1, 100_000)
    expect(s.closed).toBe(false)
    for (let t = 0; t < s.indices.length / 3; t++) {
      for (let e = 0; e < 3; e++) {
        if (s.adj[3 * t + e] >= 0) continue
        const a = s.indices[3 * t + e]
        const b = s.indices[3 * t + ((e + 1) % 3)]
        const edge = [0, 1].some((axis) => [-1, 1].some((side) => Math.abs(s.positions[3 * a + axis] - side) < 1e-12 && Math.abs(s.positions[3 * b + axis] - side) < 1e-12))
        expect(edge).toBe(true)
      }
    }
  })
})

describe('refineSurface: the triangle budget', () => {
  it('stops at the coarser level that fits, says so, and is still conforming', () => {
    const free = refineSurface(quad(), 3, 0.05, 1_000_000)
    expect(free.budgetHit).toBe(false)
    const budget = 3000
    const s = refineSurface(quad(), 3, 0.05, budget)
    expect(s.budgetHit).toBe(true)
    expect(s.indices.length / 3).toBeLessThanOrEqual(budget)
    expect(s.indices.length / 3).toBeLessThan(free.indices.length / 3)
    // a whole level: the longest edge is still no longer than the level's, uniform, not a half-refined mix
    const e = edgesOf(s)
    expect(e.longest).toBeGreaterThan(0.05)
    expect(e.longest).toBeLessThan(0.25)
    for (const n of e.count.values()) expect(n === 1 || n === 2).toBe(true)
    expect(Math.abs(totalArea(s) - 16)).toBeLessThan(1e-9)
    expect(adjacencyHolds(s)).toBe(true)
  })

  it('a budget the source already passes refines nothing and says so', () => {
    const s = refineSurface(sphereMesh({ nu: 12, nv: 8 }), 0, 0.01, 10)
    expect(s.budgetHit).toBe(true)
    expect(s.indices.length / 3).toBe(12 * 8 * 2 - 2 * 12)
  })
})

describe('refineWhere', () => {
  it('splits the triangles asked for, once per pass, with the old vertices and triangles keeping their indices, and stays conforming', () => {
    let s = refineSurface(quad(), 3, 1, 100_000)
    const near = (tri: number, x: number, y: number, r: number): boolean => {
      for (let k = 0; k < 3; k++) {
        const v = s.indices[3 * tri + k]
        if (Math.hypot(s.positions[3 * v] - x, s.positions[3 * v + 1] - y) < r) return true
      }
      return false
    }
    const first = s.positions.slice()
    const nt0 = s.indices.length / 3
    const one = refineWhere(s, (t) => near(t, 1, 1, 0.3), 0.1, 100_000)
    expect(one.indices.length / 3).toBeGreaterThan(nt0)
    expect(Array.from(one.positions.subarray(0, first.length))).toEqual(Array.from(first))
    for (const n of edgesOf(one).count.values()) expect(n === 1 || n === 2).toBe(true)
    expect(adjacencyHolds(one)).toBe(true)
    // pass after pass the edges near (1, 1) shorten to the floor, and the far side is left alone
    for (let pass = 0; pass < 8; pass++) {
      const cur = s
      s = refineWhere(cur, (t) => near(t, 1, 1, 0.3), 0.1, 100_000)
    }
    expect(Math.abs(totalArea(s) - 16)).toBeLessThan(1e-9)
    expect(adjacencyHolds(s)).toBe(true)
    let nearLongest = 0
    let farLongest = 0
    for (let t = 0; t < s.indices.length / 3; t++) {
      const centre = [0, 1, 2].map((a) => [0, 1, 2].reduce((acc, k) => acc + s.positions[3 * s.indices[3 * t + k] + a], 0) / 3)
      const len = Math.max(...[0, 1, 2].map((e) => {
        const a = s.indices[3 * t + e]
        const b = s.indices[3 * t + ((e + 1) % 3)]
        return Math.hypot(s.positions[3 * a] - s.positions[3 * b], s.positions[3 * a + 1] - s.positions[3 * b + 1])
      }))
      if (Math.hypot(centre[0] - 1, centre[1] - 1) < 0.1) nearLongest = Math.max(nearLongest, len)
      if (Math.hypot(centre[0] + 1.5, centre[1] + 1.5) < 0.5) farLongest = Math.max(farLongest, len)
    }
    expect(nearLongest).toBeLessThanOrEqual(0.1 * 1.0001)
    expect(farLongest).toBeGreaterThan(0.5)
  })

  it('returns the surface itself when nothing is asked for, and stops at the budget', () => {
    const s = refineSurface(quad(), 3, 1, 100_000)
    expect(refineWhere(s, () => false, 0.1, 100_000)).toBe(s)
    expect(refineWhere(s, () => true, 100, 100_000)).toBe(s)
    const capped = refineWhere(s, () => true, 0.01, s.indices.length / 3 + 5)
    expect(capped.budgetHit).toBe(true)
    expect(capped.indices.length / 3).toBeLessThanOrEqual(s.indices.length / 3 + 5)
    expect(adjacencyHolds(capped)).toBe(true)
  })
})

describe('locate, pointOf, normalOf', () => {
  const mesh = sphereMesh({ radius: 1.3, centre: [0.2, -0.1, 0.4], nu: 24, nv: 16 })
  const s = refineSurface(mesh, 0, 0.2, 100_000)

  it('finds a point of a SOURCE triangle again on the refined surface (the refinement lies on the source)', () => {
    let seed = 12345
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
    const nt = mesh.indices.length / 3
    const out: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const q = [0, 0, 0]
    let checked = 0
    for (let k = 0; k < 400; k++) {
      const t = Math.floor(rnd() * nt)
      const a = 3 * mesh.indices[3 * t]
      const b = 3 * mesh.indices[3 * t + 1]
      const c = 3 * mesh.indices[3 * t + 2]
      const area = Math.hypot(
        (mesh.positions[b + 1] - mesh.positions[a + 1]) * (mesh.positions[c + 2] - mesh.positions[a + 2]) - (mesh.positions[b + 2] - mesh.positions[a + 2]) * (mesh.positions[c + 1] - mesh.positions[a + 1]),
        (mesh.positions[b + 2] - mesh.positions[a + 2]) * (mesh.positions[c] - mesh.positions[a]) - (mesh.positions[b] - mesh.positions[a]) * (mesh.positions[c + 2] - mesh.positions[a + 2]),
        (mesh.positions[b] - mesh.positions[a]) * (mesh.positions[c + 1] - mesh.positions[a + 1]) - (mesh.positions[b + 1] - mesh.positions[a + 1]) * (mesh.positions[c] - mesh.positions[a]),
      )
      if (area < 1e-9) continue // a pole's fan has no area
      const sq = Math.sqrt(rnd())
      const w1 = sq * (1 - rnd())
      const w2 = sq - w1
      const w0 = 1 - w1 - w2
      const p = [0, 1, 2].map((i) => w0 * mesh.positions[a + i] + w1 * mesh.positions[b + i] + w2 * mesh.positions[c + i])
      const n = [0, 1, 2].map((i) => w0 * mesh.normals[a + i] + w1 * mesh.normals[b + i] + w2 * mesh.normals[c + i])
      const nl = Math.hypot(...n)
      expect(locate(s, p[0], p[1], p[2], n[0] / nl, n[1] / nl, n[2] / nl, 1e-3, out)).toBe(true)
      pointOf(s, out, q)
      expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeLessThan(1e-9)
      checked++
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('finds the surface within the reach and not beyond it', () => {
    const out: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const q = [0, 0, 0]
    // a point 0.01 off the surface, out along its normal
    const dir = [0.6, 0.0, 0.8]
    const p = [0.2 + 1.3 * dir[0] * 1.0, -0.1 + 1.3 * dir[1], 0.4 + 1.3 * dir[2]]
    const off = p.map((v, i) => v + 0.05 * dir[i])
    expect(locate(s, off[0], off[1], off[2], dir[0], dir[1], dir[2], 0.01, out)).toBe(false)
    expect(locate(s, off[0], off[1], off[2], dir[0], dir[1], dir[2], 0.2, out)).toBe(true)
    pointOf(s, out, q)
    // the nearest point of the faceted surface: within a facet's sag of the sphere's, and 0.05 or so from the query
    expect(Math.hypot(q[0] - off[0], q[1] - off[1], q[2] - off[2])).toBeLessThan(0.06)
  })

  it('gives the side normals: +1 as the mesh has them (outward on this sphere), -1 the opposite, both unit', () => {
    const out: SurfacePoint = { tri: 100, b1: 0.3, b2: 0.2 }
    const n1 = [0, 0, 0]
    const n2 = [0, 0, 0]
    normalOf(s, out, 1, n1)
    normalOf(s, out, -1, n2)
    expect(Math.hypot(...n1)).toBeCloseTo(1, 12)
    for (let k = 0; k < 3; k++) expect(n2[k]).toBeCloseTo(-n1[k], 12)
    const p = [0, 0, 0]
    pointOf(s, out, p)
    const radial = [p[0] - 0.2, p[1] + 0.1, p[2] - 0.4]
    const rl = Math.hypot(...radial)
    expect(n1[0] * (radial[0] / rl) + n1[1] * (radial[1] / rl) + n1[2] * (radial[2] / rl)).toBeGreaterThan(0.98)
  })
})

// The same mesh with its normals the other way.
const inward = (m: MeshMark): MeshMark => ({ ...m, normals: m.normals.map((v) => -v) })

describe('orientation: which way a closed mesh’s normals point', () => {
  const sphere = sphereMesh({ radius: 1.2, centre: [0.3, -0.2, 0.5], nu: 24, nv: 16 })
  const torus = parametricMesh(
    (u, v) => [(2 + 0.7 * Math.cos(v)) * Math.cos(u), (2 + 0.7 * Math.cos(v)) * Math.sin(u), 0.7 * Math.sin(v)],
    (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
    0, 2 * Math.PI, 0, 2 * Math.PI, 20, 12,
  )

  it('is +1 for outward normals and -1 for inward ones, on a sphere and on a torus, and +1 on an open surface', () => {
    expect(refineSurface(sphere, 0, 100, 100_000).orient).toBe(1)
    expect(refineSurface(inward(sphere), 0, 100, 100_000).orient).toBe(-1)
    expect(refineSurface(torus, 0, 100, 100_000).orient).toBe(1)
    expect(refineSurface(inward(torus), 0, 100, 100_000).orient).toBe(-1)
    expect(refineSurface(quad(), 0, 100, 100_000).orient).toBe(1)
    expect(refineSurface(inward(quad()), 0, 100, 100_000).orient).toBe(1) // an open sheet has no outside: side +1 is where its normals point
    // the form the caster reads is the same
    expect(closedForm(inward(sphere))).toMatchObject({ closed: true, orient: -1 })
  })

  it('keeps the orientation through refinement, and normalOf side +1 is the outward normal either way, side -1 the inward one', () => {
    for (const [mesh, orient] of [[sphere, 1], [inward(sphere), -1]] as const) {
      const s = refineSurface(mesh, 0, 0.3, 100_000)
      expect(s.orient).toBe(orient)
      const refined = refineWhere(s, (t) => t % 7 === 0, 0.05, 100_000)
      expect(refined.orient).toBe(orient)
      const out: SurfacePoint = { tri: 40, b1: 0.3, b2: 0.3 }
      const p = [0, 0, 0]
      const n = [0, 0, 0]
      pointOf(refined, out, p)
      const radial = [p[0] - 0.3, p[1] + 0.2, p[2] - 0.5]
      const rl = Math.hypot(...radial)
      normalOf(refined, out, 1, n)
      expect(n[0] * (radial[0] / rl) + n[1] * (radial[1] / rl) + n[2] * (radial[2] / rl)).toBeGreaterThan(0.95)
      normalOf(refined, out, -1, n)
      expect(n[0] * (radial[0] / rl) + n[1] * (radial[1] / rl) + n[2] * (radial[2] / rl)).toBeLessThan(-0.95)
    }
  })

  it('is outsideOnly for a closed opaque mesh and not for a closed veil (both its sides are seen), whatever its orientation', () => {
    const veil = sphereMesh({ radius: 1, opacity: 0.4, nu: 24, nv: 16 })
    const v = refineSurface(veil, 0, 100, 100_000)
    expect(v.closed).toBe(true)
    expect(v.outsideOnly).toBe(false)
    const o = refineSurface(sphere, 0, 100, 100_000)
    expect(o.closed).toBe(true)
    expect(o.outsideOnly).toBe(true)
    expect(refineSurface(quad(), 0, 100, 100_000).outsideOnly).toBe(false)
    expect(refineSurface(inward(veil), 0, 100, 100_000).orient).toBe(-1)
  })
})

describe('refineSurface: a level is never left half done', () => {
  // a sliver of a quad, 60 x 0.6: each level of bisection can add many times its triangles
  const sliver = quadMesh({ origin: [0, 0, 0], e1: [60, 0, 0], e2: [0, 0.6, 0], n: 1 })

  it('ends at the state of a whole number of levels for every budget, with budgetHit set', () => {
    const length = (a: RefinedSurface) => {
      let m = 0
      for (let t = 0; t < a.indices.length / 3; t++) {
        for (let e = 0; e < 3; e++) {
          const p = a.indices[3 * t + e]
          const q = a.indices[3 * t + ((e + 1) % 3)]
          m = Math.max(m, Math.sqrt((a.positions[3 * p] - a.positions[3 * q]) ** 2 + (a.positions[3 * p + 1] - a.positions[3 * q + 1]) ** 2 + (a.positions[3 * p + 2] - a.positions[3 * q + 2]) ** 2))
        }
      }
      return m
    }
    const bytes = (a: Float64Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')
    // the state after each whole level, from a budget that is never reached
    const levels = new Map<number, string>()
    let target = length(refineSurface(sliver, 0, Infinity, 10_000_000))
    levels.set(2, bytes(refineSurface(sliver, 0, Infinity, 10_000_000).positions))
    for (let k = 0; k < 40 && target > 0.5; k++) {
      target = Math.max(0.5, target / Math.SQRT2)
      const state = refineSurface(sliver, 0, target, 10_000_000)
      expect(state.budgetHit).toBe(false)
      levels.set(state.indices.length / 3, bytes(state.positions))
    }
    expect(levels.size).toBeGreaterThan(8)
    for (const budget of [30, 60, 100, 150, 200, 400, 1000, 2000]) {
      const s = refineSurface(sliver, 0, 0.5, budget)
      const n = s.indices.length / 3
      expect(s.budgetHit, `budget ${budget}`).toBe(true)
      expect(n, `budget ${budget}`).toBeLessThanOrEqual(budget)
      expect(levels.has(n), `budget ${budget}: ${n} triangles is not a whole level`).toBe(true)
      expect(bytes(s.positions), `budget ${budget}`).toBe(levels.get(n))
    }
  })
})

describe('locate: how far the point found is', () => {
  const sheet = refineSurface(quad(), 0, 0.5, 100_000) // [-2, 2]², open
  const out: SurfacePoint = { tri: 0, b1: 0, b2: 0 }

  it('reports the distance to the point found: 0 on the surface, the height above it off it', () => {
    expect(locate(sheet, 0.3, 0.2, 0, 0, 0, 1, 0.1, out)).toBe(true)
    expect(out.dist).toBeCloseTo(0, 12)
    expect(locate(sheet, 0.3, 0.2, 0.05, 0, 0, 1, 0.1, out)).toBe(true)
    expect(out.dist).toBeCloseTo(0.05, 12)
    const p = [0, 0, 0]
    pointOf(sheet, out, p)
    expect(p[0]).toBeCloseTo(0.3, 12)
    expect(p[2]).toBeCloseTo(0, 12)
  })

  it('does not slide a point that is past an open border onto the border: beyond the reach it is not found, and one just inside the reach is, at its distance', () => {
    const reach = 0.1
    // 2 x the reach past the edge x = 2 (in the plane of the sheet)
    expect(locate(sheet, 2 + 2 * reach, 0.2, 0, 0, 0, 1, reach, out)).toBe(false)
    // 0.5 x the reach past it: found, on the border, at 0.5 x the reach
    expect(locate(sheet, 2 + 0.5 * reach, 0.2, 0, 0, 0, 1, reach, out)).toBe(true)
    expect(out.dist).toBeCloseTo(0.5 * reach, 12)
    expect(out.dist!).toBeLessThanOrEqual(reach)
  })
})
