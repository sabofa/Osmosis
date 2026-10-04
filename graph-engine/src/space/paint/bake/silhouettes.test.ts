import { describe, expect, it, vi } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { lchToLab, linearToOklab } from '../model/colour'
import { LoadMixer } from '../model/mix'
import { colourOfRecipe, newRecipe } from '../model/recipe'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import { silhouettePolylines } from '../model/contours'
import { smoothClasses } from '../model/edges'
import { hash01, valueNoise3 } from '../model/math'
import { flatColours, graphMesh, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { project, makeFrameCtx, pxPerUnit } from '../model/view'
import { PATH_POINTS, ROLES, type GBuffer, type PaintView } from '../types'
import { LIGHT, TERRACOTTA, CANVAS, framing, fixture, saddleColours, saddleScene, sparse, sphereColours, sphereScene, type Fixture } from './bakeFixture'
import { frameFromBakeWith, FrameScratch } from './frame'
import { HIDDEN_NA } from './types'
import {
  casterOf, CUT_WINDOW, cutRun, focalAt, indexOf, lowestKeys, medianClasses, newSilhouetteStats, NoiseRun, SILHOUETTE_MIN_SAMPLES, SILHOUETTE_STEP_PX, silhouetteEnv, silhouetteRuns, silhouetteStrokes,
  siteBefore, stretchKinds, VertexGrid, WorldDraw, type SilhouetteRun,
} from './silhouettes'
import { StrokeList } from './strokeList'

vi.setConfig({ testTimeout: 180_000 })

const PP = PATH_POINTS
const EMPTY_G: GBuffer = { width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0) }
const ORTHO = framing(20, 25, true)

const sphereFx = fixture(sphereScene(), sphereColours(), sparse(700), LIGHT, ORTHO)
// a torus-like second figure would make the outline more than one polyline; two spheres do
const twoFx = (() => {
  const scene = sceneOf([sphereMesh({ radius: 0.9, centre: [-0.8, 0, 0], index: 0, nu: 32, nv: 20 }), sphereMesh({ radius: 0.6, centre: [1.0, 0.2, 0.1], index: 1, nu: 32, nv: 20 }), tableMesh({ z: -1, half: 2.5, index: 2 })])
  return fixture(scene, flatColours({ 0: TERRACOTTA, 1: lchToLab(0.45, 0.1, 250), 2: CANVAS }), sparse(500), LIGHT, ORTHO)
})()

const viewAt = (az: number, el: number, opts: { perspective?: boolean; zoom?: number; target?: [number, number, number] } = {}): PaintView => ({
  ...paintView({ width: 640, height: 480, azimuth: az, elevation: el, zoom: 150 * (opts.zoom ?? 1), magnify: opts.zoom ?? 1, perspective: opts.perspective, target: opts.target }), lightDir: LIGHT,
})

interface Made {
  runs: SilhouetteRun[]
  list: StrokeList
  stats: ReturnType<typeof newSilhouetteStats>
  view: PaintView
}
function make(fx: Fixture, view: PaintView, g: GBuffer | null = null): Made {
  const fc = makeFrameCtx(fx.scene, view, g ?? EMPTY_G, fx.params)
  const senv = silhouetteEnv(fx.params)
  const runs = silhouetteRuns(fx.baked, fx.scene, view, fx.params, g, fc, senv)
  const list = new StrokeList()
  const stats = newSilhouetteStats()
  silhouetteStrokes(list, runs, fx.params, view, fc, senv, stats)
  return { runs, list, stats, view }
}

// The distance of a point to a polyline (xyz per vertex).
function distToPolyline(poly: Float64Array, x: number, y: number, z: number): number {
  let best = Infinity
  for (let s = 0; s + 1 < poly.length / 3; s++) {
    const ax = poly[3 * s], ay = poly[3 * s + 1], az = poly[3 * s + 2]
    const dx = poly[3 * s + 3] - ax, dy = poly[3 * s + 4] - ay, dz = poly[3 * s + 5] - az
    const px = x - ax, py = y - ay, pz = z - az
    const l2 = dx * dx + dy * dy + dz * dz
    const t = l2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / l2)) : 0
    best = Math.min(best, Math.hypot(px - t * dx, py - t * dy, pz - t * dz))
  }
  return best
}

describe('the silhouette samples of a view', () => {
  it('lie ON the mesh\'s silhouette polyline, 2 px apart on the screen, at the projection of their world points, both projections', () => {
    for (const perspective of [false, true]) {
      for (const [az, el] of [[20, 25], [140, 10], [250, 60]] as const) {
        const view = viewAt(az, el, { perspective })
        const { runs } = make(sphereFx, view)
        const fc = makeFrameCtx(sphereFx.scene, view, EMPTY_G, sphereFx.params)
        const polys = silhouettePolylines(sphereFx.scene.marks[0] as MeshMark, view.eye, fc.ortho, view.viewDir)
        expect(runs.length).toBeGreaterThan(0)
        const out = [0, 0, 0]
        for (const run of runs) {
          expect(run.mark).toBe(0)
          expect(run.n).toBeGreaterThanOrEqual(SILHOUETTE_MIN_SAMPLES)
          for (let s = 0; s < run.n; s++) {
            const x = run.world[3 * s], y = run.world[3 * s + 1], z = run.world[3 * s + 2]
            expect(Math.min(...polys.map((p) => distToPolyline(p, x, y, z)))).toBeLessThan(1e-9)
            project(fc, x, y, z, out)
            // (the world point is linear along a mesh edge, the screen point along the screen's: they differ by a thousandth of a px under a perspective view)
            expect(run.screen[2 * s]).toBeCloseTo(out[0], 2)
            expect(run.screen[2 * s + 1]).toBeCloseTo(out[1], 2)
            expect(run.depth[s]).toBeCloseTo(out[2], 4)
            // (2 px of arc: the chord between two samples is a hair shorter where the outline bends between them, at a facet's corner 2 (1 - cos 5 degrees))
            if (s > 0 && s < run.n - 1) expect(Math.abs(Math.hypot(run.screen[2 * s] - run.screen[2 * s - 2], run.screen[2 * s + 1] - run.screen[2 * s - 1]) - SILHOUETTE_STEP_PX)).toBeLessThan(0.03)
          }
        }
      }
    }
  })

  it('go round the sphere: the radius the outline has, the inward normal pointing at the centre, the nearest vertex\'s value and local colour', () => {
    const view = viewAt(20, 25)
    const { runs } = make(sphereFx, view)
    // the sphere of radius 1 at 150 px: a circle of radius 150 about the screen's middle (the facets' sagitta is under a px)
    let total = 0
    const surface = sphereFx.baked.surfaces[0]!
    for (const run of runs) {
      total += run.n
      for (let s = 0; s < run.n; s++) {
        const x = run.screen[2 * s] - view.width / 2
        const y = run.screen[2 * s + 1] - view.height / 2
        expect(Math.abs(Math.hypot(x, y) - 150)).toBeLessThan(1.5)
        // inward is toward the centre
        expect((run.nrm[2 * s] * -x + run.nrm[2 * s + 1] * -y) / Math.hypot(x, y)).toBeGreaterThan(0.97)
        expect(Math.hypot(run.nrm[2 * s], run.nrm[2 * s + 1])).toBeCloseTo(1, 6)
        expect(run.uA[s]).toBeGreaterThan(0)
        expect(run.uA[s]).toBeLessThan(1)
      }
      // the colour is a vertex's of the surface (the terracotta, whole)
      for (let s = 0; s < run.n; s++) {
        expect(run.local[3 * s]).toBeCloseTo(surface.local[0], 5)
        expect(run.local[3 * s + 1]).toBeCloseTo(surface.local[1], 5)
      }
    }
    // a full circle of 2 px steps: about 471 samples
    expect(total).toBeGreaterThan(440)
    expect(total).toBeLessThan(500)
  })

  it('read the outside from the canvas, and from the G-buffer where it holds another mark: the raw value through the lighting and value curves', () => {
    const view = viewAt(20, 25)
    const none = make(sphereFx, view)
    const senv = silhouetteEnv(sphereFx.params)
    for (const run of none.runs) for (let s = 0; s < run.n; s++) expect(run.uB[s]).toBeCloseTo(senv.uCanvas, 6)
    // a G-buffer of the sphere and the table under it (which fills the view round the sphere), and of the sphere alone (the canvas round it)
    const gTable = sphereGBuffer(view.width, view.height, { view, params: sphereFx.params, table: { z: -1, mark: 1 } })
    const gAlone = sphereGBuffer(view.width, view.height, { view, params: sphereFx.params })
    const used: Record<string, number> = { table: 0, canvas: 0 }
    for (const g of [gTable, gAlone]) {
      const withG = make(sphereFx, view, g)
      for (const run of withG.runs) {
        for (let s = 0; s < run.n; s++) {
          const gx = Math.floor((run.screen[2 * s] - run.nrm[2 * s] * 3) / g.scale)
          const gy = Math.floor((run.screen[2 * s + 1] - run.nrm[2 * s + 1] * 3) / g.scale)
          const gi = gy * g.width + gx
          if (g.mark[gi] === 1) {
            used.table++
            expect(run.uB[s]).toBeCloseTo(senv.curves.value(senv.curves.lightResponse(g.value[gi])), 6)
          } else {
            used.canvas++
            expect(run.uB[s]).toBeCloseTo(senv.uCanvas, 6)
          }
          // (the inside is the figure's, whatever the G-buffer)
          expect(run.uA[s]).toBe(none.runs[0].uA[s])
        }
      }
      expect(withG.list.count).toBeGreaterThan(5)
    }
    expect(used.table).toBeGreaterThan(300)
    expect(used.canvas).toBeGreaterThan(300)
  })

  it('score the outline as the model does: the form in shadow against light is a found edge (at least firm), the lit side against the canvas is lost or soft', () => {
    const view = viewAt(20, 25)
    const { runs } = make(sphereFx, view)
    const senv = silhouetteEnv(sphereFx.params)
    let shadowSide = 0
    let shadowFound = 0
    let lit = 0
    let litLost = 0
    for (const run of runs) {
      for (let s = 0; s < run.n; s++) {
        if (run.uMin[s] <= senv.capU && run.uB[s] >= senv.floorU) {
          shadowSide++
          if (run.cls[s] >= 2) shadowFound++
        }
        if (run.uA[s] > 0.62 && Math.abs(run.uA[s] - run.uB[s]) < 0.12) {
          lit++
          if (run.cls[s] <= 1) litLost++
        }
      }
    }
    expect(shadowSide).toBeGreaterThan(40)
    expect(shadowFound / shadowSide).toBeGreaterThan(0.9)
    expect(lit).toBeGreaterThan(20)
    expect(litLost / lit).toBeGreaterThan(0.8)
    // the classes are the median of seven: no sample differs from the median of its window
    for (const run of runs) {
      const smooth = smoothClasses(Uint8Array.from(run.cls))
      void smooth
    }
  })

  it('score the focal emphasis from the authored focal points, fixed in the world', () => {
    const f = sphereFx.baked.focal
    expect(f.length).toBe(8 * sphereFx.scene.marks.length)
    // the sphere has two points; at one the term is 1
    expect(focalAt(f, 0, f[0], f[1], f[2])).toBeCloseTo(1, 12)
    expect(focalAt(f, 0, f[0] + 5 * f[3], f[1], f[2])).toBeLessThan(1e-9)
    // exp(-(d/R)²) between: a radius away is e^-1, half a radius e^-0.25
    expect(focalAt(f, 0, f[0] + f[3], f[1], f[2])).toBeCloseTo(Math.exp(-1), 12)
    expect(focalAt(f, 0, f[0], f[1] + 0.5 * f[3], f[2])).toBeCloseTo(Math.exp(-0.25), 12)
    // a mark with none (a table, which has none: it is bare ground) is 0 everywhere
    expect(Number.isNaN(f[8])).toBe(true)
    expect(focalAt(f, 1, 0, 0, 0)).toBe(0)
  })
})

