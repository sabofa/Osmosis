import { describe, expect, it, vi } from 'vitest'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { loadCellOf } from '../model/brush'
import { holdLightness, oklabToLinear } from '../model/colour'
import { LoadMixer } from '../model/mix'
import { boundLightness, preMixLab } from './draft'
import { meshArea } from '../model/view'
import { FAM_SHADOW } from '../model/value'
import { PARAM_SCHEMA, setParam, type PaintParams } from '../params'
import { LAYER_ORDER, ROLES } from '../types'
import { bakeKey, bakePainting, bakePaintingWithProgress, bakedRecipes, bakeStats, recolourBake, type BakeProgress } from './index'
import { BAKE_MIX_LEVELS, BAKE_PATH_POINTS, HIDDEN_NA, SIZING_SURFACE, type BakedPainting, type BakedSurface } from './types'
import { framing, fixture, LIGHT, P, saddleColours, saddleScene, sparse, sphereColours, sphereScene, TERRACOTTA, type Fixture } from './bakeFixture'
import { boxMesh } from './edgesFixture'
import { arrowMark, flatColours, lineMark, pointMark, sceneOf, sphereMesh } from '../model/testing'
import { lengthFactorsOf } from './strokes'
import type { MeshMark } from '../../scene/types'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 300_000 })

const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const SADDLE = fixture(saddleScene(), saddleColours(), sparse(600))

const bytesEqual = (a: ArrayBufferView, b: ArrayBufferView): boolean => Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0

// The arrays of a painting that are colours: the strokes' and each surface's underpainting.
const COLOUR_KEYS = ['colour'] as const
const SURFACE_COLOUR_KEYS = ['underFront', 'underBack'] as const

// Every typed array of a painting, by path, and the rest.
function arraysOf(b: BakedPainting): Map<string, ArrayBufferView> {
  const out = new Map<string, ArrayBufferView>()
  for (const [k, v] of Object.entries(b)) if (ArrayBuffer.isView(v)) out.set(k, v)
  b.surfaces.forEach((s, m) => {
    if (!s) return
    for (const [k, v] of Object.entries(s)) if (ArrayBuffer.isView(v)) out.set(`surfaces[${m}].${k}`, v)
  })
  return out
}

// `moved`: the new params for a schema path: its maximum, or its minimum where the default is the maximum.
const moved = (path: string): PaintParams => {
  const spec = PARAM_SCHEMA.find((s) => s.path === path)!
  const current = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], P) as number
  return setParam(P, path, current === spec.max ? spec.min : spec.max)
}

// The same particle set under changed params (the particle parameters are not among the changes the tests make).
const bakeAgain = (f: Fixture, params: PaintParams): BakedPainting => bakePainting(f.scene, f.particles, f.colours, f.light, params, f.authored)

