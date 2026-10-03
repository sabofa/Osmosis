// The silhouettes of a baked frame (the baked painting, spec §3.6 and §14; plan Task 4): the outline of each opaque figure in THIS view, which is
// view-dependent by nature and so cannot be baked, built as the baked edge strokes are (bake/edgeStrokes.ts: crisp, drag, pulls and bridges by the
// class of the outline), from the bake's per-vertex facts and with no G-buffer.
//
// THE OUTLINE. model/contours.ts silhouettePolylines: the zero crossings of n·toEye over the figure's own mesh, chained, each point ON a triangle
// edge. Each polyline is projected, cut where it turns sharply on the screen (35 degrees, as the model's splitAtCorners) and resampled every 2 CSS px
// of screen arc length (so the world step is 2 / ppu), each sample a point on the 3D polyline. A piece under 8 samples (16 px) makes no stroke.
//
// THE SIDES. A sample's inside is the figure's: its value uA and local colour are the baked ones (BakedSurface.uFront, uBack, local) at the
// nearest refined vertex, found through a spatial hash per surface (cached by the surface's own positions array, which a recolour shares), on the
// side that faces the eye (a closed mesh: side +1, its outside; an open one: the side the mesh is mostly seen from). The lowest value on the way in
// (the model's uAmin: at a limb the normal turns fast, so a vertex a few px in can be lit where the outline itself is already in the shadow) is the
// lowest u among the eye-facing vertices within PROBE_PX of the sample. The outside is the canvas (uB = the canvas value), or, where a G-buffer is
// given and the pixel PROBE_PX outside the outline holds another mark, that pixel's raw value through the lighting and value curves (the G-buffer
// may be a frame old: it is only ever read there). The screen's inward normal is against the side's own normal projected on the screen: at a limb a
// surface normal points out of the figure.
//
// THE SCORE is the model's silhouette hardness (model/edges.ts edgeHardness, kind 1): c the contrast of the two sides, k 0.55, f the focal
// emphasis about the AUTHORED focal points (BakedPainting.focal), s the light side, d 0, the world-position noise, lost under a contrast of 0.03,
// and the outline of a form in shadow against light a found edge at least; then the class and the median of 7. The strokes of a stretch and their
// colours are the bake's (edgeStrokes.ts), the colours made here with the model's own recipe functions and the sequential brush-load mix along the
// outline, held to the shadow family's ceiling where the stretch is the outline of a form in shadow.
//
// VIEW STABILITY. Every seed comes from the position of a sample (the hash of its world position at 1/7 of a unit), never from its place in a run,
// so a turn of the view does not reseed what has not moved.
//
// WHAT IS DIFFERENT FROM THE PER-FRAME MODEL'S: the inside is read at the outline, not 3 px in (the baked value at the nearest vertex, and the
// lowest within PROBE_PX for the family test); the outside is the canvas unless a G-buffer says otherwise (hidden parts are the renderer's depth test's,
// not clipped here); the colour of the figure's side is the local colour at the vertex (the model's: the mean of the mark's visible particles').

import { randomFor } from '../../../style/random'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type GBuffer, type Oklab, type PaintView } from '../types'
import { holdLightness, oklabToLinear } from '../model/colour'
import { groundRecipe, segmentRun, silhouettePolylines, sideRecipeOf } from '../model/contours'
import { behaviourOf, edgeClassOf, edgeHardness, edgeNoiseSeed, EDGE_NOISE_FREQ, type EdgeTerms } from '../model/edges'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { clamp, hash3, smooth, valueNoise3 } from '../model/math'
import { LoadMixer } from '../model/mix'
import { colourOfDraft, colourOfRecipe, lightnessAtValue, type ColourRecipe, type ColourSource, type DraftColour, type RecipeEnv } from '../model/recipe'
import { compileCurves, type CompiledCurves } from '../model/respond'
import { polylinePath } from '../model/strokes'
import { canvasValue, effectiveValues } from '../model/value'
import { pxPerUnit, toEye, type FrameCtx } from '../model/view'
import { StrokeList } from './strokeList'
import { HIDDEN_NA, type BakedPainting, type BakedSurface } from './types'

const P = PATH_POINTS
// Samples every this many CSS px of screen arc length.
export const SILHOUETTE_STEP_PX = 2
// A piece with fewer samples than this makes no stroke (16 px).
export const SILHOUETTE_MIN_SAMPLES = 8
// How far in from the outline the lowest value of the figure's side is looked for, and how far out the G-buffer is probed, CSS px.
export const SILHOUETTE_PROBE_PX = 3
// A turn of the screen outline over this ends a piece.
const CORNER_COS = Math.cos((35 * Math.PI) / 180)
const R_EDGE = ROLES.indexOf('edge')
const EDGE_LAYER = LAYER_ORDER.indexOf('edge')
// A stretch of this many samples or fewer (b - a under it) makes no stroke.
const MIN_STRETCH = 6

// ---- the nearest refined vertex of a surface ----

// A grid over the vertices of a surface (a hash of the cell of each, in CSR form). Its cell is the longest edge of the surface's triangles, so the
// nearest vertex of any point ON the surface is within one cell of it (the vertices of the triangle the point is in are).
export class VertexGrid {
  readonly positions: Float32Array
  readonly cell: number
  private readonly inv: number
  private readonly mask: number
  private readonly start: Int32Array
  private readonly items: Int32Array
  private readonly ox: number
  private readonly oy: number
  private readonly oz: number

