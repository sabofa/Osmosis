import { describe, expect, it, vi } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { buildParticles, cellId } from './particles'
import { flatColours, graphMesh, sceneOf, sphereMesh, tableMesh } from './testing'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const COLOURS = flatColours({ 0: [0.56, 0.1, 0.08], 1: [0.7, 0.01, 0.02] })

// An open cylinder with no uv: only its normals say which way it curves.
function cylinderMesh(radius: number, height: number, nu: number, nv: number): MeshMark {
  const verts = (nu + 1) * (nv + 1)
  const positions = new Float64Array(3 * verts)
  const normals = new Float64Array(3 * verts)
  let k = 0
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const th = (i / nu) * Math.PI * 2
      positions.set([radius * Math.cos(th), radius * Math.sin(th), (j / nv) * height], 3 * k)
      normals.set([Math.cos(th), Math.sin(th), 0], 3 * k)
      k++
    }
  }
  const indices = new Uint32Array(nu * nv * 6)
  let t = 0
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      indices.set([a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1], t)
      t += 6
    }
  }
  return { ...sphereMesh({ nu: 2, nv: 2 }), positions, normals, indices, uv: null }
}

describe('paint particles', () => {
  const sphere = sphereMesh({ radius: 0.6 })
  const scene = sceneOf([sphere])
  const set = buildParticles(scene, COLOURS, P)

  it('thins to a Poisson disc: no two particles are closer than 1/√maxPerUnit2', () => {
    const r = 1 / Math.sqrt(P.particles.maxPerUnit2)
    let closest = Infinity
    const cell = r
    const grid = new Map<string, number[]>()
    const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
    for (let i = 0; i < set.count; i++) {
      const x = set.position[3 * i]
      const y = set.position[3 * i + 1]
      const z = set.position[3 * i + 2]
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell))
            if (!bucket) continue
            for (const j of bucket) {
              closest = Math.min(closest, Math.hypot(x - set.position[3 * j], y - set.position[3 * j + 1], z - set.position[3 * j + 2]))
            }
          }
        }
      }
      const k = key(x, y, z)
      grid.set(k, [...(grid.get(k) ?? []), i])
    }
    // (positions are stored as Float32, so allow its rounding)
    expect(closest).toBeGreaterThanOrEqual(r - 1e-5)
    // and they are blue noise, not a sparse scatter: the closest pair is not far beyond r
    expect(closest).toBeLessThan(1.5 * r)
  })

  it('fills the surface at roughly the Poisson-disc packing of the radius', () => {
    // area of the sphere 4π·0.36 = 4.52; a disc packing of radius r holds ≈ 0.7·area/r² = 0.7·area·maxPerUnit2
    const area = 4 * Math.PI * 0.36
    const nominal = area * P.particles.maxPerUnit2
    expect(set.count).toBeGreaterThan(0.55 * nominal)
    expect(set.count).toBeLessThan(0.85 * nominal)
    // every particle is on this sphere (chord error only)
    for (let i = 0; i < set.count; i += 7) {
      const d = Math.hypot(set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2])
      expect(d).toBeGreaterThan(0.6 * Math.cos(Math.PI / 32))
      expect(d).toBeLessThanOrEqual(0.6 + 1e-5)
    }
  })

  it('weights by area: a triangle four times as big gets four times the particles', () => {
    // a big triangle of area 2 at x in -1..1, and a small one of area 0.5 at x in 2..3
    const quad = tableMesh({ z: 0, half: 1 })
    const mesh: MeshMark = {
      ...quad,
      positions: new Float64Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0]),
      normals: new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      uv: null,
    }
    const s = buildParticles(sceneOf([mesh]), COLOURS, P)
    let big = 0
    let small = 0
    for (let i = 0; i < s.count; i++) {
      if (s.position[3 * i] < 1.5) big++
      else small++
    }
    expect(small).toBeGreaterThan(200)
    expect(big / small).toBeGreaterThan(3.6)
    expect(big / small).toBeLessThan(4.4)
  })

  it('is deterministic, reseeds with the seed, and keeps one mesh independent of the others', () => {
    const again = buildParticles(scene, COLOURS, P)
    expect(again.count).toBe(set.count)
    expect(Array.from(again.position)).toEqual(Array.from(set.position))
    expect(Array.from(again.rank)).toEqual(Array.from(set.rank))
    expect(Array.from(again.seed)).toEqual(Array.from(set.seed))
    const reseeded = buildParticles(scene, COLOURS, resolvePaintParams({ seed: 2 }))
    expect(Array.from(reseeded.position.slice(0, 30))).not.toEqual(Array.from(set.position.slice(0, 30)))
    // adding a second mesh leaves the first one's particles exactly as they were
    const two = buildParticles(sceneOf([sphere, tableMesh({ z: -1, half: 0.5 })]), COLOURS, P)
    let n0 = 0
    while (n0 < two.count && two.mark[n0] === 0) n0++
    expect(n0).toBe(set.count)
    expect(Array.from(two.position.slice(0, 3 * n0))).toEqual(Array.from(set.position))
    expect(Array.from(two.rank.slice(0, n0))).toEqual(Array.from(set.rank))
    expect(two.mark[n0]).toBe(1)
  })

  it('stores unit normals that point out of the surface, and a rank in [0, 1) that is uniform', () => {
    let rankSum = 0
    let badNormal = 0
    let badRank = 0
    for (let i = 0; i < set.count; i++) {
      const nx = set.normal[3 * i]
      const ny = set.normal[3 * i + 1]
      const nz = set.normal[3 * i + 2]
      if (Math.abs(Math.hypot(nx, ny, nz) - 1) > 1e-5) badNormal++
      const outward = (nx * set.position[3 * i] + ny * set.position[3 * i + 1] + nz * set.position[3 * i + 2]) / 0.6
      if (outward < 0.99) badNormal++
      if (set.rank[i] < 0 || set.rank[i] >= 1) badRank++
      rankSum += set.rank[i]
    }
    expect(badNormal).toBe(0)
    expect(badRank).toBe(0)
    expect(rankSum / set.count).toBeGreaterThan(0.48)
    expect(rankSum / set.count).toBeLessThan(0.52)
  })

  it('takes the tangent from the uv gradient: along the longitude on a sphere, away from a pole', () => {
    let checked = 0
    let worstEast = 1
    let worstPerp = 0
    for (let i = 0; i < set.count; i++) {
      const x = set.position[3 * i]
      const y = set.position[3 * i + 1]
      const z = set.position[3 * i + 2]
      const lat = Math.asin(z / 0.6)
      if (Math.abs(lat) > 1.0) continue // within about 57° of the equator
      const tx = set.tangent[3 * i]
      const ty = set.tangent[3 * i + 1]
      const tz = set.tangent[3 * i + 2]
      expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1, 4)
      // perpendicular to the normal
      worstPerp = Math.max(worstPerp, Math.abs(tx * set.normal[3 * i] + ty * set.normal[3 * i + 1] + tz * set.normal[3 * i + 2]))
      // along the east direction (-sin φ, cos φ, 0), up to sign
      const phi = Math.atan2(y, x)
      worstEast = Math.min(worstEast, Math.abs(-Math.sin(phi) * tx + Math.cos(phi) * ty))
      checked++
    }
    expect(checked).toBeGreaterThan(1000)
    expect(worstPerp).toBeLessThan(1e-4)
    expect(worstEast).toBeGreaterThan(0.97)
  })

  it('follows ∂P/∂x on a graph surface, whose uv is (x, y)', () => {
    const saddle = graphMesh((x, y) => x * x - y * y, { half: 1, n: 24 })
    const s = buildParticles(sceneOf([saddle]), COLOURS, P)
    expect(s.count).toBeGreaterThan(2000)
    let worst = 1
    for (let i = 0; i < s.count; i++) {
      const fx = 2 * s.position[3 * i]
      const l = Math.hypot(1, fx)
      // ∂P/∂x = (1, 0, 2x), projected onto the tangent plane, is itself up to the facet's own tilt
      const d = Math.abs((s.tangent[3 * i] + fx * s.tangent[3 * i + 2]) / l)
      worst = Math.min(worst, d)
    }
    expect(worst).toBeGreaterThan(0.99)
  })

  it('without uv, takes the direction of greatest change of the normal: round a cylinder, not along it', () => {
    const s = buildParticles(sceneOf([cylinderMesh(0.5, 1, 48, 6)]), COLOURS, P)
    expect(s.count).toBeGreaterThan(500)
    let worst = 1
    for (let i = 0; i < s.count; i++) {
      const phi = Math.atan2(s.position[3 * i + 1], s.position[3 * i])
      const round = Math.abs(-Math.sin(phi) * s.tangent[3 * i] + Math.cos(phi) * s.tangent[3 * i + 1])
      worst = Math.min(worst, round)
    }
    expect(worst).toBeGreaterThan(0.97)
    // a flat mesh with no uv has no curvature to follow: a unit direction in its plane
    const flat = tableMesh({ z: 0, half: 0.5 })
    const f = buildParticles(sceneOf([{ ...flat, uv: null }]), COLOURS, P)
    expect(f.count).toBeGreaterThan(300)
    for (let i = 0; i < f.count; i += 11) {
      expect(Math.hypot(f.tangent[3 * i], f.tangent[3 * i + 1], f.tangent[3 * i + 2])).toBeCloseTo(1, 4)
      expect(Math.abs(f.tangent[3 * i + 2])).toBeLessThan(1e-6)
    }
  })

  it('takes the local colour from the mark, or from the colormap at the interpolated scalar', () => {
    expect(Array.from(set.colour.slice(0, 3)).map((v) => Number(v.toFixed(4)))).toEqual([0.56, 0.1, 0.08])
    expect(set.colormapped[0]).toBe(0)
    // a coloured saddle: L = 0.5 + 0.1·height, so the colour is read off the scalar
    const saddle = graphMesh((x, y) => x * x - y * y, { half: 1, n: 24, scaled: true })
    const colours = flatColours({}, (v) => [0.5 + 0.1 * v, 0, 0])
    const s = buildParticles(sceneOf([saddle]), colours, P)
    for (let i = 0; i < s.count; i += 13) {
      expect(s.colormapped[i]).toBe(1)
      const x = s.position[3 * i]
      const y = s.position[3 * i + 1]
      expect(s.colour[3 * i]).toBeCloseTo(0.5 + 0.1 * (x * x - y * y), 1)
    }
    // a scale that has no colour falls back to the flat colour
    const none = buildParticles(sceneOf([saddle]), flatColours({ 0: [0.3, 0, 0] }), P)
    expect(none.colormapped[0]).toBe(0)
    expect(none.colour[0]).toBeCloseTo(0.3, 5)
  })

  it('carries the mesh opacity, and a load cell that is a hash of the position', () => {
    const veil = buildParticles(sceneOf([sphereMesh({ opacity: 0.4 })]), COLOURS, P)
    expect(veil.opacity[0]).toBeCloseTo(0.4, 6)
    expect(set.opacity[0]).toBe(1)
    let checked = 0
    for (let i = 0; i < set.count; i += 5) {
      const q = [set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2]].map((v) => v / 0.5)
      // Float32 positions can land across a cell edge from the Float64 ones the cell was hashed from
      if (q.some((v) => Math.abs(v - Math.round(v)) < 1e-4)) continue
      expect(set.cell[i]).toBe(cellId(Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2])))
      checked++
    }
    expect(checked).toBeGreaterThan(300)
    // a bigger load cell merges cells: far fewer distinct ids
    const distinct = (s: typeof set) => new Set(Array.from(s.cell)).size
    const coarse = buildParticles(scene, COLOURS, resolvePaintParams({ mix: { loadCell: 2 } }))
    expect(distinct(coarse)).toBeLessThan(distinct(set))
    expect(distinct(set)).toBeGreaterThan(2)
  })

  it('handles a scene with no meshes', () => {
    const empty = buildParticles(sceneOf([]), COLOURS, P)
    expect(empty.count).toBe(0)
    expect(empty.position.length).toBe(0)
  })
})
