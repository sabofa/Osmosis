import { describe, expect, it, vi } from 'vitest'
import { lchToLab, linearToOklab } from '../model/colour'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { LoadMixer } from '../model/mix'
import { holdLightness, oklabToLinear } from '../model/colour'
import { flatColours, sceneOf, tableMesh } from '../model/testing'
import type { ColourRecipe } from '../model/recipe'
import { worldLight } from '../model/valueFinalFixture'
import { FAM_SHADOW } from '../model/value'
import { resolvePaintParams, setParam, type PaintParams } from '../params'
import { LAYER_ORDER, ROLES } from '../types'
import { CHAIN_BREAK, NO_PARTICLE, boundLightness, preMixLab } from './draft'
import { isModelCell, markMeans, spacingRank } from './edgeStrokes'
import { bakedRecipes, bakePainting, bakeStats, recolourBake } from './index'
import { newPlanAt, planAt } from './plan'
import { BAKE_EDGE_REFINE, BAKE_MIX_LEVELS, BAKE_PATH_POINTS, HIDDEN_NA, isEdgeSizing, SIZING_ACROSS, SIZING_ALONG } from './types'
import type { WorldEdgeRun } from './edges'
import { locate, type SurfacePoint } from './surface'
import { boxMesh } from './edgesFixture'
import { CANVAS, fixture, P, saddleColours, saddleScene, sparse, sphereColours, sphereScene, TERRACOTTA, type Fixture } from './bakeFixture'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 300_000 })

const SPHERE = fixture(sphereScene(), sphereColours(), sparse(250))
const SADDLE = fixture(saddleScene(), saddleColours(), sparse(600))
const boxScene = () => sceneOf([boxMesh([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], 0), tableMesh({ z: -0.5, half: 2, index: 1 })])
const BOX = fixture(boxScene(), flatColours({ 0: TERRACOTTA, 1: CANVAS }), sparse(250))
const EDGE = ROLES.indexOf('edge')
const env = (params: PaintParams) => recipeEnv(params, curveFor(params), groundLocal(params))
const PX = SPHERE.authored.worldPerPx

// The edge strokes of a fixture, as indices into its painting order.
const edgeStrokes = (f: Fixture): number[] => {
  const out: number[] = []
  for (let i = 0; i < f.baked.count; i++) if (f.baked.role[i] === EDGE) out.push(i)
  return out
}
// What a stroke is, by its alpha (the model's own, set per kind of stroke: a firm crisp stroke 0.85, a hard one 1, a drag 0.8, a pull 0.75, a bridge 0.6).
const kindOf = (f: Fixture, i: number): 'crisp' | 'drag' | 'pull' | 'bridge' => {
  const a = f.baked.alpha[i]
  if (a === Math.fround(0.8)) return 'drag'
  if (a === Math.fround(0.75)) return 'pull'
  if (a === Math.fround(0.6)) return 'bridge'
  return 'crisp'
}
const sizeOf = (f: Fixture): number => {
  const b = bakeStats(f.baked)!.plan.surfaces.map((s) => (s ? s.bvh.bounds : null))
  let size = 0
  for (const bb of b) if (bb) size = Math.max(size, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]))
  return size
}
const mid = (f: Fixture, i: number): [number, number, number] => {
  const o = 3 * (BAKE_PATH_POINTS * i + BAKE_PATH_POINTS / 2)
  const p = o - 3
  const w = f.baked.worldPath
  return [(w[o] + w[p]) / 2, (w[o + 1] + w[p + 1]) / 2, (w[o + 2] + w[p + 2]) / 2]
}
// The nearest sample of the runs of a mark and side to a point: its run and index.
function nearest(runs: WorldEdgeRun[], mark: number, side: number, x: number, y: number, z: number): { run: WorldEdgeRun; i: number; d: number } | null {
  let best: { run: WorldEdgeRun; i: number; d: number } | null = null
  for (const run of runs) {
    if (run.mark !== mark || run.side !== side) continue
    for (let i = 0; i < run.pts.length / 3; i++) {
      const d = Math.hypot(run.pts[3 * i] - x, run.pts[3 * i + 1] - y, run.pts[3 * i + 2] - z)
      if (!best || d < best.d) best = { run, i, d }
    }
  }
  return best
}
// How far a point is from the nearest sample of the runs of its mark and side (the polyline's samples are 2 px apart: the point is within a px of one).
const distanceToRuns = (runs: WorldEdgeRun[], mark: number, side: number, x: number, y: number, z: number): number => nearest(runs, mark, side, x, y, z)?.d ?? Infinity

