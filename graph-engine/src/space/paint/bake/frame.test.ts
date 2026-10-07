import { describe, expect, it, vi } from 'vitest'
import type { SpaceScene } from '../../scene/types'
import { reshapeWidths, sizedBristles, sizedLength, sizedVariance, sizedWidth } from '../model/brush'
import { lchToLab } from '../model/colour'
import { BEHIND_VEIL_LAYER, pressure } from '../model/strokes'
import { arrowMark, flatColours, graphMesh, lineMark, paintView, pointMark, quadMesh, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from '../model/testing'
import { paintFrame } from '../model/index'
import { bigMax, drawChanceOf, drawFadeAt, loadCellLevel, project, pxPerUnit, makeFrameCtx, roleRank, zoomGrowOf, zoomSizeScaleAt } from '../model/view'
import { VEIL_ALPHA, VEIL_BORDER_ALPHA, VEIL_DENSITY } from '../model/roles'
import { smooth } from '../model/math'
import { reprojectStrokes } from '../reproject'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type GBuffer, type PaintView, type StrokeBatch } from '../types'
import { P, LIGHT, framing, fixture, sparse, bytes, sphereColours, sphereScene, saddleColours, saddleScene, veilScene, TERRACOTTA, CANVAS, type Fixture } from './bakeFixture'
import { DEPTH_BUCKETS, frameFromBake, frameFromBakeWith, FrameScratch } from './frame'
import { BAKE_EDGE_REFINE, BAKE_MIX_LEVELS, BAKE_PATH_POINTS, HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE, isEdgeSizing, SIZING_ACROSS, SIZING_ALONG, SIZING_SURFACE, type BakedPainting } from './types'

vi.setConfig({ testTimeout: 180_000 })

const PP = PATH_POINTS
const FRONT_ORTHO = framing(20, 25, true)

// A view of the origin from (azimuth, elevation), `zoom` times in on the framing the bakes are made for (150 CSS px a world unit), the light the bakes' own.
function viewAt(azimuth: number, elevation: number, opts: { zoom?: number; perspective?: boolean; width?: number; height?: number } = {}): PaintView {
  const zoom = opts.zoom ?? 1
  const v = paintView({
    width: opts.width ?? 640, height: opts.height ?? 480, azimuth, elevation, zoom: 150 * zoom, magnify: zoom, perspective: opts.perspective,
  })
  return { ...v, lightDir: LIGHT }
}

// ---- fixtures, made once ----

const sphereFx = fixture(sphereScene(), sphereColours(), sparse(700), LIGHT, FRONT_ORTHO)
const saddleFx = fixture(saddleScene(), saddleColours(), sparse(700), LIGHT, FRONT_ORTHO)

// a bake whose brushes are so narrow that many strokes are too thin to see (the mean of their widths under 0.6 px: the frame leaves them out)
const thinFx = (() => {
  const base = sparse(700)
  const params = { ...base, roles: { ...base.roles, block: { ...base.roles.block, width: 0.35 }, glaze: { ...base.roles.glaze, width: 0.35 } } }
  return fixture(sphereScene(), sphereColours(), params, LIGHT, FRONT_ORTHO)
})()

const dataColours = flatColours({ 0: TERRACOTTA, 1: CANVAS, 2: lchToLab(0.4, 0.05, 55), 3: lchToLab(0.4, 0.05, 200), 4: lchToLab(0.45, 0.1, 300), 5: lchToLab(0.35, 0.1, 20) })
const dataScene = (): SpaceScene =>
  sceneOf([
    sphereMesh({ radius: 0.8, index: 0, nu: 32, nv: 20 }),
    tableMesh({ z: -1, half: 2, index: 1 }),
    // a line round the back of the sphere (hidden from the front: dashed), one in front of it (none), points, an arrow
    lineMark([[0, 1.2, 0.2], [0, 0.4, 0.2], [0, -0.4, 0.2], [0, -1.2, 0.2]], { index: 2, hidden: 'dashed', width: 2 }),
    lineMark([[-1.2, 0.9, -0.9], [-0.4, 0.9, -0.9], [0.4, 0.9, -0.9], [1.2, 0.9, -0.9]], { index: 3, hidden: 'none', width: 2 }),
    pointMark([[0.5, 0.5, 0.9], [-0.5, 0.2, 0.95]], { index: 4, size: 8 }),
    arrowMark([0.9, 0.9, 0.2], [0.6, 0, 0.3], { index: 5, hidden: 'dashed', headSize: 12 }),
  ])
const dataFx = fixture(dataScene(), dataColours, sparse(500), LIGHT, FRONT_ORTHO)

// A veil over a sphere, with a line below the veil and one above it.
const veilFx = (() => {
  const scene = sceneOf([
    sphereMesh({ radius: 0.5, index: 0, nu: 24, nv: 16 }),
    quadMesh({ origin: [-1, -1, 0.8], e1: [2, 0, 0], e2: [0, 2, 0], n: 6, opacity: 0.5, index: 1 }),
    lineMark([[-0.5, 0.3, 0], [0.5, 0.3, 0]], { index: 2, hidden: 'none' }),
    lineMark([[-0.5, -0.3, 1.3], [0.5, -0.3, 1.3]], { index: 3, hidden: 'none' }),
  ])
  return fixture(scene, flatColours({ 0: TERRACOTTA, 1: lchToLab(0.7, 0.1, 250), 2: lchToLab(0.4, 0.05, 55), 3: lchToLab(0.4, 0.05, 55) }), sparse(500), LIGHT, FRONT_ORTHO)
})()

// A flat sheet facing the camera (tilted off the table's z so that it is a figure, not bare table), seen square on.
const SHEET_N: [number, number, number] = [0.3, 0, 1]
const sheetNorm = Math.hypot(...SHEET_N)
const sheetFx = (() => {
  const nrm = SHEET_N.map((c) => c / sheetNorm)
  // e1 x e2 = the normal: e1 = (0,1,0) x ... any two perpendicular unit vectors in the plane
  const e1: [number, number, number] = [0, 1, 0]
  const e2: [number, number, number] = [nrm[2], 0, -nrm[0]] // (n_z, 0, -n_x): perpendicular to n and e1; e1 x e2 = (-n_x, 0, -n_z)... flipped below
  const k = 2.4
  const scene = sceneOf([quadMesh({ origin: [-0.5 * k * e1[0] - 0.5 * k * e2[0], -0.5 * k * e1[1] - 0.5 * k * e2[1], -0.5 * k * e1[2] - 0.5 * k * e2[2]], e1: [k * e2[0], k * e2[1], k * e2[2]], e2: [k * e1[0], k * e1[1], k * e1[2]], n: 12, index: 0 })])
  return fixture(scene, flatColours({ 0: TERRACOTTA }), sparse(900), LIGHT, FRONT_ORTHO)
})()
// the camera of the sheet: looking along -n (az 0, el = asin(n_z))
const SHEET_EL = (Math.asin(SHEET_N[2] / sheetNorm) * 180) / Math.PI

const run = (fx: Fixture, view: PaintView, scr = new FrameScratch(), g: GBuffer | null = null): { batch: StrokeBatch; scr: FrameScratch } => ({
  batch: frameFromBakeWith(scr, fx.baked, fx.scene, view, fx.params, g),
  scr,
})

// ---- a reference implementation of the per-stroke selection, from the brief, with the pure forms of the model's functions ----

interface Ref {
  alpha: number
  big: number
}

