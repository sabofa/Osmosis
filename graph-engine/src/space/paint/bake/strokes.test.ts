import { describe, expect, it, vi } from 'vitest'
import { lchToLab, linearToOklab, labToLch, hueArc } from '../model/colour'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { sizedLength } from '../model/brush'
import { colourOfDraft, lightnessAtValue, type ColourRecipe } from '../model/recipe'
import { BASE_END, GLAZE_ALPHA, VEIL_ALPHA, VEIL_BORDER_ALPHA, VEIL_SCALE, veilOf } from '../model/roles'
import { flatColours, quadMesh, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { FAM_SHADOW, Z_CAST } from '../model/value'
import { bigMax, roleRank } from '../model/view'
import { resolvePaintParams, type PaintParams } from '../params'
import { ROLES } from '../types'
import { bakeKey, bakedRecipes, bakeStats } from './index'
import { newPlanAt, planAt } from './plan'
import { stepValueWorld } from './planes'
import { bakeLengthFactor, SIDE_SEED, MIN_PATH_SHARE } from './strokes'
import { locate, type SurfacePoint } from './surface'
import { NO_PARTICLE } from './draft'
import { BAKE_MIX_LEVELS, BAKE_PATH_POINTS, BAKE_ZOOM_MIN } from './types'
import { fixture, flatSaddleScene, inwardSphere, LIGHT, P, PX, saddleColours, sparse, sphereColours, sphereScene, TERRACOTTA, veilScene, type Fixture } from './bakeFixture'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const SADDLE = fixture(flatSaddleScene(), saddleColours(), sparse(1200))
const VEILS = fixture(veilScene(), flatColours({ 0: [0.6, 0.05, 0.05], 1: [0.7, 0, 0] }), sparse(900))
const D = P.detect
const ROLE = (r: string): number => ROLES.indexOf(r as (typeof ROLES)[number])

// The plan at particle p of a fixture (side +1, or the stroke's side), at the particle's own point of the refined surface.
function planOfParticle(f: Fixture, p: number, side: 1 | -1 = 1) {
  const plan = bakeStats(f.baked)!.plan
  const m = f.particles.mark[p]
  const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  const ok = locate(plan.surfaces[m]!, f.particles.position[3 * p], f.particles.position[3 * p + 1], f.particles.position[3 * p + 2], f.particles.normal[3 * p], f.particles.normal[3 * p + 1], f.particles.normal[3 * p + 2], 1e-3, hit)
  expect(ok).toBe(true)
  return planAt(plan, m, side, hit, newPlanAt())
}

// The strokes of a fixture for which a predicate holds, as indices.
const strokesWhere = (f: Fixture, test: (i: number) => boolean): number[] => {
  const out: number[] = []
  for (let i = 0; i < f.baked.count; i++) if (test(i)) out.push(i)
  return out
}

describe('the roles a particle qualifies for (the model’s conditions, read from the world plan)', () => {
  const { baked, particles, params } = SPHERE
  const sphereParticles = Array.from({ length: particles.count }, (_, i) => i).filter((i) => particles.mark[i] === 0)

  it('makes a block stroke for every particle of the sphere, with no density test: the frame thins them by the particle’s rank, shifted by the role', () => {
    const blocks = strokesWhere(SPHERE, (i) => baked.mark[i] === 0 && baked.role[i] === ROLE('block'))
    const seen = new Set<number>()
    for (const i of blocks) {
      const p = baked.particle[i]
      expect(seen.has(p)).toBe(false)
      seen.add(p)
      expect(particles.mark[p]).toBe(0)
      expect(baked.rank[i]).toBeCloseTo(roleRank(particles.rank[p], 'block'), 6)
    }
    // (a stroke that could not go anywhere, or is under a quarter of its zoom-1 length, is dropped: a few)
    expect(blocks.length).toBeGreaterThanOrEqual(0.97 * sphereParticles.length)
    expect(blocks.length).toBeLessThanOrEqual(sphereParticles.length)
  })

  it('puts a form stroke only on particles within detect.formBandNL of the terminator that are not in the deep core, and loads it at the lighter end (a hand-start stroke is the frame’s to turn)', () => {
    const forms = strokesWhere(SPHERE, (i) => baked.mark[i] === 0 && baked.role[i] === ROLE('form'))
    expect(forms.length).toBeGreaterThan(50)
    const plan = bakeStats(baked)!.plan
    const at = newPlanAt()
    let worstNl = 0
    let darkest = 0
    let loadedWrong = 0
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    for (const i of forms) {
      const a = planOfParticle(SPHERE, baked.particle[i])
      worstNl = Math.max(worstNl, Math.abs(a.nl))
      darkest = Math.max(darkest, a.shadowW)
      expect(baked.handStart[i]).toBe(0)
      // the path runs from the lighter end: the plan value at its start is not under its end's
      const ends = [0, BAKE_PATH_POINTS - 1].map((q) => {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        expect(locate(plan.surfaces[0]!, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 1e-3, hit)).toBe(true)
        return planAt(plan, 0, 1, hit, at).u
      })
      if (ends[0] < ends[1] - 1e-6) loadedWrong++
    }
    expect(worstNl).toBeLessThanOrEqual(D.formBandNL + 1e-6)
    expect(darkest).toBeLessThan(0.85)
    expect(loadedWrong).toBe(0)
    // and every other particle-stroke role is the hand's (the frame turns the loaded end by screen x)
    for (const i of strokesWhere(SPHERE, (j) => baked.role[j] !== ROLE('form') && baked.role[j] !== ROLE('edge'))) expect(baked.handStart[i]).toBe(1)
  })

  it('puts glaze where the shadow family is under detect.glazeBelow, scumble only where the plan’s transition is wide, reflected only where the bounce reaches, and the dab on the highlight', () => {
    let glazeOk = 0
    let reflectedOk = 0
    let scumbleOk = 0
    const counts = { glaze: 0, reflected: 0, scumble: 0, dab: 0 }
    for (let i = 0; i < baked.count; i++) {
      if (baked.mark[i] !== 0) continue
      const role = ROLES[baked.role[i]]
      if (role === 'dab') {
        counts.dab++
        expect(baked.particle[i]).toBe(NO_PARTICLE)
        expect(baked.alpha[i]).toBe(1)
        expect(baked.rank[i]).toBe(0)
        continue
      }
      const p = baked.particle[i]
      const a = planOfParticle(SPHERE, p)
      if (role === 'glaze') {
        counts.glaze++
        if (a.shadowW > 0.55 && a.u < D.glazeBelow) glazeOk++
      } else if (role === 'reflected') {
        counts.reflected++
        if (a.reflW > 0.35 && params.light.bounce * Math.max(-particles.normal[3 * p + 2], 0) >= D.reflectedMin - 1e-9) reflectedOk++
      } else if (role === 'scumble') {
        counts.scumble++
        if (a.trans > 0.1) scumbleOk++
      }
    }
    for (const k of ['glaze', 'reflected', 'scumble'] as const) expect(counts[k], k).toBeGreaterThan(20)
    // (the plan at the particle is the interpolated one; the roles' conditions read the same: all of them, but for a hair at a threshold)
    expect(glazeOk).toBeGreaterThanOrEqual(0.97 * counts.glaze)
    expect(reflectedOk).toBeGreaterThanOrEqual(0.97 * counts.reflected)
    expect(scumbleOk).toBeGreaterThanOrEqual(0.9 * counts.scumble)
    // the dab: one highlight on a sphere under one light, the plan's value there over 0.8
    expect(counts.dab).toBeGreaterThanOrEqual(1)
    const dab = strokesWhere(SPHERE, (i) => baked.role[i] === ROLE('dab'))[0]
    const plan = bakeStats(baked)!.plan
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const q = Math.round(baked.anchor[dab] * (BAKE_PATH_POINTS - 1))
    const o = 3 * (BAKE_PATH_POINTS * dab + q)
    expect(locate(plan.surfaces[0]!, baked.worldPath[o], baked.worldPath[o + 1], baked.worldPath[o + 2], 0, 0, 0, 0.06, hit)).toBe(true)
    expect(planAt(plan, 0, 1, hit, newPlanAt()).value).toBeGreaterThanOrEqual(0.8)
    expect(baked.endSoft[dab]).toBeCloseTo(BASE_END.dab, 6)
  })

  it('paints the table only where the shadow falls, as block and glaze, and never scumbles or forms on it', () => {
    const table = strokesWhere(SPHERE, (i) => baked.mark[i] === 1)
    expect(table.length).toBeGreaterThan(200)
    const roles = new Set(table.map((i) => ROLES[baked.role[i]]))
    expect([...roles].sort()).toEqual(['block', 'glaze'])
    let notCast = 0
    let n = 0
    for (const i of table) {
      if (baked.side[i] !== 1) continue
      n++
      if (planOfParticle(SPHERE, baked.particle[i]).zone !== Z_CAST) notCast++
    }
    expect(n).toBeGreaterThan(50)
    // (the zone is the nearest vertex's: a particle on the shadow's edge may be read from either of two triangles)
    expect(notCast).toBeLessThanOrEqual(0.02 * n)
  })

  it('glazes a veil and nothing else: wide, nearly clear strokes at the veil alphas, twice the role’s size, with a dry border pass of small strokes near a flat sheet’s edge', () => {
    const { baked: b, particles: set, params: pp } = VEILS
    const veil = strokesWhere(VEILS, (i) => b.mark[i] === 1)
    expect(veil.length).toBeGreaterThan(500)
    const mesh = VEILS.scene.marks[1] as Parameters<typeof veilOf>[0]
    const vm = veilOf(mesh)
    let border = 0
    let body = 0
    for (const i of veil) {
      expect(b.role[i]).toBe(ROLE('glaze'))
      const p = b.particle[i]
      const edge = vm.border(set.position[3 * p], set.position[3 * p + 1], set.position[3 * p + 2]) > 0.86
      if (b.alpha[i] === Math.fround(VEIL_BORDER_ALPHA)) {
        border++
        expect(edge).toBe(true)
        expect(b.dry[i]).toBeCloseTo(0.6, 6)
        expect(b.basePx[2 * i]).toBeGreaterThanOrEqual(pp.roles.glaze.length * 0.5 * 0.88 - 1e-4)
        expect(b.basePx[2 * i]).toBeLessThanOrEqual(pp.roles.glaze.length * 0.5 * 1.12 + 1e-4)
        // the border pass is drawn at the scumble role's density: its rank is the particle's shifted by the scumble's
        expect(b.rank[i]).toBeCloseTo(roleRank(set.rank[p], 'scumble'), 6)
      } else {
        body++
        expect(b.alpha[i]).toBe(Math.fround(VEIL_ALPHA))
        expect(b.basePx[2 * i]).toBeGreaterThanOrEqual(pp.roles.glaze.length * VEIL_SCALE * 0.88 - 1e-4)
        expect(b.basePx[2 * i]).toBeLessThanOrEqual(pp.roles.glaze.length * VEIL_SCALE * 1.12 + 1e-4)
        expect(b.impasto[i]).toBe(0)
        expect(b.rank[i]).toBeCloseTo(roleRank(set.rank[p], 'glaze'), 6)
      }
      expect(b.edge[i]).toBe(255)
    }
    expect(body).toBeGreaterThan(300)
    expect(border).toBeGreaterThan(10)
    // the veil is painted from both sides (an open sheet); the sphere under it as usual
    expect(new Set(veil.map((i) => b.side[i]))).toEqual(new Set([1, -1]))
  })

  it('sizes a stroke as buildParticleStroke does before the zoom: the role’s length and width, the seeded ±12%, the light and shadow factor, and the table’s 1.25 and 2.3', () => {
    const rb = params.roles.block
    const rf = params.roles.form
    for (const i of strokesWhere(SPHERE, (j) => baked.mark[j] === 0 && baked.role[j] === ROLE('block'))) {
      // ls = 1 + 0.16 lightW - 0.14 shadowW, between 0.86 and 1.16
      expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rb.length * 0.88 * 0.86 - 1e-3)
      expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rb.length * 1.12 * 1.16 + 1e-3)
      expect(baked.basePx[2 * i + 1]).toBeGreaterThanOrEqual(rb.width * 0.88 * 0.86 - 1e-3)
      expect(baked.basePx[2 * i + 1]).toBeLessThanOrEqual(rb.width * 1.12 * 1.16 + 1e-3)
    }
    for (const i of strokesWhere(SPHERE, (j) => baked.mark[j] === 1 && baked.role[j] === ROLE('block'))) {
      expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rb.length * 1.25 * 0.88 * 0.86 - 1e-3)
      expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rb.length * 1.25 * 1.12 * 1.16 + 1e-3)
      expect(baked.basePx[2 * i + 1]).toBeGreaterThanOrEqual(rb.width * 2.3 * 0.88 * 0.86 - 1e-3)
      expect(baked.basePx[2 * i + 1]).toBeLessThanOrEqual(rb.width * 2.3 * 1.12 * 1.16 + 1e-3)
    }
    for (const i of strokesWhere(SPHERE, (j) => baked.role[j] === ROLE('form'))) {
      expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rf.length * 0.88 * 0.86 - 1e-3)
      expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rf.length * 1.12 * 1.16 + 1e-3)
    }
    // a glaze is plain (no light/shadow factor)
    const rg = params.roles.glaze
    for (const i of strokesWhere(SPHERE, (j) => baked.mark[j] === 0 && baked.role[j] === ROLE('glaze'))) {
      expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rg.length * 0.88 - 1e-3)
      expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rg.length * 1.12 + 1e-3)
      expect(baked.alpha[i]).toBe(Math.fround(GLAZE_ALPHA))
    }
  })

  it('takes a block or form stroke’s class from the edge field (an index into EDGE_CLASSES), a scumble’s kept soft or firm, and gives a glaze, a reflected stroke and a veil none', () => {
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < baked.count; i++) {
      const role = ROLES[baked.role[i]]
      if (role === 'block' || role === 'form') {
        expect(baked.edge[i]).toBeLessThanOrEqual(3)
        counts[baked.edge[i]]++
      } else if (role === 'scumble') {
        expect([1, 2]).toContain(baked.edge[i])
      } else if (role === 'glaze' || role === 'reflected' || role === 'dab') expect(baked.edge[i]).toBe(255)
      expect(baked.alpha[i]).toBeGreaterThan(0)
      expect(baked.alpha[i]).toBeLessThanOrEqual(1)
      expect(Number.isFinite(baked.load[i] + baked.impasto[i] + baked.bristles[i] + baked.bristleVar[i] + baked.dry[i] + baked.wet[i] + baked.endSoft[i])).toBe(true)
    }
    // (the strokes of the interior of a plane are soft: the field's reach is 20 px)
    expect(counts[0] + counts[1] + counts[2] + counts[3]).toBeGreaterThan(1000)
    expect(counts[1] + counts[2]).toBeGreaterThan(0)
  })

  it('drops no stroke shorter than a quarter of its zoom-1 length (the model drops a walk of fewer than three points) and none with a path that is not BAKE_PATH_POINTS long', () => {
    let shortest = Infinity
    for (let i = 0; i < baked.count; i++) shortest = Math.min(shortest, baked.pathLength[i] / (baked.basePx[2 * i] * baked.referenceWorldPerPx))
    expect(shortest).toBeGreaterThanOrEqual(MIN_PATH_SHARE - 1e-4)
    expect(baked.worldPath.length).toBe(3 * BAKE_PATH_POINTS * baked.count)
    expect(baked.worldNormal.length).toBe(3 * BAKE_PATH_POINTS * baked.count)
    expect(baked.colour.length).toBe(3 * BAKE_MIX_LEVELS * baked.count)
  })
})