  constructor(positions: Float32Array, indices: Uint32Array) {
    this.positions = positions
    const nv = positions.length / 3
    let x0 = Infinity, y0 = Infinity, z0 = Infinity
    for (let v = 0; v < nv; v++) {
      x0 = Math.min(x0, positions[3 * v])
      y0 = Math.min(y0, positions[3 * v + 1])
      z0 = Math.min(z0, positions[3 * v + 2])
    }
    if (nv === 0) x0 = y0 = z0 = 0
    this.ox = x0
    this.oy = y0
    this.oz = z0
    let longest = 0
    for (let t = 0; t + 2 < indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = indices[t + k], b = indices[t + (k + 1) % 3]
        longest = Math.max(longest, Math.hypot(positions[3 * a] - positions[3 * b], positions[3 * a + 1] - positions[3 * b + 1], positions[3 * a + 2] - positions[3 * b + 2]))
      }
    }
    this.cell = Math.max(longest, 1e-9)
    this.inv = 1 / this.cell
    let size = 1
    while (size < 2 * nv) size *= 2
    this.mask = size - 1
    const count = new Int32Array(size + 1)
    const cellOf = new Int32Array(nv)
    for (let v = 0; v < nv; v++) {
      const c = this.hash(Math.floor((positions[3 * v] - x0) * this.inv), Math.floor((positions[3 * v + 1] - y0) * this.inv), Math.floor((positions[3 * v + 2] - z0) * this.inv))
      cellOf[v] = c
      count[c + 1]++
    }
    for (let c = 0; c < size; c++) count[c + 1] += count[c]
    this.start = count
    const cursor = count.slice(0, size)
    this.items = new Int32Array(nv)
    for (let v = 0; v < nv; v++) this.items[cursor[cellOf[v]]++] = v
  }

  private hash(ix: number, iy: number, iz: number): number {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & this.mask
  }

  // The vertex nearest the point, searched in the cells within one cell of its own and, where there is none, within two and three; -1 when there is none.
  nearest(x: number, y: number, z: number): number {
    const p = this.positions
    const cx = Math.floor((x - this.ox) * this.inv)
    const cy = Math.floor((y - this.oy) * this.inv)
    const cz = Math.floor((z - this.oz) * this.inv)
    for (let rings = 1; rings <= 3; rings++) {
      let best = -1
      let bestD2 = Infinity
      for (let dz = -rings; dz <= rings; dz++) {
        for (let dy = -rings; dy <= rings; dy++) {
          for (let dx = -rings; dx <= rings; dx++) {
            const c = this.hash(cx + dx, cy + dy, cz + dz)
            for (let k = this.start[c]; k < this.start[c + 1]; k++) {
              const v = this.items[k]
              const ex = p[3 * v] - x, ey = p[3 * v + 1] - y, ez = p[3 * v + 2] - z
              const d2 = ex * ex + ey * ey + ez * ez
              if (d2 < bestD2) {
                bestD2 = d2
                best = v
              }
            }
          }
        }
      }
      if (best >= 0) return best
    }
    return -1
  }
}

// A surface's vertex index: the grid that finds a vertex near a point, and the graph of the triangles' edges that walks from one vertex to the one
// nearest the next sample of an outline (consecutive samples are 2 px apart, so the walk is a few steps).
export class SurfaceIndex {
  readonly grid: VertexGrid
  // The neighbours of vertex v: nbr[start[v]..start[v + 1]) (an edge shared by two triangles is listed twice).
  readonly start: Int32Array
  readonly nbr: Int32Array

  constructor(s: BakedSurface) {
    this.grid = new VertexGrid(s.positions, s.indices)
    const nv = s.positions.length / 3
    const idx = s.indices
    // the copies of one position (a seam of a lattice, a pole) are not joined by an edge: link each to the next copy, in a ring, so that a walk crosses the seam
    const ring = new Int32Array(nv).fill(-1)
    {
      const first = new Map<string, number>()
      const last = new Map<string, number>()
      for (let v = 0; v < nv; v++) {
        // (positions that agree to 1e-5, as the surface's own canonical vertices: a seam's copies differ in the last digits)
        const key = `${Math.round(s.positions[3 * v] * 1e5)},${Math.round(s.positions[3 * v + 1] * 1e5)},${Math.round(s.positions[3 * v + 2] * 1e5)}`
        const head = first.get(key)
        if (head === undefined) first.set(key, v)
        else ring[last.get(key) ?? head] = v
        if (head !== undefined) last.set(key, v)
      }
      // close each ring: the last copy points to the first
      for (const [key, tail] of last) ring[tail] = first.get(key) as number
    }
    const count = new Int32Array(nv + 1)
    for (let t = 0; t + 2 < idx.length; t += 3) {
      count[idx[t] + 1] += 2
      count[idx[t + 1] + 1] += 2
      count[idx[t + 2] + 1] += 2
    }
    for (let v = 0; v < nv; v++) if (ring[v] >= 0) count[v + 1]++
    for (let v = 0; v < nv; v++) count[v + 1] += count[v]
    this.start = count
    const cursor = count.slice(0, nv)
    this.nbr = new Int32Array(count[nv])
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2]
      this.nbr[cursor[a]++] = b
      this.nbr[cursor[a]++] = c
      this.nbr[cursor[b]++] = a
      this.nbr[cursor[b]++] = c
      this.nbr[cursor[c]++] = a
      this.nbr[cursor[c]++] = b
    }
    for (let v = 0; v < nv; v++) if (ring[v] >= 0) this.nbr[cursor[v]++] = ring[v]
  }

  // The vertex nearest (x, y, z): by walking down the distance from `from` (a vertex near it; -1: look for one in the grid) over the edges.
  nearest(positions: Float32Array, x: number, y: number, z: number, from: number): number {
    let cur = from >= 0 ? from : this.grid.nearest(x, y, z)
    if (cur < 0) return -1
    let ex = positions[3 * cur] - x, ey = positions[3 * cur + 1] - y, ez = positions[3 * cur + 2] - z
    let best = ex * ex + ey * ey + ez * ez
    for (;;) {
      let next = -1
      for (let k = this.start[cur]; k < this.start[cur + 1]; k++) {
        const v = this.nbr[k]
        ex = positions[3 * v] - x
        ey = positions[3 * v + 1] - y
        ez = positions[3 * v + 2] - z
        const d2 = ex * ex + ey * ey + ez * ez
        if (d2 < best) {
          best = d2
          next = v
        }
      }
      if (next < 0) {
        // no neighbour is nearer: look one ring further (the vertex across the other diagonal of a quad is not a neighbour, and is the nearest as often)
        for (let k = this.start[cur]; k < this.start[cur + 1]; k++) {
          const u = this.nbr[k]
          for (let j = this.start[u]; j < this.start[u + 1]; j++) {
            const v = this.nbr[j]
            ex = positions[3 * v] - x
            ey = positions[3 * v + 1] - y
            ez = positions[3 * v + 2] - z
            const d2 = ex * ex + ey * ey + ez * ez
            if (d2 < best) {
              best = d2
              next = v
            }
          }
        }
        if (next < 0) return cur
      }
      cur = next
    }
  }
}