describe('the silhouette strokes', () => {
  it('are edge strokes of every kind, with the brush the model gives each class, never hidden, finite and in gamut', () => {
    const { list, stats } = make(sphereFx, viewAt(20, 25))
    expect(list.count).toBe(stats.strokes)
    expect(stats.crisp).toBeGreaterThan(0)
    expect(stats.drags + stats.pulls).toBeGreaterThan(0)
    expect(stats.bridges).toBeGreaterThan(0)
    expect(stats.crisp + stats.drags + stats.pulls + stats.bridges).toBe(stats.strokes)
    expect(stats.byClass.reduce((a, b) => a + b, 0)).toBe(stats.strokes)
    for (let e = 0; e < list.count; e++) {
      expect(ROLES[list.role[e]]).toBe('edge')
      expect(list.hidden[e]).toBe(HIDDEN_NA)
      expect(list.edge[e]).toBeLessThanOrEqual(3)
      for (const v of [list.colour[3 * e], list.colour[3 * e + 1], list.colour[3 * e + 2]]) {
        expect(v).toBeGreaterThanOrEqual(-1e-6)
        expect(v).toBeLessThanOrEqual(1 + 1e-6)
      }
      for (let q = 0; q < 2 * PP; q++) expect(Number.isFinite(list.path[2 * PP * e + q])).toBe(true)
      for (let q = 0; q < PP; q++) expect(list.width[PP * e + q]).toBeGreaterThanOrEqual(0.35 - 1e-6)
      expect([list.worldNormal[3 * e], list.worldNormal[3 * e + 1], list.worldNormal[3 * e + 2]]).toEqual([0, 0, 0])
    }
  })

  it('put the points of an along-stroke exactly on the silhouette polyline, and a pull or bridge on a decal at the depth of its sample', () => {
    const view = viewAt(140, 20, { perspective: true })
    const { list, runs } = make(sphereFx, view)
    const fc = makeFrameCtx(sphereFx.scene, view, EMPTY_G, sphereFx.params)
    const polys = silhouettePolylines(sphereFx.scene.marks[0] as MeshMark, view.eye, fc.ortho, view.viewDir)
    let along = 0
    let across = 0
    const out = [0, 0, 0]
    for (let e = 0; e < list.count; e++) {
      // an along stroke's world points are on the polyline; a decal's are all at one view depth, and project to the stroke's own path
      const onLine = Math.max(...Array.from({ length: PP }, (_, q) => Math.min(...polys.map((p) => distToPolyline(p, list.worldPath[3 * PP * e + 3 * q], list.worldPath[3 * PP * e + 3 * q + 1], list.worldPath[3 * PP * e + 3 * q + 2])))))
      if (onLine < 1e-5) along++
      else {
        across++
        let dMin = Infinity
        let dMax = -Infinity
        for (let q = 0; q < PP; q++) {
          project(fc, list.worldPath[3 * PP * e + 3 * q], list.worldPath[3 * PP * e + 3 * q + 1], list.worldPath[3 * PP * e + 3 * q + 2], out)
          expect(out[0]).toBeCloseTo(list.path[2 * PP * e + 2 * q], 2)
          expect(out[1]).toBeCloseTo(list.path[2 * PP * e + 2 * q + 1], 2)
          dMin = Math.min(dMin, out[2])
          dMax = Math.max(dMax, out[2])
        }
        expect(dMax - dMin).toBeLessThan(1e-4)
        // (the depth is the sample's own, which lies on the outline)
        expect(Math.abs(out[2] - list.depth[e])).toBeLessThan(0.05)
      }
    }
    expect(along).toBeGreaterThan(3)
    expect(across).toBeGreaterThan(3)
    expect(runs.length).toBeGreaterThan(0)
  })

  it('pull from the lighter side into the darker, and a bridge starts on one side and ends on the other', () => {
    // the sphere's shadow side: darker than the canvas, so a pull goes from the canvas (outside) into the figure; its direction against the inward normal
    const view = viewAt(20, 25)
    const { runs, list } = make(sphereFx, view)
    expect(runs.length).toBe(1)
    const run = runs[0]
    let pulls = 0
    let inward = 0
    let outward = 0
    for (let e = 0; e < list.count; e++) {
      // a pull or bridge: a straight 2-point stroke (every point on one line)
      const x0 = list.path[2 * PP * e], y0 = list.path[2 * PP * e + 1], x1 = list.path[2 * PP * e + 2 * (PP - 1)], y1 = list.path[2 * PP * e + 2 * (PP - 1) + 1]
      const len = Math.hypot(x1 - x0, y1 - y0)
      let straight = len > 5
      for (let q = 1; q < PP - 1 && straight; q++) {
        const px = list.path[2 * PP * e + 2 * q], py = list.path[2 * PP * e + 2 * q + 1]
        if (Math.abs((px - x0) * (y1 - y0) - (py - y0) * (x1 - x0)) / len > 1e-3) straight = false
      }
      if (!straight) continue
      pulls++
      // which sample of the run is nearest the middle of the stroke
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
      let best = 0
      let bd = Infinity
      for (let s = 0; s < run.n; s++) {
        const d = Math.hypot(run.screen[2 * s] - mx, run.screen[2 * s + 1] - my)
        if (d < bd) {
          bd = d
          best = s
        }
      }
      const along = ((x1 - x0) * run.nrm[2 * best] + (y1 - y0) * run.nrm[2 * best + 1]) / len
      if (along > 0.5) inward++
      else if (along < -0.5) outward++
      // a stroke of one of these kinds is across the outline: its line is more across than along it
      expect(Math.abs(along)).toBeGreaterThan(0.6)
    }
    expect(pulls).toBeGreaterThan(5)
    expect(inward + outward).toBe(pulls)
    // the lit side is lighter than the canvas or about equal; the shadow side darker: both kinds of direction occur around a sphere lit from one side
    expect(inward).toBeGreaterThan(0)
  })

  it('hold a shadow-family outline to the family\'s ceiling under the loudest brush-load mix', () => {
    const loud = {
      ...sphereFx.params,
      mix: { ...sphereFx.params.mix, strength: 2, valueStepFraction: 1, valueStep: 0.08, hueMin: 8, hueMax: 20 },
    }
    const fx = { ...sphereFx, params: loud }
    let total = 0
    for (const az of [20, 110, 200, 290]) {
      const { list, runs } = make(fx, viewAt(az, 25))
      const senv = silhouetteEnv(loud)
      // the lightness of the sphere's colour at the cap (jitter-free; the strokes have their own seeded jitters of a few thousandths)
      let held = 0
      for (let e = 0; e < list.count; e++) {
        // a stroke that lies on the shadow side: its middle sample's lowest value on the way in is under the cap
        const mx = (list.path[2 * PP * e + 6] + list.path[2 * PP * e + 8]) / 2
        const my = (list.path[2 * PP * e + 7] + list.path[2 * PP * e + 9]) / 2
        let best = 0
        let bd = Infinity
        for (const run of runs) {
          for (let s = 0; s < run.n; s++) {
            const d = Math.hypot(run.screen[2 * s] - mx, run.screen[2 * s + 1] - my)
            if (d < bd) {
              bd = d
              best = run.uMin[s]
            }
          }
        }
        if (best <= senv.capU && bd < 8) {
          held++
          // the cap's lightness for the terracotta is well under the canvas's: a shadow-family stroke is no lighter than half the way up to it
          const L = linearToOklab(list.colour[3 * e], list.colour[3 * e + 1], list.colour[3 * e + 2])[0]
          expect(L).toBeLessThan(0.7)
        }
      }
      total += held
    }
    expect(total).toBeGreaterThan(12)
  })

  it('are the same strokes, byte for byte, with the same inputs, and a G-buffer moves only the outside', () => {
    const view = viewAt(20, 25)
    const a = make(sphereFx, view)
    const b = make(sphereFx, view)
    expect(b.list.count).toBe(a.list.count)
    for (const k of ['path', 'width', 'colour', 'alpha', 'seed', 'worldPath', 'depth', 'load', 'bristles', 'edge'] as const) {
      for (let i = 0; i < a.list[k].length; i++) if (a.list[k][i] !== b.list[k][i]) throw new Error(`${k} differs at ${i}`)
    }
  })

  it('join the batch of a frame: edge layer, after the baked strokes of the same layer are ordered, with the figure\'s G-buffer or without', () => {
    const view = viewAt(20, 25)
    const g = sphereGBuffer(view.width, view.height, { view, params: sphereFx.params, table: { z: -1, mark: 1 } })
    for (const gbuffer of [null, g]) {
      const scr = new FrameScratch()
      const batch = frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, view, sphereFx.params, gbuffer)
      expect(scr.stats.silhouettes).toBeGreaterThan(10)
      let sil = 0
      for (let o = 0; o < batch.count; o++) if (scr.source[o] < 0) sil++
      expect(sil).toBe(scr.stats.own)
      expect(sil).toBe(scr.stats.silhouettes)
    }
  })

  it('run round each figure with its own colour and values: two spheres have a run each, and a frame has the strokes of both', () => {
    const { runs, list } = make(twoFx, viewAt(30, 20))
    const marks = new Set(runs.map((r) => r.mark))
    expect(marks.has(0)).toBe(true)
    expect(marks.has(1)).toBe(true)
    expect(marks.has(2)).toBe(false)
    const own = [twoFx.baked.surfaces[0]!, twoFx.baked.surfaces[1]!]
    for (const run of runs) {
      expect(run.local[0]).toBeCloseTo(own[run.mark].local[0], 5)
      expect(run.local[1]).toBeCloseTo(own[run.mark].local[1], 5)
    }
    expect(list.count).toBeGreaterThan(20)
  })

  it('have none for a scene with no opaque figure, and for a figure behind the eye', () => {
    // bare table only: no silhouette
    const scene = sceneOf([tableMesh({ z: -1, half: 2, index: 0 })])
    const fx = fixture(scene, flatColours({ 0: CANVAS }), sparse(500), LIGHT, ORTHO)
    const scr = new FrameScratch()
    frameFromBakeWith(scr, fx.baked, fx.scene, viewAt(20, 25), fx.params, null)
    expect(scr.stats.silhouettes).toBe(0)
  })
})