describe('the edge strokes: what they are', () => {
  for (const [name, f] of [['a sphere on a table', SPHERE], ['an open saddle', SADDLE], ['a box on a table', BOX]] as const) {
    it(`are made along the runs of ${name}: sized in px, with no particle, in the edge role and layer, hidden is not applicable, with finite paths and normals of the side`, () => {
      const { baked } = f
      const stats = bakeStats(baked)!
      const strokes = edgeStrokes(f)
      expect(strokes.length).toBe(stats.edgeStrokes.strokes)
      expect(strokes.length).toBeGreaterThan(40)
      for (const i of strokes) {
        expect(baked.layer[i]).toBe(LAYER_ORDER.indexOf('edge'))
        expect(baked.particle[i]).toBe(NO_PARTICLE)
        expect(isEdgeSizing(baked.sizing[i])).toBe(true)
        expect(baked.hidden[i]).toBe(HIDDEN_NA)
        expect(baked.handStart[i]).toBe(0)
        expect(baked.edge[i]).toBeLessThan(4)
        expect(baked.rank[i]).toBeGreaterThanOrEqual(0)
        expect(baked.rank[i]).toBeLessThan(1)
        expect(baked.pathLength[i]).toBeGreaterThan(0)
        // the model's length in px: an along stroke's path is its stretch (the run's samples, chorded), a pull or a bridge is walked ARC_REACH (3) times as long
        if (baked.sizing[i] === SIZING_ALONG) {
          expect(baked.basePx[2 * i] * PX / baked.pathLength[i]).toBeGreaterThan(0.9)
          expect(baked.basePx[2 * i] * PX / baked.pathLength[i]).toBeLessThan(1.15)
        } else expect(baked.pathLength[i]).toBeLessThanOrEqual(3 * baked.basePx[2 * i] * PX * 1.001)
        expect(baked.basePx[2 * i + 1]).toBeGreaterThan(0)
        // the spacing rank and the anchor of the cell
        expect(baked.spacing[i]).toBeGreaterThanOrEqual(0)
        expect(baked.spacing[i]).toBeLessThan(1)
        expect(baked.anchor[i]).toBeGreaterThanOrEqual(0)
        expect(baked.anchor[i]).toBeLessThanOrEqual(1)
        for (let q = 0; q < BAKE_PATH_POINTS; q++) {
          const o = 3 * (BAKE_PATH_POINTS * i + q)
          expect(Number.isFinite(baked.worldPath[o] + baked.worldPath[o + 1] + baked.worldPath[o + 2])).toBe(true)
          // the side's unit normal at every point
          expect(Math.hypot(baked.worldNormal[o], baked.worldNormal[o + 1], baked.worldNormal[o + 2])).toBeCloseTo(1, 4)
        }
      }
      // (the stats count what the arrays hold)
      const byClass = [0, 0, 0, 0]
      for (const i of strokes) byClass[baked.edge[i]]++
      expect(byClass).toEqual(stats.edgeStrokes.byClass)
      const kinds = { crisp: 0, drag: 0, pull: 0, bridge: 0 }
      for (const i of strokes) kinds[kindOf(f, i)]++
      expect(kinds.crisp).toBe(stats.edgeStrokes.crisp)
      expect(kinds.drag).toBe(stats.edgeStrokes.drags)
      expect(kinds.pull).toBe(stats.edgeStrokes.pulls)
      expect(kinds.bridge).toBe(stats.edgeStrokes.bridges)
    })
  }

  it('gives a stroke on a closed opaque mesh side 0 and a stroke on an open one its run’s side, and never one on a mark that has no run', () => {
    const { baked } = SPHERE
    for (const i of edgeStrokes(SPHERE)) {
      // the sphere is closed (side 0); the table is an open sheet, and its cast shadow's edge is on the side that is lit
      expect(baked.side[i]).toBe(baked.mark[i] === 0 ? 0 : 1)
    }
    const sides = new Set(edgeStrokes(SADDLE).map((i) => SADDLE.baked.side[i]))
    expect(sides.has(1)).toBe(true)
    expect(sides.has(-1)).toBe(true)
    expect(sides.has(0)).toBe(false)
    const runMarks = new Set(bakeStats(SPHERE.baked)!.edges.runs.map((r) => r.mark))
    for (const i of edgeStrokes(SPHERE)) expect(runMarks.has(baked.mark[i])).toBe(true)
  })

  it('puts a crisp stroke on firm and hard edges, a drag and pulls on soft ones, bridges on lost ones, as the model’s classes do, with the model’s widths and alphas', () => {
    const rp = P.roles.edge
    for (const f of [SPHERE, SADDLE, BOX]) {
      const { baked } = f
      let seen = { crisp: 0, drag: 0, pull: 0, bridge: 0 }
      for (const i of edgeStrokes(f)) {
        const k = kindOf(f, i)
        seen[k]++
        const w = baked.basePx[2 * i + 1]
        const cls = baked.edge[i]
        if (k === 'crisp') {
          expect(cls).toBeGreaterThanOrEqual(2)
          expect(baked.alpha[i]).toBe(Math.fround(cls === 3 ? 1 : 0.85))
          // role width × 0.7 (hard) or 0.475 (firm) × the seeded ±12%
          const base = rp.width * (cls === 3 ? 0.7 : 0.475)
          expect(w).toBeGreaterThanOrEqual(base * 0.88 - 1e-4)
          expect(w).toBeLessThanOrEqual(base * 1.12 + 1e-4)
        } else if (k === 'drag') {
          expect(cls).toBeLessThanOrEqual(1)
          expect(w).toBeGreaterThanOrEqual(rp.width * 2.6 * 0.88 - 1e-4)
          expect(w).toBeLessThanOrEqual(rp.width * 2.6 * 1.12 + 1e-4)
        } else if (k === 'pull') {
          expect(w).toBeGreaterThanOrEqual(rp.width * 1.9 * 0.88 - 1e-4)
          expect(w).toBeLessThanOrEqual(rp.width * 1.9 * 1.12 + 1e-4)
          // (the model's length of a pull: the role's length × 22/30 × the seeded ±20%; the path is walked 3 times as long, and the walk may stop short)
          expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rp.length * (22 / 30) * 0.8 - 1e-4)
          expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rp.length * (22 / 30) * 1.2 + 1e-4)
          expect(baked.pathLength[i] / PX).toBeLessThanOrEqual(3 * baked.basePx[2 * i] * 1.001)
        } else {
          expect(cls).toBeLessThanOrEqual(1)
          expect(w).toBeGreaterThanOrEqual(rp.width * 1.8 * 0.88 - 1e-4)
          expect(w).toBeLessThanOrEqual(rp.width * 1.8 * 1.12 + 1e-4)
          expect(baked.basePx[2 * i]).toBeGreaterThanOrEqual(rp.length * (26 / 30) * 0.85 - 1e-4)
          expect(baked.basePx[2 * i]).toBeLessThanOrEqual(rp.length * (26 / 30) * 1.15 + 1e-4)
          expect(baked.pathLength[i] / PX).toBeLessThanOrEqual(3 * baked.basePx[2 * i] * 1.001)
        }
      }
      // (every kind occurs somewhere in the three scenes, below)
      for (const k of Object.keys(seen) as (keyof typeof seen)[]) expect(seen[k] >= 0).toBe(true)
    }
    const all = { crisp: 0, drag: 0, pull: 0, bridge: 0 }
    for (const f of [SPHERE, SADDLE, BOX]) for (const i of edgeStrokes(f)) all[kindOf(f, i)]++
    for (const k of Object.keys(all) as (keyof typeof all)[]) expect(all[k], k).toBeGreaterThan(5)
  })
})