describe('the sides of a surface', () => {
  it('paints a closed sphere from its outside only: every stroke on it has side 0; the table, an open sheet, has both', () => {
    const { baked } = SPHERE
    const sphere = strokesWhere(SPHERE, (i) => baked.mark[i] === 0)
    expect(sphere.length).toBeGreaterThan(1000)
    expect(sphere.every((i) => baked.side[i] === 0)).toBe(true)
    const table = strokesWhere(SPHERE, (i) => baked.mark[i] === 1)
    expect(new Set(table.map((i) => baked.side[i]))).toEqual(new Set([1, -1]))
    // a closed sphere with its normals inward is painted from the outside all the same
    const inward = fixture(sceneOf([inwardSphere(0)]), flatColours({ 0: TERRACOTTA }), sparse(250))
    for (let i = 0; i < inward.baked.count; i++) {
      expect(inward.baked.side[i]).toBe(0)
      const o = 3 * (BAKE_PATH_POINTS * i)
      // the stroke's normal at its first point is OUTWARD
      expect(inward.baked.worldNormal[o] * inward.baked.worldPath[o] + inward.baked.worldNormal[o + 1] * inward.baked.worldPath[o + 1] + inward.baked.worldNormal[o + 2] * inward.baked.worldPath[o + 2]).toBeGreaterThan(0.99 * Math.hypot(inward.baked.worldPath[o], inward.baked.worldPath[o + 1], inward.baked.worldPath[o + 2]) - 0.02)
    }
  })

  it('paints an open saddle lit from above from both sides: strokes of side +1 and -1 for the same particle have opposite normals, independent seeds, and do not mirror each other', () => {
    const { baked, particles } = SADDLE
    const byParticle = new Map<number, { up?: number; down?: number }>()
    for (let i = 0; i < baked.count; i++) {
      if (baked.role[i] !== ROLE('block')) continue
      const e = byParticle.get(baked.particle[i]) ?? {}
      if (baked.side[i] === 1) e.up = i
      else if (baked.side[i] === -1) e.down = i
      else throw new Error('a stroke of an open sheet with side 0')
      byParticle.set(baked.particle[i], e)
    }
    let pairs = 0
    let normalsWorst = 1
    let seedsOk = 0
    let sameSize = 0
    let samePath = 0
    for (const [p, e] of byParticle) {
      if (e.up === undefined || e.down === undefined) continue
      pairs++
      const a = 3 * (BAKE_PATH_POINTS * e.up + Math.round(baked.anchor[e.up] * (BAKE_PATH_POINTS - 1)))
      const b = 3 * (BAKE_PATH_POINTS * e.down + Math.round(baked.anchor[e.down] * (BAKE_PATH_POINTS - 1)))
      normalsWorst = Math.min(normalsWorst, -(baked.worldNormal[a] * baked.worldNormal[b] + baked.worldNormal[a + 1] * baked.worldNormal[b + 1] + baked.worldNormal[a + 2] * baked.worldNormal[b + 2]))
      if (baked.seed[e.down] === ((particles.seed[p] ^ SIDE_SEED) >>> 0) && baked.seed[e.up] === particles.seed[p]) seedsOk++
      const down = e.down
      if (baked.basePx[2 * e.up] === baked.basePx[2 * e.down]) sameSize++
      const o = 3 * BAKE_PATH_POINTS
      if (baked.worldPath.slice(3 * BAKE_PATH_POINTS * e.up, 3 * BAKE_PATH_POINTS * e.up + o).every((v, k) => v === baked.worldPath[3 * BAKE_PATH_POINTS * down + k])) samePath++
    }
    expect(pairs).toBeGreaterThan(500)
    // (a saddle's normal turns over the stroke's anchor point a little: the two sides' anchors are not the same point)
    expect(normalsWorst).toBeGreaterThan(0.9)
    expect(seedsOk).toBe(pairs)
    expect(sameSize).toBeLessThanOrEqual(0.02 * pairs)
    expect(samePath).toBe(0)
    // the lit side (+1: the normals point up) and the underside both exist for every role the plan gives them
    expect(strokesWhere(SADDLE, (i) => baked.side[i] === 1).length).toBeGreaterThan(500)
    expect(strokesWhere(SADDLE, (i) => baked.side[i] === -1).length).toBeGreaterThan(500)
  })
})

