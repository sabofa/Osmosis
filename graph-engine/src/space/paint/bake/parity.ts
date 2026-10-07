// Parity of the baked painting's frame with the per-frame model's (the baked painting, spec §14; plan Task 4): the same scene, the same particles, the
// same view and light, run through both, at the AUTHORED view (the view the bake composes for), and measured.
//
// The scene is the value-final fixture's (model/valueFinalFixture.ts: a sphere on a table with a ring of line round it, the analytic G-buffer with the
// sphere's cast shadow on the table, as the model's own tests build it). The per-frame model is `paintFrame`'s own pieces (the strokes of the roles that lie
// on a surface, the edge strokes and the lines: `made`), its underpainting `underpaintImage`; the baked side is `bakePainting` with `authored` set to the
// view and `frameFromBake` with the same G-buffer (it reads it only for the silhouettes' outside).
//
// THE METRICS (spec §14 accepts look differences from the world's planes: these are measured, and the test holds only gross bounds):
//   roleAgreement   over the particles drawn by both (a stroke of a surface role in each frame), the share whose SET of roles is the same;
//   strokeDeltaE    the mean OKLab distance between the two colours of every (particle, role) pair drawn by both;
//   countRatio      the baked frame's strokes over the model's (and by role); the baked frame draws every stroke that faces the eye and leaves what is behind a
//                   surface to the renderer's depth test, so its surface strokes are also counted as the model's visibility rule counts them (visibleRatio:
//                   the G-buffer shows the stroke's mark at its place, within the model's own depth tolerance);
//   underpaint      the mean OKLab distance between the model's underpainting and the baked surfaces' colours rasterised into the same G-buffer's pixels,
//                   over the pixels both cover with the same mark.

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { resolvePaintParams } from '../params'
import { linearToOklab, lchToLab } from '../model/colour'
import { buildUnderpaintField, underpaintImage } from '../model/underpaint'
import { paintFrame } from '../model/index'
import { buildParticles } from '../model/particles'
import { flatColours } from '../model/testing'
import { CANVAS, made, SCENE } from '../model/valueFinalFixture'
import { gIndex, makeFrameCtx, project, pxPerUnit } from '../model/view'
import { ROLES, type GBuffer, type Oklab, type PaintView, type ParticleSet, type Role, type SceneColours, type StrokeBatch } from '../types'
import { bakePainting } from './index'
import { frameFromBakeWith, FrameScratch } from './frame'
import { NO_PARTICLE } from './draft'
import type { AuthoredFraming, BakedPainting } from './types'

const SURFACE_ROLES: readonly Role[] = ['block', 'form', 'scumble', 'glaze', 'reflected']

export interface ParityOptions {
  // The camera's turntable azimuth and elevation (degrees), the light fixed in the world (azimuth, elevation) and the view's size [width, height, CSS px a world unit].
  azimuth?: number
  elevation?: number
  light?: readonly [number, number]
  size?: readonly number[]
  params?: PaintParams
  local?: Oklab
}

export interface RoleCount {
  model: number
  baked: number
}

export interface ParityResult {
  // The particles with a stroke of a surface role in either frame, in both, and the share of the latter with the same set of roles.
  particlesEither: number
  particlesBoth: number
  roleAgreement: number
  // The (particle, role) pairs drawn by both, and the mean OKLab distance of their colours (overall, and by role).
  pairs: number
  strokeDeltaE: number
  strokeDeltaEByRole: Partial<Record<Role, number>>
  // The strokes of each frame: all, of the surface roles, by role.
  modelStrokes: number
  bakedStrokes: number
  countRatio: number
  surfaceRatio: number
  // The baked frame's surface strokes that the G-buffer shows (the model's rule), and their number over the model's surface strokes.
  bakedVisible: number
  visibleRatio: number
  byRole: Record<Role, RoleCount>
  // The (particle, role) pairs of the surface roles by role: in the model's frame, in the baked frame (all, and the ones the G-buffer shows), and in both.
  pairsByRole: Record<string, { model: number; baked: number; bakedVisible: number; both: number }>
  // The underpainting: the pixels both cover (same mark), the mean OKLab distance, and the pixels only one covers.
  underpaintPixels: number
  underpaintDeltaE: number
  underpaintOnlyModel: number
  underpaintOnlyBaked: number
  underpaintDeltaEByMark: Record<number, number>
}