describe('recolourBake: a colour-only change makes the colours again and nothing else', () => {
  const sparseP = SPHERE.params
  const changes: [string, PaintParams][] = [
    ['the curve’s warm hue', setParam(sparseP, 'curve.warmHue', 20)],
    ['the brush-load mix’s strength', setParam(sparseP, 'mix.strength', 1.6)],
    ['the environment’s absorption', setParam(sparseP, 'environment.absorption', 0.9)],
  ]

  for (const [name, next] of changes) {
    it(`gives, for a change of ${name}, exactly the painting a full bake gives, in every colour array and every surface’s underpainting, and shares every other array by identity`, () => {
      const base = SPHERE.baked
      const again = recolourBake(base, next)!
      expect(again).not.toBeNull()
      const fresh = bakeAgain(SPHERE, next)
      // every array of the recolour equals the full bake's, byte for byte
      const a = arraysOf(again)
      const b = arraysOf(fresh)
      expect([...a.keys()]).toEqual([...b.keys()])
      for (const [k, v] of a) expect(bytesEqual(v, b.get(k)!), k).toBe(true)
      expect(again.key).toBe(fresh.key)
      expect(again.count).toBe(fresh.count)
      // ... and shares every array that is not a colour with the painting it came from
      const old = arraysOf(base)
      let colourArrays = 0
      for (const [k, v] of a) {
        const isColour = (COLOUR_KEYS as readonly string[]).includes(k) || SURFACE_COLOUR_KEYS.some((c) => k.endsWith(`.${c}`))
        if (isColour) {
          colourArrays++
          expect(v, k).not.toBe(old.get(k))
        } else expect(v, k).toBe(old.get(k))
      }
      expect(colourArrays).toBeGreaterThanOrEqual(1 + 3)
      // the colours really changed (a recolour that returned the old ones would pass the rest)
      expect(bytesEqual(again.colour, base.colour)).toBe(false)
      expect(bytesEqual(again.surfaces[0]!.underFront, base.surfaces[0]!.underFront)).toBe(false)
      expect(again.referenceWorldPerPx).toBe(base.referenceWorldPerPx)
      expect(again.focal).toBe(base.focal)
    })
  }

  it('is a recolour of a recolour too: from one set of colours to a second and back to the first, bit for bit', () => {
    const base = SPHERE.baked
    const first = recolourBake(base, changes[0][1])!
    const second = recolourBake(first, changes[1][1])!
    const back = recolourBake(second, SPHERE.params)!
    expect(bytesEqual(second.colour, bakeAgain(SPHERE, changes[1][1]).colour)).toBe(true)
    expect(bytesEqual(back.colour, base.colour)).toBe(true)
    expect(bytesEqual(back.surfaces[0]!.underFront, base.surfaces[0]!.underFront)).toBe(true)
    expect(bytesEqual(back.surfaces[1]!.underBack!, base.surfaces[1]!.underBack!)).toBe(true)
  })

  it('does so for a colour-scaled open surface (the colormap’s hue share, an adjustment curve), both sides', () => {
    const base = SADDLE.baked
    for (const next of [setParam(SADDLE.params, 'curve.colormapHue', 0.9), { ...SADDLE.params, curves: { ...SADDLE.params.curves, lAdjust: [[0, 0.1], [0.5, 0.35], [1, 0.1]] } } as PaintParams]) {
      const again = recolourBake(base, next)!
      const fresh = bakeAgain(SADDLE, next)
      expect(bytesEqual(again.colour, fresh.colour)).toBe(true)
      expect(bytesEqual(again.surfaces[0]!.underFront, fresh.surfaces[0]!.underFront)).toBe(true)
      expect(bytesEqual(again.surfaces[0]!.underBack!, fresh.surfaces[0]!.underBack!)).toBe(true)
      expect(bytesEqual(again.colour, base.colour)).toBe(false)
    }
  })

  it('is null for a painting it did not make (a copy of one loses its recipes)', () => {
    expect(recolourBake({ ...SPHERE.baked }, SPHERE.params)).toBeNull()
  })

  it('classes the same sliders a colour change as the key does: a colour-only, render-only or frame-only change leaves the key, anything else moves it', () => {
    const key = (p: PaintParams) => bakeKey(SPHERE.scene, LIGHT, p, SPHERE.authored, SPHERE.particles)
    const base = key(P)
    for (const path of ['curve.lSlope', 'curve.warmHue', 'mix.strength', 'mix.hueMax', 'mix.roleBlock', 'environment.hue', 'environment.absorption', 'impasto.strength', 'canvas.texture', 'underpaint.opacity', 'roles.dab.density', 'particles.fadeLo']) {
      expect(key(moved(path)), path).toBe(base)
    }
    // the frame-only sliders that move the baked paths' length (the target, the growth cap, the brush's follow of the zoom, the densities of the roles
    // that grow) move the key through the bucketed factor of the marks, and only when it moves
    for (const path of ['particles.targetPer10kPx', 'particles.zoomGrowMax', 'particles.zoomStrokeScale', 'roles.block.density', 'roles.form.density', 'roles.glaze.density']) {
      const next = moved(path)
      const factors = (p: PaintParams) => JSON.stringify(lengthFactorsOf(SPHERE.scene, SPHERE.particles, p, SPHERE.authored.worldPerPx))
      expect(key(next) === base, path).toBe(factors(next) === factors(P))
    }
    for (const path of ['light.intensity', 'value.halfLo', 'value.terminatorSoftness', 'roles.block.length', 'roles.glaze.width', 'edges.stopAt', 'edges.planeCellDeg', 'detect.formBandNL', 'particles.zoomBigMax', 'particles.maxPerUnit2', 'mix.loadCell', 'environment.occlusion', 'seed', 'canvas.tone.0']) {
      expect(key(moved(path)), path).not.toBe(base)
    }
    // the curves that shape the value, not the colour
    expect(key({ ...P, curves: { ...P.curves, lightResponse: [[0, 0], [0.5, 0.7], [1, 1]] } })).not.toBe(base)
    expect(key({ ...P, curves: { ...P.curves, lAdjust: [[0, 0.1], [0.5, 0.35], [1, 0.1]] } })).toBe(base)
  })
})

