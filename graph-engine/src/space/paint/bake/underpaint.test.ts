import { describe, expect, it, vi } from 'vitest'
import { linearToOklab } from '../model/colour'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { colourOfRecipe, newRecipe } from '../model/recipe'
import { clamp } from '../model/math'
import { flatColours, sceneOf, sphereMesh } from '../model/testing'
import { castWeight, FAM_LIGHT, FAM_SHADOW, Z_CAST, Z_LIGHT } from '../model/value'
import { resolvePaintParams } from '../params'
import { bakeStats } from './index'
import { buildSurfaceUnder, underpaintSide, UNDERPAINT_MIX } from './underpaint'
import { buildWorldPlan } from './plan'
import { fixture, flatSaddleScene, inwardSphere, P, PX, saddleColours, saddleScene, sparse, sphereColours, sphereScene, TERRACOTTA, veilScene, LIGHT } from './bakeFixture'
import { mixerOf } from '../model/underpaint'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const STATS = bakeStats(SPHERE.baked)!
const SADDLE = fixture(saddleScene(), saddleColours(), sparse(1200))
const TS = P.value.terminatorSoftness
const env = (params = P) => recipeEnv(params, curveFor(params), groundLocal(params))
const allFinite = (a: ArrayLike<number>): boolean => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