describe('the edge strokes: their paths', () => {
  it('lie on the refined surface of their own mark, every point of every stroke (within 1e-5 of the scene size), the pulls and bridges among them (they are walked) and the creases of a box too', () => {
    for (const f of [SPHERE, SADDLE, BOX]) {
      const plan = bakeStats(f.baked)!.plan
      const size = sizeOf(f)
      const hit: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
      let worst = 0
      let n = 0
      for (const i of edgeStrokes(f)) {
        const s = plan.surfaces[f.baked.mark[i]]!
        for (let q = 0; q < BAKE_PATH_POINTS; q++) {
          const o = 3 * (BAKE_PATH_POINTS * i + q)
          expect(locate(s, f.baked.worldPath[o], f.baked.worldPath[o + 1], f.baked.worldPath[o + 2], 0, 0, 0, 1e-3 * size, hit)).toBe(true)
          worst = Math.max(worst, hit.dist ?? 0)
          n++
        }
      }
      expect(n).toBeGreaterThan(600)
      expect(worst, 'scene of size ' + size).toBeLessThanOrEqual(1e-5 * size)
    }
  })

  it('follow the run along it for a crisp stroke or a drag (the run’s own samples, 16 points at equal arc length) and cross it for a pull or a bridge', () => {
    for (const f of [SPHERE, SADDLE, BOX]) {
      const runs = bakeStats(f.baked)!.edges.runs
      let along = 0
      let across = 0
      let alongOff = 0
      let acrossOn = 0
      let even = 0
      for (const i of edgeStrokes(f)) {
        const k = kindOf(f, i)
        const m = f.baked.mark[i]
        const side = f.baked.side[i]
        // the largest distance of a path point from a run's sample (the samples are 2 px apart: a point between two is a px from one)
        let worst = 0
        for (let q = 0; q < BAKE_PATH_POINTS; q++) {
          const o = 3 * (BAKE_PATH_POINTS * i + q)
          worst = Math.max(worst, distanceToRuns(runs, m, side, f.baked.worldPath[o], f.baked.worldPath[o + 1], f.baked.worldPath[o + 2]))
        }
        if (k === 'crisp' || k === 'drag') {
          along++
          if (worst > 1.01 * PX) alongOff++
          // equal arc length: the chords of the 16 points are alike (a plane boundary's polyline wavers on a coarse triangulation, and a chord
          // across a waver is shorter than the arc)
          const chords: number[] = []
          for (let q = 1; q < BAKE_PATH_POINTS; q++) {
            const o = 3 * (BAKE_PATH_POINTS * i + q)
            chords.push(Math.hypot(...[0, 1, 2].map((c) => f.baked.worldPath[o + c] - f.baked.worldPath[o + c - 3])))
          }
          const spread = Math.max(...chords) / Math.min(...chords)
          if (spread < 1.35) even++
          expect(spread, 'chords of a stroke along a run').toBeLessThan(2.5)
        } else {
          across++
          if (worst < 3 * PX) acrossOn++
        }
      }
      expect(along).toBeGreaterThan(10)
      expect(even).toBeGreaterThanOrEqual(0.9 * along)
      expect(across).toBeGreaterThan(2)
      // (a crisp stroke's path is the samples' own, within the px between two; a pull's end is well away from them)
      expect(alongOff).toBe(0)
      // (a pull that a border stopped at once is a few px long: it does not leave the run's samples)
      expect(acrossOn).toBeLessThanOrEqual(0.1 * across)
    }
  })

  it('send a pull from the lighter side of its edge into the darker, and a bridge across it, centred on the edge: on a closed sphere the two ends are on the two sides', () => {
    const f = SPHERE
    const runs = bakeStats(f.baked)!.edges.runs
    let pulls = 0
    let right = 0
    let bridges = 0
    let across2 = 0
    for (const i of edgeStrokes(f)) {
      const k = kindOf(f, i)
      if (k !== 'pull' && k !== 'bridge') continue
      const m = f.baked.mark[i]
      if (m !== 0) continue
      const c = mid(f, i)
      const near = nearest(runs, m, f.baked.side[i], c[0], c[1], c[2])!
      const a = near.run.across
      const j = near.i
      const p0 = 3 * BAKE_PATH_POINTS * i
      const p1 = 3 * (BAKE_PATH_POINTS * i + BAKE_PATH_POINTS - 1)
      const w = f.baked.worldPath
      const s0 = (w[p0] - near.run.pts[3 * j]) * a[3 * j] + (w[p0 + 1] - near.run.pts[3 * j + 1]) * a[3 * j + 1] + (w[p0 + 2] - near.run.pts[3 * j + 2]) * a[3 * j + 2]
      const s1 = (w[p1] - near.run.pts[3 * j]) * a[3 * j] + (w[p1 + 1] - near.run.pts[3 * j + 1]) * a[3 * j + 1] + (w[p1 + 2] - near.run.pts[3 * j + 2]) * a[3 * j + 2]
      if (k === 'pull') {
        // the stroke runs from the lighter side into the darker: its end is on the darker side of the edge
        const lighterIsA = near.run.uA[j] >= near.run.uB[j]
        if (Math.abs(near.run.uA[j] - near.run.uB[j]) < 0.04) continue
        pulls++
        if ((s1 - s0) * (lighterIsA ? 1 : -1) > 0) right++
      } else {
        bridges++
        if (s0 * s1 < 0) across2++
      }
    }
    expect(pulls).toBeGreaterThan(10)
    expect(right).toBeGreaterThanOrEqual(0.9 * pulls)
    expect(bridges).toBeGreaterThan(10)
    expect(across2).toBeGreaterThanOrEqual(0.85 * bridges)
  })

  it('stop at a border the way a surface stroke does: a pull or a bridge on the border of an open sheet stays on the sheet (one side of the border only), where the model’s would run over the canvas', () => {
    const f = SADDLE
    const runs = bakeStats(f.baked)!.edges.runs
    let checked = 0
    for (const i of edgeStrokes(f)) {
      const k = kindOf(f, i)
      if (k !== 'pull' && k !== 'bridge') continue
      const m = f.baked.mark[i]
      const side = f.baked.side[i]
      const c = mid(f, i)
      const near = nearest(runs, m, side, c[0], c[1], c[2])!
      if (near.run.type !== 'border') continue
      checked++
      // the sheet is on side A of a border (across points from the sheet out to the canvas): no point of the path is beyond the border
      const a = near.run.across
      const j = near.i
      let beyond = -Infinity
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        const w = f.baked.worldPath
        beyond = Math.max(beyond, (w[o] - near.run.pts[3 * j]) * a[3 * j] + (w[o + 1] - near.run.pts[3 * j + 1]) * a[3 * j + 1] + (w[o + 2] - near.run.pts[3 * j + 2]) * a[3 * j + 2])
      }
      expect(beyond, 'a stroke of a border run past its border').toBeLessThanOrEqual(2 * PX)
    }
    expect(checked).toBeGreaterThan(3)
  })

  it('wrap round a crease: a pull or bridge on a box’s edge starts on one face and ends on the other (its two ends have unlike normals), where a straight walk would have left the surface', () => {
    const f = BOX
    let creasePulls = 0
    let wrapped = 0
    const runs = bakeStats(f.baked)!.edges.runs
    for (const i of edgeStrokes(f)) {
      const k = kindOf(f, i)
      if (k !== 'pull' && k !== 'bridge') continue
      if (f.baked.mark[i] !== 0) continue
      const c = mid(f, i)
      const near = nearest(runs, 0, 0, c[0], c[1], c[2])!
      if (near.d > 3 * PX) continue
      creasePulls++
      const n0 = 3 * BAKE_PATH_POINTS * i
      const n1 = 3 * (BAKE_PATH_POINTS * i + BAKE_PATH_POINTS - 1)
      const nn = f.baked.worldNormal
      if (nn[n0] * nn[n1] + nn[n0 + 1] * nn[n1 + 1] + nn[n0 + 2] * nn[n1 + 2] < 0.2) wrapped++
    }
    expect(creasePulls).toBeGreaterThan(10)
    expect(wrapped).toBeGreaterThanOrEqual(0.9 * creasePulls)
    // none is lost: no stroke is dropped on a box
    expect(bakeStats(f.baked)!.edgeStrokes.dropped).toBe(0)
  })
})