const LINE_COLOUR = lchToLab(0.4, 0.05, 55)

const deltaE = (a: Oklab, b: Oklab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const colourAt = (b: StrokeBatch, i: number): Oklab => linearToOklab(b.colour[3 * i], b.colour[3 * i + 1], b.colour[3 * i + 2])

// ---- the baked surfaces' underpainting, rasterised ----

export interface UnderRaster {
  // Linear sRGB, 3 per G-buffer pixel, NaN where the nearest surface is not underpainted (or none is drawn).
  colour: Float32Array
  mark: Int32Array
}

// The underpainting of the baked surfaces as seen from `view`, at the G-buffer's resolution (software rasteriser: model/testing.ts meshGBuffer's): every
// refined triangle of every surface, the nearest wins, the colour (and alpha) of the side that faces the eye interpolated with perspective-correct weights.
export function rasteriseUnder(baked: BakedPainting, view: PaintView, width: number, height: number, scale: number): UnderRaster {
  const n = width * height
  const colour = new Float32Array(3 * n).fill(Number.NaN)
  const mark = new Int32Array(n).fill(-1)
  const depth = new Float32Array(n).fill(Number.POSITIVE_INFINITY)
  const m = view.viewProj
  const ortho = m[3] === 0 && m[7] === 0 && m[11] === 0
  baked.surfaces.forEach((s, mi) => {
    if (!s) return
    const nv = s.positions.length / 3
    const sx = new Float64Array(nv)
    const sy = new Float64Array(nv)
    const sw = new Float64Array(nv)
    const sd = new Float64Array(nv)
    for (let i = 0; i < nv; i++) {
      const x = s.positions[3 * i], y = s.positions[3 * i + 1], z = s.positions[3 * i + 2]
      const w = m[3] * x + m[7] * y + m[11] * z + m[15]
      sw[i] = w
      sx[i] = ((((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) + 1) / 2) * view.width
      sy[i] = ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) / 2) * view.height
      sd[i] = (x - view.eye[0]) * view.viewDir[0] + (y - view.eye[1]) * view.viewDir[1] + (z - view.eye[2]) * view.viewDir[2]
    }
    for (let t = 0; t + 2 < s.indices.length; t += 3) {
      const a = s.indices[t], b = s.indices[t + 1], c = s.indices[t + 2]
      if (sw[a] <= 0 || sw[b] <= 0 || sw[c] <= 0) continue
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
      if (Math.abs(area) < 1e-12) continue
      // the side that faces the eye: a closed mesh's outside; an open one's by the triangle's own facing (the vertex normals are side +1's)
      let back = false
      if (!s.closed && s.underBack) {
        const nx = s.normals[3 * a] + s.normals[3 * b] + s.normals[3 * c]
        const ny = s.normals[3 * a + 1] + s.normals[3 * b + 1] + s.normals[3 * c + 1]
        const nz = s.normals[3 * a + 2] + s.normals[3 * b + 2] + s.normals[3 * c + 2]
        const cx = (s.positions[3 * a] + s.positions[3 * b] + s.positions[3 * c]) / 3
        const cy = (s.positions[3 * a + 1] + s.positions[3 * b + 1] + s.positions[3 * c + 1]) / 3
        const cz = (s.positions[3 * a + 2] + s.positions[3 * b + 2] + s.positions[3 * c + 2]) / 3
        const e = ortho ? [-view.viewDir[0], -view.viewDir[1], -view.viewDir[2]] : [view.eye[0] - cx, view.eye[1] - cy, view.eye[2] - cz]
        back = nx * e[0] + ny * e[1] + nz * e[2] < 0
      }
      const under = back && s.underBack ? s.underBack : s.underFront
      const alpha = back && s.alphaBack ? s.alphaBack : s.alphaFront
      const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c]) / scale - 1))
      const maxX = Math.min(width - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c]) / scale + 1))
      const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c]) / scale - 1))
      const maxY = Math.min(height - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c]) / scale + 1))
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          const px = (gx + 0.5) * scale
          const py = (gy + 0.5) * scale
          const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area
          const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area
          const w2 = 1 - w0 - w1
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
          const q0 = w0 / sw[a], q1 = w1 / sw[b], q2 = w2 / sw[c]
          const qs = q0 + q1 + q2
          const p0 = q0 / qs, p1 = q1 / qs, p2 = q2 / qs
          const d = p0 * sd[a] + p1 * sd[b] + p2 * sd[c]
          const i = gy * width + gx
          if (d >= depth[i]) continue
          depth[i] = d
          mark[i] = mi
          const al = p0 * alpha[a] + p1 * alpha[b] + p2 * alpha[c]
          if (al > 0.5) {
            for (let k = 0; k < 3; k++) colour[3 * i + k] = p0 * under[3 * a + k] + p1 * under[3 * b + k] + p2 * under[3 * c + k]
          } else for (let k = 0; k < 3; k++) colour[3 * i + k] = Number.NaN
        }
      }
    }
  })
  return { colour, mark }
}

