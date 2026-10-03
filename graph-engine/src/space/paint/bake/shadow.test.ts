import { describe, expect, it, vi } from 'vitest'
import { randomFor } from '../../../style/random'
import type { SpaceScene } from '../../scene/types'
import { DEFAULT_PAINT_PARAMS } from '../params'
import type { GBuffer, PaintView } from '../types'
import { computeOcclusion } from '../model/value'
import { meshGBuffer, paintView, quadMesh, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { gIndex, makeFrameCtx, project } from '../model/view'
import { occlusionAt } from './occlusion'
import { makeShadowCaster, type ShadowCaster } from './shadow'
import { refineSurface } from './surface'

vi.setConfig({ testTimeout: 60_000 })

const V = { vis: 0, dist: 0 }

// A sphere (r 1, centre (0, 0, 1.5)) over a table at z = 0.
const SPHERE = sphereMesh({ radius: 1, centre: [0, 0, 1.5], index: 0 })
const TABLE = tableMesh({ z: 0, half: 4, index: 1 })
const SCENE = sceneOf([SPHERE, TABLE])

// The exact shadow (valueFinalFixture.ts `occluded`): the ray from p toward the light meets the sphere.
function occluded(p: readonly number[], L: readonly number[], c: readonly number[], r: number): boolean {
  const ox = p[0] - c[0]
  const oy = p[1] - c[1]
  const oz = p[2] - c[2]
  const b = ox * L[0] + oy * L[1] + oz * L[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  return disc >= 0 && -b + Math.sqrt(disc) > 0 && cc > 0
}
// How far the ray from p toward the light passes from the sphere's surface (negative: through it).
function missBy(p: readonly number[], L: readonly number[], c: readonly number[], r: number): number {
  const w = [c[0] - p[0], c[1] - p[1], c[2] - p[2]]
  const along = w[0] * L[0] + w[1] * L[1] + w[2] * L[2]
  return Math.sqrt(Math.max(0, w[0] * w[0] + w[1] * w[1] + w[2] * w[2] - along * along)) - r
}

describe('the shadow caster', () => {
  const caster = makeShadowCaster(SCENE, [0, 0, 1])

  it('has the shadow map’s texel: (2 · bounding radius · 1.02) / 1024', () => {
    // the bounds of the opaque meshes: the table's corners (±4, ±4, 0) and the sphere's (z up to 2.5), about their box centre (0, 0, 1.25)
    const radius = Math.hypot(4, 4, 1.25)
    expect(caster.radius).toBeCloseTo(radius, 9)
    expect(caster.texel).toBeCloseTo((2 * radius * 1.02) / 1024, 12)
  })

  it('shadows the table under the sphere, at the distance to its underside, lights the open table, and lights the top of the sphere', () => {
    caster.visibility(0, 0, 0, 0, 0, 1, V)
    expect(V.vis).toBeLessThan(0.5)
    expect(Math.abs(V.dist - 0.5)).toBeLessThan(caster.texel)
    caster.visibility(3, 0, 0, 0, 0, 1, V)
    expect(V.vis).toBe(1)
    expect(V.dist).toBe(Infinity)
    caster.visibility(0, 0, 2.5, 0, 0, 1, V)
    expect(V.vis).toBe(1)
  })

  it('gives a penumbra at the edge: a fraction of the five rays, and a vote of one half or more flips the flag', () => {
    // the sphere's shadow edge on the table is the circle of radius 1 about the origin (light straight down)
    const fractions = new Set<number>()
    for (let k = 0; k < 40; k++) {
      caster.visibility(1 - 0.5 * caster.texel + (k / 40) * caster.texel, 0, 0, 0, 0, 1, V)
      fractions.add(V.vis)
    }
    expect([...fractions].some((f) => f > 0 && f < 1)).toBe(true)
    expect([...fractions].every((f) => [0, 0.2, 0.4, 0.6, 0.8, 1].some((q) => Math.abs(q - f) < 1e-9))).toBe(true)
  })

  it('agrees with the exact shadow of a sphere on 98% or more of a table’s vertices outside a one-texel band, for four lights (90, 62, 38 and 20 degrees)', () => {
    const table = refineSurface(TABLE, 1, 0.08, 400_000)
    const nv = table.positions.length / 3
    expect(nv).toBeGreaterThan(5000)
    const c = [0, 0, 1.5]
    for (const elevation of [90, 62, 38, 20]) {
      const e = (elevation * Math.PI) / 180
      const L = [Math.cos(e) * Math.cos(0.7), Math.cos(e) * Math.sin(0.7), Math.sin(e)]
      const cast = makeShadowCaster(SCENE, L)
      let compared = 0
      let agree = 0
      let inBand = 0
      for (let i = 0; i < nv; i++) {
        const p = [table.positions[3 * i], table.positions[3 * i + 1], table.positions[3 * i + 2]]
        const miss = missBy(p, L, c, 1)
        // the exact edge, with the cast's own softness: one texel across the light, and the bias that lifts a ray off the table
        if (Math.abs(miss) < cast.texel) {
          inBand++
          continue
        }
        cast.visibility(p[0], p[1], p[2], 0, 0, 1, V)
        compared++
        if ((V.vis < 0.5) === occluded(p, L, c, 1)) agree++
      }
      expect(compared, `${elevation}`).toBeGreaterThan(nv * 0.9)
      expect(agree / compared, `elevation ${elevation}`).toBeGreaterThanOrEqual(0.98)
      expect(inBand).toBeLessThan(nv * 0.05)
    }
  })

  it('knows a point inside a closed mesh: the first hit of any ray from it is the back of the mesh, and an open sheet has no inside', () => {
    const c = makeShadowCaster(SCENE, [0, 0, 1])
    // (rays a hair off the axes: one exactly along an axis through a pole can slip between the triangles of its fan)
    expect(c.inside(0.01, 0.02, 1.5, 0.01, 0.013, 1)).toBe(true) // the middle of the sphere
    expect(c.inside(0.3, 0.2, 1.2, 0.6, 0, 0.8)).toBe(true)
    expect(c.inside(0.01, 0.02, 3.5, 0.01, 0.013, 1)).toBe(false) // above it
    expect(c.inside(3, 0.01, 0.5, 0.01, 0.013, 1)).toBe(false) // beside it
    expect(c.inside(0.01, 0.02, 0.2, 0.01, 0.013, 1)).toBe(false) // under it: the ray meets the sphere's front, its bottom
    expect(c.inside(0.01, 0.02, 0.2, 0.01, 0.013, -1)).toBe(false) // and the table is open: from above or below, hit as a sheet
    expect(c.inside(0.01, 0.02, -0.2, 0.01, 0.013, 1)).toBe(false)
    // a table point lifted into a sphere that rests on it is in its shadow, at distance 0
    const resting = sceneOf([sphereMesh({ radius: 1, centre: [0, 0, 1], index: 0 }), tableMesh({ z: 0, half: 4, index: 1 })])
    const r = makeShadowCaster(resting, [0, 0, 1])
    r.visibility(0, 0, 0, 0, 0, 1, V)
    expect(V.vis).toBe(0)
    expect(V.dist).toBeLessThan(0.05)
  })

  it('does not let a veil cast, and does let a table cast', () => {
    const veil = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0], n: 2, opacity: 0.4, index: 0 })
    const onlyVeil = makeShadowCaster(sceneOf([veil, tableMesh({ z: 0, half: 3, index: 1 })]), [0, 0, 1])
    onlyVeil.visibility(0, 0, 0, 0, 0, 1, V)
    expect(V.vis).toBe(1)
    // the same sheet opaque casts
    const opaque = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0], n: 2, index: 0 })
    const casts = makeShadowCaster(sceneOf([opaque, tableMesh({ z: 0, half: 3, index: 1 })]), [0, 0, 1])
    casts.visibility(0, 0, 0, 0, 0, 1, V)
    expect(V.vis).toBe(0)
    expect(V.dist).toBeCloseTo(1, 2)
    // and a table casts onto what is below it
    const under = makeShadowCaster(sceneOf([tableMesh({ z: 1, half: 3, index: 0 }), sphereMesh({ radius: 0.4, centre: [0, 0, 0], index: 1 })]), [0, 0, 1])
    under.visibility(0, 0, 0.4, 0, 0, 1, V)
    expect(V.vis).toBeLessThan(0.5)
  })
})