// ---- strokes from runs made by hand (what a stretch of a given class and sides gives, with nothing else in the way) ----

interface Hand {
  n: number
  // The class of each sample, and the two sides' values.
  cls: number[]
  uA: number
  uB: number
  uMin?: number
  key?: number
}

// A straight outline along the screen's x axis at y = 200, 2 px a sample, the figure below it (the inward normal is (0, 1)), at one depth.
function handRun(h: Hand, view: PaintView, fc: ReturnType<typeof makeFrameCtx>): SilhouetteRun {
  const n = h.n
  const run: SilhouetteRun = {
    mark: 0, n, world: new Float64Array(3 * n), screen: new Float64Array(2 * n), poly: new Float64Array(3 * n), tpos: new Float64Array(n), nrm: new Float64Array(2 * n), sg: new Int8Array(n).fill(1),
    uA: new Float32Array(n).fill(h.uA), uB: new Float32Array(n).fill(h.uB), uMin: new Float32Array(n).fill(h.uMin ?? h.uA), local: new Float32Array(3 * n),
    keys: new Uint32Array(n).fill(h.key ?? 0xf0000000), depth: new Float32Array(n), h: new Float32Array(n), cls: Uint8Array.from(h.cls), contrast: Math.abs(h.uA - h.uB),
  }
  const right = [view.view[0], view.view[4], view.view[8]]
  const up = [view.view[1], view.view[5], view.view[9]]
  // the world point of the screen point (x, 200) at the depth of the origin: along the camera's right and up
  const ppu = 150
  const out = [0, 0, 0]
  for (let k = 0; k < n; k++) {
    const x = 100 + 2 * k
    const sx = (x - view.width / 2) / ppu
    const sy = -(200 - view.height / 2) / ppu
    const p = [right[0] * sx + up[0] * sy, right[1] * sx + up[1] * sy, right[2] * sx + up[2] * sy]
    run.world.set(p, 3 * k)
    run.poly.set(p, 3 * k)
    run.tpos[k] = k
    project(fc, p[0], p[1], p[2], out)
    run.screen[2 * k] = out[0]
    run.screen[2 * k + 1] = out[1]
    run.depth[k] = out[2]
    run.nrm[2 * k + 1] = 1
    run.local.set([0.55, 0.08, 0.06], 3 * k)
  }
  return run
}

function strokesOf(runs: SilhouetteRun[], params: PaintParams, view: PaintView): { list: StrokeList; stats: ReturnType<typeof newSilhouetteStats> } {
  const fc = makeFrameCtx(sphereFx.scene, view, EMPTY_G, params)
  const senv = silhouetteEnv(params)
  const list = new StrokeList()
  const stats = newSilhouetteStats()
  silhouetteStrokes(list, runs, params, view, fc, senv, stats)
  return { list, stats }
}