describe('the value rule holds in every baked stroke’s colour', () => {
  const env = (params: PaintParams) => recipeEnv(params, curveFor(params), groundLocal(params))

  // For each stroke: the lightness of its colour at each level against the lightness of its own recipe at the family's bound. Returns the
  // margins (positive = inside the bound) of the shadow family (bound - L) and the light family (L - bound), the worst of each.
  function margins(f: Fixture): { shadow: number; light: number; nShadow: number; nLight: number; uShadow: number; uLight: number } {
    const held = bakedRecipes(f.baked)!
    const e = env(f.params)
    const r = held.recipes
    let shadow = Infinity
    let light = Infinity
    let nShadow = 0
    let nLight = 0
    let uShadow = Infinity
    let uLight = Infinity
    for (let k = 0; k < f.baked.count; k++) {
      const c = held.perm[k]
      const fam = r.fam[c]
      if (fam < 0) continue
      const lBound = lightnessAtValue(r.hold[c] ?? r.colour[c], r.uBound[c], e)
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) {
        const o = 3 * (BAKE_MIX_LEVELS * k + l)
        const L = linearToOklab(f.baked.colour[o], f.baked.colour[o + 1], f.baked.colour[o + 2])[0]
        if (fam === FAM_SHADOW) shadow = Math.min(shadow, lBound - L)
        else light = Math.min(light, L - lBound)
      }
      if (fam === FAM_SHADOW) {
        nShadow++
        uShadow = Math.min(uShadow, r.uBound[c] - r.u[c])
      } else {
        nLight++
        uLight = Math.min(uLight, r.u[c] - r.uBound[c])
      }
    }
    return { shadow, light, nShadow, nLight, uShadow, uLight }
  }

  it('keeps every shadow-family stroke’s lightness at or under its bound and every light-family stroke’s at or over it, at every brush-load level, mix and all', () => {
    for (const f of [SPHERE, SADDLE]) {
      const m = margins(f)
      expect(m.nShadow).toBeGreaterThan(300)
      expect(m.nLight).toBeGreaterThan(300)
      // (the hold sets the lightness to the bound's; Float32 colours and the round trip through linear sRGB: a few 1e-6)
      expect(m.shadow, 'shadow family').toBeGreaterThanOrEqual(-5e-5)
      expect(m.light, 'light family').toBeGreaterThanOrEqual(-5e-5)
      // the plan value itself is inside its family's bound
      expect(m.uShadow).toBeGreaterThanOrEqual(-1e-9)
      expect(m.uLight).toBeGreaterThanOrEqual(-1e-9)
    }
  })

  it('keeps it under the loudest mix there is (strength 2, a value step on every load, up and down), and in the plan values: no shadow stroke over the cap away from the terminator, no light stroke under the darkest half-tone', () => {
    for (const bias of [1, -1]) {
      const loud = resolvePaintParams({ particles: { maxPerUnit2: 250 }, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: bias } })
      const f = fixture(sphereScene(), sphereColours(), loud)
      const m = margins(f)
      expect(m.shadow).toBeGreaterThanOrEqual(-5e-5)
      expect(m.light).toBeGreaterThanOrEqual(-5e-5)
    }
    // the plan values of the strokes: the stroke's u against the family's own cap and floor, away from the terminator
    const { baked, particles } = SPHERE
    const held = bakedRecipes(baked)!
    const plan = bakeStats(baked)!.plan
    const TS = P.value.terminatorSoftness
    let overCap = 0
    let underFloor = 0
    let checkedShadow = 0
    let checkedLight = 0
    for (let k = 0; k < baked.count; k++) {
      if (baked.mark[k] !== 0 || baked.particle[k] === NO_PARTICLE) continue
      const c = held.perm[k]
      const a = planOfParticle(SPHERE, baked.particle[k])
      const nl = a.nl
      if (nl <= -TS / 2) {
        checkedShadow++
        if (held.recipes.u[c] > plan.capU + 1e-6) overCap++
      } else if (nl >= TS / 2 + 0.08 && particles.mark[baked.particle[k]] === 0) {
        // (lit, and not in the cast shadow of anything: the sphere has none on itself)
        checkedLight++
        if (held.recipes.u[c] < plan.floorU - 1e-6) underFloor++
      }
    }
    expect(checkedShadow).toBeGreaterThan(300)
    expect(checkedLight).toBeGreaterThan(300)
    expect(overCap).toBe(0)
    expect(underFloor).toBe(0)
  })

  it('keeps a shadow stroke’s hue within curve.shiftMax + 3° of its local colour before the brush-load mix (the curve’s half-tone accent aside: a deliberate offset), for a terracotta and a 0.03-chroma muted one', () => {
    for (const chroma of [0.14, 0.03]) {
      const local = lchToLab(0.56, chroma, 38)
      // the curve's own hold is what is under test: no plane step, no deviation (those sit outside the cap by design)
      const params = resolvePaintParams({ particles: { maxPerUnit2: 250 }, curve: { planeStepA: 0, planeStepB: 0, devH: 0, devL: 0, devC: 0 } })
      const f = fixture(sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 }), tableMesh({ z: -1, half: 2, index: 1 })]), flatColours({ 0: local, 1: lchToLab(0.9, 0.01, 85) }), params)
      const held = bakedRecipes(f.baked)!
      const e = env(params)
      // (the half-tone accent moves the hue by 0.2 degrees at u 0.2, 2.4 at the cast and 4 at the cap: a deliberate offset, and the curve's hold is
      // around the colour's own hue with it: curve.test.ts' accentAt)
      const accentAt = (u: number) => Math.min(18, 0.5 * hueArc(38, 95)) * Math.exp(-(((u - 0.56) / 0.17) ** 2))
      let worst = 0
      let n = 0
      for (let c = 0; c < held.recipes.count; c++) {
        if (held.recipes.fam[c] !== FAM_SHADOW) continue
        const src = held.recipes.colour[c].a as ColourRecipe
        if (src.ground) continue
        const lch = labToLch(colourOfDraft(held.recipes.colour[c], e))
        worst = Math.max(worst, Math.abs(hueArc(38 + accentAt(src.u), lch[2])))
        n++
      }
      expect(n, `chroma ${chroma}`).toBeGreaterThan(200)
      expect(worst, `chroma ${chroma}`).toBeLessThanOrEqual(params.curve.shiftMax + 3 + 1e-4)
    }
  })
})