describe('world occlusion', () => {
  // a sphere sitting on the table (centre (0, 0, 1), radius 1): they touch at the origin
  const resting = sceneOf([sphereMesh({ radius: 1, centre: [0, 0, 1], index: 0 }), tableMesh({ z: 0, half: 4, index: 1 })])
  const caster: ShadowCaster = makeShadowCaster(resting, [0, 0, 1])
  const ao = (x: number, y: number, z: number, nz: number, radius: number, seed = 1): number => {
    const rng = randomFor('test/ao', seed)
    return occlusionAt(resting, caster, x, y, z, 0, 0, nz, radius, () => rng.next())
  }

  it('is high at the contact ring of a sphere on a table, and zero on the open table and on the sphere’s top', () => {
    expect(ao(0.4, 0, 0, 1, 0.3)).toBeGreaterThan(0.2)
    expect(ao(0, -0.45, 0, 1, 0.3)).toBeGreaterThan(0.2)
    expect(ao(3, 0, 0, 1, 0.3)).toBe(0)
    expect(ao(0, 0, 2, 1, 0.3)).toBe(0)
  })

  it('is full at the very contact, where the table point is lifted into the sphere that rests on it', () => {
    expect(ao(0, 0, 0, 1, 0.3)).toBe(1)
    expect(ao(0.004, 0, 0, 1, 0.3)).toBe(1)
    // and an open sheet above a point does not count as a solid: it is an occluder at its distance
    const sheet = sceneOf([quadMesh({ origin: [-2, -2, 0.1], e1: [4, 0, 0], e2: [0, 4, 0], n: 4, index: 0 }), tableMesh({ z: 0, half: 4, index: 1 })])
    const under = makeShadowCaster(sheet, [0, 0, 1])
    const rng = randomFor('test/ao', 3)
    const value = occlusionAt(sheet, under, 0, 0, 0, 0, 0, 1, 0.3, () => rng.next())
    expect(value).toBeGreaterThan(0.5)
    expect(value).toBeLessThanOrEqual(1)
  })

  it('falls off with the distance from the contact, and is the same for the same seed and different for another', () => {
    const near = ao(0.3, 0, 0, 1, 0.3)
    const far = ao(1.2, 0, 0, 1, 0.3)
    expect(near).toBeGreaterThan(far)
    expect(ao(0.3, 0, 0, 1, 0.3, 1)).toBe(near)
    expect(ao(0.3, 0, 0, 1, 0.3, 2)).not.toBe(near)
    expect(near).toBeLessThanOrEqual(1)
  })

  it('looks only at its own side: the underside of the table, with the sphere above it, sees nothing', () => {
    expect(ao(0.4, 0, 0, -1, 0.3)).toBe(0)
  })

  it('draws 17 numbers from the stream per point, in order (so a bake does not depend on anything else)', () => {
    let n = 0
    occlusionAt(resting, caster, 0.4, 0, 0, 0, 0, 1, 0.3, () => (n++ * 0.37) % 1)
    expect(n).toBe(17)
    n = 0
    expect(occlusionAt(resting, caster, 0.4, 0, 0, 0, 0, 1, 0, () => (n++ * 0.37) % 1)).toBe(0)
    expect(n).toBe(0)
  })
})