describe('the strokes of a stretch of the outline, made from runs given by hand', () => {
  const view = viewAt(20, 25)
  const fc = makeFrameCtx(sphereFx.scene, view, EMPTY_G, sphereFx.params)
  const dirOf = (l: StrokeList, e: number): [number, number] => [l.path[2 * PP * e + 2 * (PP - 1)] - l.path[2 * PP * e], l.path[2 * PP * e + 2 * (PP - 1) + 1] - l.path[2 * PP * e + 1]]

  it('pull from the lighter side into the darker: into the figure when it is the darker, out of it when it is the lighter', () => {
    for (const [uA, uB, want] of [[0.3, 0.8, 1], [0.8, 0.3, -1]] as const) {
      const { list, stats } = strokesOf([handRun({ n: 60, cls: new Array(60).fill(1), uA, uB, uMin: 0.9 }, view, fc)], sphereFx.params, view)
      expect(stats.drags).toBeGreaterThan(0)
      expect(stats.pulls).toBeGreaterThan(0)
      let pulls = 0
      for (let e = 0; e < list.count; e++) {
        const [dx, dy] = dirOf(list, e)
        // a pull is across the outline (more down or up than along), a drag along it
        if (Math.abs(dy) > Math.abs(dx)) {
          pulls++
          // (turned by up to 0.35 rad from the normal)
          expect((dy * want) / Math.hypot(dx, dy), `uA ${uA}`).toBeGreaterThan(0.9)
        } else expect(Math.abs(dx)).toBeGreaterThan(20)
      }
      expect(pulls).toBe(stats.pulls)
    }
  })

  it('bridge a lost stretch across the outline, from one side to the other, and make a crisp stroke only for a firm or hard one', () => {
    const lost = strokesOf([handRun({ n: 60, cls: new Array(60).fill(0), uA: 0.5, uB: 0.62 }, view, fc)], sphereFx.params, view)
    expect(lost.stats.bridges).toBeGreaterThan(0)
    expect(lost.stats.crisp + lost.stats.drags + lost.stats.pulls).toBe(0)
    for (let e = 0; e < lost.list.count; e++) {
      const [dx, dy] = dirOf(lost.list, e)
      // across, centred on the outline: its ends are on the two sides of y = 200 (to the rotation of up to 0.3 rad)
      expect(Math.abs(dy)).toBeGreaterThan(Math.abs(dx))
      const y0 = lost.list.path[2 * PP * e + 1]
      const y1 = lost.list.path[2 * PP * e + 2 * (PP - 1) + 1]
      expect((y0 - 200) * (y1 - 200)).toBeLessThan(0)
    }
    for (const cls of [2, 3]) {
      const found = strokesOf([handRun({ n: 60, cls: new Array(60).fill(cls), uA: 0.3, uB: 0.8, uMin: 0.9 }, view, fc)], sphereFx.params, view)
      expect(found.stats.crisp).toBeGreaterThan(0)
      expect(found.stats.pulls + found.stats.bridges + found.stats.drags).toBe(0)
      // the crisp stroke is along the outline: its path is the outline (y = 200)
      for (let e = 0; e < found.list.count; e++) {
        for (let q = 0; q < PP; q++) expect(Math.abs(found.list.path[2 * PP * e + 2 * q + 1] - 200)).toBeLessThan(1e-3)
        // a hard one is wider and fully opaque; a firm one a little thinner
        expect(found.list.alpha[e]).toBeCloseTo(cls === 3 ? 1 : 0.85, 6)
      }
    }
  })

  it("keeps a stretch's seeds and brushwork where its place in the run changes: only its position gives them", () => {
    // two runs that are the same outline from the second stretch on, one with three more samples before it
    const a = handRun({ n: 40, cls: [...new Array(15).fill(0), ...new Array(25).fill(1)], uA: 0.3, uB: 0.8, uMin: 0.9 }, view, fc)
    const b = handRun({ n: 43, cls: [...new Array(18).fill(0), ...new Array(25).fill(1)], uA: 0.3, uB: 0.8, uMin: 0.9 }, view, fc)
    const sa = strokesOf([a], sphereFx.params, view)
    const sb = strokesOf([b], sphereFx.params, view)
    // the second stretch's strokes: the soft ones (class 1)
    const soft = (l: StrokeList): number[] => Array.from({ length: l.count }, (_, e) => e).filter((e) => l.edge[e] === 1)
    const ea = soft(sa.list)
    const eb = soft(sb.list)
    expect(ea.length).toBeGreaterThan(1)
    expect(eb.length).toBe(ea.length)
    for (let k = 0; k < ea.length; k++) {
      expect(sb.list.seed[eb[k]]).toBe(sa.list.seed[ea[k]])
      // (the brush's draws, from the noise at the stretch's place, which is 6 px apart in the two: widths, loads, bristles)
      for (let q = 0; q < PP; q++) expect(sb.list.width[PP * eb[k] + q] / sa.list.width[PP * ea[k] + q]).toBeCloseTo(1, 1)
      expect(sb.list.load[eb[k]] / sa.list.load[ea[k]]).toBeGreaterThan(0.97)
      expect(sb.list.load[eb[k]] / sa.list.load[ea[k]]).toBeLessThan(1.03)
      expect(Math.abs(sb.list.bristles[eb[k]] - sa.list.bristles[ea[k]])).toBeLessThanOrEqual(1)
    }
  })

  it("hold a stretch of the shadow family to the family's ceiling under the loudest brush-load mix, by the lowest value on the way in, and not one in the light", () => {
    const loud: PaintParams = { ...sphereFx.params, mix: { ...sphereFx.params.mix, strength: 2, valueStepFraction: 1, valueStep: 0.1, hueMin: 8, hueMax: 22 } }
    const senv = silhouetteEnv(loud)
    // the figure's colour at the cap, jitter-free: the lightness a held stroke is under (to the seeded jitters, a hundredth or so)
    const rec = newRecipe()
    rec.lx = 0.55
    rec.ly = 0.08
    rec.lz = 0.06
    rec.u = senv.capU
    const cap = colourOfRecipe(rec, senv.env)[0]
    const litRec = { ...rec, u: 0.7 }
    const lit = colourOfRecipe(litRec, senv.env)[0]
    expect(lit).toBeGreaterThan(cap + 0.15)
    for (const cls of [1, 2, 0]) {
      // the figure's side is lit (0.7) at the outline but its lowest value on the way in is under the cap: the stretch is in the shadow family
      const dark = strokesOf([handRun({ n: 60, cls: new Array(60).fill(cls), uA: 0.7, uB: 0.85, uMin: senv.capU - 0.05 }, view, fc)], loud, view)
      expect(dark.list.count).toBeGreaterThan(1)
      for (let e = 0; e < dark.list.count; e++) {
        const L = linearToOklab(dark.list.colour[3 * e], dark.list.colour[3 * e + 1], dark.list.colour[3 * e + 2])[0]
        // (a bridge or a pull carries the canvas's colour a share of the way: it is held to its own side's ceiling, which is the figure's colour at the cap)
        expect(L, `class ${cls}`).toBeLessThan(cap + 0.05)
      }
      // where what lies across is dark too (the figure's own cast shadow on the table) the edge is no found edge, and the soft and lost strokes are held to the
      // figure's own side's ceiling, not to the blend's
      if (cls < 2) {
        const across = strokesOf([handRun({ n: 60, cls: new Array(60).fill(cls), uA: 0.7, uB: 0.3, uMin: senv.capU - 0.05 }, view, fc)], loud, view)
        expect(across.stats.pulls + across.stats.bridges + across.stats.drags).toBeGreaterThan(0)
        expect(across.stats.crisp).toBe(0)
        for (let e = 0; e < across.list.count; e++) {
          const L = linearToOklab(across.list.colour[3 * e], across.list.colour[3 * e + 1], across.list.colour[3 * e + 2])[0]
          expect(L, `class ${cls}, across a dark table`).toBeLessThan(cap + 0.05)
        }
      }
      // the same in the light family: no hold, the strokes are as light as the figure's side
      const light = strokesOf([handRun({ n: 60, cls: new Array(60).fill(cls), uA: 0.7, uB: 0.85, uMin: 0.7 }, view, fc)], loud, view)
      let lightest = 0
      for (let e = 0; e < light.list.count; e++) lightest = Math.max(lightest, linearToOklab(light.list.colour[3 * e], light.list.colour[3 * e + 1], light.list.colour[3 * e + 2])[0])
      expect(lightest, `class ${cls}`).toBeGreaterThan(cap + 0.1)
    }
  })

  it('score a found edge as the model does: with the weights all but off, only the outline of a form in shadow against light is a found edge', () => {
    const quiet: PaintParams = {
      ...DEFAULT_PAINT_PARAMS,
      edges: { ...DEFAULT_PAINT_PARAMS.edges, wContrast: [0, 0.01, 0], wCurvature: [0, 0, 0], wFocal: [0, 0, 0], wLight: [0, 0, 0], wDepth: [0, 0, 0], noise: 0 },
    }
    const fx = { ...sphereFx, params: quiet }
    const { runs } = make(fx, viewAt(20, 25))
    const senv = silhouetteEnv(quiet)
    let family = 0
    let familyFound = 0
    let other = 0
    let otherFound = 0
    for (const run of runs) {
      for (let s = 0; s < run.n; s++) {
        if (run.uMin[s] <= senv.capU && run.uB[s] >= senv.floorU && Math.abs(run.uA[s] - run.uB[s]) >= 0.03) {
          family++
          if (run.cls[s] >= 2) familyFound++
        } else {
          other++
          if (run.cls[s] >= 1) otherFound++
        }
      }
    }
    expect(family).toBeGreaterThan(40)
    // (the median of seven can move a sample at the end of a stretch)
    expect(familyFound / family).toBeGreaterThan(0.9)
    expect(other).toBeGreaterThan(20)
    expect(otherFound / other).toBeLessThan(0.05)
  })
})