// The point at arc-length fraction `at` (the stroke's anchor unless given) of baked stroke i's path (summing the chords, not taking the points as equally spaced) and its
// normal there.
function anchorOf(baked: BakedPainting, i: number, at = baked.anchor[i]): { p: number[]; n: number[] } {
  const o = 3 * BAKE_PATH_POINTS * i
  const cum = [0]
  for (let q = 1; q < BAKE_PATH_POINTS; q++) {
    cum.push(cum[q - 1] + Math.hypot(baked.worldPath[o + 3 * q] - baked.worldPath[o + 3 * q - 3], baked.worldPath[o + 3 * q + 1] - baked.worldPath[o + 3 * q - 2], baked.worldPath[o + 3 * q + 2] - baked.worldPath[o + 3 * q - 1]))
  }
  const s = at * cum[BAKE_PATH_POINTS - 1]
  let q = 1
  while (q < BAKE_PATH_POINTS - 1 && cum[q] < s) q++
  const f = cum[q] > cum[q - 1] ? Math.min(1, Math.max(0, (s - cum[q - 1]) / (cum[q] - cum[q - 1]))) : 0
  const p = [0, 1, 2].map((c) => baked.worldPath[o + 3 * (q - 1) + c] + (baked.worldPath[o + 3 * q + c] - baked.worldPath[o + 3 * (q - 1) + c]) * f)
  const n = [0, 1, 2].map((c) => baked.worldNormal[o + 3 * (q - 1) + c] + (baked.worldNormal[o + 3 * q + c] - baked.worldNormal[o + 3 * (q - 1) + c]) * f)
  const l = Math.hypot(n[0], n[1], n[2])
  return { p, n: l > 0 ? n.map((c) => c / l) : n }
}

// The foreshortening of the direction an edge stroke is spaced in at its anchor, by finite differences of the projection (the frame reads the projection's
// derivative): the length on the screen of a small step along the direction (the path's own for a stroke along its stretch, the normal × the path's for one across
// it) over the scale's, in 0.15..1.
function alongRef(fc: ReturnType<typeof makeFrameCtx>, baked: BakedPainting, i: number, p: number[], n: number[], at = baked.anchor[i]): number {
  const o = 3 * BAKE_PATH_POINTS * i
  const q = Math.min(BAKE_PATH_POINTS - 2, Math.floor(at * (BAKE_PATH_POINTS - 1)))
  let d = [0, 1, 2].map((c) => baked.worldPath[o + 3 * (q + 1) + c] - baked.worldPath[o + 3 * q + c])
  if (baked.sizing[i] === SIZING_ACROSS) d = [n[1] * d[2] - n[2] * d[1], n[2] * d[0] - n[0] * d[2], n[0] * d[1] - n[1] * d[0]]
  const l = Math.hypot(d[0], d[1], d[2])
  if (!(l > 1e-12)) return 1
  const h = 1e-4
  const a = [0, 0, 0]
  const b = [0, 0, 0]
  project(fc, p[0], p[1], p[2], a)
  project(fc, p[0] + (h * d[0]) / l, p[1] + (h * d[1]) / l, p[2] + (h * d[2]) / l, b)
  const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / (h * pxPerUnit(fc, p[0], p[1], p[2]))
  return Math.min(1, Math.max(0.15, r))
}

function reference(fx: Fixture, view: PaintView): Map<number, Ref> {
  const { baked, scene, params } = fx
  const out = new Map<number, Ref>()
  const fc = makeFrameCtx(scene, view, { width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0) }, params)
  const pp = params.particles
  const sizeScale = zoomSizeScaleAt(view.zoom, params)
  for (let i = 0; i < baked.count; i++) {
    const role = ROLES[baked.role[i]]
    const mark = scene.marks[baked.mark[i]]
    const veil = mark.kind === 'mesh' && mark.style.opacity < 1
    const border = veil && Math.abs(baked.alpha[i] - Math.fround(VEIL_BORDER_ALPHA)) < 1e-6
    const { p, n } = anchorOf(baked, i)
    // the unit vector toward the eye
    let t: number[]
    if (fc.ortho) t = [-view.viewDir[0], -view.viewDir[1], -view.viewDir[2]]
    else {
      const d = [view.eye[0] - p[0], view.eye[1] - p[1], view.eye[2] - p[2]]
      const l = Math.hypot(d[0], d[1], d[2])
      t = d.map((c) => c / l)
    }
    const dot = n[0] * t[0] + n[1] * t[1] + n[2] * t[2]
    if (baked.side[i] !== 0 ? dot <= 0 : dot < -0.05) continue
    // (an edge stroke: the stretch's density draw, then its spacing rank against the zoom over the refinement, the zoom being the scale at its anchor over the
    // reference's, with the tilt of the stretch from the view; past the refinement it is lengthened by the zoom over it. A stroke along its stretch reads the zoom
    // once for the stretch, at the middle of its path, and keeps the cells of the power of two of them at or under it: its rank under that over the refinement, and
    // it is drawn z over that times its px long)
    let edgeBig = 1
    if (role === 'edge') {
      if (baked.rank[i] >= params.roles.edge.density) continue
      if (baked.sizing[i] === SIZING_ALONG) {
        const m = anchorOf(baked, i, 0.5)
        const z = pxPerUnit(fc, m.p[0], m.p[1], m.p[2]) * baked.referenceWorldPerPx * alongRef(fc, baked, i, m.p, m.n, 0.5)
        let zl = 1
        while (zl < BAKE_EDGE_REFINE && 2 * zl <= z) zl *= 2
        if (baked.spacing[i] * BAKE_EDGE_REFINE >= zl) continue
        edgeBig = z / zl
      } else {
        const z = pxPerUnit(fc, p[0], p[1], p[2]) * baked.referenceWorldPerPx * alongRef(fc, baked, i, p, n)
        if (baked.spacing[i] * BAKE_EDGE_REFINE >= z) continue
        if (z > BAKE_EDGE_REFINE) edgeBig = z / BAKE_EDGE_REFINE
      }
    }
    if (role === 'line') {
      out.set(i, { alpha: baked.alpha[i], big: 1 })
      continue
    }
    const ppu = pxPerUnit(fc, p[0], p[1], p[2])
    // off the screen (the anchor's pixel, less what a stroke reaches beyond it: half its length and its width): not drawn, as the model draws the particles the G-buffer shows
    const offscreen = (big: number): boolean => {
      const m = fc.vp
      const w = Math.max(1e-9, m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15])
      const sx = (((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w + 1) / 2) * view.width
      const sy = ((1 - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w) / 2) * view.height
      // (an edge stroke is its own px long, and as wide whatever the zoom)
      const reach = role === 'edge' ? 0.5 * baked.basePx[2 * i] * big + baked.basePx[2 * i + 1] : 0.5 * sizedLength(baked.basePx[2 * i], big) + baked.basePx[2 * i + 1] * big
      return sx < -reach || sy < -reach || sx > view.width + reach || sy > view.height + reach
    }
    if (role === 'edge') {
      if (!offscreen(edgeBig)) out.set(i, { alpha: baked.alpha[i], big: edgeBig })
      continue
    }
    if (role === 'dab') {
      if (!offscreen(sizeScale)) out.set(i, { alpha: baked.alpha[i], big: sizeScale })
      continue
    }
    const facing = Math.abs(dot)
    const fade = veil ? smooth(pp.fadeLo * 0.25, pp.fadeHi * 0.5, facing) : smooth(pp.fadeLo, pp.fadeHi, facing)
    if (fade < 0.02) continue
    const pxArea = baked.areaPerParticle[baked.mark[i]] * ppu * ppu * facing
    const drawRole = veil ? (border ? 'scumble' : 'glaze') : role
    const chance = drawChanceOf(params, view.dragging, pxArea, drawRole, veil && !border ? VEIL_DENSITY : 1)
    const df = drawFadeAt(chance, baked.rank[i])
    if (!(df > 0.02)) continue
    // a veil's border pass is made only for a particle whose own glaze (at VEIL_DENSITY) is drawn (roles.ts particleStrokes), at the glaze's own rank
    if (border) {
      const glaze = drawFadeAt(drawChanceOf(params, view.dragging, pxArea, 'glaze', VEIL_DENSITY), roleRank(fx.particles.rank[baked.particle[i]], 'glaze'))
      if (!(glaze > 0.02)) continue
    }
    const growRole = veil ? 'glaze' : role
    const big = Math.min(zoomGrowOf(params, view.dragging, pxArea, growRole) * sizeScale, bigMax(params))
    if (!offscreen(big)) out.set(i, { alpha: baked.alpha[i] * fade * df, big })
  }
  return out
}