describe('the key and determinism', () => {
  it('gives byte-identical arrays and an equal key for two bakes of the same inputs, and the same with a progress callback', () => {
    const first = SPHERE.baked
    const second = bakeAgain(SPHERE, SPHERE.params)
    const withProgress = bakePaintingWithProgress(SPHERE.scene, SPHERE.particles, SPHERE.colours, SPHERE.light, SPHERE.params, SPHERE.authored, () => undefined)
    for (const other of [second, withProgress]) {
      const a = arraysOf(first)
      const b = arraysOf(other)
      expect([...a.keys()]).toEqual([...b.keys()])
      for (const [k, v] of a) expect(bytesEqual(v, b.get(k)!), k).toBe(true)
      expect(other.key).toBe(first.key)
      expect(other.count).toBe(first.count)
      expect(other.referenceWorldPerPx).toBe(first.referenceWorldPerPx)
    }
  })

  it('moves the key with the scene’s geometry, the light to 1e-6, and the authored framing; and gives a 16-digit hex string', () => {
    const base = bakeKey(SPHERE.scene, LIGHT, SPHERE.params, SPHERE.authored, SPHERE.particles)
    expect(base).toMatch(/^[0-9a-f]{16}$/)
    expect(bakeKey(SPHERE.scene, LIGHT, SPHERE.params, SPHERE.authored, SPHERE.particles)).toBe(base)
    // the light: 2e-6 away is another light, 2e-8 away is the same
    expect(bakeKey(SPHERE.scene, [LIGHT[0] + 2e-6, LIGHT[1], LIGHT[2]], SPHERE.params, SPHERE.authored, SPHERE.particles)).not.toBe(base)
    expect(bakeKey(SPHERE.scene, [LIGHT[0] + 2e-8, LIGHT[1], LIGHT[2]], SPHERE.params, SPHERE.authored, SPHERE.particles)).toBe(base)
    // a light of another length but the same direction is the same light
    expect(bakeKey(SPHERE.scene, [2 * LIGHT[0], 2 * LIGHT[1], 2 * LIGHT[2]], SPHERE.params, SPHERE.authored, SPHERE.particles)).toBe(base)
    // the authored framing: the eye, the direction, the projection, the world size of a px
    const a = SPHERE.authored
    expect(bakeKey(SPHERE.scene, LIGHT, SPHERE.params, { ...a, worldPerPx: a.worldPerPx * 1.01 }, SPHERE.particles)).not.toBe(base)
    expect(bakeKey(SPHERE.scene, LIGHT, SPHERE.params, { ...a, ortho: !a.ortho }, SPHERE.particles)).not.toBe(base)
    expect(bakeKey(SPHERE.scene, LIGHT, SPHERE.params, framing(80, 25), SPHERE.particles)).not.toBe(base)
    // the scene: a vertex moved, a mark added
    const sphere = SPHERE.scene.marks[0] as MeshMark
    const moved1 = { ...sphere, positions: Float64Array.from(sphere.positions, (v, i) => (i === 7 ? v + 1e-3 : v)) }
    expect(bakeKey({ ...SPHERE.scene, marks: [moved1, SPHERE.scene.marks[1]] }, LIGHT, SPHERE.params, SPHERE.authored, SPHERE.particles)).not.toBe(base)
    expect(bakeKey({ ...SPHERE.scene, marks: [SPHERE.scene.marks[0]] }, LIGHT, SPHERE.params, SPHERE.authored, SPHERE.particles)).not.toBe(base)
  })

  it('changes the baked painting when a non-colour parameter changes, and does not when a colour-only one does (the geometry, the roles and the values stay)', () => {
    const base = SPHERE.baked
    const longer = bakeAgain(SPHERE, setParam(SPHERE.params, 'roles.block.length', 70))
    expect(longer.key).not.toBe(base.key)
    expect(bytesEqual(longer.basePx, base.basePx)).toBe(false)
    const colourOnly = bakeAgain(SPHERE, setParam(SPHERE.params, 'curve.warmHue', 20))
    expect(colourOnly.key).toBe(base.key)
    for (const k of ['role', 'layer', 'mark', 'particle', 'rank', 'side', 'worldPath', 'worldNormal', 'pathLength', 'anchor', 'basePx', 'alpha', 'load', 'seed'] as const) {
      expect(bytesEqual(colourOnly[k], base[k]), k).toBe(true)
    }
    expect(bytesEqual(colourOnly.colour, base.colour)).toBe(false)
  })
})