describe('softness reaches the strokes', () => {
  it('follows the plan across a wide terminator: at terminatorSoftness 1 the largest step of the stroke value between neighbouring N·L bins about N·L 0 on the sphere is within 1.5 times the plan’s, where a step to the plane’s mean value is far over it', () => {
    const params: PaintParams = { ...sparse(250), value: { ...P.value, terminatorSoftness: 1 } }
    const f = fixture(sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 })]), flatColours({ 0: TERRACOTTA }), params)
    const { baked, particles } = f
    const held = bakedRecipes(baked)!
    const stats = bakeStats(baked)!
    const plan = stats.plan
    const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    const at = newPlanAt()
    const curve = curveFor(params)
    // the mean of three values per N·L bin of 0.04 (from -0.2 to 0.2): the stroke's u, the plan's u (with the deviation), and the plane's step
    // without the band's follow (the model before values round 4)
    const BINS = 10
    const sum = Array.from({ length: BINS }, () => [0, 0, 0, 0])
    for (let k = 0; k < baked.count; k++) {
      if (baked.role[k] !== ROLE('block')) continue
      const p = baked.particle[k]
      expect(locate(plan.surfaces[0]!, particles.position[3 * p], particles.position[3 * p + 1], particles.position[3 * p + 2], particles.normal[3 * p], particles.normal[3 * p + 1], particles.normal[3 * p + 2], 1e-3, hit)).toBe(true)
      planAt(plan, 0, 1, hit, at)
      const bin = Math.floor((at.nl + 0.2) / 0.04)
      if (bin < 0 || bin >= BINS) continue
      const plane = stats.planes.planeOf[0][0]![hit.tri]
      const dev = curve.devU(particles.position[3 * p], particles.position[3 * p + 1], particles.position[3 * p + 2])
      sum[bin][0] += held.recipes.u[held.perm[k]]
      sum[bin][1] += at.u + dev
      sum[bin][2] += stepValueWorld(stats.planes, plane, at.u + dev, params.edges.planeGradient, 0)
      sum[bin][3]++
    }
    for (const bin of sum) expect(bin[3]).toBeGreaterThan(8)
    const largestStep = (j: number): number => Math.max(...sum.slice(1).map((bin, k) => Math.abs(bin[j] / bin[3] - sum[k][j] / sum[k][3])))
    const planStep = largestStep(1)
    expect(planStep).toBeGreaterThan(0.01)
    expect(largestStep(0), 'the strokes').toBeLessThanOrEqual(1.5 * planStep)
    // (the counterfactual: stepping to the plane's mean everywhere, as before values round 4, puts a step of its own across the zone's edge)
    expect(largestStep(2), 'the plane step alone').toBeGreaterThan(1.5 * planStep)
  })
})