const indexes = new WeakMap<Float32Array, SurfaceIndex>()
export function indexOf(s: BakedSurface): SurfaceIndex {
  let g = indexes.get(s.positions)
  if (!g) {
    g = new SurfaceIndex(s)
    indexes.set(s.positions, g)
  }
  return g
}

// ---- the world's focal emphasis ----

// f: the larger of exp(-(d/R)²) about the mark's two focal points (BakedPainting.focal; NaN where it has fewer).
export function focalAt(focal: Float64Array, mark: number, x: number, y: number, z: number): number {
  let f = 0
  for (let k = 0; k < 2; k++) {
    const fx = focal[8 * mark + 4 * k]
    if (Number.isNaN(fx)) continue
    const R = focal[8 * mark + 4 * k + 3]
    if (!(R > 0)) continue
    const d = Math.hypot(x - fx, y - focal[8 * mark + 4 * k + 1], z - focal[8 * mark + 4 * k + 2])
    f = Math.max(f, Math.exp(-((d / R) ** 2)))
  }
  return f
}

// ---- what a frame's silhouettes read of the parameters, once ----

export interface SilhouetteEnv {
  env: RecipeEnv
  capU: number
  floorU: number
  uCanvas: number
  curves: CompiledCurves
}

export function silhouetteEnv(params: PaintParams): SilhouetteEnv {
  const curve = curveFor(params)
  const curves = compileCurves(params)
  const ev = effectiveValues(params)
  return { env: recipeEnv(params, curve, groundLocal(params)), capU: curves.value(ev.reflectedMax), floorU: curves.value(ev.halfLo), uCanvas: canvasValue(params), curves }
}

// ---- a run of samples ----

export interface SilhouetteRun {
  mark: number
  n: number
  // The sample's world point (on the mesh's silhouette polyline) and CSS px position, 3 and 2 per sample, and where it lies along the polyline `poly`
  // (xyz per vertex): vertex index + the fraction of the next segment, so that a stroke's points are made on the polyline itself.
  world: Float64Array
  screen: Float64Array
  poly: Float64Array
  tpos: Float64Array
  // The screen's unit normal toward the figure's inside, 2 per sample.
  nrm: Float64Array
  // The two sides' values (the figure's at the vertex, the canvas or the G-buffer's) and the lowest value on the way in; the local colour (3 per
  // sample); the world-position hash; the view depth.
  uA: Float32Array
  uB: Float32Array
  uMin: Float32Array
  local: Float32Array
  keys: Uint32Array
  depth: Float32Array
  // Hardness and its median-smoothed class; the mean |uA - uB|.
  h: Float32Array
  cls: Uint8Array
  contrast: number
}

const EYE = [0, 0, 0]

interface MarkCtx {
  baked: BakedPainting
  params: PaintParams
  gbuffer: GBuffer | null
  fc: FrameCtx
  senv: SilhouetteEnv
  noiseSeed: number
  mark: number
  surface: BakedSurface
  index: SurfaceIndex
  // The side the figure is seen from (+1: the side the mesh's normals point to) and its per-vertex values.
  sigma: 1 | -1
  uSide: Float32Array
  out: SilhouetteRun[]
}