const sourcesOf = (scr: FrameScratch, batch: StrokeBatch): Map<number, number> => {
  const m = new Map<number, number>()
  for (let o = 0; o < batch.count; o++) if (scr.source[o] >= 0) m.set(scr.source[o], o)
  return m
}

const dist2 = (a: ArrayLike<number>, ai: number, b: ArrayLike<number>, bi: number): number => Math.hypot(a[ai] - b[bi], a[ai + 1] - b[bi + 1], a[ai + 2] - b[bi + 2])

describe('frameFromBake: the baked strokes of a view', () => {
  it('selects, fades and sizes as the brief says, by the model\'s own pure functions (several views, both projections, zooms)', () => {
    const views: [string, Fixture, PaintView][] = [
      ['front, ortho', sphereFx, viewAt(20, 25)],
      ['back, ortho', sphereFx, viewAt(200, 25)],
      ['top, ortho', sphereFx, viewAt(20, 80)],
      ['front, ortho, zoom 2', sphereFx, viewAt(20, 25, { zoom: 2 })],
      ['front, ortho, zoom 0.5', sphereFx, viewAt(20, 25, { zoom: 0.5 })],
      ['front, perspective', sphereFx, viewAt(20, 25, { perspective: true })],
      // a veil over a sphere: its glazes' own fade, density and border pass, both of its sides
      ['veil, from above', veilFx, viewAt(30, 50)],
      ['veil, from below, zoom 2', veilFx, viewAt(30, -50, { zoom: 2 })],
      ['veil, perspective', veilFx, viewAt(120, 35, { perspective: true })],
      // (a veil fades over a quarter and a half of the surface's band of |n·v|: only a graze tells it from a surface)
      ['veil, at a graze', veilFx, viewAt(30, 12)],
      ['veil, at a graze from below', veilFx, viewAt(200, -9)],
      // a saddle: open, two sides
      ['saddle, from below', saddleFx, viewAt(30, -60)],
    ]
    for (const [name, fx, view] of views) {
      const ref = reference(fx, view)
      const { batch, scr } = run(fx, view)
      const got = sourcesOf(scr, batch)
      let missing = 0
      let extra = 0
      let alphaBad = 0
      let bigBad = 0
      for (const [i, r] of ref) {
        const o = got.get(i)
        if (o === undefined) {
          missing++
          continue
        }
        // (the anchor's place along the path is read by chords there and by equal parts here: the fade's ramp is steep, a part in a thousand of facing is
        // a hundredth of alpha at the worst)
        if (Math.abs(batch.alpha[o] - r.alpha) > 0.01) alphaBad++
        if (Math.abs(scr.bigOf[o] - r.big) > 5e-3 * r.big) bigBad++
      }
      for (const i of got.keys()) if (!ref.has(i)) extra++
      // (a stroke whose sub-arc is too short to draw is dropped by the frame and not by this reference; the anchor's place along the path is read by
      // chords here and by equal parts there: a stroke right at a threshold can fall either side)
      expect(ref.size, name).toBeGreaterThan(name.startsWith('veil') ? 40 : 200)
      expect(missing / ref.size, `${name}: missing`).toBeLessThan(0.01)
      expect(extra / ref.size, `${name}: extra`).toBeLessThan(0.005)
      // (a veil view has a few hundred strokes: one is half a percent)
      const slack = name.startsWith('veil') ? 0.02 : 0.005
      expect(alphaBad / ref.size, `${name}: alpha`).toBeLessThan(slack)
      expect(bigBad / ref.size, `${name}: big`).toBeLessThan(slack)
    }
  })

  it('gives the same batch, byte for byte, for the same bake and view, whatever scratch it is given', () => {
    const view = viewAt(20, 25)
    const a = run(sphereFx, view).batch
    const b = run(sphereFx, view).batch
    const scr = new FrameScratch()
    frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, viewAt(100, 10), sphereFx.params, null)
    const c = frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    const d = frameFromBake(sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    const e = frameFromBake(sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    for (const other of [b, c, d, e]) {
      expect(other.count).toBe(a.count)
      for (const k of Object.keys(a) as (keyof StrokeBatch)[]) {
        if (k === 'count') continue
        expect(bytes(other[k] as Float32Array), String(k)).toBe(bytes(a[k] as Float32Array))
      }
    }
    // a reused output is the same numbers
    const reuse = new FrameScratch()
    reuse.reuseOutput = true
    const r1 = frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    expect(r1.count).toBe(a.count)
    for (const k of Object.keys(a) as (keyof StrokeBatch)[]) if (k !== 'count') expect(bytes(r1[k] as Float32Array), String(k)).toBe(bytes(a[k] as Float32Array))
    frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, viewAt(100, 10), sphereFx.params, null)
    const r2 = frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    for (const k of Object.keys(a) as (keyof StrokeBatch)[]) if (k !== 'count') expect(bytes(r2[k] as Float32Array), String(k)).toBe(bytes(a[k] as Float32Array))
  })

  it('does not boil: two views a degree apart keep the same strokes, in the same colour and role, on the same bit of path', () => {
    for (const fx of [sphereFx, saddleFx]) {
      for (const el of [25, 60]) {
        const v0 = viewAt(20, el)
        const v1 = viewAt(21, el)
        const a = run(fx, v0)
        const b = run(fx, v1)
        const sa = sourcesOf(a.scr, a.batch)
        const sb = sourcesOf(b.scr, b.batch)
        let both = 0
        let same = 0
        let equalBig = 0
        let arcsOk = 0
        for (const [i, oa] of sa) {
          const ob = sb.get(i)
          if (ob === undefined) continue
          both++
          if (a.batch.seed[oa] === b.batch.seed[ob] && a.batch.role[oa] === b.batch.role[ob] && a.batch.colour[3 * oa] === b.batch.colour[3 * ob] && a.batch.colour[3 * oa + 1] === b.batch.colour[3 * ob + 1] && a.batch.colour[3 * oa + 2] === b.batch.colour[3 * ob + 2]) same++
          // the world sub-arc: the same points (in either direction) where the size is the same (the view is orthographic: the px per unit is the same); an edge
          // stroke's arc is the px the model has, and the tilt of its surface from the view moves with the camera, so its sub-arc is the same only to the tilt's
          // change over a degree (about a part in thirty of its length)
          if (Math.abs(a.scr.bigOf[oa] - b.scr.bigOf[ob]) < 1e-6) {
            const edgeArc = isEdgeSizing(fx.baked.sizing[i])
            equalBig++
            const wa = a.batch.worldPath
            const wb = b.batch.worldPath
            let fwd = 0
            let rev = 0
            for (let q = 0; q < PP; q++) {
              fwd = Math.max(fwd, dist2(wa, 3 * PP * oa + 3 * q, wb, 3 * PP * ob + 3 * q))
              rev = Math.max(rev, dist2(wa, 3 * PP * oa + 3 * q, wb, 3 * PP * ob + 3 * (PP - 1 - q)))
            }
            if (edgeArc) {
              // (an edge stroke's arc: the same piece of the path to a quarter of its length)
              const span = dist2(wa, 3 * PP * oa, wa, 3 * PP * oa + 3 * (PP - 1))
              if (fwd <= 0.25 * span + 1e-9) arcsOk++
            } else if (Math.min(fwd, rev) < 1e-6) arcsOk++
          }
        }
        if (process.env.FRAME_PRINT) console.log(`no boiling, ${fx === sphereFx ? 'sphere' : 'saddle'}, el ${el}, 1 degree: drawn ${sa.size} / ${sb.size}, in both ${both} (${(both / Math.max(sa.size, sb.size)).toFixed(4)} of the larger), same seed+colour+role ${same}/${both}, equal size ${equalBig}, sub-arcs within 1e-6 ${arcsOk}/${equalBig}`)
        expect(both, `${el}`).toBeGreaterThan(200)
        expect(same / both).toBeGreaterThanOrEqual(0.9)
        // (in fact all of them: every one of these is a baked number)
        expect(same).toBe(both)
        expect(equalBig / both).toBeGreaterThan(0.9)
        expect(arcsOk).toBe(equalBig)
        // and the views keep the bulk of the strokes
        expect(both / Math.max(sa.size, sb.size)).toBeGreaterThan(0.9)
      }
    }
  })

  it('keeps most of the strokes through a wider turn, as the per-frame model keeps 80% through 12 degrees', () => {
    const a = run(sphereFx, viewAt(20, 25))
    const sa = sourcesOf(a.scr, a.batch)
    for (const [turn, least] of [[1, 0.97], [3, 0.9], [6, 0.8], [12, 0.6]] as const) {
      const b = run(sphereFx, viewAt(20 + turn, 25))
      const sb = sourcesOf(b.scr, b.batch)
      let both = 0
      for (const i of sa.keys()) if (sb.has(i)) both++
      // (the strokes that stay: those drawn in both over those drawn in the first)
      if (process.env.FRAME_PRINT) console.log(`turn ${turn} degrees: kept ${(both / sa.size).toFixed(4)} of the first view's baked strokes`)
      expect(both / sa.size, `${turn}`).toBeGreaterThan(least)
    }
  })

  it('sizes a stroke by the zoom: its sub-arc lies on its baked path, its length on screen is the brush\'s (within 2% unless the path ends first), its mix level follows the zoom', () => {
    for (const zoom of [0.5, 1, 2, 4]) {
      const view = viewAt(0, SHEET_EL, { zoom })
      const { batch, scr } = run(sheetFx, view)
      const b = sheetFx.baked
      const level = Math.min(loadCellLevel(zoom), BAKE_MIX_LEVELS - 1)
      let checked = 0
      let clippedShort = 0
      let unclipped = 0
      const ratios: number[] = []
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || b.sizing[i] !== SIZING_SURFACE || ROLES[b.role[i]] === 'dab') continue
        checked++
        // the sub-arc is on the baked polyline
        const base = 3 * BAKE_PATH_POINTS * i
        for (let q = 0; q < PP; q++) {
          let best = Infinity
          for (let s = 0; s + 1 < BAKE_PATH_POINTS; s++) {
            const ax = b.worldPath[base + 3 * s], ay = b.worldPath[base + 3 * s + 1], az = b.worldPath[base + 3 * s + 2]
            const dx = b.worldPath[base + 3 * s + 3] - ax, dy = b.worldPath[base + 3 * s + 4] - ay, dz = b.worldPath[base + 3 * s + 5] - az
            const px = batch.worldPath[3 * PP * o + 3 * q] - ax, py = batch.worldPath[3 * PP * o + 3 * q + 1] - ay, pz = batch.worldPath[3 * PP * o + 3 * q + 2] - az
            const l2 = dx * dx + dy * dy + dz * dz
            const t = l2 > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy + pz * dz) / l2)) : 0
            best = Math.min(best, Math.hypot(px - t * dx, py - t * dy, pz - t * dz))
          }
          expect(best).toBeLessThan(2e-6)
        }
        // the mix level
        expect(batch.colour[3 * o]).toBe(b.colour[12 * i + 3 * level])
        expect(batch.colour[3 * o + 1]).toBe(b.colour[12 * i + 3 * level + 1])
        expect(batch.colour[3 * o + 2]).toBe(b.colour[12 * i + 3 * level + 2])
        // the length on screen against the brush's
        let len = 0
        for (let q = 1; q < PP; q++) len += Math.hypot(batch.path[2 * PP * o + 2 * q] - batch.path[2 * PP * o + 2 * q - 2], batch.path[2 * PP * o + 2 * q + 1] - batch.path[2 * PP * o + 2 * q - 1])
        const want = sizedLength(b.basePx[2 * i], scr.bigOf[o])
        const ppu = 150 * zoom
        const need = want / ppu
        const a = b.anchor[i]
        const L = b.pathLength[i]
        // centred on the anchor and clipped at the path's ends, with no rebalancing: the part of [a - need/2, a + need/2] that lies on the path
        const lo = Math.max(0, a - need / (2 * L))
        const hi = Math.min(1, a + need / (2 * L))
        ratios.push(len / want)
        const clipped = a - need / (2 * L) < 0 || a + need / (2 * L) > 1
        if (clipped) {
          clippedShort++
          // the path ended first: the stroke is all of the path that is there, never longer than the brush's
          expect(len).toBeLessThanOrEqual(want * 1.02)
          expect(Math.abs(len / ((hi - lo) * L * ppu) - 1), `zoom ${zoom}`).toBeLessThan(0.03)
        } else {
          unclipped++
          expect(Math.abs(len / want - 1), `zoom ${zoom}`).toBeLessThan(0.02)
        }
      }
      if (process.env.FRAME_PRINT) console.log(`zoom ${zoom}: ${checked} surface strokes, ${unclipped} unclipped (within 2% of the brush's length), ${clippedShort} clipped by the path's end; level ${level}; the length against the brush's: mean ${(ratios.reduce((x, y) => x + y, 0) / ratios.length).toFixed(4)}, 10th percentile ${[...ratios].sort((x, y) => x - y)[Math.floor(0.1 * ratios.length)].toFixed(4)}, minimum ${Math.min(...ratios).toFixed(4)}`)
      expect(checked, `zoom ${zoom}`).toBeGreaterThan(100)
      // (at the most zoomed-out view the baked path is exactly as long as the brush asks, and the walks that stop short are clipped)
      expect(unclipped, `zoom ${zoom}`).toBeGreaterThan(zoom > 0.5 ? 50 : 0)
      expect(unclipped + clippedShort).toBe(checked)
    }
  })

  it('grows the stroke with the brush at the zoom: the widths and the bristles follow sizedWidth, reshapeWidths, sizedBristles and sizedVariance', () => {
    const view = viewAt(0, SHEET_EL, { zoom: 3 })
    const { batch, scr } = run(sheetFx, view)
    const b = sheetFx.baked
    let seen = 0
    let big2 = 0
    for (let o = 0; o < batch.count; o++) {
      const i = scr.source[o]
      if (i < 0 || b.sizing[i] !== SIZING_SURFACE) continue
      const big = scr.bigOf[o]
      if (big > 1.5) big2++
      expect(batch.bristles[o]).toBe(sizedBristles(b.bristles[i], big))
      expect(batch.bristleVar[o]).toBeCloseTo(sizedVariance(b.bristleVar[i], big), 6)
      // the widths: base × pressure × the lateral's foreshortening (1 on a sheet square to the view), the close-up's shape
      const w = new Float32Array(PP)
      for (let q = 0; q < PP; q++) w[q] = Math.max(0.35, sizedWidth(b.basePx[2 * i + 1], big) * pressure(q / (PP - 1)))
      reshapeWidths(w, big)
      const reversed = b.handStart[i] === 1 && batch.path[2 * PP * o + 2 * (PP - 1)] < batch.path[2 * PP * o]
      void reversed
      for (let q = 0; q < PP; q++) expect(Math.abs(batch.width[PP * o + q] / w[q] - 1)).toBeLessThan(0.03)
      seen++
    }
    expect(seen).toBeGreaterThan(100)
    expect(big2).toBeGreaterThan(20)
  })

  it('runs a stroke of the hand from its left end to its right, whatever way it was baked, and leaves a loaded end the bake chose', () => {
    const b = sphereFx.baked
    let hand = 0
    let handBackwards = 0
    let chosen = 0
    let chosenLeftward = 0
    for (const [az, el] of [[20, 25], [110, 40], [200, 10], [290, 60]] as const) {
      const { batch, scr } = run(sphereFx, viewAt(az, el))
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || b.sizing[i] !== SIZING_SURFACE) continue
        const left = batch.path[2 * PP * o + 2 * (PP - 1)] < batch.path[2 * PP * o]
        if (b.handStart[i] === 1) {
          hand++
          if (left) handBackwards++
        } else {
          chosen++
          if (left) chosenLeftward++
        }
      }
    }
    expect(hand).toBeGreaterThan(500)
    // (the end is never left of the start for a hand stroke: it was turned)
    expect(handBackwards).toBe(0)
    // a form stroke starts at its lighter end whichever way that is on screen
    expect(chosen).toBeGreaterThan(20)
    expect(chosenLeftward).toBeGreaterThan(0)
  })

  it('draws the side that faces the eye: an open saddle seen from below has only side -1 strokes, from above only side +1, a closed sphere only its outside', () => {
    const b = saddleFx.baked
    // (the saddle's slopes reach 45 degrees: a camera 40 below the horizon still sees the steepest slopes' upper side, at a graze; 70 and more it does not)
    for (const [el, want] of [[-70, -1], [70, 1], [-85, -1], [85, 1]] as const) {
      const { batch, scr } = run(saddleFx, viewAt(30, el))
      let n = 0
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || b.sizing[i] !== SIZING_SURFACE) continue
        n++
        expect(b.side[i], `elevation ${el}`).toBe(want)
      }
      if (process.env.FRAME_PRINT) console.log(`saddle at elevation ${el}: ${n} surface strokes, all side ${want}`)
      expect(n).toBeGreaterThan(200)
    }
    for (const el of [-40, 40]) {
      const view = viewAt(30, el)
      const { batch, scr } = run(saddleFx, view)
      let n = 0
      let own = 0
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || b.sizing[i] !== SIZING_SURFACE) continue
        n++
        // the side drawn is the side that faces the eye
        const dot = batch.worldNormal[3 * o] * -view.viewDir[0] + batch.worldNormal[3 * o + 1] * -view.viewDir[1] + batch.worldNormal[3 * o + 2] * -view.viewDir[2]
        expect(dot).toBeGreaterThan(0)
        if (b.side[i] === (el < 0 ? -1 : 1)) own++
      }
      if (process.env.FRAME_PRINT) console.log(`saddle at elevation ${el}: ${n} surface strokes, ${own} of the side seen from there`)
      expect(own / n).toBeGreaterThan(0.9)
    }
    const s = sphereFx.baked
    for (const az of [20, 110, 200]) {
      const { batch, scr } = run(sphereFx, viewAt(az, 25))
      const view = viewAt(az, 25)
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || s.mark[i] !== 0) continue
        expect(s.side[i]).toBe(0)
        // facing the eye, or grazing it by under 0.05
        const nrm = [batch.worldNormal[3 * o], batch.worldNormal[3 * o + 1], batch.worldNormal[3 * o + 2]]
        expect(nrm[0] * -view.viewDir[0] + nrm[1] * -view.viewDir[1] + nrm[2] * -view.viewDir[2]).toBeGreaterThan(-0.05)
      }
    }
  })

  it('carries the hidden style of a data mark in `hidden`, and HIDDEN_NA on a surface or edge stroke', () => {
    const { batch, scr } = run(dataFx, viewAt(20, 25))
    const b = dataFx.baked
    const seen = { dashed: 0, none: 0, na: 0, edge: 0, ownNone: 0, ownDashed: 0 }
    for (let o = 0; o < batch.count; o++) {
      const i = scr.source[o]
      const role = ROLES[batch.role[o]]
      if (i >= 0 && role === 'line') {
        const dashed = (dataFx.scene.marks[b.mark[i]] as { style: { hidden: string } }).style.hidden === 'dashed'
        expect(batch.hidden![o]).toBe(dashed ? HIDDEN_DASHED : HIDDEN_NONE)
        if (dashed) seen.dashed++
        else seen.none++
      } else if (i >= 0) {
        expect(batch.hidden![o], role).toBe(HIDDEN_NA)
        seen.na++
        if (role === 'edge') seen.edge++
      } else if (role === 'line') {
        // a point (none) or an arrowhead of a dashed arrow: one or the other, and never NA (which is for what is not a data mark)
        expect([HIDDEN_NONE, HIDDEN_DASHED]).toContain(batch.hidden![o])
        if (batch.hidden![o] === HIDDEN_DASHED) seen.ownDashed++
        else seen.ownNone++
      } else expect(batch.hidden![o]).toBe(HIDDEN_NA) // a silhouette
    }
    expect(seen.dashed).toBeGreaterThan(0)
    expect(seen.none).toBeGreaterThan(0)
    expect(seen.na).toBeGreaterThan(100)
    expect(seen.edge).toBeGreaterThan(0)
    expect(seen.ownDashed).toBe(2)
    expect(seen.ownNone).toBe(2)
    // the hidden array is as long as the batch
    expect(batch.hidden!.length).toBe(batch.count)
  })

  it('gives an edge stroke the taper of a pressed brush and a line a width that is the same all along it, from its baked width', () => {
    const { batch, scr } = run(dataFx, viewAt(20, 25))
    const b = dataFx.baked
    const P = PP
    let edges = 0
    let lines = 0
    for (let o = 0; o < batch.count; o++) {
      const i = scr.source[o]
      if (i < 0) continue
      const role = ROLES[batch.role[o]]
      const baseW = b.basePx[2 * i + 1]
      if (role === 'edge') {
        edges++
        for (let q = 0; q < P; q++) expect(batch.width[P * o + q]).toBeCloseTo(Math.max(0.35, baseW * pressure(q / (P - 1))), 4)
        // it tapers: the end is the thinner
        expect(batch.width[P * o + P - 1]).toBeLessThan(batch.width[P * o])
      } else if (role === 'line') {
        lines++
        for (let q = 0; q < P; q++) expect(batch.width[P * o + q]).toBe(Math.fround(baseW))
      }
    }
    expect(edges).toBeGreaterThan(0)
    expect(lines).toBeGreaterThan(0)
  })

  it('puts a data line seen through a flat veil in the layer before the glaze, and no other', () => {
    const b = veilFx.baked
    const behindOf = (el: number): { behind: number; front: number } => {
      const { batch, scr } = run(veilFx, viewAt(20, el))
      const out = { behind: 0, front: 0 }
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || ROLES[batch.role[o]] !== 'line') continue
        const mark = b.mark[i]
        if (batch.layer[o] === BEHIND_VEIL_LAYER) out.behind++
        else {
          expect(batch.layer[o]).toBe(LAYER_ORDER.indexOf('line'))
          out.front++
        }
        void mark
      }
      return out
    }
    // from above the sheet lies over the line below it, and not over the line above it
    const above = behindOf(50)
    expect(above.behind).toBeGreaterThan(0)
    expect(above.front).toBeGreaterThan(0)
    // from below the eye is on the side of both lines at the sheet's own, the line at z = 0 in front of the sheet
    const below = behindOf(-50)
    expect(below.behind).toBeGreaterThan(0)
    // a view along the sheet sees none behind it
    void below
  })

  it('builds the points and arrowheads on the screen, anchored in the world: a dab of max(3, size) px, two barbs of max(6, headSize) px at 26 degrees', () => {
    const view = viewAt(20, 25)
    const { batch, scr } = run(dataFx, view)
    const marks = dataFx.scene.marks
    const fc = makeFrameCtx(dataFx.scene, view, { width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0) }, dataFx.params)
    const own: number[] = []
    for (let o = 0; o < batch.count; o++) if (scr.source[o] < 0 && ROLES[batch.role[o]] === 'line') own.push(o)
    expect(own.length).toBe(4)
    const project = (p: number[]): [number, number] => {
      const out = [0, 0, 0]
      const m = fc.vp
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
      out[0] = ((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w + 1) / 2 * view.width
      out[1] = (1 - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w) / 2 * view.height
      return [out[0], out[1]]
    }
    const points = marks[4] as { positions: Float64Array }
    const arrow = marks[5] as { tails: Float64Array; vectors: Float64Array }
    const pts = own.filter((o) => batch.width[PP * o] === 8)
    expect(pts.length).toBe(2)
    // (points and arrowheads are in the line layer)
    for (const o of own) {
      expect(batch.layer[o]).toBe(LAYER_ORDER.indexOf('line'))
      // (never pre-halved: the renderer's hidden pass draws the hidden parts at half)
      expect(batch.alpha[o]).toBe(1)
      expect(batch.edge[o]).toBe(255)
    }
    for (const o of pts) {
      // the world points are all one point of the mark; the dab is centred on its projection, 4 px long, 8 wide
      const wp = [batch.worldPath[3 * PP * o], batch.worldPath[3 * PP * o + 1], batch.worldPath[3 * PP * o + 2]]
      for (let q = 1; q < PP; q++) expect(dist2(batch.worldPath, 3 * PP * o + 3 * q, wp, 0)).toBe(0)
      const idx = [0, 1].find((k) => Math.hypot(points.positions[3 * k] - wp[0], points.positions[3 * k + 1] - wp[1], points.positions[3 * k + 2] - wp[2]) < 1e-5)
      expect(idx).toBeDefined()
      const [sx, sy] = project(wp)
      expect(batch.path[2 * PP * o]).toBeCloseTo(sx - 2, 3)
      expect(batch.path[2 * PP * o + 2 * (PP - 1)]).toBeCloseTo(sx + 2, 3)
      for (let q = 0; q < PP; q++) expect(batch.path[2 * PP * o + 2 * q + 1]).toBeCloseTo(sy, 3)
      expect(batch.colour[3 * o]).toBeCloseTo(dataFx.baked.dataColour[3 * 4], 6)
    }
    const barbs = own.filter((o) => batch.width[PP * o] !== 8)
    expect(barbs.length).toBe(2)
    const tip = [arrow.tails[0] + arrow.vectors[0], arrow.tails[1] + arrow.vectors[1], arrow.tails[2] + arrow.vectors[2]]
    const tail = project([arrow.tails[0], arrow.tails[1], arrow.tails[2]])
    const tipS = project(tip)
    const shaft = Math.atan2(tipS[1] - tail[1], tipS[0] - tail[0])
    const angles: number[] = []
    for (const o of barbs) {
      // each barb ends exactly at the tip, is 12 px long, and its world points are the tip
      expect(batch.path[2 * PP * o + 2 * (PP - 1)]).toBeCloseTo(tipS[0], 3)
      expect(batch.path[2 * PP * o + 2 * (PP - 1) + 1]).toBeCloseTo(tipS[1], 3)
      const dx = batch.path[2 * PP * o] - tipS[0]
      const dy = batch.path[2 * PP * o + 1] - tipS[1]
      expect(Math.hypot(dx, dy)).toBeCloseTo(12, 3)
      angles.push(Math.atan2(dy, dx) - shaft)
      for (let q = 0; q < PP; q++) expect(dist2(batch.worldPath, 3 * PP * o + 3 * q, tip, 0)).toBeLessThan(1e-6)
      expect(batch.hidden![o]).toBe(HIDDEN_DASHED)
      expect(batch.colour[3 * o]).toBeCloseTo(dataFx.baked.dataColour[3 * 5], 6)
    }
    // the barbs open +-0.46 rad about the way back down the shaft
    const wrap = (a: number): number => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    const back = angles.map((a) => wrap(a - Math.PI))
    expect(Math.min(...back)).toBeCloseTo(-0.46, 3)
    expect(Math.max(...back)).toBeCloseTo(0.46, 3)
  })

  it('orders the batch by layer, then far to near by the anchor\'s view depth (to a bucket), ties in bake order, and fills worldPath and worldNormal for reproject.ts', () => {
    for (const fx of [sphereFx, dataFx]) {
      const view = viewAt(20, 25)
      const { batch, scr } = run(fx, view)
      let dMin = Infinity
      let dMax = -Infinity
      for (let o = 0; o < batch.count; o++) {
        dMin = Math.min(dMin, batch.depth[o])
        dMax = Math.max(dMax, batch.depth[o])
      }
      const bucket = (d: number): number => Math.floor(((dMax - d) * (DEPTH_BUCKETS - 1)) / (dMax - dMin))
      for (let o = 1; o < batch.count; o++) {
        expect(batch.layer[o]).toBeGreaterThanOrEqual(batch.layer[o - 1])
        if (batch.layer[o] === batch.layer[o - 1]) {
          // far to near, to a bucket (the buckets are made from the depths before the batch's float32)
          expect(bucket(batch.depth[o]) + 1).toBeGreaterThanOrEqual(bucket(batch.depth[o - 1]))
          // a tie keeps the bake's order
          if (batch.depth[o] === batch.depth[o - 1] && scr.source[o] >= 0 && scr.source[o - 1] >= 0) expect(scr.source[o]).toBeGreaterThan(scr.source[o - 1])
        }
      }
      // every array has the length of the batch, every number is finite
      const n = batch.count
      expect(batch.role.length).toBe(n)
      expect(batch.path.length).toBe(2 * PP * n)
      expect(batch.width.length).toBe(PP * n)
      expect(batch.worldPath.length).toBe(3 * PP * n)
      expect(batch.worldNormal.length).toBe(3 * n)
      for (const k of ['path', 'width', 'depth', 'colour', 'alpha', 'load', 'impasto', 'bristles', 'bristleVar', 'dry', 'wet', 'endSoft', 'worldPath', 'worldNormal'] as const) {
        for (let i = 0; i < batch[k].length; i++) if (!Number.isFinite(batch[k][i])) throw new Error(`${k}[${i}] is ${batch[k][i]}`)
      }
      // the world path through the view's own viewProj is the path (reproject.ts: the same view gives the same batch), for every stroke that has a world path
      const again = reprojectStrokes(batch, view, view, fx.params)
      let off = 0
      let worst = -1
      for (let o = 0; o < n; o++) {
        for (let q = 0; q < 2 * PP; q++) {
          const d = Math.abs(again.path[2 * PP * o + q] - batch.path[2 * PP * o + q])
          if (d > off) {
            off = d
            worst = o
          }
        }
      }
      if (off > 2e-3) console.log('worst', worst, ROLES[batch.role[worst]], 'source', scr.source[worst], 'off', off, 'baked sizing', scr.source[worst] >= 0 ? fx.baked.sizing[scr.source[worst]] : -1, Array.from(batch.path.subarray(2 * PP * worst, 2 * PP * worst + 16)).map((v) => v.toFixed(2)).join(' '), '|', Array.from(again.path.subarray(2 * PP * worst, 2 * PP * worst + 16)).map((v) => v.toFixed(2)).join(' '))
      expect(off).toBeLessThan(2e-3)
    }
  })

  it('makes no scratch array after its first frames, and its arrays are fresh for every call (or, asked to, none)', () => {
    const scr = new FrameScratch()
    const views = [viewAt(20, 25), viewAt(50, 25), viewAt(90, 30), viewAt(20, 25)]
    for (const v of views) frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, v, sphereFx.params, null)
    const made = scr.arrays
    const a = frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, views[1], sphereFx.params, null)
    const b = frameFromBakeWith(scr, sphereFx.baked, sphereFx.scene, views[1], sphereFx.params, null)
    expect(scr.arrays).toBe(made)
    expect(a.path.buffer).not.toBe(b.path.buffer)
    expect(a.seed.buffer).not.toBe(b.seed.buffer)
    const reuse = new FrameScratch()
    reuse.reuseOutput = true
    for (const v of views) frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, v, sphereFx.params, null)
    const made2 = reuse.arrays
    const c = frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, views[1], sphereFx.params, null)
    const d = frameFromBakeWith(reuse, sphereFx.baked, sphereFx.scene, views[1], sphereFx.params, null)
    expect(reuse.arrays).toBe(made2)
    expect(c.path.buffer).toBe(d.path.buffer)
  })

  it('gives an empty batch for a scene with nothing to paint, and the points of a scene of points alone', () => {
    const empty = fixture(sceneOf([]), flatColours({}), sparse(500), LIGHT, FRONT_ORTHO)
    const a = run(empty, viewAt(20, 25))
    expect(a.batch.count).toBe(0)
    expect(a.batch.path.length).toBe(0)
    const pts = fixture(sceneOf([pointMark([[0, 0, 0], [0.5, 0.5, 0], [0, 0, 5000]], { index: 0, size: 6 })]), flatColours({ 0: lchToLab(0.4, 0.1, 30) }), sparse(500), LIGHT, FRONT_ORTHO)
    const b = run(pts, viewAt(20, 25))
    // two on the screen, and the third (far off it) left out
    expect(b.batch.count).toBe(2)
    expect(Array.from(b.batch.role)).toEqual([ROLES.indexOf('line'), ROLES.indexOf('line')])
  })

  it('reads a scene that is another object with the same marks as the same (the bake preparation is kept), and a veil that is not one any more as another bake', () => {
    const view = viewAt(20, 25)
    const a = frameFromBakeWith(new FrameScratch(), sphereFx.baked, sphereFx.scene, view, sphereFx.params, null)
    const copy = { ...sphereFx.scene, marks: [...sphereFx.scene.marks] }
    const b = frameFromBakeWith(new FrameScratch(), sphereFx.baked, copy, view, sphereFx.params, null)
    expect(bytes(b.path)).toBe(bytes(a.path))
    expect(bytes(b.alpha)).toBe(bytes(a.alpha))
    // the sphere's mark made translucent: its glazes are a veil's now (a different fade and density): the strokes differ
    const veiled = { ...sphereFx.scene, marks: sphereFx.scene.marks.map((m, i) => (i === 0 && m.kind === 'mesh' ? { ...m, style: { ...m.style, opacity: 0.5 } } : m)) }
    const c = frameFromBakeWith(new FrameScratch(), sphereFx.baked, veiled, view, sphereFx.params, null)
    expect(c.count).not.toBe(a.count)
  })

  it('closes up the gaps left by strokes too thin to see: every array moves with its stroke', () => {
    const view = viewAt(20, 25)
    const { batch, scr } = run(thinFx, view)
    const b = thinFx.baked
    expect(scr.stats.written).toBeLessThan(scr.stats.selected)
    expect(batch.count).toBe(scr.stats.written)
    expect(batch.count).toBeGreaterThan(300)
    // every stroke of the result is its source's: role, seed, colour, edge class, hidden, layer; in order of layer
    let last = -1
    let own = 0
    for (let o = 0; o < batch.count; o++) {
      const i = scr.source[o]
      if (i < 0) {
        own++
        continue
      }
      expect(batch.role[o]).toBe(b.role[i])
      expect(batch.seed[o]).toBe(b.seed[i])
      expect(batch.colour[3 * o]).toBe(b.colour[12 * i])
      expect(batch.colour[3 * o + 2]).toBe(b.colour[12 * i + 2])
      expect(batch.edge[o]).toBe(b.edge[i])
      expect(batch.hidden![o]).toBe(b.hidden[i])
      expect(batch.alpha[o]).toBeLessThanOrEqual(b.alpha[i] * (1 + 1e-6))
      expect(batch.layer[o]).toBe(b.layer[i])
      expect(last).toBeLessThanOrEqual(batch.layer[o])
      last = batch.layer[o]
      // its path is its own world path's projection
      expect(batch.path.length).toBe(2 * PP * batch.count)
    }
    expect(own).toBe(scr.stats.own)
    // the world path of every stroke projects to its path (the same view)
    const again = reprojectStrokes(batch, view, view, thinFx.params)
    for (let o = 0; o < batch.count; o++) for (let q = 0; q < 2 * PP; q++) expect(Math.abs(again.path[2 * PP * o + q] - batch.path[2 * PP * o + q])).toBeLessThan(2e-3)
  })

  it('tests the baked strokes against the screen only when an anchor may be off it, and leaves out those that are', () => {
    // (a sphere alone: the table of the other fixtures reaches past the screen)
    const ball = fixture(sceneOf([sphereMesh({ radius: 0.8, index: 0, nu: 32, nv: 20 })]), flatColours({ 0: TERRACOTTA }), sparse(400), LIGHT, FRONT_ORTHO)
    for (const perspective of [false, true]) {
      // a figure wholly in view: nothing is tested, nothing is left out
      const inView = run(ball, viewAt(20, 25, { perspective })).scr.stats
      expect(inView.screenTested, `perspective ${perspective}`).toBe(false)
      expect(inView.offscreen).toBe(0)
      // zoomed in to a part of it: the strokes off the screen are not drawn
      const zoomed = run(ball, viewAt(20, 25, { zoom: 4, perspective })).scr.stats
      expect(zoomed.screenTested, `perspective ${perspective}, zoom 4`).toBe(true)
      expect(zoomed.offscreen).toBeGreaterThan(20)
    }
  })

  it("draws a veil's border pass only where the particle's own glaze is drawn, as the per-frame model does", () => {
    const fx = fixture(veilScene(), flatColours({ 0: TERRACOTTA, 1: lchToLab(0.7, 0.1, 250) }), sparse(500), LIGHT, FRONT_ORTHO)
    const set = fx.particles
    const bySeed = new Map<number, number>()
    for (let i = 0; i < set.count; i++) bySeed.set(set.seed[i], i)
    for (const zoom of [1, 2, 4]) {
      const view = viewAt(30, 50, { zoom })
      // the model's frame: the sphere (mark 0, radius 0.6) is in the G-buffer, the veil is not
      const g = sphereGBuffer(view.width, view.height, { view, params: fx.params, radius: 0.6, mark: 0 })
      const model = paintFrame(fx.scene, set, view, g, fx.params).strokes
      const modelBorder = new Set<number>()
      let modelGlaze = 0
      for (let o = 0; o < model.count; o++) {
        const seedP = bySeed.get(model.seed[o])
        if (ROLES[model.role[o]] !== 'glaze' || seedP === undefined || fx.scene.marks[set.mark[seedP]].kind !== 'mesh' || set.opacity[seedP] >= 1) continue
        // (the border pass is the glaze with the dry brush 0.6)
        if (model.dry[o] === Math.fround(0.6)) modelBorder.add(seedP)
        else modelGlaze++
      }
      const { batch, scr } = run(fx, view)
      const fcv = makeFrameCtx(fx.scene, view, g, fx.params)
      const onScreen = (p: number): boolean => {
        const out = [0, 0, 0]
        return project(fcv, set.position[3 * p], set.position[3 * p + 1], set.position[3 * p + 2], out) && out[0] >= 0 && out[1] >= 0 && out[0] < view.width && out[1] < view.height
      }
      const bakedBorder = new Set<number>()
      for (let o = 0; o < batch.count; o++) {
        const i = scr.source[o]
        if (i < 0 || ROLES[batch.role[o]] !== 'glaze' || fx.baked.particle[i] === 0xffffffff) continue
        const mk = fx.scene.marks[fx.baked.mark[i]]
        // (a stroke whose anchor is within its reach of the screen's edge is drawn, and the model's particle is not on the screen: left out of the comparison)
        if (mk.kind === 'mesh' && mk.style.opacity < 1 && Math.abs(fx.baked.alpha[i] - Math.fround(VEIL_BORDER_ALPHA)) < 1e-6 && onScreen(fx.baked.particle[i])) bakedBorder.add(fx.baked.particle[i])
      }
      let both = 0
      for (const p of bakedBorder) if (modelBorder.has(p)) both++
      if (process.env.FRAME_PRINT) console.log(`veil border pass, zoom ${zoom}: model ${modelBorder.size} (of ${modelGlaze} glazes), baked frame ${bakedBorder.size}, in both ${both}`)
      expect(modelBorder.size, `zoom ${zoom}`).toBeGreaterThan(2)
      // (the baked frame draws what faces the eye, the model what the G-buffer shows: the sphere is under the veil here, nothing hides it)
      expect(both / modelBorder.size, `zoom ${zoom}: recall`).toBeGreaterThan(0.9)
      expect(both / bakedBorder.size, `zoom ${zoom}: precision`).toBeGreaterThan(0.9)
    }
  })

  it('never thins a highlight dab or fades it, draws an edge stroke by roles.edge.density, and a data line always', () => {
    const view = viewAt(20, 25)
    const b = sphereFx.baked
    const { scr, batch } = run(sphereFx, view)
    const drawn = sourcesOf(scr, batch)
    // a dab facing the eye is drawn whatever the density, whole, and sized by the zoom alone (no growth for a shortage of particles)
    let dabs = 0
    for (const zoom of [1, 3]) {
      for (const [az, el] of [[20, 25], [60, 40], [330, 35], [20, 60]] as const) {
        const v = viewAt(az, el, { zoom })
        const r = run(sphereFx, v)
        const got = sourcesOf(r.scr, r.batch)
        for (let i = 0; i < b.count; i++) {
          if (ROLES[b.role[i]] !== 'dab') continue
          const o = got.get(i)
          if (o === undefined) continue
          dabs++
          expect(r.batch.alpha[o]).toBe(b.alpha[i])
          expect(r.scr.bigOf[o]).toBeCloseTo(zoomSizeScaleAt(zoom, sphereFx.params), 5)
        }
      }
    }
    expect(dabs).toBeGreaterThan(2)
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'dab') continue
      const o = drawn.get(i)
      if (o !== undefined) expect(batch.alpha[o]).toBe(b.alpha[i])
    }
    // the edge density: a stroke is kept when its rank is under the slider
    const halved = { ...sphereFx.params, roles: { ...sphereFx.params.roles, edge: { ...sphereFx.params.roles.edge, density: 0.5 } } }
    const half = frameFromBakeWith(new FrameScratch(), b, sphereFx.scene, view, halved, null)
    let edges = 0
    let edgesHalf = 0
    for (let o = 0; o < batch.count; o++) if (ROLES[batch.role[o]] === 'edge' && scr.source[o] >= 0) edges++
    for (let o = 0; o < half.count; o++) if (ROLES[half.role[o]] === 'edge') edgesHalf++
    expect(edges).toBeGreaterThan(20)
    expect(edgesHalf).toBeLessThan(edges)
    expect(edgesHalf).toBeGreaterThan(0)
  })

  it('draws a stroke width that follows the surface: a foreshortened lateral direction narrows it, and the four-point reading stays within 5% of reading every point', () => {
    // the widths against a per-point reading, on a view that is not square to the figure
    const view = viewAt(20, 25, { zoom: 1.5 })
    const { batch, scr } = run(sphereFx, view)
    const b = sphereFx.baked
    const fc = makeFrameCtx(sphereFx.scene, view, { width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0) }, sphereFx.params)
    const errs: number[] = []
    for (let o = 0; o < batch.count; o++) {
      const i = scr.source[o]
      if (i < 0 || b.sizing[i] !== SIZING_SURFACE || ROLES[b.role[i]] === 'dab') continue
      const big = scr.bigOf[o]
      const a = anchorOf(b, i)
      const ppu = pxPerUnit(fc, a.p[0], a.p[1], a.p[2])
      // the widths with fore read at all eight points of the output's own world path (the lateral: n × t with n the baked normal at the nearest baked point)
      const w = new Float32Array(PP)
      const reversed = batch.path[2 * PP * o + 2 * (PP - 1)] < batch.path[2 * PP * o] && b.handStart[i] === 1
      for (let q = 0; q < PP; q++) {
        const k = reversed ? PP - 1 - q : q
        const k0 = Math.max(0, k - 1)
        const k1 = Math.min(PP - 1, k + 1)
        const wp = batch.worldPath
        const t = [0, 1, 2].map((c) => wp[3 * PP * o + 3 * k1 + c] - wp[3 * PP * o + 3 * k0 + c])
        // the normal there: the anchor's (a sphere's normal turns slowly over a stroke): use the position on the sphere (unit radius) for the sphere's marks
        const p = [wp[3 * PP * o + 3 * k], wp[3 * PP * o + 3 * k + 1], wp[3 * PP * o + 3 * k + 2]]
        const n = b.mark[i] === 0 ? p.map((c) => c / Math.hypot(p[0], p[1], p[2])) : [0, 0, 1]
        const lat = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]]
        const ll = Math.hypot(lat[0], lat[1], lat[2])
        const m = fc.vp
        const wv = Math.max(1e-9, m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15])
        const lx = (view.width / 2) * (m[0] * lat[0] + m[4] * lat[1] + m[8] * lat[2]) / ll / wv
        const ly = (view.height / 2) * (m[1] * lat[0] + m[5] * lat[1] + m[9] * lat[2]) / ll / wv
        w[q] = Math.max(0.35, sizedWidth(b.basePx[2 * i + 1], big) * pressure(q / (PP - 1)) * (ll > 0 ? Math.hypot(lx, ly) / ppu : 0))
      }
      reshapeWidths(w, big)
      for (let q = 0; q < PP; q++) errs.push(Math.abs(batch.width[PP * o + q] - w[q]) / Math.max(w[q], 0.35))
    }
    errs.sort((x, y) => x - y)
    if (process.env.FRAME_PRINT) console.log(`width, four foreshortening nodes against every point: ${errs.length} widths, median ${errs[Math.floor(0.5 * errs.length)].toFixed(5)}, 95th percentile ${errs[Math.floor(0.95 * errs.length)].toFixed(5)}, 99th ${errs[Math.floor(0.99 * errs.length)].toFixed(5)}, max ${errs[errs.length - 1].toFixed(4)}`)
    expect(errs.length).toBeGreaterThan(1000)
    // (the reading has its own error: the sphere's normal is the radius, the mesh's own is the facet's)
    expect(errs[Math.floor(0.95 * errs.length)]).toBeLessThan(0.05)
  })
})

// the unused imports of a half-built suite are kept out of the build
void DEFAULT_PAINT_PARAMS
void VEIL_ALPHA
void P
void graphMesh