describe('a stroke too short to be a stroke', () => {
  it('is dropped: on a sheet smaller than a quarter of a stroke’s zoom-1 length no stroke is made, though its particles are there; on a sheet a stroke fits on, they are', () => {
    // a 12 px sheet (0.08 world at 150 px per unit): a block stroke is 46 px, a quarter of it 11.5 px
    const make = (edge: number) => fixture(sceneOf([quadMesh({ origin: [0, 0, 0], e1: [edge, 0, 0], e2: [0, edge, 0], n: 3, index: 0 })]), flatColours({ 0: TERRACOTTA }), sparse(60000))
    const tiny = make(0.07)
    const wide = make(0.6)
    expect(tiny.particles.count).toBeGreaterThan(50)
    expect(wide.baked.count).toBeGreaterThan(100)
    let shortest = Infinity
    for (let i = 0; i < tiny.baked.count; i++) shortest = Math.min(shortest, tiny.baked.pathLength[i] / (tiny.baked.basePx[2 * i] * PX))
    expect(shortest).toBeGreaterThanOrEqual(MIN_PATH_SHARE - 1e-4)
    // (every block stroke of the tiny sheet would be at most its own length across: they are dropped; a few of the smaller roles may still fit)
    expect(tiny.baked.count).toBeLessThan(0.4 * tiny.particles.count)
    expect(wide.baked.count).toBeGreaterThan(0.8 * wide.particles.count)
  })
})