// The runs of every opaque figure's silhouette in this view. `gbuffer` may be null.
export function silhouetteRuns(
  baked: BakedPainting, scene: SpaceScene, view: PaintView, params: PaintParams, gbuffer: GBuffer | null, fc: FrameCtx, senv: SilhouetteEnv,
): SilhouetteRun[] {
  const out: SilhouetteRun[] = []
  const noiseSeed = edgeNoiseSeed(params)
  let scratch = new Float64Array(0)
  scene.marks.forEach((mark, m) => {
    if (mark.kind !== 'mesh' || mark.style.opacity < 1 || fc.ground[m] === 1) return
    const surface = baked.surfaces[m]
    if (!surface) return
    const mesh = mark as MeshMark
    if (scratch.length < mesh.positions.length / 3) scratch = new Float64Array(mesh.positions.length / 3)
    const polylines = silhouettePolylines(mesh, view.eye, fc.ortho, view.viewDir, scratch)
    if (polylines.length === 0) return
    // the side the figure is seen from: a closed mesh's outside; an open one's, the side its middle faces the eye with
    let sigma: 1 | -1 = 1
    if (!surface.closed && surface.uBack) {
      const nv = surface.positions.length / 3
      const step = Math.max(1, Math.floor(nv / 64))
      let cx = 0, cy = 0, cz = 0, cnt = 0
      for (let v = 0; v < nv; v += step) {
        cx += surface.positions[3 * v]
        cy += surface.positions[3 * v + 1]
        cz += surface.positions[3 * v + 2]
        cnt++
      }
      toEye(fc, cx / cnt, cy / cnt, cz / cnt, EYE)
      let d = 0
      for (let v = 0; v < nv; v += step) d += surface.normals[3 * v] * EYE[0] + surface.normals[3 * v + 1] * EYE[1] + surface.normals[3 * v + 2] * EYE[2]
      sigma = d >= 0 ? 1 : -1
    }
    const mc: MarkCtx = {
      baked, params, gbuffer, fc, senv, noiseSeed, mark: m, surface, index: indexOf(surface), sigma, uSide: sigma === 1 ? surface.uFront : (surface.uBack as Float32Array), out,
    }
    for (const poly of polylines) polylineRuns(mc, poly)
  })
  return out
}

// One silhouette polyline: projected, cut at the points behind the eye and at its sharp corners, each piece resampled.
function polylineRuns(mc: MarkCtx, poly: Float64Array): void {
  const { fc } = mc
  const vp = fc.vp
  const { W, H } = fc
  const n = poly.length / 3
  if (n < 2) return
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const ok = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const x = poly[3 * i], y = poly[3 * i + 1], z = poly[3 * i + 2]
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
    if (w <= 1e-9) continue
    ok[i] = 1
    px[i] = (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w + 1) / 2) * W
    py[i] = ((1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) / 2) * H
  }
  let i = 0
  while (i < n) {
    if (!ok[i]) {
      i++
      continue
    }
    let j = i
    while (j + 1 < n && ok[j + 1]) j++
    // the run i..j, cut at its sharp corners
    let a = i
    for (let c = i + 1; c < j; c++) {
      const ax = px[c] - px[c - 1], ay = py[c] - py[c - 1]
      const bx = px[c + 1] - px[c], by = py[c + 1] - py[c]
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
      if (la < 1e-9 || lb < 1e-9) continue
      if ((ax * bx + ay * by) / (la * lb) < CORNER_COS) {
        pieceRun(mc, poly, px, py, a, c)
        a = c
      }
    }
    pieceRun(mc, poly, px, py, a, j)
    i = j + 1
  }
}