describe('the edge strokes: their colours', () => {

  it('are the same at every brush-load level (the sequential mix, made once)', () => {
    for (const f of [SPHERE, SADDLE, BOX]) {
      for (const i of edgeStrokes(f)) {
        const o = 3 * BAKE_MIX_LEVELS * i
        for (let l = 1; l < BAKE_MIX_LEVELS; l++) for (let c = 0; c < 3; c++) expect(f.baked.colour[o + 3 * l + c]).toBe(f.baked.colour[o + c])
      }
    }
  })

  it('keep the value rule: a stroke on the outline of a form in shadow, or between planes both in the shadow family, is no lighter than the colour of its own side at the cap, at every level, also under the loudest mix', () => {
    const loud = resolvePaintParams({ particles: { maxPerUnit2: 600 }, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: 1 } })
    const loudDown = resolvePaintParams({ particles: { maxPerUnit2: 600 }, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: -1 } })
    const fixtures: Fixture[] = [SPHERE, SADDLE, BOX, fixture(saddleScene(), saddleColours(), loud), fixture(saddleScene(), saddleColours(), loudDown)]
    let held = 0
    for (const f of fixtures) {
      const rec = bakedRecipes(f.baked)!
      const e = env(f.params)
      for (const k of edgeStrokes(f)) {
        const c = rec.perm[k]
        if (rec.recipes.fam[c] < 0) continue
        expect(rec.recipes.fam[c]).toBe(FAM_SHADOW)
        const bound = boundLightness(rec.recipes, c, e)
        for (let l = 0; l < BAKE_MIX_LEVELS; l++) {
          const o = 3 * (BAKE_MIX_LEVELS * k + l)
          const L = linearToOklab(f.baked.colour[o], f.baked.colour[o + 1], f.baked.colour[o + 2])[0]
          expect(bound - L, `edge stroke ${k}`).toBeGreaterThanOrEqual(-5e-5)
        }
        held++
      }
    }
    expect(held).toBeGreaterThan(60)
  })

  it('make the outline of a form in the shadow family against the light canvas a FOUND edge: a crisp stroke held to the shadow family, never bridged to the canvas (the model’s rule for a silhouette, on a sheet’s border)', () => {
    let found = 0
    let crisp = 0
    for (const f of [SADDLE, BOX]) {
      const rec = bakedRecipes(f.baked)!
      const plan = bakeStats(f.baked)!.plan
      const runs = bakeStats(f.baked)!.edges.runs
      for (const i of edgeStrokes(f)) {
        if (rec.recipes.fam[rec.perm[i]] !== FAM_SHADOW) continue
        const c = mid(f, i)
        const near = nearest(runs, f.baked.mark[i], f.baked.side[i], c[0], c[1], c[2])!
        if (near.run.type !== 'border' || near.d > 3 * PX || near.run.uB[near.i] < plan.floorU) continue
        found++
        if (kindOf(f, i) === 'crisp') crisp++
      }
    }
    expect(found).toBeGreaterThan(3)
    expect(crisp).toBeGreaterThanOrEqual(0.9 * found)
  })

  it('carry one side into the other for a drag, a pull and a bridge (a blend of the two sides’ recipes, held to the figure’s own side where the stretch is a shadow-family outline) and one side’s own colour for a crisp stroke', () => {
    let blends = 0
    let crisp = 0
    for (const f of [SPHERE, SADDLE, BOX]) {
      const rec = bakedRecipes(f.baked)!
      for (const k of edgeStrokes(f)) {
        const d = rec.recipes.draft[rec.perm[k]]!
        const kind = kindOf(f, k)
        expect(d).toBeDefined()
        if (kind === 'crisp') {
          expect(d.b).toBeNull()
          crisp++
        } else {
          expect(d.b).not.toBeNull()
          expect(d.t).toBeCloseTo(kind === 'pull' ? 0.3 : 0.5, 6)
          blends++
        }
        // a stroke held to the shadow family's ceiling that is a blend is held to its own side's colour
        if (rec.recipes.fam[rec.perm[k]] >= 0 && kind !== 'crisp') expect(rec.recipes.hold[rec.perm[k]]).toBeDefined()
      }
    }
    expect(blends).toBeGreaterThan(50)
    expect(crisp).toBeGreaterThan(10)
  })

  it('are mixed by the SEQUENTIAL mixer in the order they are made: replaying the model’s LoadMixer over the recipes, with each stroke’s distance from the one before it in the chain, gives the baked colour bit for bit', () => {
    for (const f of [SPHERE, SADDLE]) {
      const rec = bakedRecipes(f.baked)!
      const r = rec.recipes
      const e = env(f.params)
      const mixer = new LoadMixer(f.params)
      let axis = 0
      const inOrder: number[] = []
      // creation order: perm[k] is the creation index of the k-th painted stroke
      const painted = new Map<number, number>()
      rec.perm.forEach((c, k) => painted.set(c, k))
      for (let c = 0; c < r.count; c++) if (r.sequential[c] === 1 && r.mixRole[c] === EDGE) inOrder.push(c)
      expect(inOrder.length).toBe(edgeStrokes(f).length)
      let starts = 0
      let rides = 0
      for (const c of inOrder) {
        // (a stroke that rides a load is no step of the chain, and takes the place in the load the stroke before it has)
        const rider = r.follow[c] === 1
        if (!rider) axis += r.mx[c]
        const lab = preMixLab(r, c, e)
        const input = { role: 'edge' as const, cell: r.cells[BAKE_MIX_LEVELS * c], u: r.u[c], x: axis, y: 0, lab, colormapped: false, seed: r.seed[c], jit0: r.jit0[c], jit1: r.jit1[c] }
        const out = rider ? mixer.mixFollow(input) : mixer.mix(input)
        if (rider) rides++
        else if (out.index === 0) starts++
        let m = out.lab
        if (r.fam[c] >= 0) m = holdLightness(m, r.fam[c] === FAM_SHADOW, boundLightness(r, c, e))
        const lin = Array.from(Float32Array.from(oklabToLinear(m)))
        const k = painted.get(c)!
        expect(Array.from(f.baked.colour.slice(3 * BAKE_MIX_LEVELS * k, 3 * BAKE_MIX_LEVELS * k + 3))).toEqual(lin)
        // a stroke that starts its chain (another run) starts a load
        if (r.mx[c] >= CHAIN_BREAK) expect(out.index).toBe(0)
      }
      // loads are runs of loadMin..loadMax consecutive strokes of the chain (the strokes that are not riders): a good many strokes share one, and every chain start
      // begins another; and the riders are most of the strokes (BAKE_EDGE_REFINE times as many cells as the model has)
      expect(starts).toBeLessThan(inOrder.length - rides)
      expect(starts).toBeGreaterThanOrEqual(inOrder.filter((c) => r.mx[c] >= CHAIN_BREAK).length)
      expect(rides).toBeGreaterThan(inOrder.length / 2)
    }
  })

  it('seed each load by the cell of its first stroke, the position hash at the stretch’s middle (the model’s `cell`), so no two loads of a run are made alike', () => {
    const f = SPHERE
    const r = bakedRecipes(f.baked)!.recipes
    const cells: number[] = []
    for (let c = 0; c < r.count; c++) if (r.sequential[c] === 1 && r.mixRole[c] === EDGE) cells.push(r.cells[BAKE_MIX_LEVELS * c])
    expect(cells.length).toBe(edgeStrokes(f).length)
    expect(cells.every((v) => v !== 0)).toBe(true)
    // (the strokes of one stretch share a cell: a stretch is a drag and a few pulls; every other stroke is another stretch's)
    // (the cell is a position hash rounded to 1/7 of a unit: two stretches whose middles are a cell apart may share one)
    expect(new Set(cells).size).toBeGreaterThanOrEqual(0.75 * bakeStats(f.baked)!.edgeStrokes.stretches)
    // the other levels carry no cell (a sequential stroke is mixed once)
    for (let c = 0; c < r.count; c++) if (r.sequential[c] === 1) for (let l = 1; l < BAKE_MIX_LEVELS; l++) expect(r.cells[BAKE_MIX_LEVELS * c + l]).toBe(0)
  })

  it('break a load where the next stroke is over mix.loadBreakPx away in the world, or where the run changes: a smaller distance gives more loads, a run change always one', () => {
    const f = SPHERE
    const rec = bakedRecipes(f.baked)!
    const r = rec.recipes
    const e = env(f.params)
    const loadsAt = (breakPx: number): { loads: number; chainStarts: number; broke: number } => {
      const mixer = new LoadMixer(setParam(f.params, 'mix.loadBreakPx', breakPx))
      let axis = 0
      let loads = 0
      let chainStarts = 0
      let broke = 0
      for (let c = 0; c < r.count; c++) {
        if (r.sequential[c] !== 1 || r.mixRole[c] !== EDGE || r.follow[c] === 1) continue
        axis += r.mx[c]
        const out = mixer.mix({ role: 'edge', cell: r.cells[BAKE_MIX_LEVELS * c], u: r.u[c], x: axis, y: 0, lab: preMixLab(r, c, e), colormapped: false, seed: r.seed[c], jit0: r.jit0[c], jit1: r.jit1[c] })
        if (out.index === 0) loads++
        if (r.mx[c] >= CHAIN_BREAK) {
          chainStarts++
          if (out.index === 0) broke++
        }
      }
      return { loads, chainStarts, broke }
    }
    const tight = loadsAt(10)
    const wide = loadsAt(400)
    expect(tight.loads).toBeGreaterThan(wide.loads)
    expect(wide.loads).toBeGreaterThanOrEqual(wide.chainStarts)
    expect(wide.chainStarts).toBeGreaterThan(5)
    expect(wide.broke).toBe(wide.chainStarts)
    expect(tight.broke).toBe(tight.chainStarts)
  })

  it('give the same distances to the chain whatever the colour parameters are: mx is the geometry’s (world distance over the reference px), not a slider’s', () => {
    const f = SPHERE
    const rec = bakedRecipes(f.baked)!
    const r = rec.recipes
    let last: [number, number, number] | null = null
    let checked = 0
    let prevRun = -1
    // (creation order: the strokes' middles, in the order the sink got them, are the paths' middle points)
    const painted = new Map<number, number>()
    rec.perm.forEach((c, k) => painted.set(c, k))
    for (let c = 0; c < r.count; c++) {
      // (a stroke that rides a load is no step of the chain)
      if (r.sequential[c] !== 1 || r.mixRole[c] !== EDGE || r.follow[c] === 1) continue
      const k = painted.get(c)!
      const m = mid(f, k)
      if (last && r.mx[c] < CHAIN_BREAK) {
        expect(r.mx[c]).toBeCloseTo(Math.hypot(m[0] - last[0], m[1] - last[1], m[2] - last[2]) / PX, 2)
        checked++
      }
      last = m
      prevRun = c
    }
    expect(prevRun).toBeGreaterThan(0)
    expect(checked).toBeGreaterThan(50)
  })

  it('recolour bit for bit with a fresh bake, over the edge strokes too, for a change of the load break (a colour-only slider that moves where the loads break)', () => {
    for (const next of [setParam(SPHERE.params, 'mix.loadBreakPx', 25), setParam(SPHERE.params, 'mix.loadMin', 2), setParam(SPHERE.params, 'curve.warmHue', 20)]) {
      const again = recolourBake(SPHERE.baked, next)!
      const fresh = bakePainting(SPHERE.scene, SPHERE.particles, SPHERE.colours, SPHERE.light, next, SPHERE.authored)
      expect(Buffer.compare(Buffer.from(again.colour.buffer), Buffer.from(fresh.colour.buffer))).toBe(0)
      expect(again.key).toBe(fresh.key)
    }
    // (and the load break does move colours: another break, other loads)
    const wide = recolourBake(SPHERE.baked, setParam(SPHERE.params, 'mix.loadBreakPx', 400))!
    const tight = recolourBake(SPHERE.baked, setParam(SPHERE.params, 'mix.loadBreakPx', 10))!
    let differ = 0
    for (const i of edgeStrokes(SPHERE)) if (wide.colour[3 * BAKE_MIX_LEVELS * i] !== tight.colour[3 * BAKE_MIX_LEVELS * i]) differ++
    expect(differ).toBeGreaterThan(5)
  })
})