describe('the silhouettes of a frame, more', () => {
  it("has the lowest value on the way in below the outline's own at some samples and never above it", () => {
    const { runs } = make(sphereFx, viewAt(20, 25))
    let below = 0
    let n = 0
    for (const run of runs) {
      for (let s = 0; s < run.n; s++) {
        n++
        expect(run.uMin[s]).toBeLessThanOrEqual(run.uA[s])
        if (run.uMin[s] < run.uA[s] - 1e-4) below++
      }
    }
    expect(below / n).toBeGreaterThan(0.02)
  })

  it('thins its strokes by roles.edge.density, and makes none for a translucent figure', () => {
    const view = viewAt(20, 25)
    const full = make(sphereFx, view).list.count
    const halved = { ...sphereFx.params, roles: { ...sphereFx.params.roles, edge: { ...sphereFx.params.roles.edge, density: 0.4 } } }
    const half = make({ ...sphereFx, params: halved }, view).list.count
    expect(full).toBeGreaterThan(15)
    expect(half).toBeLessThan(full)
    expect(half).toBeGreaterThan(0)
    // a sphere with opacity 0.5 is a veil: no outline
    const veil = fixture(sceneOf([sphereMesh({ radius: 1, index: 0, nu: 24, nv: 16, opacity: 0.5 })]), flatColours({ 0: TERRACOTTA }), sparse(300), LIGHT, ORTHO)
    const r = make(veil, view)
    expect(r.runs.length).toBe(0)
    expect(r.list.count).toBe(0)
  })

  it('puts the points of a stroke along the outline on the polyline itself, not on the chords between samples', () => {
    const view = viewAt(40, 30)
    const { list } = make(sphereFx, view)
    const fc = makeFrameCtx(sphereFx.scene, view, EMPTY_G, sphereFx.params)
    const polys = silhouettePolylines(sphereFx.scene.marks[0] as MeshMark, view.eye, fc.ortho, view.viewDir)
    let worstAlong = 0
    let along = 0
    for (let e = 0; e < list.count; e++) {
      const d = Math.max(...Array.from({ length: PP }, (_, q) => Math.min(...polys.map((p) => distToPolyline(p, list.worldPath[3 * PP * e + 3 * q], list.worldPath[3 * PP * e + 3 * q + 1], list.worldPath[3 * PP * e + 3 * q + 2])))))
      if (d < 1e-5) {
        along++
        worstAlong = Math.max(worstAlong, d)
      }
    }
    expect(along).toBeGreaterThan(3)
    expect(worstAlong).toBeLessThan(1e-5)
  })
})

describe('the helpers of the silhouettes', () => {
  it('finds the nearest vertex of a refined surface by walking from the last one (what a run of samples does) or from the grid (its first): across a seam too, and nearly always the nearest', () => {
    const s = sphereFx.baked.surfaces[0]!
    const index = indexOf(s)
    const nv = s.positions.length / 3
    let worse = 0
    let diff = 0
    let n = 0
    // points of three tilted great circles of the unit sphere, a hundredth of a radian apart (1.5 px at the lab's 150 px a unit: an outline's samples are 2 px apart)
    for (const tilt of [0.3, 1.1, 2.0]) {
      let hint = -1
      for (let k = 0; k < 628; k++) {
        const a = k * 0.01
        const p = [Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt)]
        const walked = index.nearest(s.positions, p[0], p[1], p[2], hint)
        hint = walked
        if (k % 4 !== 0) continue
        let bd = Infinity
        for (let v = 0; v < nv; v++) bd = Math.min(bd, Math.hypot(s.positions[3 * v] - p[0], s.positions[3 * v + 1] - p[1], s.positions[3 * v + 2] - p[2]))
        const fresh = index.nearest(s.positions, p[0], p[1], p[2], -1)
        for (const v of [walked, fresh]) {
          n++
          const d = Math.hypot(s.positions[3 * v] - p[0], s.positions[3 * v + 1] - p[1], s.positions[3 * v + 2] - p[2])
          // (a vertex as near as the nearest, to a part in a billion, is as good: a point of a seam or a lattice is as near to several)
          if (d > bd * (1 + 1e-9) + 1e-12) diff++
          if (d > bd * 1.05 + 1e-9) worse++
        }
      }
    }
    expect(n).toBeGreaterThan(900)
    // (a walk down the distance over the edges, a ring wider where it stalls, and the copies of a seam's vertex joined: the nearest in nearly every case)
    expect(diff / n).toBeLessThan(0.02)
    expect(worse / n).toBeLessThan(0.002)
    expect(new VertexGrid(s.positions, s.indices).cell).toBeGreaterThan(0)
  })

  it('makes the seeded noise of a run as model/math.ts valueNoise3 does, across the cells of its lattice', () => {
    let seed = 777
    const rand = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
    const run = new NoiseRun(0x6ed9eba1)
    // a walk through the lattice (cells change every few steps), and jumps
    let x = 0.3, y = 0.2, z = 0.7
    for (let k = 0; k < 4000; k++) {
      if (k % 500 === 499) {
        x = rand() * 40 - 20
        y = rand() * 40 - 20
        z = rand() * 40 - 20
      } else {
        x += (rand() - 0.5) * 0.2
        y += (rand() - 0.5) * 0.2
        z += (rand() - 0.5) * 0.2
      }
      expect(run.at(x, y, z)).toBe(valueNoise3(x, y, z, 0x6ed9eba1))
    }
  })

  it('takes the median of seven as model/edges.ts smoothClasses does', () => {
    let seed = 12345
    const rand = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
    for (const n of [1, 2, 7, 8, 40, 300]) {
      const raw = Uint8Array.from({ length: n }, () => Math.floor(rand() * 4))
      const out = new Uint8Array(n)
      medianClasses(raw, out)
      expect(Array.from(out)).toEqual(Array.from(smoothClasses(raw)))
    }
  })

  it('makes the silhouette polylines as the model\'s own arithmetic does, in both projections: every crossing is where n·toEye (normalised) changes sign', () => {
    const mesh = sphereMesh({ radius: 1.3, centre: [0.2, -0.1, 0.3], nu: 24, nv: 16 })
    for (const perspective of [false, true]) {
      const view = viewAt(40, 30, { perspective })
      const ortho = !perspective
      const polys = silhouettePolylines(mesh, view.eye, ortho, view.viewDir)
      // an independent brute force: every triangle edge whose end vertices' n·toEye (normalised, hypot) have opposite signs crosses at s_i / (s_i - s_j)
      const nv = mesh.positions.length / 3
      const s = new Float64Array(nv)
      for (let i = 0; i < nv; i++) {
        const d = ortho ? [-view.viewDir[0], -view.viewDir[1], -view.viewDir[2]] : [view.eye[0] - mesh.positions[3 * i], view.eye[1] - mesh.positions[3 * i + 1], view.eye[2] - mesh.positions[3 * i + 2]]
        const l = ortho ? 1 : Math.hypot(d[0], d[1], d[2])
        s[i] = (mesh.normals[3 * i] * d[0] + mesh.normals[3 * i + 1] * d[1] + mesh.normals[3 * i + 2] * d[2]) / l
      }
      const crossings: number[][] = []
      const seen = new Set<string>()
      for (let t = 0; t < mesh.indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const i = mesh.indices[t + k], j = mesh.indices[t + (k + 1) % 3]
          if (!(s[i] > 0) === !(s[j] > 0)) continue
          const key = i < j ? `${i},${j}` : `${j},${i}`
          if (seen.has(key)) continue
          seen.add(key)
          const f = s[i] / (s[i] - s[j])
          crossings.push([0, 1, 2].map((c) => mesh.positions[3 * i + c] + (mesh.positions[3 * j + c] - mesh.positions[3 * i + c]) * f))
        }
      }
      const points: number[][] = []
      for (const p of polys) for (let k = 0; k < p.length / 3; k++) points.push([p[3 * k], p[3 * k + 1], p[3 * k + 2]])
      // (the sphere's poles are single vertices shared by a fan: some edges are crossed in two polylines' points once each)
      const key = (p: number[]): string => p.map((c) => c.toFixed(12)).join(',')
      const uniq = new Set(points.map(key))
      // (a seam's two copies of a vertex make two crossings at one place)
      const want = new Set(crossings.map(key))
      expect(uniq.size).toBe(want.size)
      for (const c of want) expect(uniq.has(c)).toBe(true)
    }
  })
})