// ---- the comparison ----

export function parityAtAuthored(opts: ParityOptions = {}): ParityResult {
  const params = opts.params ?? resolvePaintParams({ seed: 1 })
  const local = opts.local ?? lchToLab(0.56, 0.14, 38)
  const size = opts.size ?? [640, 480, 120]
  const m = made(params, local, { azimuth: opts.azimuth ?? 20, elevation: opts.elevation ?? 25, light: opts.light ?? [-35, 39] }, true, size)
  const { an, batch: model, g, view } = m
  const set = an.set
  // the particles' colours as the model had them (the fixture puts the sphere's own colour on its particles): the bake's colours are these
  const colours = flatColours({ 0: local, 1: CANVAS, 2: LINE_COLOUR })
  const authored: AuthoredFraming = { eye: [...view.eye], viewDir: [...view.viewDir], ortho: view.viewProj[3] === 0 && view.viewProj[7] === 0 && view.viewProj[11] === 0, worldPerPx: 1 / size[2] }
  const baked = bakePainting(SCENE, set, colours, view.lightDir, params, authored)
  const scr = new FrameScratch()
  const frame = frameFromBakeWith(scr, baked, SCENE, view, params, g)
  // the model's underpainting
  const under = underpaintImage(buildUnderpaintField(an, g), params, an.env)
  return compareFrames({ scene: SCENE, set, baked, frame, scr, model, modelSeed: (i) => an.drafts[i].seed, view, g, params, under })
}

// What the two frames of a scene are compared from.
interface Compared {
  scene: SpaceScene
  set: ParticleSet
  baked: BakedPainting
  frame: StrokeBatch
  scr: FrameScratch
  model: StrokeBatch
  // The seed of the particle that made the model's stroke i.
  modelSeed: (i: number) => number
  view: PaintView
  g: GBuffer
  params: PaintParams
  // The model's underpainting.
  under: Float32Array
}

// The parity of any scene: its particles, the model's frame (paintFrame, whole: the veils and the open sheets too) and the baked painting's, from the
// same view and G-buffer. `zoom` is the CSS px a world unit is across at the authored view.
export interface SceneParityOptions {
  scene: SpaceScene
  colours: SceneColours
  view: PaintView
  gbuffer: GBuffer
  zoom: number
  params?: PaintParams
}