describe('the edge strokes: the density, the contrast floor and the ranks', () => {
  it('carry the stretch’s seeded density draw as their rank (a frame keeps the stroke when rank < roles.edge.density), the same for every stroke of a stretch, spread over 0..1', () => {
    const ranks = edgeStrokes(SPHERE).map((i) => SPHERE.baked.rank[i])
    expect(new Set(ranks).size).toBeGreaterThan(20)
    expect(Math.min(...ranks)).toBeLessThan(0.2)
    expect(Math.max(...ranks)).toBeGreaterThan(0.8)
    // the strokes of one stretch share it: its cells (a stretch has one rank, and BAKE_EDGE_REFINE strokes or more of it: a stroke along it for each of its
    // cells, and a pull or a bridge for each of its lattice's)
    const counts = new Map<number, number>()
    for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeGreaterThan(BAKE_EDGE_REFINE)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(120)
  })

  it('make fewer strokes where the contrast floor is raised (an edge under detect.edgeMinContrast makes none), and more where it is lowered', () => {
    const count = (p: PaintParams) => edgeStrokes({ ...SPHERE, baked: bakePainting(SPHERE.scene, SPHERE.particles, SPHERE.colours, SPHERE.light, p, SPHERE.authored) }).length
    const base = edgeStrokes(SPHERE).length
    expect(count(setParam(SPHERE.params, 'detect.edgeMinContrast', 0.3))).toBeLessThan(base)
    expect(count(setParam(SPHERE.params, 'detect.edgeMinContrast', 0))).toBeGreaterThan(base)
  })
})