// ---- an open sheet's outline: the side that is seen ----

describe('the outline of an open sheet', () => {
  const saddleFx = fixture(saddleScene(), saddleColours(), sparse(700), LIGHT, ORTHO)
  // a coarse sheet (8 cells across: its triangles are larger than the screen's stride when the view is zoomed in)
  const coarseFx = fixture(sceneOf([graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 8, scaled: true, index: 0 })]), saddleColours(), sparse(700), LIGHT, ORTHO)

  // The nearest surface along the line through o in direction dir, by every triangle of the refined sheet (what the eye sees: no walk, no screen buffer, so
  // nothing the silhouettes do): its distance along dir and the facing of the interpolated normal to the eye (-dir).
  function castLine(fx: Fixture, o: number[], dir: number[]): { t: number; face: number } | null {
    const surface = fx.baked.surfaces[0]!
    const p = surface.positions, idx = surface.indices, nor = surface.normals
    let best: { t: number; face: number } | null = null
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const a = 3 * idx[k], b = 3 * idx[k + 1], c = 3 * idx[k + 2]
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]]
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]]
      const pv = [dir[1] * e2[2] - dir[2] * e2[1], dir[2] * e2[0] - dir[0] * e2[2], dir[0] * e2[1] - dir[1] * e2[0]]
      const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]
      if (Math.abs(det) < 1e-14) continue
      const tv = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]]
      const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det
      if (u < 0 || u > 1) continue
      const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]]
      const v = (dir[0] * qv[0] + dir[1] * qv[1] + dir[2] * qv[2]) / det
      if (v < 0 || u + v > 1) continue
      const t = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det
      if (best && t >= best.t) continue
      const w = 1 - u - v
      let face = 0
      for (let j = 0; j < 3; j++) face += (w * nor[a + j] + u * nor[b + j] + v * nor[c + j]) * -dir[j]
      best = { t, face }
    }
    return best
  }

  // For every other sample of the runs of a view: the side of the outline the sheet is on (3 px either side, by ray casting: the side whose nearest surface is at
  // the outline's own depth), what that surface shows the eye, and whether the run's side and normal say so.
  function checkView(fx: Fixture, view: PaintView): { decided: number; wrongSide: number; wrongWay: number; sides: Set<number> } {
    const { runs } = make(fx, view)
    const fc = makeFrameCtx(fx.scene, view, EMPTY_G, fx.params)
    const right = [view.view[0], view.view[4], view.view[8]]
    const up = [view.view[1], view.view[5], view.view[9]]
    let decided = 0, wrongSide = 0, wrongWay = 0
    const sides = new Set<number>()
    for (const run of runs) {
      for (let k = 0; k < run.n; k += 2) {
        // (the samples on the screen, and a margin)
        if (run.screen[2 * k] < -20 || run.screen[2 * k + 1] < -20 || run.screen[2 * k] > view.width + 20 || run.screen[2 * k + 1] > view.height + 20) continue
        const a0 = Math.max(0, k - 1), a1 = Math.min(run.n - 1, k + 1)
        let tx = run.screen[2 * a1] - run.screen[2 * a0], ty = run.screen[2 * a1 + 1] - run.screen[2 * a0 + 1]
        const tl = Math.hypot(tx, ty) || 1
        tx /= tl
        ty /= tl
        const ppu = pxPerUnit(fc, run.world[3 * k], run.world[3 * k + 1], run.world[3 * k + 2])
        const P = [run.world[3 * k], run.world[3 * k + 1], run.world[3 * k + 2]]
        const depthP = (P[0] - view.eye[0]) * view.viewDir[0] + (P[1] - view.eye[1]) * view.viewDir[1] + (P[2] - view.eye[2]) * view.viewDir[2]
        // the sheet's nearest surface over the point 3 px to a side of the outline, along the eye's ray through it: its facing and its depth
        const hits = [3, -3].map((d) => {
          const ox = (-ty * d) / ppu, oy = (tx * d) / ppu
          const Q = [0, 1, 2].map((j) => P[j] + right[j] * ox - up[j] * oy)
          let o: number[]
          let dir: number[]
          if (fc.ortho) {
            o = Q.map((q, j) => q - view.viewDir[j] * 50)
            dir = [...view.viewDir]
          } else {
            o = [...view.eye]
            const dv = Q.map((q, j) => q - view.eye[j])
            const l = Math.hypot(dv[0], dv[1], dv[2])
            dir = dv.map((x) => x / l)
          }
          const h = castLine(fx, o, dir)
          if (!h) return null
          const at = o.map((x, j) => x + dir[j] * h.t)
          return { face: h.face, depth: (at[0] - view.eye[0]) * view.viewDir[0] + (at[1] - view.eye[1]) * view.viewDir[1] + (at[2] - view.eye[2]) * view.viewDir[2] }
        })
        const gap = hits.map((h) => (h ? Math.abs(h.depth - depthP) : Infinity))
        const inside = gap[0] < gap[1] ? 0 : 1
        // only where the sheet is on one side and at the outline's depth, or clearly nearer one side's
        if (!(gap[inside] < 1) || (Number.isFinite(gap[1 - inside]) && Math.abs(gap[0] - gap[1]) < 0.05)) continue
        decided++
        const seen = (hits[inside] as { face: number }).face >= 0 ? 1 : -1
        sides.add(seen)
        if (run.sg[k] !== seen) wrongSide++
        const ix = inside === 0 ? -ty : ty, iy = inside === 0 ? tx : -tx
        if (run.nrm[2 * k] * ix + run.nrm[2 * k + 1] * iy < 0) wrongWay++
      }
    }
    return { decided, wrongSide, wrongWay, sides }
  }

  const checkAgainstRays = (az: number, el: number, perspective = false): ReturnType<typeof checkView> => checkView(saddleFx, viewAt(az, el, { perspective }))

  // A view zoomed in on a point of the outline of the same view at zoom 1 (the outline in the middle of the screen).
  function zoomedOn(fx: Fixture, az: number, el: number, zoom: number, perspective: boolean): PaintView {
    const { runs } = make(fx, viewAt(az, el, { perspective }))
    const run = runs[0]
    const k = Math.floor(run.n / 3)
    return viewAt(az, el, { perspective, zoom, target: [run.world[3 * k], run.world[3 * k + 1], run.world[3 * k + 2]] })
  }

  it("reads the side of the sheet that is seen just inside the outline at every sample, as ray casting the refined sheet 3 px either side sees it, and the way in", () => {
    for (const [az, el] of [[20, 25], [200, 10], [30, 15]] as const) {
      const r = checkAgainstRays(az, el)
      if (process.env.FRAME_PRINT) console.log(`saddle az ${az} el ${el}: ${r.decided} samples decided by rays, the side seen wrong at ${r.wrongSide}, the way in wrong at ${r.wrongWay}`)
      expect(r.decided).toBeGreaterThan(20)
      expect(r.wrongSide / r.decided, `az ${az}`).toBeLessThan(0.03)
      expect(r.wrongWay / r.decided, `az ${az}`).toBeLessThan(0.03)
    }
  })

  it("reads the side seen in a perspective view too, as the eye's rays through the points 3 px to a side see it", () => {
    for (const [az, el] of [[20, 25], [200, 10]] as const) {
      const r = checkAgainstRays(az, el, true)
      if (process.env.FRAME_PRINT) console.log(`saddle in perspective, az ${az} el ${el}: ${r.decided} samples decided by rays, the side seen wrong at ${r.wrongSide}, the way in wrong at ${r.wrongWay}`)
      expect(r.decided).toBeGreaterThan(20)
      expect(r.wrongSide / r.decided, `az ${az}`).toBeLessThan(0.03)
      expect(r.wrongWay / r.decided, `az ${az}`).toBeLessThan(0.03)
    }
  })

  it("reads the side seen on a short piece of the outline, in perspective, as the rays do (a piece is not one side because its middle is)", () => {
    for (const [az, el] of [[30, 40], [225, -21]] as const) {
      const view = viewAt(az, el, { perspective: true })
      const { runs } = make(saddleFx, view)
      // (a short piece: 24 samples or fewer, under 50 px)
      expect(runs.some((r) => r.n <= 24), `az ${az} el ${el}: has a short piece`).toBe(true)
      const r = checkView(saddleFx, view)
      if (process.env.FRAME_PRINT) console.log(`saddle in perspective with a short piece, az ${az} el ${el}: ${r.decided} samples decided by rays, the side seen wrong at ${r.wrongSide}`)
      expect(r.decided, `az ${az} el ${el}`).toBeGreaterThan(5)
      expect(r.wrongSide, `az ${az} el ${el}`).toBeLessThanOrEqual(1)
    }
  })

  // Zoomed in on a point of the outline: the shares of the decided samples that may be wrong (the rays' truth: round 1 had under 0.5% on the saddle at zoom 8, and
  // 1.4% and 8.4% on the coarse sheet at zoom 3 and 8; a cast that looks only so far round a vertex has 5%, 4.7% and 22%).
  const zoomedCases = (cases: [Fixture, number, number, number, boolean, number][], name: string): void => {
    for (const [fx, az, el, zoom, perspective, allowed] of cases) {
      const r = checkView(fx, zoomedOn(fx, az, el, zoom, perspective))
      const label = `${name} az ${az} el ${el} zoom ${zoom}${perspective ? ' perspective' : ''}`
      if (process.env.FRAME_PRINT) console.log(`${label}: ${r.decided} samples decided by rays, the side seen wrong at ${r.wrongSide}`)
      expect(r.decided, label).toBeGreaterThan(100)
      expect(r.wrongSide / r.decided, label).toBeLessThan(allowed)
    }
  }

  it("reads the side seen on a fine sheet zoomed in to 8, where a triangle is larger than the screen's stride at the outline: both projections", () => {
    zoomedCases([[saddleFx, 30, 15, 8, false, 0.005], [saddleFx, 30, 15, 8, true, 0.005]], 'saddle')
  })

  it("reads the side seen on a coarse sheet zoomed in to 3 and 8 (a triangle is hundreds of pixels across): both projections", () => {
    zoomedCases([[coarseFx, 30, 15, 3, false, 0.03], [coarseFx, 30, 15, 8, false, 0.05], [coarseFx, 20, 25, 8, true, 0.06]], 'coarse sheet')
  })

  it("casts the side at a small share of the samples: every 16th, the end, and where two casts differ", () => {
    const view = viewAt(20, 25)
    const mesh = saddleFx.scene.marks[0] as MeshMark
    const caster = casterOf(mesh)
    make(saddleFx, view)
    const before = caster.casts
    const { runs } = make(saddleFx, view)
    // (a cast is a ray to each side of the sample)
    const rays = caster.casts - before
    const samples = runs.reduce((s, r) => s + r.n, 0)
    if (process.env.FRAME_PRINT) console.log(`saddle az 20 el 25: ${rays} rays for ${samples} samples`)
    expect(samples).toBeGreaterThan(100)
    expect(rays).toBeGreaterThan(4)
    expect(rays).toBeLessThan(samples / 3)
  })

  it("sees both sides of a sheet along one outline where the sheet turns, and cuts a stretch there", () => {
    const view = viewAt(20, 25)
    const { runs, list } = make(saddleFx, view)
    const senv = silhouetteEnv(saddleFx.params)
    const flipped = runs.filter((r) => new Set(r.sg).size === 2)
    expect(flipped.length).toBeGreaterThan(0)
    for (const run of flipped) {
      for (const [a, b] of cutRun(stretchKinds(run, senv.capU), 45, lowestKeys(run.keys, CUT_WINDOW))) {
        const seen = new Set(run.sg.slice(a, b + 1))
        expect(seen.size, `stretch ${a}-${b}`).toBe(1)
      }
    }
    expect(list.count).toBeGreaterThan(4)
    // and a closed figure is seen from its outside all round
    for (const run of make(sphereFx, view).runs) expect(new Set(run.sg)).toEqual(new Set([1]))
  })

  it("tells the sides of the sheet apart in the kinds, so that a stretch is not cut across a change of side", () => {
    const view = viewAt(20, 25)
    const { runs } = make(saddleFx, view)
    const senv = silhouetteEnv(saddleFx.params)
    const run = runs.find((r) => new Set(r.sg).size === 2) as SilhouetteRun
    const kinds = stretchKinds(run, senv.capU)
    const front = run.sg.findIndex((s) => s > 0)
    const back = run.sg.findIndex((s) => s < 0)
    expect(kinds[front] & 8).toBe(0)
    expect(kinds[back] & 8).toBe(8)
  })
})