describe('the baked length', () => {
  const dense = 3e-4 // world area per particle at the lab's scale
  it('is the longest any view asks for: 2 zoom-1 strokes for a view zoomed out to BAKE_ZOOM_MIN, more where the particles are few enough that a zoomed-in view grows its strokes, never past the first reading’s bound', () => {
    const f = bakeLengthFactor(P, dense, PX)
    expect(f).toBeGreaterThanOrEqual(1 / BAKE_ZOOM_MIN)
    expect(f).toBeLessThan(4)
    const scarce = bakeLengthFactor(P, 0.02, PX)
    expect(scarce).toBeGreaterThan(f)
    const ceiling = Math.max(1 / BAKE_ZOOM_MIN, sizedLength(1, bigMax(P)))
    expect(scarce).toBeLessThanOrEqual(ceiling)
    expect(bakeLengthFactor(P, 100, PX)).toBeCloseTo(ceiling, 6)
    // the cap of the brush bounds it
    expect(bakeLengthFactor({ ...P, particles: { ...P.particles, zoomBigMax: 1 } }, 0.02, PX)).toBeCloseTo(1 / BAKE_ZOOM_MIN, 6)
  })

  it('does not depend on the sliders only a frame reads (the density, the target, the growth cap, the brush’s follow of the zoom): moving them moves no baked path, and no key', () => {
    const f = bakeLengthFactor(P, 0.002, PX)
    for (const next of [
      { ...P, particles: { ...P.particles, targetPer10kPx: 20 } },
      { ...P, particles: { ...P.particles, zoomGrowMax: 1.5, zoomStrokeScale: 0.9 } },
      { ...P, roles: { ...P.roles, block: { ...P.roles.block, density: 0.1 } } },
    ] as PaintParams[]) {
      expect(bakeLengthFactor(next, 0.002, PX)).toBe(f)
      expect(bakeKey(SPHERE.scene, LIGHT, next, SPHERE.authored)).toBe(bakeKey(SPHERE.scene, LIGHT, P, SPHERE.authored))
    }
  })

  it('makes every baked path at most the factor times its zoom-1 length (a chord is never longer than the arc)', () => {
    const { baked, particles } = SPHERE
    const factor = bakeLengthFactor(SPHERE.params, baked.areaPerParticle[0], PX)
    for (let i = 0; i < baked.count; i++) {
      if (baked.mark[i] !== 0) continue
      expect(baked.pathLength[i]).toBeLessThanOrEqual(factor * baked.basePx[2 * i] * PX * (1 + 1e-4))
    }
    expect(particles.count).toBeGreaterThan(1000)
  })
})