describe('the assembly', () => {
  const { baked, particles, params, scene, authored } = SPHERE
  const stats = bakeStats(baked)!

  it('fills the contract: one entry per stroke in every array, the framing’s world size of a px, a focal pair per mark from the world edges, area per particle, no data colours yet', () => {
    const n = baked.count
    expect(n).toBeGreaterThan(2000)
    expect(baked.role.length).toBe(n)
    expect(baked.layer.length).toBe(n)
    expect(baked.mark.length).toBe(n)
    expect(baked.particle.length).toBe(n)
    expect(baked.rank.length).toBe(n)
    expect(baked.side.length).toBe(n)
    expect(baked.sizing.length).toBe(n)
    expect(baked.hidden.length).toBe(n)
    expect(baked.handStart.length).toBe(n)
    expect(baked.worldPath.length).toBe(3 * BAKE_PATH_POINTS * n)
    expect(baked.worldNormal.length).toBe(3 * BAKE_PATH_POINTS * n)
    for (const k of ['pathLength', 'anchor', 'alpha', 'load', 'impasto', 'bristles', 'bristleVar', 'dry', 'wet', 'endSoft'] as const) expect(baked[k].length, k).toBe(n)
    expect(baked.basePx.length).toBe(2 * n)
    expect(baked.colour.length).toBe(3 * BAKE_MIX_LEVELS * n)
    expect(baked.edge.length).toBe(n)
    expect(baked.seed.length).toBe(n)
    expect(baked.referenceWorldPerPx).toBe(authored.worldPerPx)
    expect(baked.focal).toBe(stats.edges.focal)
    expect(baked.focal.length).toBe(8 * scene.marks.length)
    expect(baked.dataColour.length).toBe(3 * scene.marks.length)
    expect(baked.dataColour.every((v) => v === 0)).toBe(true)
    expect(baked.surfaces.length).toBe(scene.marks.length)
    // area per particle: the mesh's world area over its particle count
    scene.marks.forEach((m, i) => {
      const count = particles.mark.reduce((c, mk) => c + (mk === i ? 1 : 0), 0)
      expect(baked.areaPerParticle[i]).toBeCloseTo(meshArea(m as MeshMark) / count, 5)
    })
    // surface strokes: not data marks, surface-sized, with the particle they grew from (a dab: none)
    for (let i = 0; i < n; i++) {
      expect(baked.sizing[i]).toBe(SIZING_SURFACE)
      expect(baked.hidden[i]).toBe(HIDDEN_NA)
      if (baked.particle[i] !== 0xffffffff) expect(particles.mark[baked.particle[i]]).toBe(baked.mark[i])
    }
  })

  it('orders the strokes by layer, then by a seeded key (not by particle), and every role’s layer is its index in LAYER_ORDER', () => {
    let prevLayer = 0
    let layerOk = true
    let inOrder = 0
    let pairs = 0
    for (let i = 0; i < baked.count; i++) {
      if (baked.layer[i] < prevLayer) layerOk = false
      if (baked.layer[i] !== LAYER_ORDER.indexOf(ROLES[baked.role[i]])) layerOk = false
      if (i > 0 && baked.layer[i] === baked.layer[i - 1] && baked.particle[i] !== 0xffffffff && baked.particle[i - 1] !== 0xffffffff) {
        pairs++
        if (baked.particle[i] > baked.particle[i - 1]) inOrder++
      }
      prevLayer = baked.layer[i]
    }
    expect(layerOk).toBe(true)
    // (a seeded shuffle: about half of the neighbours go up, not all, not none)
    expect(pairs).toBeGreaterThan(1000)
    expect(inOrder / pairs).toBeGreaterThan(0.35)
    expect(inOrder / pairs).toBeLessThan(0.65)
  })

  it('gives every stroke a finite, displayable colour at every level, and the levels the brush-load cells give: the model’s loadCellOf at that level, mixed from the recipe', () => {
    expect(baked.colour.every((v) => Number.isFinite(v))).toBe(true)
    expect(Math.min(...baked.colour)).toBeGreaterThanOrEqual(-1e-6)
    expect(Math.max(...baked.colour)).toBeLessThanOrEqual(1 + 1e-6)
    const held = bakedRecipes(baked)!
    const env = recipeEnv(params, curveFor(params), groundLocal(params))
    const mixer = new LoadMixer(params)
    let checked = 0
    let levelsDiffer = 0
    for (let k = 0; k < baked.count; k += 37) {
      const c = held.perm[k]
      const p = baked.particle[k]
      if (p === 0xffffffff) continue
      const lab = preMixLab(held.recipes, c, env)
      const lBound = held.recipes.fam[c] >= 0 ? boundLightness(held.recipes, c, env) : null
      const out: number[][] = []
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) {
        const cell = loadCellOf(particles, p, params.mix.loadCell, l)
        expect(held.recipes.cells[BAKE_MIX_LEVELS * c + l]).toBe(cell)
        let mixed = mixer.mix({ role: ROLES[baked.role[k]], cell, u: held.recipes.u[c], x: 0, y: 0, lab, colormapped: held.recipes.colormapped[c] === 1, seed: baked.seed[k], jit0: held.recipes.jit0[c], jit1: held.recipes.jit1[c] }).lab
        if (lBound !== null) mixed = holdLightness(mixed, held.recipes.fam[c] === FAM_SHADOW, lBound)
        const lin = Array.from(Float32Array.from(oklabToLinear(mixed)))
        out.push(lin)
        const o = 3 * (BAKE_MIX_LEVELS * k + l)
        expect(Array.from(baked.colour.slice(o, o + 3))).toEqual(lin)
      }
      if (out[0].some((v, i) => v !== out[BAKE_MIX_LEVELS - 1][i])) levelsDiffer++
      checked++
    }
    expect(checked).toBeGreaterThan(50)
    // (finer cells, other offsets: most strokes have another colour at the finest level than at the coarsest)
    expect(levelsDiffer).toBeGreaterThan(0.3 * checked)
  })

  it('reports its progress through the six phases in order, each from 0 to 1, with the strokes’ in between, and the same painting as without', () => {
    const events: BakeProgress[] = []
    const out = bakePaintingWithProgress(scene, particles, SPHERE.colours, SPHERE.light, params, authored, (p) => events.push({ ...p }))
    const phases = ['plan', 'planes', 'edges', 'strokes', 'underpaint', 'pack']
    const seen: string[] = []
    for (const e of events) if (seen[seen.length - 1] !== e.phase) seen.push(e.phase)
    expect(seen).toEqual(phases)
    for (const ph of phases) {
      const mine = events.filter((e) => e.phase === ph).map((e) => e.done)
      expect(mine[0]).toBe(0)
      expect(mine[mine.length - 1]).toBe(1)
      for (let i = 1; i < mine.length; i++) expect(mine[i]).toBeGreaterThanOrEqual(mine[i - 1])
      for (const d of mine) expect(d >= 0 && d <= 1).toBe(true)
    }
    expect(events.filter((e) => e.phase === 'strokes').length).toBeGreaterThan(3)
    expect(out.key).toBe(baked.key)
    expect(bytesEqual(out.colour, baked.colour)).toBe(true)
  })

  it('exposes nothing of a surface that is shared with the refined surface the bake keeps: the baked surface owns its arrays', () => {
    const s: BakedSurface = baked.surfaces[0]!
    const refined = stats.plan.surfaces[0]!
    expect(s.indices).not.toBe(refined.indices)
    expect(s.positions.buffer).not.toBe(refined.positions.buffer)
  })

  it('bakes a scene that has creases (a flat-shaded box), a degenerate mesh, and data marks without throwing, with finite colours and the data marks left to the frame', () => {
    const box = boxMesh([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], 0)
    // a mesh with a non-finite vertex and a triangle that has no area
    const bad: MeshMark = { ...sphereMesh({ radius: 0.2, index: 1, nu: 4, nv: 3 }), positions: Float64Array.from([0, 0, 0, Number.NaN, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float64Array(12), indices: Uint32Array.from([0, 1, 2, 0, 0, 3]) }
    const empty: MeshMark = { ...sphereMesh({ radius: 0.2, index: 2 }), positions: new Float64Array(0), normals: new Float64Array(0), indices: new Uint32Array(0), uv: null }
    const marks = [box, bad, empty, lineMark([[-1, -1, 1], [1, 1, 1]], { index: 3 }), pointMark([[0, 0, 1]], { index: 4 }), arrowMark([0, 0, 0], [0, 0, 1], { index: 5 })]
    const f = fixture(sceneOf(marks), flatColours({ 0: TERRACOTTA }), sparse(300))
    expect(f.baked.count).toBeGreaterThan(300)
    expect(f.baked.colour.every((v) => Number.isFinite(v))).toBe(true)
    expect(f.baked.worldPath.every((v) => Number.isFinite(v))).toBe(true)
    // the box is closed (painted from outside), the data marks have no surface, no stroke belongs to them in this task
    expect(f.baked.surfaces[0]!.closed).toBe(true)
    for (const m of [3, 4, 5]) expect(f.baked.surfaces[m]).toBeNull()
    for (let i = 0; i < f.baked.count; i++) expect(f.baked.mark[i]).toBe(0)
    expect(f.baked.areaPerParticle[3]).toBe(0)
    for (const s of f.baked.surfaces) if (s) expect([...s.underFront, ...(s.underBack ?? [])].every((v) => Number.isFinite(v))).toBe(true)
  })

  it('bakes a scene with no mesh at all to an empty painting (a line alone), and a scene with an empty mesh without throwing', () => {
    const none = bakePainting({ ...scene, marks: [] }, { ...particles, count: 0 }, SPHERE.colours, LIGHT, params, authored)
    expect(none.count).toBe(0)
    expect(none.surfaces.length).toBe(0)
    expect(none.colour.length).toBe(0)
  })
})
