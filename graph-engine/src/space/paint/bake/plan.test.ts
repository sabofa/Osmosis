import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { buildParticles } from '../model/particles'
import { flatColours, quadMesh, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { RING_PX } from '../model/underpaint'
import { worldLight } from '../model/valueFinalFixture'
import { FAM_LIGHT, FAM_SHADOW, familyBound, holdFamily, newZoneSample, planSample, type PlanMap } from '../model/value'
import { buildWorldPlan, familyBoundAt, holdFamilyAt, newPlanAt, planAt, triangleGradients, type SidePlan, type WorldPlan } from './plan'
import { locate, normalOf, refineSurface, type SurfacePoint } from './surface'

// A plan over a refined surface is heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS
const PX = 1 / 150 // world units per CSS px
const LIGHT = worldLight(30, 40)

// A sphere (r 1) on a table at z = -1, as the value tests' fixture.
const SPHERE = sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 })
const TABLE = tableMesh({ z: -1, half: 3, index: 1 })
const SCENE = sceneOf([SPHERE, TABLE])
const PLAN = buildWorldPlan(SCENE, LIGHT, P, PX)

const sides = (plan: WorldPlan, m: number): [1 | -1, SidePlan][] => {
  const out: [1 | -1, SidePlan][] = [[1, plan.front[m]!]]
  if (plan.back[m]) out.push([-1, plan.back[m]!])
  return out
}

const dist = (p: Float64Array, a: number, b: number): number => Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2])

describe('buildWorldPlan: what it is made of', () => {
  it('has a refined surface and a plan for each mesh, both sides of an open one and one side of a closed one', () => {
    expect(PLAN.surfaces.every((s) => s !== null)).toBe(true)
    expect(PLAN.surfaces[0]!.closed).toBe(true)
    expect(PLAN.back[0]).toBeNull()
    expect(PLAN.surfaces[1]!.closed).toBe(false)
    expect(PLAN.back[1]).not.toBeNull()
    expect(Array.from(PLAN.ground)).toEqual([0, 1])
    expect(Array.from(PLAN.veil)).toEqual([0, 0])
    expect(PLAN.referenceWorldPerPx).toBe(PX)
    expect(PLAN.lightDir.map((v) => v.toFixed(9))).toEqual(LIGHT.map((v) => v.toFixed(9)))
    expect(PLAN.stats.triangles).toBe(PLAN.surfaces[0]!.indices.length / 3 + PLAN.surfaces[1]!.indices.length / 3)
    expect(PLAN.stats.budgetHit).toBe(false)
  })

  it('refines every surface to the underpainting’s 12 px cell at most, away from the boundaries too', () => {
    for (const s of PLAN.surfaces) {
      let longest = 0
      for (let t = 0; t < s!.indices.length / 3; t++) {
        for (let e = 0; e < 3; e++) longest = Math.max(longest, dist(s!.positions, s!.indices[3 * t + e], s!.indices[3 * t + ((e + 1) % 3)]))
      }
      expect(longest).toBeLessThanOrEqual(12 * PX + 1e-9)
    }
  })

  it('makes every vertex’s u exactly planSample of its own inputs (it is the same function), and bare lit ground the canvas value', () => {
    const zs = newZoneSample()
    let checked = 0
    let canvas = 0
    PLAN.surfaces.forEach((s, m) => {
      for (const [side, sp] of sides(PLAN, m)) {
        for (let i = 0; i < s!.positions.length / 3; i++) {
          const shadow = sp.shadow[i] === 1
          if (PLAN.ground[m] === 1 && !shadow) {
            expect(sp.u[i]).toBe(Math.fround(PLAN.uCanvas))
            expect(sp.fam[i]).toBe(FAM_LIGHT)
            canvas++
            continue
          }
          planSample(P, PLAN.curves, sp.nl[i], shadow, side * s!.normals[3 * i], side * s!.normals[3 * i + 1], side * s!.normals[3 * i + 2], sp.ao[i], zs)
          expect(sp.u[i]).toBe(Math.fround(zs.u))
          expect(sp.zone[i]).toBe(zs.zone)
          expect(sp.fam[i]).toBe(zs.fam)
          expect(sp.lightW[i]).toBe(Math.fround(zs.w[0] + 0.6 * zs.w[1]))
          expect(sp.shadowW[i]).toBe(Math.fround(zs.w[2] + zs.w[4]))
          expect(sp.reflW[i]).toBe(Math.fround(zs.w[3]))
          checked++
        }
      }
    })
    expect(checked).toBeGreaterThan(5000)
    expect(canvas).toBeGreaterThan(1000)
  })

  it('has the capU and floorU of the plan map: the curve applied to the cap and to the darkest half-tone, the canvas above both', () => {
    expect(PLAN.capU).toBeLessThan(PLAN.floorU)
    expect(PLAN.uCanvas).toBeGreaterThan(PLAN.floorU)
  })
})

