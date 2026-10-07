import { describe, expect, it, vi } from 'vitest'
import { quadMesh } from '../model/testing'
import { DAB_MIN_VALUE } from '../model/roles'
import { bakeStats } from './index'
import { ParticleGrid, dabSitesOf, scumbleMaskOf, vertexGraph } from './detect'
import type { SidePlan } from './plan'
import { refineSurface, type RefinedSurface } from './surface'
import { fixture, P, PX, sparse, sphereColours, sphereScene } from './bakeFixture'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const STATS = bakeStats(SPHERE.baked)!
const D = P.detect

// The parts of a side's plan the scumble mask reads, with the plan's transition wide and its value gentle everywhere.
function gentlePlan(s: RefinedSurface): SidePlan {
  return { trans: new Float32Array(s.positions.length / 3).fill(1), grad: new Float32Array(s.indices.length / 3) } as unknown as SidePlan
}

describe('the scumble mask on the sphere', () => {
  const s = STATS.plan.surfaces[0]!
  const sp = STATS.plan.front[0]!
  const mask = scumbleMaskOf(s, sp, PX, P)
  const g = vertexGraph(s)
  const need = (D.scumbleMinPx / 2) * PX

  it('is ok only where the plan’s transition is wide and gentle (trans over 0.16, every incident triangle’s gradient under detect.scumbleGradient)', () => {
    let ok = 0
    let wrongTrans = 0
    let wrongGrad = 0
    const worstGrad = new Float32Array(s.positions.length / 3)
    for (let t = 0; t < s.indices.length / 3; t++) for (let k = 0; k < 3; k++) worstGrad[s.indices[3 * t + k]] = Math.max(worstGrad[s.indices[3 * t + k]], sp.grad[t])
    for (let v = 0; v < mask.length; v++) {
      if (!mask[v]) continue
      ok++
      if (!(sp.trans[v] > 0.16)) wrongTrans++
      if (!(worstGrad[v] < D.scumbleGradient)) wrongGrad++
    }
    expect(ok).toBeGreaterThan(100)
    expect(wrongTrans).toBe(0)
    expect(wrongGrad).toBe(0)
    // and the mask is a part of the sphere, not the whole of it
    expect(ok).toBeLessThan(0.6 * mask.length)
  })

  it('keeps a stroke’s whole half width from the places that are not ok: the distance rule masks vertices that are ok by themselves, and an ok vertex has no other vertex within the minimum width of it', () => {
    // vertices that would be ok but for the distance rule
    let masked = 0
    const bad: number[] = []
    for (let v = 0; v < mask.length; v++) if (sp.trans[v] > 0.16 && !mask[v]) masked++
    for (let c = 0; c < g.nCanon; c++) if (!mask[g.rep[c]]) bad.push(c)
    expect(masked).toBeGreaterThan(0)
    // an ok vertex is at least `need` (graph distance) from every vertex that is not ok: so by Euclid at least most of it, as the mesh is fine and smooth
    let worst = Infinity
    let checked = 0
    for (let v = 0; v < mask.length; v += 7) {
      if (!mask[v]) continue
      checked++
      for (const c of bad) {
        const d = Math.hypot(g.cpos[3 * c] - s.positions[3 * v], g.cpos[3 * c + 1] - s.positions[3 * v + 1], g.cpos[3 * c + 2] - s.positions[3 * v + 2])
        if (d < worst) worst = d
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(worst).toBeGreaterThanOrEqual(0.85 * need)
  })

  it('treats the border of an open sheet as not ok: on a sheet whose plan is gentle everywhere, a vertex is ok exactly when it is at least the minimum half width from the border', () => {
    const quad = refineSurface(quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], n: 8 }), 0, 0.02, 200_000)
    const side = gentlePlan(quad)
    const nv = quad.positions.length / 3
    const m = scumbleMaskOf(quad, side, 0.01, P)
    // need = scumbleMinPx / 2 × 0.01 = 0.03: the strip of 3 cm along the border is not ok
    const need2 = (D.scumbleMinPx / 2) * 0.01
    let near = 0
    let far = 0
    let wrong = 0
    for (let v = 0; v < nv; v++) {
      const x = quad.positions[3 * v]
      const y = quad.positions[3 * v + 1]
      const toBorder = Math.min(x, 1 - x, y, 1 - y)
      if (toBorder < 0.9 * need2) {
        near++
        if (m[v]) wrong++
      } else if (toBorder > 1.15 * need2) {
        far++
        if (!m[v]) wrong++
      }
    }
    expect(near).toBeGreaterThan(50)
    expect(far).toBeGreaterThan(50)
    expect(wrong).toBe(0)
  })
})