describe('the edge strokes: a crisp stroke’s value, the fold’s direction, and the crease’s hold (review fix round 1)', () => {
  it('sits below the darker side by 0.06 (a firm stroke) or 0.12 (a hard one): within 0.04 of the model’s rule at the sample it lies on, never held back from it but by the shadow cap', () => {
    let n = 0
    let firm = 0
    let hard = 0
    for (const f of [SPHERE, SADDLE, BOX]) {
      const rec = bakedRecipes(f.baked)!
      const runs = bakeStats(f.baked)!.edges.runs
      const capU = bakeStats(f.baked)!.plan.capU
      for (const i of edgeStrokes(f)) {
        if (kindOf(f, i) !== 'crisp') continue
        const u = (rec.recipes.draft[rec.perm[i]]!.a as ColourRecipe).u
        const c = mid(f, i)
        const near = nearest(runs, f.baked.mark[i], f.baked.side[i], c[0], c[1], c[2])!
        if (near.d > PX) continue
        const lo = Math.min(near.run.uA[near.i], near.run.uB[near.i])
        const hardEdge = f.baked.edge[i] === 3
        const want = Math.min(1, Math.max(0.1, Math.min(0.8, lo - (hardEdge ? 0.12 : 0.06))))
        // (the cap holds a shadow outline's stroke under it: a stroke under the rule is on the cap)
        if (u < want - 0.04) expect(Math.abs(u - capU), 'a stroke under the rule is on the cap').toBeLessThan(1e-6)
        else expect(Math.abs(u - want)).toBeLessThan(0.04)
        n++
        if (hardEdge) hard++
        else firm++
      }
    }
    expect(n).toBeGreaterThan(20)
    expect(firm).toBeGreaterThan(5)
    expect(hard).toBeGreaterThan(5)
  })

  it('starts a pull over a box’s crease on the lighter face and ends it on the darker, by the plan (the fold joins the face on the stroke’s -dir side first), in two lights', () => {
    let n = 0
    let right = 0
    for (const f of [BOX, fixture(boxScene(), flatColours({ 0: TERRACOTTA, 1: CANVAS }), sparse(250), worldLight(-60, 45))]) {
      const plan = bakeStats(f.baked)!.plan
      const s = plan.surfaces[0]!
      const uAt = (k: number, q: number): number => {
        const o = 3 * (BAKE_PATH_POINTS * k + q)
        const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
        if (!locate(s, f.baked.worldPath[o], f.baked.worldPath[o + 1], f.baked.worldPath[o + 2], 0, 0, 0, 1e-4, p)) return Number.NaN
        return planAt(plan, 0, 1, p, newPlanAt()).u
      }
      for (const i of edgeStrokes(f)) {
        if (f.baked.mark[i] !== 0 || kindOf(f, i) !== 'pull') continue
        // (the path is walked 3 times the model's length: the middle third of it, points 5 and 10, is what a frame draws)
        const u0 = (uAt(i, 5) + uAt(i, 6)) / 2
        const u1 = (uAt(i, 9) + uAt(i, 10)) / 2
        if (!(Math.abs(u0 - u1) > 0.01)) continue
        n++
        if (u0 > u1) right++
      }
    }
    expect(n).toBeGreaterThan(20)
    expect(right).toBe(n)
  })

  it('holds a crisp stroke on a crease whose value is in the shadow family to the cap whichever face is A, at every level, under the loudest mix (a dark box lit from two sides)', () => {
    const loud = resolvePaintParams({ particles: { maxPerUnit2: 250 }, mix: { strength: 2, valueStep: 0.15, valueStepFraction: 1, valueBias: 1 } })
    let n = 0
    for (const light of [worldLight(100, 10), worldLight(200, 20)] as [number, number, number][]) {
      const f = fixture(boxScene(), flatColours({ 0: lchToLab(0.35, 0.12, 260), 1: CANVAS }), loud, light)
      const rec = bakedRecipes(f.baked)!
      const capU = bakeStats(f.baked)!.plan.capU
      const e = env(loud)
      for (const i of edgeStrokes(f)) {
        if (f.baked.mark[i] !== 0 || kindOf(f, i) !== 'crisp') continue
        const c = rec.perm[i]
        if ((rec.recipes.draft[c]!.a as ColourRecipe).u > capU) continue
        n++
        expect(rec.recipes.fam[c]).toBe(FAM_SHADOW)
        const bound = boundLightness(rec.recipes, c, e)
        for (let l = 0; l < BAKE_MIX_LEVELS; l++) {
          const o = 3 * (BAKE_MIX_LEVELS * i + l)
          expect(bound - linearToOklab(f.baked.colour[o], f.baked.colour[o + 1], f.baked.colour[o + 2])[0]).toBeGreaterThanOrEqual(-5e-5)
        }
      }
    }
    expect(n).toBeGreaterThan(5)
  })

  it('falls back to a mark’s own flat colour, not a grey, for a mark with no particle (the model’s mean colour of a mark that has none)', () => {
    const own = lchToLab(0.5, 0.15, 30)
    const scene = sceneOf([boxMesh([0, 0, 0], [1, 1, 1], 0), boxMesh([2, 0, 0], [3, 1, 1], 1)])
    const set = { count: 2, mark: Uint32Array.from([0, 0]), colour: Float32Array.from([0.4, 0.1, 0.05, 0.6, 0.0, 0.1]) }
    const means = markMeans({ scene, set } as never, flatColours({ 0: [0.1, 0.1, 0.1], 1: own }))
    // a mark with particles: their mean; one without: its own colour
    expect(Array.from(means.slice(0, 3))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.05, 6), expect.closeTo(0.075, 6)])
    expect(Array.from(means.slice(3, 6))).toEqual([own[0], own[1], own[2]])
  })
})