describe('buildWorldPlan: the light, the shadow and the sides', () => {
  const L = LIGHT
  it('puts the sphere’s terminator at N·L = 0: the lit side is the light family, the far side the shadow family, with the signed N·L stored', () => {
    const s = PLAN.surfaces[0]!
    const sp = PLAN.front[0]!
    let lit = 0
    let dark = 0
    for (let i = 0; i < s.positions.length / 3; i++) {
      const nl = s.normals[3 * i] * L[0] + s.normals[3 * i + 1] * L[1] + s.normals[3 * i + 2] * L[2]
      expect(sp.nl[i]).toBeCloseTo(nl, 6)
      if (nl > 0.2 && sp.shadow[i] === 0) {
        expect(sp.fam[i]).toBe(FAM_LIGHT)
        lit++
      }
      if (nl < -0.2) {
        expect(sp.fam[i]).toBe(FAM_SHADOW)
        expect(sp.shadow[i]).toBe(1)
        dark++
      }
    }
    expect(lit).toBeGreaterThan(300)
    expect(dark).toBeGreaterThan(300)
  })

  it('casts the sphere’s shadow on the table, lights the rest of it as canvas, and darkens the contact', () => {
    const s = PLAN.surfaces[1]!
    const sp = PLAN.front[1]!
    let cast = 0
    let lit = 0
    let castFar = 0
    let castFarU = 0
    let underU = 0
    let underN = 0
    for (let i = 0; i < s.positions.length / 3; i++) {
      const rho = Math.hypot(s.positions[3 * i], s.positions[3 * i + 1])
      if (sp.shadow[i] === 1) {
        cast++
        expect(sp.shadowDist[i]).toBeGreaterThan(0)
        expect(sp.shadowDist[i]).toBeLessThan(Infinity)
        expect(sp.fam[i]).toBe(FAM_SHADOW)
        if (rho > 1.5) {
          castFar++
          castFarU += sp.u[i]
        }
        if (rho < 0.3) {
          underU += sp.u[i]
          underN++
          // (the sphere hangs over the table by 0.01 at 0.15 from the contact, and 0.05 at 0.3: within the radius of 14 px = 0.09 it shuts out the sky)
          if (rho < 0.15) expect(sp.ao[i]).toBeGreaterThan(0.3)
        }
      } else {
        lit++
        expect(sp.vis[i]).toBeGreaterThanOrEqual(0.5)
      }
    }
    expect(cast).toBeGreaterThan(500)
    expect(lit).toBeGreaterThan(5000)
    expect(underN).toBeGreaterThan(5)
    expect(castFar).toBeGreaterThan(5)
    // the occlusion takes the cast shadow down toward its contact value, under the sphere
    expect(underU / underN).toBeLessThan(castFarU / castFar)
  })

  it('has the sphere’s bottom, which faces away from a light from above, with N·L under 0 and in the shadow, and its top lit', () => {
    const plan = buildWorldPlan(SCENE, worldLight(30, 89), P, PX)
    const s = plan.surfaces[0]!
    const sp = plan.front[0]!
    let bottom = 0
    let top = 0
    for (let i = 0; i < s.positions.length / 3; i++) {
      if (s.positions[3 * i + 2] < s.positions[3 * bottom + 2]) bottom = i
      if (s.positions[3 * i + 2] > s.positions[3 * top + 2]) top = i
    }
    expect(s.positions[3 * bottom + 2]).toBeCloseTo(-1, 6)
    expect(sp.nl[bottom]).toBeLessThan(-0.99)
    expect(sp.shadow[bottom]).toBe(1)
    expect(sp.nl[top]).toBeGreaterThan(0.99)
    expect(sp.shadow[top]).toBe(0)
    expect(sp.fam[top]).toBe(FAM_LIGHT)
  })

  it('plans both sides of a single sheet: the side the normal points to is lit, the other is in the shadow family', () => {
    // a tilted sheet at about z = 1 (not bare table), and a flat one at z = 1 (bare table: the canvas where lit)
    for (const flat of [false, true]) {
      const sheet = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, flat ? 0 : 0.4], n: 6, index: 0 })
      const plan = buildWorldPlan(sceneOf([sheet]), [0.1, 0.05, 1], P, PX)
      expect(plan.ground[0]).toBe(flat ? 1 : 0)
      expect(plan.back[0]).not.toBeNull()
      const n = plan.surfaces[0]!.positions.length / 3
      for (let i = 0; i < n; i++) {
        expect(plan.front[0]!.nl[i]).toBeGreaterThan(0)
        expect(plan.front[0]!.shadow[i]).toBe(0)
        expect(plan.front[0]!.fam[i]).toBe(FAM_LIGHT)
        expect(plan.back[0]!.nl[i]).toBeLessThan(0)
        expect(plan.back[0]!.shadow[i]).toBe(1)
        expect(plan.back[0]!.fam[i]).toBe(FAM_SHADOW)
        expect(plan.back[0]!.u[i]).toBeLessThanOrEqual(plan.capU + 1e-6)
        expect(plan.front[0]!.u[i]).toBeGreaterThan(plan.back[0]!.u[i])
      }
    }
  })

  it('lights the other way round for a light from below: the back of the sheet is the lit side', () => {
    const sheet = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, index: 0 })
    const plan = buildWorldPlan(sceneOf([sheet]), [0.1, 0.05, -1], P, PX)
    expect(plan.front[0]!.fam[0]).toBe(FAM_SHADOW)
    expect(plan.back[0]!.fam[0]).toBe(FAM_LIGHT)
    expect(plan.back[0]!.shadow[0]).toBe(0)
  })

  it('makes a veil unshadowed and unoccluded, on both sides, and lets it cast nothing', () => {
    const veil = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, opacity: 0.4, index: 0 })
    const table = tableMesh({ z: 0, half: 3, index: 1 })
    const plan = buildWorldPlan(sceneOf([veil, table]), [0.1, 0.05, 1], P, PX)
    expect(Array.from(plan.veil)).toEqual([1, 0])
    for (const sp of [plan.front[0]!, plan.back[0]!]) {
      expect(sp.shadow.every((v) => v === 0)).toBe(true)
      expect(sp.ao.every((v) => v === 0)).toBe(true)
      expect(sp.vis.every((v) => v === 1)).toBe(true)
    }
    // the table below the veil is lit: the veil is not a caster
    expect(plan.front[1]!.shadow.every((v) => v === 0)).toBe(true)
    // the veil's two sides are lit by their own normals, as roles.ts whereOf lights a veil
    const zs = newZoneSample()
    const s = plan.surfaces[0]!
    planSample(P, plan.curves, plan.back[0]!.nl[3], false, -s.normals[9], -s.normals[10], -s.normals[11], 0, zs)
    expect(plan.back[0]!.u[3]).toBe(Math.fround(zs.u))
  })
})