describe('world occlusion against the screen-space version (calibration; the numbers are in the task report)', () => {
  const params = DEFAULT_PAINT_PARAMS
  const R = params.environment.occlusionRadiusPx / 120 // the radius in world units at zoom 120

  // Both versions over the visible points of one mark, at the given (x, y, z) points on a surface whose normal is +z.
  function compare(scene: SpaceScene, view: PaintView, g: GBuffer, mark: number, points: [number, number, number][]): { screen: number; world: number; n: number } {
    const fc = makeFrameCtx(scene, view, g, params)
    const screen = new Float32Array(g.width * g.height)
    computeOcclusion(fc, screen)
    const caster = makeShadowCaster(scene, view.lightDir)
    const rng = randomFor('calibration/ao', 1)
    const out = [0, 0, 0]
    let s = 0
    let w = 0
    let n = 0
    for (const [x, y, z] of points) {
      project(fc, x, y, z, out)
      const gi = gIndex(fc, out[0], out[1])
      if (gi < 0 || g.mark[gi] !== mark) continue // hidden from this camera
      s += screen[gi]
      w += occlusionAt(scene, caster, x, y, z, 0, 0, 1, R, () => rng.next())
      n++
    }
    return { screen: s / n, world: w / n, n }
  }

  it('on the sphere-on-table fixture: the contact ring is dark in the world and the screen version sees nothing there (its depth window never reaches the sphere); the open table is 0 in both', () => {
    const scene = sceneOf([sphereMesh({ radius: 1, index: 0 }), tableMesh({ z: -1, half: 3, index: 1 })])
    const ring = (lo: number, hi: number): [number, number, number][] => {
      const pts: [number, number, number][] = []
      for (let a = 0; a < 360; a += 3) for (let k = 0; k <= 6; k++) pts.push([(lo + ((hi - lo) * k) / 6) * Math.cos((a * Math.PI) / 180), (lo + ((hi - lo) * k) / 6) * Math.sin((a * Math.PI) / 180), -1])
      return pts
    }
    const report: string[] = []
    let contactWorld = 0
    for (const elevation of [25, 45]) {
      const view = paintView({ width: 640, height: 480, azimuth: 30, elevation, zoom: 120 })
      const g = sphereGBuffer(640, 480, { view, params, table: { z: -1, mark: 1 } })
      const contact = compare(scene, view, g, 1, ring(0.25, 0.5))
      const open = compare(scene, view, g, 1, ring(1.8, 2.8))
      report.push(`elevation ${elevation}: contact ring 0.25-0.5 from the contact: screen ${contact.screen.toFixed(3)} world ${contact.world.toFixed(3)} (${contact.n} pts); open table 1.8-2.8: screen ${open.screen.toFixed(3)} world ${open.world.toFixed(3)}`)
      expect(contact.n).toBeGreaterThan(30)
      expect(open.screen).toBeLessThan(0.01)
      expect(open.world).toBeLessThan(0.01)
      contactWorld = Math.max(contactWorld, contact.world)
    }
    console.log(['AO calibration, R = ' + params.environment.occlusionRadiusPx + 'px = ' + R.toFixed(3) + ' world.', ...report].join(' // '))
    expect(contactWorld).toBeGreaterThan(0.3)
  })

  it('at a crease, which is what the screen version is made for, the two agree in magnitude: floor beside a wall, 0.01 to 0.08 from it', () => {
    const floor = tableMesh({ z: 0, half: 3, index: 0 })
    const wall = quadMesh({ origin: [-1, -3, 0], e1: [0, 6, 0], e2: [0, 0, 3], n: 8, index: 1 })
    const scene = sceneOf([floor, wall])
    const view = paintView({ width: 640, height: 480, azimuth: -30, elevation: 30, zoom: 120, target: [0, 0, 0.5] })
    const g = meshGBuffer(640, 480, [{ mesh: floor, mark: 0 }, { mesh: wall, mark: 1 }], { view, params })
    const band = (lo: number, hi: number): [number, number, number][] => {
      const pts: [number, number, number][] = []
      for (let y = -1.5; y <= 1.5; y += 0.05) for (let k = 0; k <= 6; k++) pts.push([-1 + lo + ((hi - lo) * k) / 6, y, 0])
      return pts
    }
    const near = compare(scene, view, g, 0, band(0.01, 0.04))
    const next = compare(scene, view, g, 0, band(0.04, 0.08))
    const far = compare(scene, view, g, 0, band(0.5, 1.5))
    console.log(
      `AO calibration at a crease (R ${R.toFixed(3)} world): 0.01-0.04 from the wall: screen ${near.screen.toFixed(3)} world ${near.world.toFixed(3)}; ` +
        `0.04-0.08: screen ${next.screen.toFixed(3)} world ${next.world.toFixed(3)}; away from it: screen ${far.screen.toFixed(3)} world ${far.world.toFixed(3)}`,
    )
    for (const p of [near, next]) {
      expect(p.screen).toBeGreaterThan(0.1)
      expect(p.world / p.screen).toBeGreaterThan(0.5)
      expect(p.world / p.screen).toBeLessThan(2)
    }
    expect(far.screen).toBeLessThan(0.01)
    expect(far.world).toBeLessThan(0.01)
  })
})