describe('the baked surfaces', () => {
  const [sphere, table] = SPHERE.baked.surfaces

  it('has a BakedSurface per mesh mark, Float32 copies of the refined surface, with the underpainting per vertex, for the sides that are painted', () => {
    expect(SPHERE.baked.surfaces.length).toBe(2)
    for (const [m, s] of [[0, sphere], [1, table]] as const) {
      const refined = STATS.plan.surfaces[m]!
      const nv = refined.positions.length / 3
      expect(s!.mark).toBe(m)
      expect(s!.positions).toBeInstanceOf(Float32Array)
      expect(s!.positions.length).toBe(3 * nv)
      expect(s!.normals.length).toBe(3 * nv)
      expect(s!.indices).toEqual(refined.indices)
      expect(s!.indices).not.toBe(refined.indices)
      expect(s!.underFront.length).toBe(3 * nv)
      expect(s!.alphaFront.length).toBe(nv)
      expect(s!.uFront.length).toBe(nv)
      expect(s!.famFront.length).toBe(nv)
      expect(s!.local.length).toBe(3 * nv)
      for (const a of [s!.positions, s!.normals, s!.underFront, s!.alphaFront, s!.uFront, s!.local]) expect(allFinite(a)).toBe(true)
    }
    // a closed opaque sphere is painted from its outside only; the table, an open sheet, from both
    expect(sphere!.closed).toBe(true)
    expect(sphere!.underBack).toBeNull()
    expect(sphere!.alphaBack).toBeNull()
    expect(sphere!.uBack).toBeNull()
    expect(sphere!.famBack).toBeNull()
    expect(table!.closed).toBe(false)
    expect(table!.underBack).not.toBeNull()
    expect(table!.alphaBack).not.toBeNull()
    expect(table!.uBack).not.toBeNull()
    expect(table!.famBack).not.toBeNull()
    expect(allFinite(table!.underBack!)).toBe(true)
  })

  it('writes the normals as the side +1 normals: orient x the mesh’s, so a closed sphere’s are OUTWARD whichever way the kernel pointed them', () => {
    for (const mesh of [sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 }), inwardSphere(0)]) {
      const f = fixture(sceneOf([mesh]), flatColours({ 0: TERRACOTTA }), sparse(150))
      const s = f.baked.surfaces[0]!
      expect(s.closed).toBe(true)
      let worst = 1
      for (let v = 0; v < s.positions.length / 3; v++) {
        const p = Math.hypot(s.positions[3 * v], s.positions[3 * v + 1], s.positions[3 * v + 2])
        worst = Math.min(worst, (s.normals[3 * v] * s.positions[3 * v] + s.normals[3 * v + 1] * s.positions[3 * v + 1] + s.normals[3 * v + 2] * s.positions[3 * v + 2]) / p)
      }
      expect(worst).toBeGreaterThan(0.99)
    }
  })

  it('says `closed` for a mesh painted from its outside only: a closed VEIL is seen from both sides, so it is not closed here; and a veil’s underpainting alpha is 0 everywhere', () => {
    const closedVeil = fixture(sceneOf([sphereMesh({ radius: 0.7, index: 0, nu: 24, nv: 16, opacity: 0.5 })]), flatColours({ 0: TERRACOTTA }), sparse(150))
    const s = closedVeil.baked.surfaces[0]!
    expect(s.closed).toBe(false)
    expect(s.underBack).not.toBeNull()
    expect(s.alphaFront.every((a) => a === 0)).toBe(true)
    expect(s.alphaBack!.every((a) => a === 0)).toBe(true)
    expect(s.underFront.every((c) => c === 0)).toBe(true)
    // (and a flat veil above a sphere: the same, with the sphere under it underpainted as usual)
    const veils = fixture(veilScene(), flatColours({ 0: [0.6, 0.05, 0.05], 1: [0.7, 0, 0] }), sparse(300))
    expect(veils.baked.surfaces[1]!.alphaFront.every((a) => a === 0)).toBe(true)
    expect(veils.baked.surfaces[0]!.alphaFront.some((a) => a === 1)).toBe(true)
  })

  it('lays no underpainting on lit bare table (alpha 0) and does on its cast shadow (alpha 1) and on every vertex of the sphere', () => {
    expect(sphere!.alphaFront.every((a) => a === 1)).toBe(true)
    const sp = STATS.plan.front[1]!
    let lit = 0
    let cast = 0
    let wrong = 0
    for (const [alpha, plan] of [[table!.alphaFront, STATS.plan.front[1]!], [table!.alphaBack!, STATS.plan.back[1]!]] as const) {
      for (let v = 0; v < alpha.length; v++) {
        const isCast = plan.zone[v] === Z_CAST
        if (isCast) cast++
        else lit++
        if (alpha[v] !== (isCast ? 1 : 0)) wrong++
      }
    }
    expect(sp.zone.some((z) => z === Z_LIGHT)).toBe(true)
    expect(lit).toBeGreaterThan(100)
    expect(cast).toBeGreaterThan(100)
    expect(wrong).toBe(0)
  })

  it('stores the plan value u and the family per vertex per side (the stroke value rule’s own, held in the family), and the local colour', () => {
    const plan = STATS.plan
    const fam = sphere!.famFront
    let light = 0
    let shadow = 0
    for (let v = 0; v < fam.length; v++) {
      expect(fam[v]).toBe(plan.front[0]!.fam[v])
      if (fam[v] === FAM_LIGHT) light++
      else shadow++
      expect(sphere!.uFront[v]).toBeGreaterThanOrEqual(0.02 - 1e-6)
      expect(sphere!.uFront[v]).toBeLessThanOrEqual(0.99 + 1e-6)
    }
    expect(light).toBeGreaterThan(100)
    expect(shadow).toBeGreaterThan(100)
    // the sphere's local colour is its flat colour at every vertex
    const flat = sphereColours().markColour(0)
    for (let v = 0; v < fam.length; v++) {
      expect(sphere!.local[3 * v]).toBeCloseTo(flat[0], 6)
      expect(sphere!.local[3 * v + 1]).toBeCloseTo(flat[1], 6)
      expect(sphere!.local[3 * v + 2]).toBeCloseTo(flat[2], 6)
    }
  })

  it('takes the colormap at the vertex’s own scalar on a colour-scaled surface (the saddle: height), and makes the underpainting vary with it', () => {
    const s = SADDLE.baked.surfaces[0]!
    const refined = bakeStats(SADDLE.baked)!.plan.surfaces[0]!
    expect(refined.scalars).not.toBeNull()
    const colours = saddleColours()
    let worst = 0
    for (let v = 0; v < s.positions.length / 3; v++) {
      const c = colours.scaleColour(0, refined.scalars![v])!
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(s.local[3 * v + k] - c[k]))
    }
    expect(worst).toBeLessThanOrEqual(1e-6)
    // the underpainting's hue turns with the colormap: a low vertex and a high one are not the same colour
    let lo = Infinity
    let hi = -Infinity
    for (let v = 0; v < refined.scalars!.length; v++) {
      lo = Math.min(lo, refined.scalars![v])
      hi = Math.max(hi, refined.scalars![v])
    }
    const at = (target: number): number => {
      let best = 0
      for (let v = 0; v < refined.scalars!.length; v++) if (Math.abs(refined.scalars![v] - target) < Math.abs(refined.scalars![best] - target)) best = v
      return best
    }
    const a = at(lo)
    const b = at(hi)
    const ca = linearToOklab(s.underFront[3 * a], s.underFront[3 * a + 1], s.underFront[3 * a + 2])
    const cb = linearToOklab(s.underFront[3 * b], s.underFront[3 * b + 1], s.underFront[3 * b + 2])
    expect(Math.hypot(ca[1] - cb[1], ca[2] - cb[2])).toBeGreaterThan(0.02)
  })
})