describe('buildWorldPlan: adaptive refinement at the families’ boundaries', () => {
  it('leaves no triangle that straddles a family, the shadow flag or the terminator band with an edge over 3 px', () => {
    expect(PLAN.stats.unresolved).toBe(0)
    expect(PLAN.stats.passes).toBeGreaterThan(0)
    expect(PLAN.stats.passes).toBeLessThanOrEqual(6)
    const ring = RING_PX * PX * 1.01
    let mixed = 0
    PLAN.surfaces.forEach((s, m) => {
      for (const [, sp] of sides(PLAN, m)) {
        for (let t = 0; t < s!.indices.length / 3; t++) {
          const a = s!.indices[3 * t]
          const b = s!.indices[3 * t + 1]
          const c = s!.indices[3 * t + 2]
          if (sp.fam[a] === sp.fam[b] && sp.fam[b] === sp.fam[c]) continue
          mixed++
          for (let e = 0; e < 3; e++) expect(dist(s!.positions, s!.indices[3 * t + e], s!.indices[3 * t + ((e + 1) % 3)])).toBeLessThanOrEqual(ring)
        }
      }
    })
    expect(mixed).toBeGreaterThan(50)
  })

  it('refines only where it is asked to: far from a boundary the triangles stay at the 12 px cell', () => {
    // the open table, in the light, far from the cast shadow: 12 px (0.08 world) and not 3 px
    const s = PLAN.surfaces[1]!
    let near = 0
    for (let t = 0; t < s.indices.length / 3; t++) {
      const a = s.indices[3 * t]
      if (Math.hypot(s.positions[3 * a] + 2.6, s.positions[3 * a + 1] - 2.6) > 0.3) continue
      for (let e = 0; e < 3; e++) near = Math.max(near, dist(s.positions, s.indices[3 * t + e], s.indices[3 * t + ((e + 1) % 3)]))
    }
    expect(near).toBeGreaterThan(5 * PX)
  })

  it('stops at the triangle budget and says so in its stats', () => {
    const plan = buildWorldPlan(SCENE, LIGHT, P, PX, { maxTriangles: 12_000 })
    expect(plan.stats.budgetHit).toBe(true)
    // each mesh keeps within its area's share of the budget (or the triangles it came with)
    expect(plan.stats.triangles).toBeLessThanOrEqual(12_000 + 1)
    expect(plan.stats.triangles).toBeLessThan(PLAN.stats.triangles)
    expect(plan.surfaces.some((s) => s!.budgetHit)).toBe(true)
  })
})

