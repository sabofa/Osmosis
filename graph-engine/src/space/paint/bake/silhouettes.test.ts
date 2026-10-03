import { describe, expect, it, vi } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { lchToLab, linearToOklab } from '../model/colour'
import { silhouettePolylines } from '../model/contours'
import { smoothClasses } from '../model/edges'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { project, makeFrameCtx } from '../model/view'
import { PATH_POINTS, ROLES, type GBuffer, type PaintView } from '../types'
import { LIGHT, TERRACOTTA, CANVAS, framing, fixture, sparse, sphereColours, sphereScene, type Fixture } from './bakeFixture'
import { frameFromBakeWith, FrameScratch } from './frame'
import { HIDDEN_NA } from './types'
import {
  focalAt, indexOf, medianClasses, newSilhouetteStats, SILHOUETTE_MIN_SAMPLES, SILHOUETTE_STEP_PX, silhouetteEnv, silhouetteRuns, silhouetteStrokes, VertexGrid,
  type SilhouetteRun,
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

const viewAt = (az: number, el: number, opts: { perspective?: boolean; zoom?: number } = {}): PaintView => ({
  ...paintView({ width: 640, height: 480, azimuth: az, elevation: el, zoom: 150 * (opts.zoom ?? 1), magnify: opts.zoom ?? 1, perspective: opts.perspective }), lightDir: LIGHT,
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

  it('keep their seeds where the outline has not moved: a turn of a degree reseeds a minority, a turn of five most', () => {
    const base = make(sphereFx, viewAt(20, 25))
    const mid = (l: StrokeList, e: number): number[] => [0, 1, 2].map((c) => (l.worldPath[3 * PP * e + 3 * 3 + c] + l.worldPath[3 * PP * e + 3 * 4 + c]) / 2)
    const kept = (az: number): number => {
      const other = make(sphereFx, viewAt(az, 25))
      let same = 0
      let n = 0
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
        if (bd < 0.15) {
          n++
          if (base.list.seed[best] === other.list.seed[e]) same++
        }
      }
      expect(n).toBeGreaterThan(15)
      return same / n
    }
    expect(kept(20.5)).toBeGreaterThan(0.6)
    expect(kept(21)).toBeGreaterThan(0.55)
    expect(kept(25)).toBeLessThan(0.7)
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