describe('the edge strokes: the cells of a stretch and their spacing ranks (final fix wave, M2)', () => {
  it('rank the cells of a stretch in a bit-reversal order: the cells BAKE_EDGE_REFINE apart come first, then those halfway between, and so on, whatever the seeded draw', () => {
    const F = BAKE_EDGE_REFINE
    for (const u of [0, 0.37, 0.9999999]) {
      for (let i = -64; i <= 64; i++) {
        const r = spacingRank(i, u)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThan(1)
        // a model cell (a member of the load chain) is one under 1 / F
        expect(isModelCell(i), `cell ${i}`).toBe(r < 1 / F)
      }
      // the cells kept at a threshold of 2^m / F are those a multiple of F / 2^m apart, from the middle: a frame's lattice is even where its zoom is such a power
      for (let m = 0; 2 ** m <= F; m++) {
        const step = F / 2 ** m
        for (let i = -64; i <= 64; i++) expect(spacingRank(i, u) < 2 ** m / F, `m ${m} cell ${i}`).toBe(i % step === 0)
      }
    }
    // every run of F cells has each band of ranks once (the ranks of a stretch are uniform however short it is), and the draw moves a rank inside its band only
    for (let s0 = -20; s0 <= 20; s0++) {
      const bands = new Set<number>()
      for (let i = s0; i < s0 + F; i++) bands.add(Math.floor(spacingRank(i, 0.5) * F))
      expect(bands.size).toBe(F)
    }
    expect(spacingRank(5, 0.2)).toBeLessThan(spacingRank(5, 0.8))
    expect(Math.floor(spacingRank(5, 0.2) * F)).toBe(Math.floor(spacingRank(5, 0.8) * F))
  })

  it('make each stretch a lattice: one stroke along it is the model’s (a member), the others BAKE_EDGE_REFINE cells’ worth of the same path, anchored at the cells’ places', () => {
    const f = SPHERE
    const stretches = new Map<number, number[]>()
    for (const i of edgeStrokes(f)) {
      if (f.baked.sizing[i] !== SIZING_ALONG) continue
      const g = stretches.get(f.baked.rank[i])
      if (g) g.push(i)
      else stretches.set(f.baked.rank[i], [i])
    }
    expect(stretches.size).toBeGreaterThan(30)
    for (const g of stretches.values()) {
      // the cells of the stretch: from its start to its end, BAKE_EDGE_REFINE + 1 of them
      expect(g.length).toBe(BAKE_EDGE_REFINE + 1)
      const anchors = g.map((i) => f.baked.anchor[i] * BAKE_EDGE_REFINE).sort((a, b) => a - b)
      anchors.forEach((a, k) => expect(a).toBeCloseTo(k, 5))
      // exactly one is a model cell (under 1 / F), and it is the middle's; all share the path of the stretch, its length and the model's px
      const members = g.filter((i) => f.baked.spacing[i] < 1 / BAKE_EDGE_REFINE)
      expect(members.length).toBe(1)
      expect(f.baked.anchor[members[0]]).toBeCloseTo(0.5, 6)
      for (const i of g) {
        expect(f.baked.pathLength[i]).toBe(f.baked.pathLength[g[0]])
        expect(f.baked.basePx[2 * i]).toBe(f.baked.basePx[2 * g[0]])
        for (let q = 0; q < 3 * BAKE_PATH_POINTS; q++) expect(f.baked.worldPath[3 * BAKE_PATH_POINTS * i + q]).toBe(f.baked.worldPath[3 * BAKE_PATH_POINTS * g[0] + q])
      }
    }
  })

  it('make about the model’s number of strokes at the authored zoom: the cells that are the model’s, per soft stretch, are its drag and as many pulls as the model’s rule (a pull every ~34 px)', () => {
    const f = SPHERE
    const stats = bakeStats(f.baked)!.edgeStrokes
    // (the members of the load chain are the model's strokes)
    let members = 0
    for (const i of edgeStrokes(f)) if (f.baked.spacing[i] < 1 / BAKE_EDGE_REFINE) members++
    expect(members).toBe(stats.members)
    expect(stats.strokes).toBeGreaterThan(5 * stats.members)
    // the pulls of a soft stretch, the model's rule: max(1, round(px / 34))
    const drags = new Map<number, number>()
    const pulls = new Map<number, number>()
    for (const i of edgeStrokes(f)) {
      const r = f.baked.rank[i]
      if (f.baked.sizing[i] === SIZING_ALONG && f.baked.edge[i] === 1) drags.set(r, f.baked.basePx[2 * i])
      else if (f.baked.sizing[i] === SIZING_ACROSS && f.baked.edge[i] === 1 && f.baked.spacing[i] < 1 / BAKE_EDGE_REFINE) pulls.set(r, (pulls.get(r) ?? 0) + 1)
    }
    let want = 0
    let got = 0
    for (const [r, px] of drags) {
      want += Math.max(1, Math.round(px / 34))
      got += pulls.get(r) ?? 0
    }
    expect(drags.size).toBeGreaterThan(20)
    // (a lattice centred on the stretch has its own rounding: the same count over the stretches to within a fifth)
    expect(got / want).toBeGreaterThan(0.8)
    expect(got / want).toBeLessThan(1.2)
  })

  it('make a member of the load chain of exactly the cells that are the model’s, and let the rest ride: follow is set for a stroke whose spacing is not under 1 / BAKE_EDGE_REFINE, and a rider has no step of the chain', () => {
    for (const f of [SPHERE, SADDLE, BOX]) {
      const rec = bakedRecipes(f.baked)!
      let riders = 0
      for (const i of edgeStrokes(f)) {
        const c = rec.perm[i]
        const rides = !(f.baked.spacing[i] < 1 / BAKE_EDGE_REFINE)
        expect(rec.recipes.follow[c] === 1, `stroke ${i}`).toBe(rides)
        if (rides) {
          riders++
          expect(rec.recipes.mx[c]).toBe(0)
        }
      }
      expect(riders).toBeGreaterThan(edgeStrokes(f).length / 2)
    }
  })

  it('lay the pulls and bridges of a stretch on a lattice of cells 1 / BAKE_EDGE_REFINE of the model’s spacing apart in the world: neighbouring cells are a cell of 34 / 8 (or 42 / 8) px away along the stretch', () => {
    const f = SPHERE
    const groups = new Map<number, number[]>()
    for (const i of edgeStrokes(f)) {
      if (f.baked.sizing[i] !== SIZING_ACROSS) continue
      const key = f.baked.rank[i]
      const g = groups.get(key)
      if (g) g.push(i)
      else groups.set(key, [i])
    }
    let gaps = 0
    let sum = 0
    for (const g of groups.values()) {
      if (g.length < 6) continue
      // the middles' places along the stretch (the farthest pair's axis), sorted
      const mids = g.map((i) => mid(f, i))
      let far = 0
      let fa = 0
      let fb = 0
      for (let a = 0; a < mids.length; a++) {
        for (let b = a + 1; b < mids.length; b++) {
          const d = Math.hypot(mids[a][0] - mids[b][0], mids[a][1] - mids[b][1], mids[a][2] - mids[b][2])
          if (d > far) {
            far = d
            fa = a
            fb = b
          }
        }
      }
      const axis = [0, 1, 2].map((c) => (mids[fb][c] - mids[fa][c]) / far)
      const order = mids.map((m, k) => [k, [0, 1, 2].reduce((s, c) => s + (m[c] - mids[fa][c]) * axis[c], 0)] as const).sort((a, b) => a[1] - b[1])
      for (let k = 1; k < order.length; k++) {
        const p = mids[order[k - 1][0]]
        const q = mids[order[k][0]]
        sum += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / PX
        gaps++
      }
    }
    expect(gaps).toBeGreaterThan(100)
    // (a pull is 34 / 8 = 4.25 px apart, a bridge 5.25: the stretches are of one kind or the other)
    expect(sum / gaps).toBeGreaterThan(3.5)
    expect(sum / gaps).toBeLessThan(6)
  })
})