describe('buildWorldPlan: determinism', () => {
  it('gives byte-identical arrays on two calls', () => {
    const again = buildWorldPlan(SCENE, LIGHT, P, PX)
    const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')
    PLAN.surfaces.forEach((s, m) => {
      const t = again.surfaces[m]!
      for (const k of ['positions', 'normals', 'indices', 'canon', 'adj', 'area', 'rawNormals'] as const) expect(bytes(t[k]), `surface ${m} ${k}`).toBe(bytes(s![k]))
      for (const [side, sp] of sides(PLAN, m)) {
        const other = side === 1 ? again.front[m]! : again.back[m]!
        for (const k of Object.keys(sp) as (keyof SidePlan)[]) expect(bytes(other[k]), `mark ${m} side ${side} ${k}`).toBe(bytes(sp[k]))
      }
    })
    expect(again.stats).toEqual(PLAN.stats)
  })

  it('changes with the seed (the occlusion’s rays) and with the light', () => {
    const other = buildWorldPlan(SCENE, LIGHT, resolvePaintParams({ seed: 7 }), PX)
    const aoOf = (p: WorldPlan) => Buffer.from(p.front[1]!.ao.buffer).toString('base64')
    expect(aoOf(other)).not.toBe(aoOf(PLAN))
    const turned = buildWorldPlan(SCENE, worldLight(120, 40), P, PX)
    expect(Buffer.from(turned.front[0]!.nl.buffer).toString('base64')).not.toBe(Buffer.from(PLAN.front[0]!.nl.buffer).toString('base64'))
  })
})