// One piece (vertices a..b of one polyline): resampled every SILHOUETTE_STEP_PX of screen arc length, each sample read against the surface.
function pieceRun(mc: MarkCtx, poly: Float64Array, px: Float64Array, py: Float64Array, a: number, b: number): void {
  if (b - a < 1) return
  let total = 0
  for (let v = a + 1; v <= b; v++) total += Math.hypot(px[v] - px[v - 1], py[v] - py[v - 1])
  if (!(total > 0)) return
  const cap = Math.floor(total / SILHOUETTE_STEP_PX) + 2
  const sx = new Float64Array(cap)
  const sy = new Float64Array(cap)
  const wxyz = new Float64Array(3 * cap)
  const tp = new Float64Array(cap)
  let n = 0
  const put = (v: number, f: number): void => {
    tp[n] = v - 1 + f
    sx[n] = px[v - 1] + (px[v] - px[v - 1]) * f
    sy[n] = py[v - 1] + (py[v] - py[v - 1]) * f
    for (let c = 0; c < 3; c++) wxyz[3 * n + c] = poly[3 * (v - 1) + c] + (poly[3 * v + c] - poly[3 * (v - 1) + c]) * f
    n++
  }
  // the first sample is the first vertex, then one every step along the arc, and the last vertex when it is far enough from the last sample
  put(a + 1, 0)
  let carry = 0
  for (let v = a + 1; v <= b; v++) {
    const d = Math.hypot(px[v] - px[v - 1], py[v] - py[v - 1])
    if (d === 0) continue
    let pos = SILHOUETTE_STEP_PX - carry
    while (pos <= d && n < cap) {
      put(v, pos / d)
      pos += SILHOUETTE_STEP_PX
    }
    carry = d - (pos - SILHOUETTE_STEP_PX)
  }
  if (n < cap && Math.hypot(px[b] - sx[n - 1], py[b] - sy[n - 1]) > SILHOUETTE_STEP_PX * 0.3) put(b, 1)
  if (n < SILHOUETTE_MIN_SAMPLES) return

  const { fc, surface, index, sigma, uSide, gbuffer, senv } = mc
  const { W, H } = fc
  const vp = fc.vp
  const view = fc.view
  const run: SilhouetteRun = {
    mark: mc.mark, n, world: new Float64Array(3 * n), screen: new Float64Array(2 * n), poly, tpos: tp.slice(0, n), nrm: new Float64Array(2 * n), uA: new Float32Array(n), uB: new Float32Array(n),
    uMin: new Float32Array(n), local: new Float32Array(3 * n), keys: new Uint32Array(n), depth: new Float32Array(n), h: new Float32Array(n), cls: new Uint8Array(n), contrast: 0,
  }
  const lost = new Uint8Array(n)
  // "within PROBE_PX of the sample", in the world, at the piece's middle
  const mid = n >> 1
  const probeWorld = SILHOUETTE_PROBE_PX / Math.max(1e-9, pxPerUnit(fc, wxyz[3 * mid], wxyz[3 * mid + 1], wxyz[3 * mid + 2]))
  const probe2 = probeWorld * probeWorld
  const pos = surface.positions
  const nor = surface.normals
  let hint = -1
  for (let s = 0; s < n; s++) {
    const x = wxyz[3 * s], y = wxyz[3 * s + 1], z = wxyz[3 * s + 2]
    run.world[3 * s] = x
    run.world[3 * s + 1] = y
    run.world[3 * s + 2] = z
    run.screen[2 * s] = sx[s]
    run.screen[2 * s + 1] = sy[s]
    run.depth[s] = (x - view.eye[0]) * view.viewDir[0] + (y - view.eye[1]) * view.viewDir[1] + (z - view.eye[2]) * view.viewDir[2]
    // the nearest vertex (found by walking on from the last sample's), and the lowest value of the eye-facing ones within the probe: it and its neighbours
    const v = index.nearest(pos, x, y, z, hint)
    if (v < 0) {
      lost[s] = 1
      hint = -1
      continue
    }
    hint = v
    toEye(fc, x, y, z, EYE)
    let lowest = uSide[v]
    for (let k = index.start[v] - 1; k < index.start[v + 1]; k++) {
      const w = k < index.start[v] ? v : index.nbr[k]
      const dx = pos[3 * w] - x, dy = pos[3 * w + 1] - y, dz = pos[3 * w + 2] - z
      if (dx * dx + dy * dy + dz * dz <= probe2 && sigma * (nor[3 * w] * EYE[0] + nor[3 * w + 1] * EYE[1] + nor[3 * w + 2] * EYE[2]) > 0 && uSide[w] < lowest) lowest = uSide[w]
    }
    run.uA[s] = uSide[v]
    run.uMin[s] = lowest
    run.local[3 * s] = surface.local[3 * v]
    run.local[3 * s + 1] = surface.local[3 * v + 1]
    run.local[3 * s + 2] = surface.local[3 * v + 2]
    run.keys[s] = hash3(Math.round(x * 7), Math.round(y * 7), Math.round(z * 7))
    // the screen's normal: the tangent turned a quarter, to the side the figure's outside normal points away from
    const a0 = Math.max(0, s - 1), a1 = Math.min(n - 1, s + 1)
    let tx = sx[a1] - sx[a0]
    let ty = sy[a1] - sy[a0]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    let nx = -ty
    let ny = tx
    const onx = sigma * nor[3 * v], ony = sigma * nor[3 * v + 1], onz = sigma * nor[3 * v + 2]
    const oxs = (W / 2) * (vp[0] * onx + vp[4] * ony + vp[8] * onz)
    const oys = -(H / 2) * (vp[1] * onx + vp[5] * ony + vp[9] * onz)
    if (nx * oxs + ny * oys > 0) {
      nx = -nx
      ny = -ny
    }
    run.nrm[2 * s] = nx
    run.nrm[2 * s + 1] = ny
    // the outside: the canvas, or what the G-buffer holds PROBE_PX beyond the outline
    let uB = senv.uCanvas
    if (gbuffer) {
      const gx = Math.floor((sx[s] - nx * SILHOUETTE_PROBE_PX) / gbuffer.scale)
      const gy = Math.floor((sy[s] - ny * SILHOUETTE_PROBE_PX) / gbuffer.scale)
      if (gx >= 0 && gy >= 0 && gx < gbuffer.width && gy < gbuffer.height) {
        const gi = gy * gbuffer.width + gx
        const val = gbuffer.value[gi]
        if (gbuffer.mark[gi] >= 0 && gbuffer.mark[gi] !== mc.mark && val >= 0) uB = senv.curves.value(senv.curves.lightResponse(val))
      }
    }
    run.uB[s] = uB
  }
  // a sample with no vertex near ends the run: keep the longest stretch of the others
  let bestA = 0, bestN = 0, cur = 0
  for (let s = 0; s <= n; s++) {
    if (s < n && lost[s] === 0) cur++
    else {
      if (cur > bestN) {
        bestN = cur
        bestA = s - cur
      }
      cur = 0
    }
  }
  if (bestN < SILHOUETTE_MIN_SAMPLES) return
  const whole = bestN === n ? run : sliceRun(run, bestA, bestN)
  scoreRun(mc, whole)
  mc.out.push(whole)
}

function sliceRun(r: SilhouetteRun, a: number, n: number): SilhouetteRun {
  return {
    mark: r.mark, n, world: r.world.slice(3 * a, 3 * (a + n)), screen: r.screen.slice(2 * a, 2 * (a + n)), poly: r.poly, tpos: r.tpos.slice(a, a + n), nrm: r.nrm.slice(2 * a, 2 * (a + n)),
    uA: r.uA.slice(a, a + n), uB: r.uB.slice(a, a + n), uMin: r.uMin.slice(a, a + n), local: r.local.slice(3 * a, 3 * (a + n)), keys: r.keys.slice(a, a + n),
    depth: r.depth.slice(a, a + n), h: new Float32Array(n), cls: new Uint8Array(n), contrast: 0,
  }
}