export function parityOfScene(o: SceneParityOptions): ParityResult {
  const params = o.params ?? resolvePaintParams({ seed: 1 })
  const view = o.view
  const set = buildParticles(o.scene, o.colours, params)
  const authored: AuthoredFraming = { eye: [...view.eye], viewDir: [...view.viewDir], ortho: view.viewProj[3] === 0 && view.viewProj[7] === 0 && view.viewProj[11] === 0, worldPerPx: 1 / o.zoom }
  const baked = bakePainting(o.scene, set, o.colours, view.lightDir, params, authored)
  const scr = new FrameScratch()
  const frame = frameFromBakeWith(scr, baked, o.scene, view, params, o.gbuffer)
  const pf = paintFrame(o.scene, set, view, o.gbuffer, params)
  return compareFrames({ scene: o.scene, set, baked, frame, scr, model: pf.strokes, modelSeed: (i) => pf.strokes.seed[i], view, g: o.gbuffer, params, under: pf.underpaint })
}

function compareFrames(c: Compared): ParityResult {
  const { scene, set, baked, frame, scr, model, view, g, params, under } = c

  // ---- the strokes ----
  const bySeed = new Map<number, number>()
  const dup = new Set<number>()
  for (let i = 0; i < set.count; i++) {
    if (bySeed.has(set.seed[i])) dup.add(set.seed[i])
    bySeed.set(set.seed[i], i)
  }
  const key = (particle: number, role: number): number => particle * ROLES.length + role
  const modelPairs = new Map<number, number>() // (particle, role) -> index in the model's batch
  for (let i = 0; i < model.count; i++) {
    const role = ROLES[model.role[i]]
    if (!SURFACE_ROLES.includes(role)) continue
    const seed = c.modelSeed(i)
    const p = bySeed.get(seed)
    if (p === undefined || dup.has(seed)) continue
    modelPairs.set(key(p, model.role[i]), i)
  }
  const bakedPairs = new Map<number, number>()
  for (let o = 0; o < frame.count; o++) {
    const i = scr.source[o]
    if (i < 0 || baked.particle[i] === NO_PARTICLE) continue
    const role = ROLES[frame.role[o]]
    if (!SURFACE_ROLES.includes(role)) continue
    bakedPairs.set(key(baked.particle[i], frame.role[o]), o)
  }
  // the roles of each particle, in each frame
  const rolesOf = (pairs: Map<number, number>): Map<number, number> => {
    const out = new Map<number, number>()
    for (const k of pairs.keys()) {
      const p = Math.floor(k / ROLES.length)
      out.set(p, (out.get(p) ?? 0) | (1 << (k % ROLES.length)))
    }
    return out
  }
  const modelRoles = rolesOf(modelPairs)
  const bakedRoles = rolesOf(bakedPairs)
  let both = 0
  let same = 0
  for (const [p, mask] of modelRoles) {
    const other = bakedRoles.get(p)
    if (other === undefined) continue
    both++
    if (other === mask) same++
  }
  const either = new Set([...modelRoles.keys(), ...bakedRoles.keys()]).size
  let pairs = 0
  let sum = 0
  const roleSum: Partial<Record<Role, { n: number; s: number }>> = {}
  for (const [k, i] of modelPairs) {
    const o = bakedPairs.get(k)
    if (o === undefined) continue
    const d = deltaE(colourAt(model, i), colourAt(frame, o))
    pairs++
    sum += d
    const role = ROLES[k % ROLES.length]
    const r = (roleSum[role] ??= { n: 0, s: 0 })
    r.n++
    r.s += d
  }
  const pairsByRole: ParityResult['pairsByRole'] = Object.fromEntries(SURFACE_ROLES.map((r) => [r, { model: 0, baked: 0, bakedVisible: 0, both: 0 }]))
  for (const k of modelPairs.keys()) pairsByRole[ROLES[k % ROLES.length]].model++
  for (const k of bakedPairs.keys()) {
    const r = pairsByRole[ROLES[k % ROLES.length]]
    r.baked++
    if (modelPairs.has(k)) r.both++
  }
  const byRole = Object.fromEntries(ROLES.map((r) => [r, { model: 0, baked: 0 }])) as Record<Role, RoleCount>
  for (let i = 0; i < model.count; i++) byRole[ROLES[model.role[i]]].model++
  for (let o = 0; o < frame.count; o++) byRole[ROLES[frame.role[o]]].baked++
  const surfaceModel = SURFACE_ROLES.reduce((s, r) => s + byRole[r].model, 0)
  const surfaceBaked = SURFACE_ROLES.reduce((s, r) => s + byRole[r].baked, 0)
  // the baked surface strokes the G-buffer shows: its mark at the stroke's place, within the model's depth tolerance (view.ts visibleParticles)
  let visible = 0
  {
    const fc = makeFrameCtx(scene, view, g, params)
    const out = [0, 0, 0]
    for (let o = 0; o < frame.count; o++) {
      const i = scr.source[o]
      if (i < 0 || !SURFACE_ROLES.includes(ROLES[frame.role[o]])) continue
      const a = (3 * 8 * o)
      const x = (frame.worldPath[a + 9] + frame.worldPath[a + 12]) / 2
      const y = (frame.worldPath[a + 10] + frame.worldPath[a + 13]) / 2
      const z = (frame.worldPath[a + 11] + frame.worldPath[a + 14]) / 2
      if (!project(fc, x, y, z, out)) continue
      const gi = gIndex(fc, out[0], out[1])
      if (gi < 0) continue
      const facing = Math.max(0.1, Math.abs(frame.worldNormal[3 * o] * -view.viewDir[0] + frame.worldNormal[3 * o + 1] * -view.viewDir[1] + frame.worldNormal[3 * o + 2] * -view.viewDir[2]))
      const slope = Math.sqrt(Math.max(0, 1 - facing * facing)) / facing
      const eps = (g.scale / pxPerUnit(fc, x, y, z)) * (1.5 + 1.5 * slope)
      if (g.mark[gi] === baked.mark[i] && Math.abs(g.depth[gi] - out[2]) <= eps) {
        visible++
        pairsByRole[ROLES[frame.role[o]]].bakedVisible++
      }
    }
  }

  // ---- the underpainting ----
  const raster = rasteriseUnder(baked, view, g.width, g.height, g.scale)
  let px = 0
  let usum = 0
  let onlyModel = 0
  let onlyBaked = 0
  const markSum: Record<number, { n: number; s: number }> = {}
  for (let i = 0; i < g.width * g.height; i++) {
    if (g.mark[i] < 0) continue
    const have = !Number.isNaN(under[3 * i])
    const mine = raster.mark[i] === g.mark[i] && !Number.isNaN(raster.colour[3 * i])
    if (have && mine) {
      const d = deltaE(linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2]), linearToOklab(raster.colour[3 * i], raster.colour[3 * i + 1], raster.colour[3 * i + 2]))
      px++
      usum += d
      const r = (markSum[g.mark[i]] ??= { n: 0, s: 0 })
      r.n++
      r.s += d
    } else if (have) onlyModel++
    else if (mine) onlyBaked++
  }
  return {
    particlesEither: either,
    particlesBoth: both,
    roleAgreement: both > 0 ? same / both : 0,
    pairs,
    strokeDeltaE: pairs > 0 ? sum / pairs : 0,
    strokeDeltaEByRole: Object.fromEntries(Object.entries(roleSum).map(([r, v]) => [r, (v as { n: number; s: number }).s / (v as { n: number; s: number }).n])) as Partial<Record<Role, number>>,
    modelStrokes: model.count,
    bakedStrokes: frame.count,
    countRatio: frame.count / Math.max(1, model.count),
    surfaceRatio: surfaceBaked / Math.max(1, surfaceModel),
    bakedVisible: visible,
    visibleRatio: visible / Math.max(1, surfaceModel),
    byRole,
    pairsByRole,
    underpaintPixels: px,
    underpaintDeltaE: px > 0 ? usum / px : 0,
    underpaintOnlyModel: onlyModel,
    underpaintOnlyBaked: onlyBaked,
    underpaintDeltaEByMark: Object.fromEntries(Object.entries(markSum).map(([k, v]) => [Number(k), (v as { n: number; s: number }).s / (v as { n: number; s: number }).n])),
  }
}

// The G-buffer the parity harness reads, for a test that wants to look at the pixels itself.
export type { GBuffer }