describe('the gradient per triangle', () => {
  it('is |∇ value| of the linear interpolant, per CSS px', () => {
    const quad = refineSurface(quadMesh({ origin: [0, 0, 0], e1: [1, 0, 0], e2: [0, 1, 0], n: 1 }), 0, 10, 100)
    // value = x + 2 y over a flat quad: |∇| = √5 per world unit
    const value = new Float32Array(quad.positions.length / 3)
    for (let i = 0; i < value.length; i++) value[i] = quad.positions[3 * i] + 2 * quad.positions[3 * i + 1]
    const out = new Float32Array(quad.indices.length / 3)
    triangleGradients(quad, value, 0.01, out)
    for (const g of out) expect(g).toBeCloseTo(Math.sqrt(5) * 0.01, 6)
    // over the plane spanned by (1, 0, 1) and (0, 1, 0), the function 3x has the gradient (3, 0, 0) projected into it: 3/2 (1, 0, 1), of length 3/√2
    const tilted = refineSurface(quadMesh({ origin: [0, 0, 0], e1: [1, 0, 1], e2: [0, 1, 0], n: 1 }), 0, 10, 100)
    for (let i = 0; i < tilted.positions.length / 3; i++) value[i] = 3 * tilted.positions[3 * i]
    triangleGradients(tilted, value, 1, out)
    for (const g of out) expect(g).toBeCloseTo(3 / Math.SQRT2, 5)
  })

  it('is zero on bare lit canvas and non-zero across the terminator', () => {
    const table = PLAN.front[1]!
    const s = PLAN.surfaces[1]!
    let zero = 0
    let any = 0
    for (let t = 0; t < s.indices.length / 3; t++) {
      const a = s.indices[3 * t]
      const b = s.indices[3 * t + 1]
      const c = s.indices[3 * t + 2]
      if (table.shadow[a] === 0 && table.shadow[b] === 0 && table.shadow[c] === 0) {
        expect(table.grad[t]).toBe(0)
        zero++
      } else if (table.grad[t] > 0) any++
    }
    expect(zero).toBeGreaterThan(1000)
    expect(any).toBeGreaterThan(20)
    const sphere = PLAN.front[0]!
    expect(Math.max(...sphere.grad)).toBeGreaterThan(0)
    expect(sphere.grad.every((g) => Number.isFinite(g) && g >= 0)).toBe(true)
  })
})