// The hardness of every sample, its class (the median of 7), and the run's contrast.
function scoreRun(mc: MarkCtx, r: SilhouetteRun): void {
  const { params, baked, senv } = mc
  const ep = params.edges
  const { capU, floorU } = senv
  const raw = new Uint8Array(r.n)
  const t: EdgeTerms = { c: 0, k: 0.55, f: 0, s: 0, d: 0, x: 0 }
  let sum = 0
  for (let s = 0; s < r.n; s++) {
    const uA = r.uA[s]
    const uB = r.uB[s]
    const x = r.world[3 * s], y = r.world[3 * s + 1], z = r.world[3 * s + 2]
    const con = Math.abs(uA - uB)
    sum += con
    t.c = smooth(0.04, 0.34, con)
    t.f = focalAt(baked.focal, r.mark, x, y, z)
    t.s = smooth(0.28, 0.8, (uA + uB) / 2)
    let hh = edgeHardness('silhouette', t, params) + ep.noise * valueNoise3(x * EDGE_NOISE_FREQ, y * EDGE_NOISE_FREQ, z * EDGE_NOISE_FREQ, mc.noiseSeed)
    if (con < 0.03) hh = Math.min(hh, ep.lostBelow - 0.01)
    // the outline of a form in shadow against light is where two families meet: a FOUND edge, whatever the other terms say
    else if (r.uMin[s] <= capU && uB >= floorU) hh = Math.max(hh, ep.softBelow + 0.01)
    r.h[s] = clamp(hh, 0, 1)
    raw[s] = edgeClassOf(r.h[s], params)
  }
  medianClasses(raw, r.cls)
  r.contrast = sum / r.n
}

// The class of each sample as the median of the 7 about it (the ends repeat): model/edges.ts smoothClasses, by counting (a class is 0 to 3).
export function medianClasses(raw: Uint8Array, out: Uint8Array): void {
  const n = raw.length
  for (let i = 0; i < n; i++) {
    let c0 = 0, c1 = 0, c2 = 0
    for (let k = -3; k <= 3; k++) {
      const v = raw[i + k < 0 ? 0 : i + k > n - 1 ? n - 1 : i + k]
      if (v === 0) c0++
      else if (v === 1) c1++
      else if (v === 2) c2++
    }
    // the fourth of seven in order
    out[i] = c0 >= 4 ? 0 : c0 + c1 >= 4 ? 1 : c0 + c1 + c2 >= 4 ? 2 : 3
  }
}

// ---- the strokes ----

// The world points of a stroke along samples a..b of a run: PATH_POINTS of them at equal screen arc length (as polylinePath places its path's), each ON the
// silhouette polyline itself (the sample's place along it, interpolated), not on the chords between samples.
function alongWorld(run: SilhouetteRun, a: number, b: number, world: Float32Array): void {
  const n = b - a + 1
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(run.screen[2 * (a + i)] - run.screen[2 * (a + i - 1)], run.screen[2 * (a + i) + 1] - run.screen[2 * (a + i - 1) + 1])
  const total = cum[n - 1]
  const poly = run.poly
  const last = poly.length / 3 - 1
  for (let k = 0; k < P; k++) {
    const s = (k / (P - 1)) * total
    let seg = 1
    while (seg < n - 1 && cum[seg] < s) seg++
    const span = cum[seg] - cum[seg - 1]
    const f = span > 0 ? clamp((s - cum[seg - 1]) / span, 0, 1) : 0
    const t = run.tpos[a + seg - 1] + (run.tpos[a + seg] - run.tpos[a + seg - 1]) * f
    const v = Math.min(last - 1, Math.max(0, Math.floor(t)))
    const g = t - v
    for (let c = 0; c < 3; c++) world[3 * k + c] = poly[3 * v + c] + (poly[3 * (v + 1) + c] - poly[3 * v + c]) * g
  }
}

const meanOver = (a: ArrayLike<number>, from: number, to: number): number => {
  let s = 0
  for (let i = from; i <= to; i++) s += a[i]
  return s / (to - from + 1)
}

export interface SilhouetteStats {
  runs: number
  stretches: number
  strokes: number
  // By the class of the edge (0 lost, 1 soft, 2 firm, 3 hard), and by kind.
  byClass: number[]
  crisp: number
  drags: number
  pulls: number
  bridges: number
}

export const newSilhouetteStats = (): SilhouetteStats => ({ runs: 0, stretches: 0, strokes: 0, byClass: [0, 0, 0, 0], crisp: 0, drags: 0, pulls: 0, bridges: 0 })