describe('the highlight dabs on the sphere', () => {
  const s = STATS.plan.surfaces[0]!
  const sp = STATS.plan.front[0]!
  const sites = dabSitesOf(s, sp, PX, P)
  const radius = D.dabMinPx * PX

  it('finds the value maxima over 0.8 (a strict maximum of value + 0.01 key over the graph neighbourhood), the best of them, spaced', () => {
    expect(sites.length).toBeGreaterThanOrEqual(1)
    const score = (v: number) => sp.value[v] + 0.01 * sp.key[v]
    for (const site of sites) {
      expect(sp.value[site.vertex]).toBeGreaterThanOrEqual(DAB_MIN_VALUE)
      // the vertex's corner of its triangle
      expect(s.indices[3 * site.tri + (site.b1 === 1 ? 1 : site.b2 === 1 ? 2 : 0)]).toBe(site.vertex)
      // a strict maximum: no vertex within half the radius is as high
      let worstOther = -Infinity
      for (let v = 0; v < sp.value.length; v++) {
        if (s.canon[v] === s.canon[site.vertex]) continue
        const d = Math.hypot(s.positions[3 * v] - s.positions[3 * site.vertex], s.positions[3 * v + 1] - s.positions[3 * site.vertex + 1], s.positions[3 * v + 2] - s.positions[3 * site.vertex + 2])
        if (d < 0.5 * radius) worstOther = Math.max(worstOther, score(v))
      }
      expect(worstOther).toBeLessThan(site.score)
    }
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i].vertex
        const b = sites[j].vertex
        expect(Math.hypot(s.positions[3 * a] - s.positions[3 * b], s.positions[3 * a + 1] - s.positions[3 * b + 1], s.positions[3 * a + 2] - s.positions[3 * b + 2])).toBeGreaterThanOrEqual(radius - 1e-9)
      }
      if (i > 0) expect(sites[i].score).toBeLessThanOrEqual(sites[i - 1].score)
    }
  })

  it('keeps the top detect.dabTopFraction of the candidates, at least one: a plan with highlights all over has dabs on a fraction of them', () => {
    // on this sphere there is one highlight
    expect(sites.length).toBeLessThanOrEqual(Math.max(1, Math.ceil(D.dabTopFraction * s.positions.length / 3)))
  })
})

describe('the dabs on a clipped highlight', () => {
  // A flat sheet whose value is 0.9 on a square plateau (a highlight clipped by the light's top) and 0.5 elsewhere.
  const quad = refineSurface(quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], n: 8 }), 0, 0.02, 200_000)
  const nv = quad.positions.length / 3
  const plan = (key: (x: number, y: number) => number): SidePlan => {
    const value = new Float32Array(nv)
    const k = new Float32Array(nv)
    for (let v = 0; v < nv; v++) {
      const x = quad.positions[3 * v]
      const y = quad.positions[3 * v + 1]
      value[v] = x >= 0.3 && x <= 0.7 && y >= 0.3 && y <= 0.7 ? 0.9 : 0.5
      k[v] = key(x, y)
    }
    return { value, key: k } as unknown as SidePlan
  }

  it('has no strict maximum on a plateau of equal values and equal N·L (a tie is no maximum), and finds the one point a hair of N·L raises over it', () => {
    expect(dabSitesOf(quad, plan(() => 0.5), 0.01, P)).toEqual([])
    // the key rises toward (0.7, 0.7): that vertex is the strict maximum of value + 0.01 key
    const sites = dabSitesOf(quad, plan((x, y) => x + 1e-3 * y), 0.01, P)
    expect(sites.length).toBe(1)
    // (the plateau's last vertex: the mesh's own vertices are 1/64 apart)
    expect(Math.abs(quad.positions[3 * sites[0].vertex] - 0.7)).toBeLessThan(0.02)
    expect(Math.abs(quad.positions[3 * sites[0].vertex + 1] - 0.7)).toBeLessThan(0.02)
  })
})

describe('the nearest particle of a mark', () => {
  it('is the nearest, by a hash grid, to any point, including one far from every particle', () => {
    const { particles } = SPHERE
    const ids = Array.from({ length: particles.count }, (_, i) => i).filter((i) => particles.mark[i] === 0)
    const grid = new ParticleGrid(particles.position, ids, 0.12)
    for (let k = 0; k < 60; k++) {
      const a = k * 2.399963
      const z = 1 - (2 * (k + 0.5)) / 60
      const r = Math.sqrt(1 - z * z)
      const h = k % 3 === 0 ? 3 : 1
      const p = [h * r * Math.cos(a), h * r * Math.sin(a), h * z]
      let best = -1
      let bd = Infinity
      for (const i of ids) {
        const d = (particles.position[3 * i] - p[0]) ** 2 + (particles.position[3 * i + 1] - p[1]) ** 2 + (particles.position[3 * i + 2] - p[2]) ** 2
        if (d < bd || (d === bd && i < best)) {
          bd = d
          best = i
        }
      }
      expect(grid.nearest(p[0], p[1], p[2])).toBe(best)
    }
    expect(new ParticleGrid(particles.position, [], 0.1).nearest(0, 0, 0)).toBe(-1)
  })
})