describe('the plan at a point, and for the particles', () => {
  const out = newPlanAt()

  it('is the vertex’s own values at a vertex, their mean between, and the nearest vertex’s zone and family', () => {
    const s = PLAN.surfaces[0]!
    const sp = PLAN.front[0]!
    const t = 1234
    const [a, b, c] = [s.indices[3 * t], s.indices[3 * t + 1], s.indices[3 * t + 2]]
    planAt(PLAN, 0, 1, { tri: t, b1: 0, b2: 0 }, out)
    expect(out.u).toBeCloseTo(sp.u[a], 6)
    expect(out.nl).toBeCloseTo(sp.nl[a], 6)
    expect(out.zone).toBe(sp.zone[a])
    expect(out.fam).toBe(sp.fam[a])
    planAt(PLAN, 0, 1, { tri: t, b1: 1 / 3, b2: 1 / 3 }, out)
    expect(out.u).toBeCloseTo((sp.u[a] + sp.u[b] + sp.u[c]) / 3, 6)
    expect(out.ao).toBeCloseTo((sp.ao[a] + sp.ao[b] + sp.ao[c]) / 3, 6)
    planAt(PLAN, 0, 1, { tri: t, b1: 0.1, b2: 0.8 }, out)
    expect(out.zone).toBe(sp.zone[c])
    // a closed mesh has no back: side -1 reads the front
    const back = newPlanAt()
    planAt(PLAN, 0, -1, { tri: t, b1: 0.1, b2: 0.8 }, back)
    expect(back.u).toBe(out.u)
    expect(() => planAt(PLAN, 5, 1, { tri: 0, b1: 0, b2: 0 }, out)).toThrow()
  })

  it('has the shadow distance only from the vertices that have one', () => {
    const s = PLAN.surfaces[1]!
    const sp = PLAN.front[1]!
    // a triangle with a cast vertex and a lit one
    for (let t = 0; t < s.indices.length / 3; t++) {
      const [a, b, c] = [s.indices[3 * t], s.indices[3 * t + 1], s.indices[3 * t + 2]]
      const ds = [sp.shadowDist[a], sp.shadowDist[b], sp.shadowDist[c]]
      if (ds.filter((d) => d === Infinity).length !== 1) continue
      planAt(PLAN, 1, 1, { tri: t, b1: 1 / 3, b2: 1 / 3 }, out)
      const finite = ds.filter((d) => d !== Infinity)
      expect(out.shadowDist).toBeCloseTo((finite[0] + finite[1]) / 2, 4)
      return
    }
    throw new Error('no such triangle')
  })

  it('has the family bound of value.ts at the point: the cap for shadow, the floor for light, the plan’s own where it is beyond', () => {
    const shadow = newPlanAt()
    shadow.fam = FAM_SHADOW
    shadow.u = PLAN.capU - 0.05
    expect(familyBoundAt(PLAN, shadow)).toBe(PLAN.capU)
    shadow.u = PLAN.capU + 0.03
    expect(familyBoundAt(PLAN, shadow)).toBe(PLAN.capU + 0.03)
    const light = newPlanAt()
    light.fam = FAM_LIGHT
    light.u = PLAN.floorU + 0.2
    expect(familyBoundAt(PLAN, light)).toBe(PLAN.floorU)
    light.u = PLAN.floorU - 0.01
    expect(familyBoundAt(PLAN, light)).toBe(PLAN.floorU - 0.01)
    // held inside the family: a shadow stroke is at most the bound, a light one at least
    shadow.u = PLAN.capU - 0.05
    expect(holdFamilyAt(PLAN, shadow, 0.9)).toBe(PLAN.capU)
    expect(holdFamilyAt(PLAN, shadow, 0.01)).toBe(0.01)
    light.u = PLAN.floorU + 0.2
    expect(holdFamilyAt(PLAN, light, 0.01)).toBe(PLAN.floorU)
    expect(holdFamilyAt(PLAN, light, 0.9)).toBe(0.9)
    // and it is value.ts's own function
    const pm = { fam: [FAM_SHADOW], u: [shadow.u], capU: PLAN.capU, floorU: PLAN.floorU } as unknown as PlanMap
    expect(familyBoundAt(PLAN, { ...shadow, fam: FAM_SHADOW })).toBe(familyBound(pm, 0))
    expect(holdFamilyAt(PLAN, { ...shadow, fam: FAM_SHADOW }, 0.5)).toBe(holdFamily(pm, 0, 0.5))
  })

  it('finds every particle on its refined surface, and reads its normal and its plan there', () => {
    const set = buildParticles(SCENE, flatColours({ 0: [0.56, 0.1, 0.08], 1: [0.9, 0.01, 0.02] }), P)
    expect(set.count).toBeGreaterThan(1000)
    const zs = newZoneSample()
    const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const n = [0, 0, 0]
    let worstN = 0
    let close = 0
    let compared = 0
    for (let i = 0; i < set.count; i++) {
      const m = set.mark[i]
      const s = PLAN.surfaces[m]!
      const found = locate(s, set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2], set.normal[3 * i], set.normal[3 * i + 1], set.normal[3 * i + 2], 1e-4, p)
      expect(found, `particle ${i}`).toBe(true)
      normalOf(s, p, 1, n)
      worstN = Math.max(worstN, Math.hypot(n[0] - set.normal[3 * i], n[1] - set.normal[3 * i + 1], n[2] - set.normal[3 * i + 2]))
      planAt(PLAN, m, 1, p, out)
      // the plan at the particle against planSample at the particle's own normal (the plan's vertex values are interpolated, so a little apart)
      const nl = set.normal[3 * i] * LIGHT[0] + set.normal[3 * i + 1] * LIGHT[1] + set.normal[3 * i + 2] * LIGHT[2]
      if (m === 0) {
        compared++
        planSample(P, PLAN.curves, nl, nl <= 0, set.normal[3 * i], set.normal[3 * i + 1], set.normal[3 * i + 2], 0, zs)
        if (Math.abs(out.nl - nl) < 0.03 && Math.abs(out.u - zs.u) < 0.06) close++
      }
    }
    expect(worstN).toBeLessThan(1e-5)
    expect(close / compared).toBeGreaterThan(0.9)
  })
})