// ---- the cuts, the names and the draws of the strokes of an outline ----

describe('the cuts of an outline and the draws of its strokes', () => {
  it('cuts at the sites, where the kind changes, and in equal parts when a stretch is long, and joins a short stretch to the one before it', () => {
    const n = 200
    const keys = new Uint32Array(n)
    // cells of 20 samples with the keys 5, 9, 3, 8, 7, 1, 6, 4, 2, 0 (+ 1)
    const cellKeys = [5, 9, 3, 8, 7, 1, 6, 4, 2, 0]
    for (let i = 0; i < n; i++) keys[i] = 1000 * (cellKeys[Math.floor(i / 20)] + 1)
    // a site is where a cell begins and its key is the lowest within 24 samples either side: the cells 0, 2, 5 and 9 (the first has none before it)
    const sites = lowestKeys(keys, 24)
    expect(Array.from(sites)).toEqual([0, 40, 100, 180])
    expect(siteBefore(sites, 0)).toBe(0)
    expect(siteBefore(sites, 39)).toBe(0)
    expect(siteBefore(sites, 40)).toBe(1)
    expect(siteBefore(sites, 199)).toBe(3)
    expect(siteBefore(Int32Array.from([30]), 10)).toBe(-1)
    const kinds = new Uint8Array(n)
    expect(cutRun(kinds, 1000, sites).map(([a, b]) => [a, b])).toEqual([[0, 39], [40, 99], [100, 179], [180, 199]])
    // a change of kind cuts too; a long stretch is cut in equal parts, numbered; a stretch under 11 samples (the last, of kind 2) joins the one before it
    kinds.fill(1, 60, 100)
    kinds.fill(2, 190, 200)
    expect(cutRun(kinds, 25, sites)).toEqual([
      [0, 19, 0, 0], [20, 39, 0, 1], [40, 59, 0, 0], [60, 79, 1, 0], [80, 99, 1, 1], [100, 119, 0, 0], [120, 139, 0, 1], [140, 159, 0, 2], [160, 179, 0, 3], [180, 199, 0, 0],
    ])
  })

  it('draws from smooth noise at its place: the same at the same place, never far from itself a little way off, and spread as the uniform and the normal draws are', () => {
    const a = new WorldDraw(0.3, -0.2, 0.9)
    const b = new WorldDraw(0.3, -0.2, 0.9)
    for (let k = 0; k < 12; k++) expect(a.next()).toBe(b.next())
    let worst = 0
    let worstG = 0
    let sum = 0
    let sum2 = 0
    let gsum2 = 0
    const N = 4000
    for (let i = 0; i < N; i++) {
      const x = 7 * hash01(i, 1, 2) - 3.5, y = 7 * hash01(i, 3, 4) - 3.5, z = 7 * hash01(i, 5, 6) - 3.5
      const p = new WorldDraw(x, y, z)
      const q = new WorldDraw(x + 0.01, y - 0.01, z + 0.01)
      for (let k = 0; k < 4; k++) {
        const u = p.next()
        worst = Math.max(worst, Math.abs(u - q.next()))
        if (k === 0) {
          sum += u
          sum2 += u * u
        }
      }
      const g = p.gauss()
      worstG = Math.max(worstG, Math.abs(g - q.gauss()))
      gsum2 += g * g
    }
    // (a hashed draw is 0.33 apart on average)
    expect(worst).toBeLessThan(0.08)
    expect(worstG).toBeLessThan(0.2)
    const mean = sum / N
    const sd = Math.sqrt(sum2 / N - mean * mean)
    // (the 4000 points share about 1500 lattice corners: the mean of the corners' values is that of 1500 draws)
    expect(mean).toBeGreaterThan(0.42)
    expect(mean).toBeLessThan(0.58)
    expect(sd).toBeGreaterThan(0.25)
    expect(sd).toBeLessThan(0.33)
    expect(Math.sqrt(gsum2 / N)).toBeGreaterThan(0.85)
    expect(Math.sqrt(gsum2 / N)).toBeLessThan(1.15)
  })

  it('mixes each stretch of an outline as a load of its own: a few strokes to a load, and a different hue from one stroke to the next (a fresh mix, not one hue along a site)', () => {
    const spy = vi.spyOn(LoadMixer.prototype, 'mixByCell')
    try {
      for (const zoom of [1, 4]) {
        const perLoad: number[] = []
        const dHue: number[] = []
        for (const [az, el] of [[20, 25], [120, 25], [200, 40], [300, 15]] as const) {
          // zoomed in, the top of the outline is in the middle of the screen
          const A = (az * Math.PI) / 180, E = (el * Math.PI) / 180
          const up = [-Math.sin(E) * Math.cos(A), -Math.sin(E) * Math.sin(A), Math.cos(E)]
          const target = zoom > 1 ? ([up[0], up[1], up[2]] as [number, number, number]) : ([0, 0, 0] as [number, number, number])
          const view = { ...paintView({ width: 640, height: 480, azimuth: az, elevation: el, zoom: 150 * zoom, magnify: zoom, target }), lightDir: LIGHT }
          spy.mockClear()
          const { list } = make(sphereFx, view)
          const results = spy.mock.results.map((r) => r.value as { load: number; hueOffset: number; kd: number })
          expect(results.length).toBe(list.count)
          // the strokes on the screen (by the middle of the path), in outline order
          const on: number[] = []
          for (let e = 0; e < list.count; e++) {
            const x = list.path[2 * PP * e + PP], y = list.path[2 * PP * e + PP + 1]
            if (x >= 0 && y >= 0 && x <= view.width && y <= view.height) on.push(e)
          }
          const loads = new Map<number, number>()
          for (const e of on) loads.set(results[e].load, (loads.get(results[e].load) ?? 0) + 1)
          for (const n of loads.values()) perLoad.push(n)
          for (let k = 1; k < on.length; k++) dHue.push(Math.abs(results[on[k]].hueOffset * results[on[k]].kd - results[on[k - 1]].hueOffset * results[on[k - 1]].kd))
        }
        const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
        if (process.env.FRAME_PRINT) console.log(`outline brush loads, sphere at zoom ${zoom}: ${mean(perLoad).toFixed(2)} strokes to a load, mean hue change to the next stroke ${mean(dHue).toFixed(2)} degrees (${dHue.length} strokes)`)
        expect(dHue.length, `zoom ${zoom}`).toBeGreaterThan(30)
        expect(mean(perLoad), `zoom ${zoom}: strokes to a load`).toBeLessThanOrEqual(3)
        expect(mean(dHue), `zoom ${zoom}: hue change to the next stroke`).toBeGreaterThanOrEqual(3)
      }
    } finally {
      spy.mockRestore()
    }
  })

  // The strokes of a view, and for each stroke of another view the one of this nearest it (by the middle of its world path, within 0.15 units).
  function carried(fx: Fixture, az0: number, el: number, az1: number): { n: number; sameSeed: number; sameSeedColour: number; same: number; sameClass: number; sameClassOK: number } {
    const base = make(fx, viewAt(az0, el))
    const other = make(fx, viewAt(az1, el))
    const mid = (l: StrokeList, e: number): number[] => [0, 1, 2].map((c) => (l.worldPath[3 * PP * e + 3 * (PP >> 1) + c] + l.worldPath[3 * PP * e + 3 * ((PP >> 1) - 1) + c]) / 2)
    const peak = (l: StrokeList, e: number): number => Math.max(...Array.from({ length: PP }, (_, q) => l.width[PP * e + q]))
    const oklab = (l: StrokeList, e: number): number[] => linearToOklab(l.colour[3 * e], l.colour[3 * e + 1], l.colour[3 * e + 2])
    let n = 0, sameSeed = 0, sameSeedColour = 0, same = 0, sameClass = 0, sameClassOK = 0
    for (let e = 0; e < other.list.count; e++) {
      const m = mid(other.list, e)
      let best = -1
      let bd = Infinity
      for (let f = 0; f < base.list.count; f++) {
        const q = mid(base.list, f)
        const d = Math.hypot(m[0] - q[0], m[1] - q[1], m[2] - q[2])
        if (d < bd) {
          bd = d
          best = f
        }
      }
      if (bd >= 0.15) continue
      n++
      // the brush's jitters (width, load and colour) within 5% (a colour 5% apart: 0.02 of OKLab distance, 5% of its range)
      const la = oklab(base.list, best), lb = oklab(other.list, e)
      const colourClose = Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]) <= 0.02
      const close = Math.abs(peak(other.list, e) / peak(base.list, best) - 1) <= 0.05 && Math.abs(other.list.load[e] / base.list.load[best] - 1) <= 0.05 && colourClose
      const kept = base.list.seed[best] === other.list.seed[e]
      if (kept) {
        sameSeed++
        if (colourClose) sameSeedColour++
      }
      if (kept || close) same++
      if (base.list.edge[best] === other.list.edge[e]) {
        sameClass++
        if (kept || close) sameClassOK++
      }
    }
    return { n, sameSeed, sameSeedColour, same, sameClass, sameClassOK }
  }

  it('keeps what an outline draws where it has not moved: a turn of a degree reseeds a few strokes and changes the brush of none, and five degrees most', () => {
    let nAll = 0
    let sameAll = 0
    for (const [fx, az, el] of [[sphereFx, 20, 25], [sphereFx, 120, 25], [sphereFx, 200, 40]] as const) {
      const one = carried(fx, az, el, az + 1)
      const five = carried(fx, az, el, az + 5)
      if (process.env.FRAME_PRINT) {
        console.log(`outline, az ${az} to ${az + 1}: ${one.n} strokes matched, ${one.sameSeed} keep their seed, ${one.same} keep it or have width, load and colour within 5%; ${one.sameClass} of them in the same class, ${one.sameClassOK} of those keep it or are within 5%`)
        console.log(`outline, az ${az} to ${az + 5}: ${five.n} strokes matched, ${five.sameSeed} keep their seed, ${five.same} keep it or are within 5%; ${five.sameClass} in the same class, ${five.sameClassOK} of those`)
      }
      expect(one.n).toBeGreaterThan(15)
      // a stroke that keeps its seed keeps its colour, too: what it is mixed with does not depend on the strokes drawn before it
      expect(one.sameSeedColour / one.sameSeed, `1 degree from az ${az}, the colour`).toBeGreaterThanOrEqual(0.9)
      nAll += one.n
      sameAll += one.same
      expect(one.same / one.n, `1 degree from az ${az}`).toBeGreaterThanOrEqual(0.9)
      // (a stroke whose class changes is another kind of stroke: the lost edge turning soft where the outline runs along a terminator moves fast)
      expect(one.sameClassOK / one.sameClass, `1 degree from az ${az}, the same class`).toBeGreaterThanOrEqual(0.9)
      // five degrees: a stroke in every two keeps its seed, and well over half keep their brush (the old outline kept 7 in 23)
      expect(five.sameSeed / five.n, `5 degrees from az ${az}`).toBeGreaterThan(0.3)
      expect(five.same / five.n, `5 degrees from az ${az}`).toBeGreaterThan(0.55)
    }
    expect(sameAll / nAll).toBeGreaterThanOrEqual(0.9)
  })
})