describe('the underpainting’s colours and the value rule', () => {
  // For every vertex of every opaque surface and side: the colour's lightness against the lightness of the vertex's own recipe at the family's
  // bound. Returns the margins (positive = inside the bound) of the shadow and light families (outside the terminator's band, which is held to
  // none: it is the plan's own edge).
  function margins() {
    const { under } = (() => {
      const m = buildSurfaceUnder(SPHERE.scene, SPHERE.colours, P, curveFor(P), STATS.plan, STATS.planes, 0)
      const t = buildSurfaceUnder(SPHERE.scene, SPHERE.colours, P, curveFor(P), STATS.plan, STATS.planes, 1)
      return { under: [m, t] }
    })()
    const e = env()
    let shadow = Infinity
    let light = Infinity
    let nShadow = 0
    let nLight = 0
    let uShadow = Infinity
    let uLight = Infinity
    const r = newRecipe()
    for (const [k, u] of under.entries()) {
      const surface = SPHERE.baked.surfaces[k]!
      for (const [sideIndex, side] of [[0, u.under.front], [1, u.under.back]] as const) {
        if (!side) continue
        const colours = sideIndex === 0 ? surface.underFront : surface.underBack!
        for (let v = 0; v < u.under.nv; v++) {
          if (side.band[v] === 1 || side.alpha[v] === 0 && u.under.ground) continue
          r.ground = u.under.ground
          r.lx = u.under.local[3 * v]
          r.ly = u.under.local[3 * v + 1]
          r.lz = u.under.local[3 * v + 2]
          r.u = side.bound[v]
          r.nz = side.nz[v]
          r.bounce = side.bounce[v]
          r.ambientShare = side.amb[v]
          r.hasPlane = !Number.isNaN(side.plane[3 * v])
          r.pnx = r.hasPlane ? side.plane[3 * v] : 0
          r.pny = r.hasPlane ? side.plane[3 * v + 1] : 0
          r.pnz = r.hasPlane ? side.plane[3 * v + 2] : 0
          r.colormapped = false
          r.field = true
          r.px = u.under.positions[3 * v]
          r.py = u.under.positions[3 * v + 1]
          r.pz = u.under.positions[3 * v + 2]
          const bound = colourOfRecipe(r, e)[0]
          const L = linearToOklab(colours[3 * v], colours[3 * v + 1], colours[3 * v + 2])[0]
          if (side.fam[v] === FAM_SHADOW) {
            shadow = Math.min(shadow, bound - L)
            uShadow = Math.min(uShadow, side.bound[v] - side.u[v])
            nShadow++
          } else {
            light = Math.min(light, L - bound)
            uLight = Math.min(uLight, side.u[v] - side.bound[v])
            nLight++
          }
        }
      }
    }
    return { shadow, light, nShadow, nLight, uShadow, uLight }
  }

  it('keeps every shadow-family vertex’s lightness at or under its family bound and every light-family vertex’s at or over it, mix and all', () => {
    const m = margins()
    expect(m.nShadow).toBeGreaterThan(500)
    expect(m.nLight).toBeGreaterThan(500)
    expect(m.shadow, 'shadow family').toBeGreaterThanOrEqual(-5e-5)
    expect(m.light, 'light family').toBeGreaterThanOrEqual(-5e-5)
    expect(m.uShadow).toBeGreaterThanOrEqual(-1e-6)
    expect(m.uLight).toBeGreaterThanOrEqual(-1e-6)
  })

  it('holds under the loudest mix, with the underpainting’s own half strength: no vertex crosses its family’s bound', () => {
    const loud = resolvePaintParams({ particles: { maxPerUnit2: 250 }, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: 1 } })
    const f = fixture(sphereScene(), sphereColours(), loud)
    const stats = bakeStats(f.baked)!
    const e = env(loud)
    const curve = curveFor(loud)
    const u = buildSurfaceUnder(f.scene, f.colours, loud, curve, stats.plan, stats.planes, 0).under
    // (the side's colours made again from the recipes under the loud mix: the bake's own functions)
    const colours = underpaintSide(u, u.front, loud, e, mixerOf(loud))
    const r = newRecipe()
    let worst = Infinity
    for (let v = 0; v < u.nv; v++) {
      if (u.front.band[v] === 1) continue
      r.lx = u.local[3 * v]
      r.ly = u.local[3 * v + 1]
      r.lz = u.local[3 * v + 2]
      r.u = u.front.bound[v]
      r.nz = u.front.nz[v]
      r.bounce = u.front.bounce[v]
      r.ambientShare = u.front.amb[v]
      r.hasPlane = !Number.isNaN(u.front.plane[3 * v])
      r.pnx = r.hasPlane ? u.front.plane[3 * v] : 0
      r.pny = r.hasPlane ? u.front.plane[3 * v + 1] : 0
      r.pnz = r.hasPlane ? u.front.plane[3 * v + 2] : 0
      r.field = true
      r.px = u.positions[3 * v]
      r.py = u.positions[3 * v + 1]
      r.pz = u.positions[3 * v + 2]
      const bound = colourOfRecipe(r, e)[0]
      const L = linearToOklab(colours[3 * v], colours[3 * v + 1], colours[3 * v + 2])[0]
      worst = Math.min(worst, u.front.fam[v] === FAM_SHADOW ? bound - L : L - bound)
    }
    expect(worst).toBeGreaterThanOrEqual(-5e-5)
    expect(UNDERPAINT_MIX).toBe(0.5)
  })

  it('makes a vertex of the terminator’s band at the plan’s own value (with the seeded deviation, no plane step), and the others at the plane’s step', () => {
    const plan = STATS.plan
    const sp = plan.front[0]!
    const curve = curveFor(P)
    let band = 0
    let outside = 0
    let bandWorst = 0
    let steps = 0
    for (let v = 0; v < sphere0().positions.length / 3; v++) {
      const inBand = Math.abs(sp.nl[v]) < TS / 2 && castWeight(sp.nl[v], sp.shadow[v] === 1) < 0.5
      const dev = curve.devU(sphere0().positions[3 * v], sphere0().positions[3 * v + 1], sphere0().positions[3 * v + 2])
      const own = clamp(sp.u[v] + dev, 0.02, 0.99)
      if (inBand) {
        band++
        bandWorst = Math.max(bandWorst, Math.abs(sphere0().uFront[v] - own))
      } else {
        outside++
        if (Math.abs(sphere0().uFront[v] - own) > 0.01) steps++
      }
    }
    expect(band).toBeGreaterThan(50)
    expect(outside).toBeGreaterThan(500)
    expect(bandWorst).toBeLessThanOrEqual(1e-6)
    // (outside the band the planes' step is a real step of the value)
    expect(steps).toBeGreaterThan(50)
  })

  it('makes the sphere’s lit side lighter than its shadow side, and every colour finite and a displayable linear sRGB', () => {
    const s = SPHERE.baked.surfaces[0]!
    let lit = 0
    let nLit = 0
    let dark = 0
    let nDark = 0
    for (let v = 0; v < s.famFront.length; v++) {
      const L = linearToOklab(s.underFront[3 * v], s.underFront[3 * v + 1], s.underFront[3 * v + 2])[0]
      if (s.famFront[v] === FAM_LIGHT) {
        lit += L
        nLit++
      } else {
        dark += L
        nDark++
      }
    }
    expect(lit / nLit).toBeGreaterThan(dark / nDark + 0.15)
    for (const surf of SPHERE.baked.surfaces) {
      for (const a of [surf!.underFront, surf!.underBack]) {
        if (!a) continue
        expect(allFinite(a)).toBe(true)
        expect(Math.min(...a)).toBeGreaterThanOrEqual(-1e-6)
        expect(Math.max(...a)).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })

  it('underpaints the flat open sheet from both sides (the side −1 plan has its own shadow and value) with the front and the back different colours', () => {
    const f = fixture(flatSaddleScene(), saddleColours(), sparse(300))
    const s = f.baked.surfaces[0]!
    expect(s.underBack).not.toBeNull()
    let differ = 0
    for (let v = 0; v < s.underFront.length; v++) if (Math.abs(s.underFront[v] - s.underBack![v]) > 1e-3) differ++
    // lit from above, the sheet's back is turned from the light: darker
    expect(differ).toBeGreaterThan(0.5 * s.underFront.length)
    const mean = (a: Float32Array) => {
      let m = 0
      for (let v = 0; v < a.length / 3; v++) m += linearToOklab(a[3 * v], a[3 * v + 1], a[3 * v + 2])[0]
      return m / (a.length / 3)
    }
    expect(mean(s.underFront)).toBeGreaterThan(mean(s.underBack!) + 0.1)
  })

  // keep a plan referenced so that its builder is exercised here too: the plan is deterministic
  it('is made from a plan that is itself deterministic: the same inputs give the same per-vertex values', () => {
    const again = buildWorldPlan(SPHERE.scene, LIGHT, P, PX)
    expect(Array.from(again.front[0]!.u)).toEqual(Array.from(STATS.plan.front[0]!.u))
  })
})

function sphere0() {
  return SPHERE.baked.surfaces[0]!
}