// The strokes of the runs, appended to `list`: the bake's edge strokes (edgeStrokes.ts) of kind 1, built on the screen. Returns the count.
export function silhouetteStrokes(
  list: StrokeList, runs: SilhouetteRun[], params: PaintParams, view: PaintView, fc: FrameCtx, senv: SilhouetteEnv, stats?: SilhouetteStats,
): number {
  const rp = params.roles.edge
  const minContrast = params.detect.edgeMinContrast
  const { env, capU, floorU } = senv
  const mixer = new LoadMixer(params)
  const canvas: ColourSource = [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]]
  const maxSamples = Math.max(12, Math.round((3 * rp.length) / SILHOUETTE_STEP_PX))
  const right = [view.view[0], view.view[4], view.view[8]]
  const up = [view.view[1], view.view[5], view.view[9]]
  const before = list.count
  const path = new Float32Array(2 * P)
  const width = new Float32Array(P)
  const world = new Float32Array(3 * P)
  for (const run of runs) {
    if (run.contrast < minContrast) continue
    if (stats) stats.runs++
    // a stretch is of one family on the figure's side: the cut falls where the outline leaves the shadow family (the lowest value on the way in
    // under the cap), so what a stretch is held to, and what it is bridged to, is true of all of it
    const kinds = Uint8Array.from(run.cls, (c, i) => c | (run.uMin[i] <= capU ? 4 : 0))
    for (const [a, b, cl0k] of segmentRun(kinds, run.keys, maxSamples)) {
      if (b - a < MIN_STRETCH) continue
      const mid = Math.floor((a + b) / 2)
      let cl = cl0k & 3
      const cell = run.keys[mid]
      const rng = randomFor(`paint/sil/${cell}`, params.seed)
      // the role's density thins the strokes, by a seeded draw
      if (rng.next() >= rp.density) continue
      if (stats) stats.stretches++
      const beh = behaviourOf(cl)
      const uA = meanOver(run.uA, a, b)
      const uB = meanOver(run.uB, a, b)
      const shadowSide = run.uMin[mid] <= capU
      const shadowEdge = shadowSide && run.uB[mid] >= floorU
      if (shadowEdge) cl = Math.max(cl, 2)
      const uLo = Math.min(uA, uB)
      // the figure's local colour over the stretch
      const loc = [0, 0, 0]
      for (let s = a; s <= b; s++) for (let c = 0; c < 3; c++) loc[c] += run.local[3 * s + c]
      for (let c = 0; c < 3; c++) loc[c] /= b - a + 1
      const recA = sideRecipeOf(null, null, false, loc, uA, rng)
      // across the outline: the canvas where it is light, or the table in the figure's own cast shadow, as dark as it is there
      const srcB: ColourSource = uB >= floorU ? canvas : groundRecipe(uB, rng)
      const lighterIsA = uA >= uB
      // the colours of the stretch's two sources (every blended stroke of it is a mix of these two), made when first wanted, and the figure's own
      // side's lightness at the cap, which a stroke that is held to its own side is held to
      let labA: Oklab | null = null
      let labB: Oklab | null = null
      let ownBound = Number.NaN
      const sourceLab = (s: ColourSource): Oklab => (Array.isArray(s) ? [s[0], s[1], s[2]] : colourOfRecipe(s as ColourRecipe, env))
      // the colour of a stroke that blends the figure's side (t of the way) with the other: [a, b] in the order the stroke names them
      const blend = (aIsOwn: boolean, t: number): Oklab => {
        const la = (labA ??= sourceLab(recA))
        const lb = (labB ??= sourceLab(srcB))
        const a = aIsOwn ? la : lb
        const b = aIsOwn ? lb : la
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
      }
      const mx = run.screen[2 * mid]
      const my = run.screen[2 * mid + 1]
      const depth = run.depth[mid]

      // the lightness of the figure's own side at the cap (what a stroke held to its own side's family is held to), once
      const ownBoundOf = (): number => (Number.isNaN(ownBound) ? (ownBound = lightnessAtValue({ a: recA, b: null, t: 0 }, capU, env)) : ownBound)

      // one stroke made: its brush and colour (`lab`, before the mix; `bound` the lightness it is held to when `held`), the path in `path`, `width` and `world`
      const finish = (kk: number, lab0: Oklab, bound: () => number, alpha: number, held: boolean): void => {
        const load = rp.load * beh.loadMul * (0.9 + 0.2 * rng.next())
        const bristles = Math.max(1, Math.round(rp.bristles * rng.range(0.88, 1.12)))
        const jit0 = rng.gauss()
        const jit1 = rng.gauss()
        const seed = (cell ^ Math.imul(kk, 0x85ebca6b)) >>> 0
        let lab = mixer.mix({ role: 'edge', cell, u: uA, x: mx, y: my, lab: lab0, colormapped: false, seed, jit0, jit1 }).lab
        if (held) lab = holdLightness(lab, true, bound())
        const lin = oklabToLinear(lab)
        const e = list.push()
        list.role[e] = R_EDGE
        list.layer[e] = EDGE_LAYER
        for (let q = 0; q < 2 * P; q++) list.path[2 * P * e + q] = path[q]
        for (let q = 0; q < P; q++) list.width[P * e + q] = width[q]
        for (let q = 0; q < 3 * P; q++) list.worldPath[3 * P * e + q] = world[q]
        list.depth[e] = depth
        list.colour[3 * e] = lin[0]
        list.colour[3 * e + 1] = lin[1]
        list.colour[3 * e + 2] = lin[2]
        list.alpha[e] = alpha
        list.load[e] = load
        list.impasto[e] = rp.impasto * beh.impastoMul
        list.bristles[e] = bristles
        list.bristleVar[e] = clamp(rp.bristleVar * beh.bristleVarMul, 0, 1)
        list.dry[e] = Math.max(rp.dry * 0.5, beh.dryMin)
        list.wet[e] = Math.max(rp.wet * beh.wetMul, beh.wetMin)
        list.endSoft[e] = beh.endSoft
        list.edge[e] = cl
        list.seed[e] = seed
        list.worldNormal[3 * e] = 0
        list.worldNormal[3 * e + 1] = 0
        list.worldNormal[3 * e + 2] = 0
        list.hidden[e] = HIDDEN_NA
        if (stats) {
          stats.strokes++
          stats.byClass[cl]++
        }
      }

      // a stroke ALONG the stretch: its screen polyline resampled to PATH_POINTS at equal arc length, the world points on the 3D polyline
      const along = (kk: number, widthPx: number, lab0: Oklab, bound: () => number, alpha: number): void => {
        const xs: number[] = []
        const ys: number[] = []
        for (let s = a; s <= b; s++) {
          xs.push(run.screen[2 * s])
          ys.push(run.screen[2 * s + 1])
        }
        if (!(polylinePath(xs, ys, xs.length, widthPx, true, false, path, width) > 1e-6)) return
        // the points are on the silhouette polyline, and the path is their projection (so that a world path and a path are one stroke)
        alongWorld(run, a, b, world)
        const vp = fc.vp
        for (let q = 0; q < P; q++) {
          const x = world[3 * q], y = world[3 * q + 1], z = world[3 * q + 2]
          const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
          if (w <= 1e-9) return
          path[2 * q] = (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w + 1) / 2) * fc.W
          path[2 * q + 1] = ((1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) / 2) * fc.H
        }
        finish(kk, lab0, bound, alpha, shadowSide)
        if (stats) {
          if (cl >= 2) stats.crisp++
          else stats.drags++
        }
      }

      // a stroke ACROSS the outline through sample `ii` along the screen direction (dx, dy), `len` px long (`from` of it behind the sample, `to` ahead):
      // a decal in the plane of the sample's depth
      const across = (kk: number, ii: number, dx: number, dy: number, len: number, widthPx: number, lab0: Oklab, alpha: number, from: number, to: number): void => {
        const cx = run.screen[2 * ii]
        const cy = run.screen[2 * ii + 1]
        polylinePath([cx - dx * len * from, cx + dx * len * to], [cy - dy * len * from, cy + dy * len * to], 2, widthPx, true, false, path, width)
        const wx = run.world[3 * ii], wy = run.world[3 * ii + 1], wz = run.world[3 * ii + 2]
        const inv = 1 / Math.max(1e-9, pxPerUnit(fc, wx, wy, wz))
        for (let q = 0; q < P; q++) {
          const ox = (path[2 * q] - cx) * inv
          const oy = (path[2 * q + 1] - cy) * inv
          world[3 * q] = wx + right[0] * ox - up[0] * oy
          world[3 * q + 1] = wy + right[1] * ox - up[1] * oy
          world[3 * q + 2] = wz + right[2] * ox - up[2] * oy
        }
        finish(kk, lab0, ownBoundOf, alpha, shadowSide)
      }

      if (cl >= 2) {
        // distinct: a crisp, loaded stroke along the edge, darker than the darker side
        const uE = Math.min(clamp(uLo - (cl === 3 ? 0.12 : 0.06), 0.1, 0.8), shadowEdge ? capU : 1)
        const colour: DraftColour = { a: sideRecipeOf(null, null, false, loc, uE, rng, 0.9), b: null, t: 0 }
        along(0, rp.width * (cl === 3 ? 0.7 : 0.475) * rng.range(0.88, 1.12), colourOfDraft(colour, env), () => lightnessAtValue(colour, capU, env), cl === 3 ? 1 : 0.85)
      } else if (cl === 1) {
        // blended: a wide dragged stroke along the boundary, and short scumbled pulls from the lighter side into the darker
        along(0, rp.width * 2.6 * rng.range(0.88, 1.12), blend(true, 0.5), ownBoundOf, 0.8)
        const nd = Math.max(1, Math.round(((b - a) * SILHOUETTE_STEP_PX) / 34))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          // from the lighter side into the darker: out of the figure when it is the lighter, else into it (the normal points in)
          const sgn = lighterIsA ? -1 : 1
          const dir0x = sgn * run.nrm[2 * ii]
          const dir0y = sgn * run.nrm[2 * ii + 1]
          const rot = rng.range(-0.35, 0.35)
          const dx = dir0x * Math.cos(rot) - dir0y * Math.sin(rot)
          const dy = dir0x * Math.sin(rot) + dir0y * Math.cos(rot)
          const len = rp.length * (22 / 30) * rng.range(0.8, 1.2)
          // (the lighter source's share is 0.7)
          across(1 + d, ii, dx, dy, len, rp.width * 1.9 * rng.range(0.88, 1.12), blend(lighterIsA, 0.3), 0.75, 0.45, 0.55)
          if (stats) stats.pulls++
        }
      } else {
        // lost: a few strokes that bridge both sides, carrying one colour into the other
        const nd = Math.max(1, Math.round(((b - a) * SILHOUETTE_STEP_PX) / 42))
        for (let d = 0; d < nd; d++) {
          const ii = a + Math.floor(((d + 0.5) / nd) * (b - a))
          const len = rp.length * (26 / 30) * rng.range(0.85, 1.15)
          const rot = rng.range(-0.3, 0.3)
          const dx = -run.nrm[2 * ii] * Math.cos(rot) + run.nrm[2 * ii + 1] * Math.sin(rot)
          const dy = -run.nrm[2 * ii] * Math.sin(rot) - run.nrm[2 * ii + 1] * Math.cos(rot)
          across(1 + d, ii, dx, dy, len, rp.width * 1.8 * rng.range(0.88, 1.12), blend(true, 0.5), 0.6, 0.5, 0.5)
          if (stats) stats.bridges++
        }
      }
    }
  }
  return list.count - before
}

// Every silhouette stroke of the frame, appended to `list`; the count. (The frame calls this with its own strokes' list.)
export function addSilhouettes(
  list: StrokeList, baked: BakedPainting, scene: SpaceScene, view: PaintView, params: PaintParams, gbuffer: GBuffer | null, fc: FrameCtx,
): number {
  // (a scene with no opaque figure has no silhouettes, and no parameters to read)
  let any = false
  scene.marks.forEach((mark, m) => {
    if (mark.kind === 'mesh' && mark.style.opacity >= 1 && fc.ground[m] !== 1 && baked.surfaces[m]) any = true
  })
  if (!any) return 0
  const senv = silhouetteEnv(params)
  return silhouetteStrokes(list, silhouetteRuns(baked, scene, view, params, gbuffer, fc, senv), params, view, fc, senv)
}
