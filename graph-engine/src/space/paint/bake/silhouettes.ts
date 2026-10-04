// The silhouettes of a baked frame (the baked painting, spec §3.6 and §14; plan Task 4): the outline of each opaque figure in THIS view, which is
// view-dependent by nature and so cannot be baked, built as the baked edge strokes are (bake/edgeStrokes.ts: crisp, drag, pulls and bridges by the
// class of the outline), from the bake's per-vertex facts and with no G-buffer.
//
// THE OUTLINE. model/contours.ts silhouettePolylines: the zero crossings of n·toEye over the figure's own mesh, chained, each point ON a triangle
// edge. Each polyline is projected, cut where it turns sharply on the screen (35 degrees, as the model's splitAtCorners) and resampled every 2 CSS px
// of screen arc length (so the world step is 2 / ppu), each sample a point on the 3D polyline. A piece under 8 samples (16 px) makes no stroke.
//
// THE SIDES. A sample's inside is the figure's: its value uA and local colour are the baked ones (BakedSurface.uFront, uBack, local) at the
// nearest refined vertex, found by walking down the distance over the surface's edges from the last sample's (the first of a piece through a spatial hash;
// both cached per surface by its own positions array, which a recolour shares), on the
// side of the surface that is seen there (a closed mesh: side +1, its outside; an open sheet: read at each sample, below). The lowest value on the way in
// (the model's uAmin: at a limb the normal turns fast, so a vertex a few px in can be lit where the outline itself is already in the shadow) is the
// lowest u among the eye-facing vertices within PROBE_PX of the sample. The outside is the canvas (uB = the canvas value), or, where a G-buffer is
// given and the pixel PROBE_PX outside the outline holds another mark, that pixel's raw value through the lighting and value curves (the G-buffer
// may be a frame old: it is only ever read there). The screen's inward normal is against the seen side's own normal projected on the screen: at a limb a
// surface normal points out of the figure.
//
// AN OPEN SHEET is seen from one side at one place of its outline and the other at another (a fold's outline: the sheet goes away from it on both sides of it,
// the facing changing across it, and the sheet nearer the eye is the one that is seen; on a saddle the nearer one changes along the outline). So the side is
// read at each sample, as the model's G-buffer read 3 px in would: what the eye sees PROBE_PX to a side of the outline, found by casting at that point of
// the screen through the sheet's own triangles (MeshCaster: the pick's BVH, exact), the side that has the sheet being the inside, and the side the surface
// there shows the eye the side seen. The sides are the majority of 7 along the run, and a stretch is cut where they change.
//
// THE SCORE is the model's silhouette hardness (model/edges.ts edgeHardness, kind 1): c the contrast of the two sides, k 0.55, f the focal
// emphasis about the AUTHORED focal points (BakedPainting.focal), s the light side, d 0, the world-position noise, lost under a contrast of 0.03,
// and the outline of a form in shadow against light a found edge at least; then the class and the median of 7. The strokes of a stretch and their
// colours are the bake's (edgeStrokes.ts), the colours made here with the model's own recipe functions and a brush-load mix (one load for each stretch:
// below), held to the shadow family's ceiling where the stretch is the outline of a form in shadow.
//
// VIEW STABILITY (the outline must not boil as the view turns). Nothing a stretch draws comes from its place in a run or in the frame. Each sample is named
// by the cell of a coarse world lattice (KEY_FREQ) it is in, a name that is the same in every view; the outline is cut where a cell's key is the lowest of
// its neighbourhood (the sites), and where the kind changes; a stretch follows a site, and its name, its seeds and its brush load are made from that site's
// cell, the kind and its part; the pulls and bridges of a stretch are every PULL_STEP samples after the site, each seeded by its number there. The jitters
// of a stretch (the brush's load and widths, the colours' jitter, the turn of a pull) are smooth world-space noise at its place (WorldDraw), and the brush
// load of a stretch is a cell of its own (the site's cell with the kind and the part: LoadMixer.mixByCell), one load for the stretch's strokes and a fresh
// paint mix for the next stretch (each load a different hue: a load is not shared by the stretches of a site), not a load that runs on through the strokes
// before it, so that what a stroke is mixed with does not depend on which others are drawn. So a turn of the view slides a stretch's ends and changes its brush a little, and reseeds it only when the
// outline crosses into another cell of the lattice.
//
// WHAT IS DIFFERENT FROM THE PER-FRAME MODEL'S: the inside is read at the outline, not 3 px in (the baked value at the nearest vertex, and the
// lowest within PROBE_PX for the family test); the outside is the canvas unless a G-buffer says otherwise (hidden parts are the renderer's depth test's,
// not clipped here); the colour of the figure's side is the local colour at the vertex (the model's: the mean of the mark's visible particles').

import type { Random } from '../../../style/random'
import { bvhOf, type Bvh } from '../../pick/bvh'
import type { MeshMark, SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type GBuffer, type Oklab, type PaintView } from '../types'
import { holdLightness, oklabToLinear } from '../model/colour'
import { groundRecipe, silhouettePolylines, sideRecipeOf } from '../model/contours'
import { behaviourOf, edgeClassOf, edgeHardness, edgeNoiseSeed, EDGE_NOISE_FREQ, type EdgeTerms } from '../model/edges'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { clamp, hash01, hash3, mix2, smooth } from '../model/math'
import { LoadMixer } from '../model/mix'
import { colourOfDraft, colourOfRecipe, lightnessAtValue, type ColourRecipe, type ColourSource, type DraftColour, type RecipeEnv } from '../model/recipe'
import { compileCurves, type CompiledCurves } from '../model/respond'
import { polylinePath } from '../model/strokes'
import { canvasValue, effectiveValues } from '../model/value'
import { pxPerUnit, toEye, type FrameCtx } from '../model/view'
import { StrokeList } from './strokeList'
import { HIDDEN_NA, type BakedPainting, type BakedSurface } from './types'

const P = PATH_POINTS
// The lattice (cells per world unit) whose cell names a sample: coarse, so that the outline, which moves a little over the surface as the view turns, is in
// the same cell for most of a turn.
export const KEY_FREQ = 1.0
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

// The length of (dx, dy): Math.hypot is several times the cost of the square root, and a run asks for it a few times a sample.
const dist2d = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy)

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
  // The neighbours of vertex v: nbr[start[v]..start[v + 1]) (each once).
  readonly start: Int32Array
  nbr: Int32Array
  // Half the distance from each vertex to its nearest neighbour: a point nearer than this to a vertex has no nearer vertex (the triangle inequality).
  readonly gap: Float32Array

  constructor(s: Pick<BakedSurface, 'positions' | 'indices'>) {
    this.grid = new VertexGrid(s.positions, s.indices)
    const nv = s.positions.length / 3
    const idx = s.indices
    // the copies of one position (a seam of a lattice, a pole) are not joined by an edge: link each to the next copy, in a ring, so that a walk crosses the seam
    // (positions that agree to 1e-5, as the surface's own canonical vertices: a seam's copies differ in the last digits; the vertices of one cell of the
    // position hash are compared on their rounded numbers, so a collision of the hash only misses a link)
    const ring = new Int32Array(nv).fill(-1)
    {
      const first = new Map<number, number>()
      const last = new Map<number, number>()
      const same = (u: number, v: number): boolean =>
        Math.round(s.positions[3 * u] * 1e5) === Math.round(s.positions[3 * v] * 1e5) &&
        Math.round(s.positions[3 * u + 1] * 1e5) === Math.round(s.positions[3 * v + 1] * 1e5) &&
        Math.round(s.positions[3 * u + 2] * 1e5) === Math.round(s.positions[3 * v + 2] * 1e5)
      for (let v = 0; v < nv; v++) {
        const key = hash3(Math.round(s.positions[3 * v] * 1e5), Math.round(s.positions[3 * v + 1] * 1e5), Math.round(s.positions[3 * v + 2] * 1e5))
        const head = first.get(key)
        if (head === undefined) first.set(key, v)
        else if (same(head, v)) {
          ring[last.get(key) ?? head] = v
          last.set(key, v)
        }
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
    // each neighbour once (an edge of two triangles was listed twice): about six to a vertex, so a walk's two rings are about forty vertices
    const start = new Int32Array(nv + 1)
    const seenAt = new Int32Array(nv).fill(-1)
    let w = 0
    for (let v = 0; v < nv; v++) {
      start[v] = w
      for (let k = count[v]; k < count[v + 1]; k++) {
        const u = this.nbr[k]
        if (u !== v && seenAt[u] !== v) {
          seenAt[u] = v
          this.nbr[w++] = u
        }
      }
    }
    start[nv] = w
    this.start = start
    this.nbr = this.nbr.slice(0, w)
    this.gap = new Float32Array(nv)
    for (let v = 0; v < nv; v++) {
      let least = Infinity
      const measure = (u: number): void => {
        const dx = s.positions[3 * u] - s.positions[3 * v], dy = s.positions[3 * u + 1] - s.positions[3 * v + 1], dz = s.positions[3 * u + 2] - s.positions[3 * v + 2]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > 1e-14 && d2 < least) least = d2
      }
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = this.nbr[k]
        measure(u)
        // (a copy of the vertex at the same place, across a seam, has neighbours of its own that are as near to this one's place)
        const dx = s.positions[3 * u] - s.positions[3 * v], dy = s.positions[3 * u + 1] - s.positions[3 * v + 1], dz = s.positions[3 * u + 2] - s.positions[3 * v + 2]
        if (dx * dx + dy * dy + dz * dz <= 1e-14) for (let j = start[u]; j < start[u + 1]; j++) measure(this.nbr[j])
      }
      this.gap[v] = Number.isFinite(least) ? 0.5 * Math.sqrt(least) : 0
    }
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
        // no neighbour is nearer: when the point is nearer to this vertex than half of its way to the nearest other, none is; else look one ring further
        // (the vertex across the other diagonal of a quad is not a neighbour, and is the nearest as often)
        const g = this.gap[cur]
        if (best < g * g) return cur
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
export function indexOf(s: Pick<BakedSurface, 'positions' | 'indices'>): SurfaceIndex {
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
    const dx = x - fx, dy = y - focal[8 * mark + 4 * k + 1], dz = z - focal[8 * mark + 4 * k + 2]
    const r2 = (dx * dx + dy * dy + dz * dz) / (R * R)
    // (past 7 radii the term is under 1e-21: no exp)
    if (r2 < 49) f = Math.max(f, Math.exp(-r2))
  }
  return f
}

// model/math.ts valueNoise3 for a run of nearby points: the eight corner values of the lattice cell are kept while the points stay in it (a run's samples
// are 2 px apart and the noise's cell is two thirds of a world unit), so a sample costs the blend and not sixteen hashes. The same numbers.
export class NoiseRun {
  private ix = Number.NaN
  private iy = 0
  private iz = 0
  private readonly c = new Float64Array(8)
  private readonly seed: number
  constructor(seed: number) {
    this.seed = seed
  }
  at(x: number, y: number, z: number): number {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const iz = Math.floor(z)
    const c = this.c
    if (ix !== this.ix || iy !== this.iy || iz !== this.iz) {
      this.ix = ix
      this.iy = iy
      this.iz = iz
      const corner = (a: number, b: number, d: number): number => hash01(ix + a, iy + b, mix2(iz + d, this.seed)) * 2 - 1
      c[0] = corner(0, 0, 0)
      c[1] = corner(1, 0, 0)
      c[2] = corner(0, 1, 0)
      c[3] = corner(1, 1, 0)
      c[4] = corner(0, 0, 1)
      c[5] = corner(1, 0, 1)
      c[6] = corner(0, 1, 1)
      c[7] = corner(1, 1, 1)
    }
    const fx = x - ix
    const fy = y - iy
    const fz = z - iz
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const uz = fz * fz * (3 - 2 * fz)
    const x00 = c[0] + (c[1] - c[0]) * ux
    const x10 = c[2] + (c[3] - c[2]) * ux
    const x01 = c[4] + (c[5] - c[4]) * ux
    const x11 = c[6] + (c[7] - c[6]) * ux
    const y0 = x00 + (x10 - x00) * uy
    const y1 = x01 + (x11 - x01) * uy
    return y0 + (y1 - y0) * uz
  }
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
  // (xyz per vertex): vertex index + the fraction of the next segment, so that a stroke's points are made on the polyline itself. `keys` names the
  // sample by the cell of the world lattice it is in (KEY_FREQ): the same in every view.
  world: Float64Array
  screen: Float64Array
  poly: Float64Array
  tpos: Float64Array
  // The screen's unit normal toward the figure's inside, 2 per sample, and the side of the surface that is seen there (+1 the side its normals point to, -1
  // the other: always +1 on a closed figure, and per sample on an open sheet).
  nrm: Float64Array
  sg: Int8Array
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
  mesh: MeshMark
  // An open sheet is seen from the side its own surface shows at each sample, not one side for the whole mesh.
  open: boolean
  out: SilhouetteRun[]
}

// The per-vertex array silhouettePolylines writes into, one for each mesh and kept (a frame allocates none).
const polyScratch = new WeakMap<MeshMark, Float64Array>()
function scratchOf(mesh: MeshMark): Float64Array {
  let s = polyScratch.get(mesh)
  if (!s) {
    s = new Float64Array(mesh.positions.length / 3)
    polyScratch.set(mesh, s)
  }
  return s
}

// The runs of every opaque figure's silhouette in this view. `gbuffer` may be null.
export function silhouetteRuns(
  baked: BakedPainting, scene: SpaceScene, view: PaintView, params: PaintParams, gbuffer: GBuffer | null, fc: FrameCtx, senv: SilhouetteEnv,
): SilhouetteRun[] {
  const out: SilhouetteRun[] = []
  const noiseSeed = edgeNoiseSeed(params)
  scene.marks.forEach((mark, m) => {
    if (mark.kind !== 'mesh' || mark.style.opacity < 1 || fc.ground[m] === 1) return
    const surface = baked.surfaces[m]
    if (!surface) return
    const mesh = mark as MeshMark
    const scratch = scratchOf(mesh)
    const polylines = silhouettePolylines(mesh, view.eye, fc.ortho, view.viewDir, scratch)
    if (polylines.length === 0) return
    // the side the figure is seen from: a closed mesh's outside (its normals' side); an open sheet's, read at each sample
    const mc: MarkCtx = { baked, params, gbuffer, fc, senv, noiseSeed, mark: m, surface, index: indexOf(surface), mesh, open: !surface.closed && !!surface.uBack, out }
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
      const la = Math.sqrt(ax * ax + ay * ay), lb = Math.sqrt(bx * bx + by * by)
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
  for (let v = a + 1; v <= b; v++) total += dist2d(px[v] - px[v - 1], py[v] - py[v - 1])
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
    const d = dist2d(px[v] - px[v - 1], py[v] - py[v - 1])
    if (d === 0) continue
    let pos = SILHOUETTE_STEP_PX - carry
    while (pos <= d && n < cap) {
      put(v, pos / d)
      pos += SILHOUETTE_STEP_PX
    }
    carry = d - (pos - SILHOUETTE_STEP_PX)
  }
  if (n < cap && dist2d(px[b] - sx[n - 1], py[b] - sy[n - 1]) > SILHOUETTE_STEP_PX * 0.3) put(b, 1)
  if (n < SILHOUETTE_MIN_SAMPLES) return

  const { fc, surface, index, open, gbuffer, senv } = mc
  const { W, H } = fc
  const vp = fc.vp
  const view = fc.view
  const keys = new Uint32Array(n)
  for (let s = 0; s < n; s++) keys[s] = hash3(Math.floor(wxyz[3 * s] * KEY_FREQ), Math.floor(wxyz[3 * s + 1] * KEY_FREQ), Math.floor(wxyz[3 * s + 2] * KEY_FREQ))
  const run: SilhouetteRun = {
    mark: mc.mark, n, world: new Float64Array(3 * n), screen: new Float64Array(2 * n), poly, tpos: tp.slice(0, n), nrm: new Float64Array(2 * n), sg: new Int8Array(n).fill(1),
    uA: new Float32Array(n), uB: new Float32Array(n), uMin: new Float32Array(n), local: new Float32Array(3 * n), keys, depth: new Float32Array(n), h: new Float32Array(n),
    cls: new Uint8Array(n), contrast: 0,
  }
  const lost = new Uint8Array(n)
  // "within PROBE_PX of the sample", in the world, at the piece's middle
  const mid = n >> 1
  const probeWorld = SILHOUETTE_PROBE_PX / Math.max(1e-9, pxPerUnit(fc, wxyz[3 * mid], wxyz[3 * mid + 1], wxyz[3 * mid + 2]))
  const probe2 = probeWorld * probeWorld
  const pos = surface.positions
  const nor = surface.normals
  const uFront = surface.uFront
  const uBack = surface.uBack ?? uFront
  // the nearest vertex of every sample, found by walking on from the last sample's
  const near = new Int32Array(n)
  let hint = -1
  for (let s = 0; s < n; s++) {
    hint = near[s] = index.nearest(pos, wxyz[3 * s], wxyz[3 * s + 1], wxyz[3 * s + 2], hint)
  }
  // an open sheet: the side seen, at each sample
  if (open) readSides(mc, run, near, sx, sy, wxyz)
  for (let s = 0; s < n; s++) {
    const x = wxyz[3 * s], y = wxyz[3 * s + 1], z = wxyz[3 * s + 2]
    run.world[3 * s] = x
    run.world[3 * s + 1] = y
    run.world[3 * s + 2] = z
    run.screen[2 * s] = sx[s]
    run.screen[2 * s + 1] = sy[s]
    run.depth[s] = (x - view.eye[0]) * view.viewDir[0] + (y - view.eye[1]) * view.viewDir[1] + (z - view.eye[2]) * view.viewDir[2]
    // the lowest value of the eye-facing vertices within the probe: the nearest vertex and its neighbours
    const v = near[s]
    if (v < 0) {
      lost[s] = 1
      continue
    }
    toEye(fc, x, y, z, EYE)
    const sig = run.sg[s]
    const uSide = sig > 0 ? uFront : uBack
    let lowest = uSide[v]
    for (let k = index.start[v] - 1; k < index.start[v + 1]; k++) {
      const w = k < index.start[v] ? v : index.nbr[k]
      const dx = pos[3 * w] - x, dy = pos[3 * w + 1] - y, dz = pos[3 * w + 2] - z
      if (dx * dx + dy * dy + dz * dz <= probe2 && sig * (nor[3 * w] * EYE[0] + nor[3 * w + 1] * EYE[1] + nor[3 * w + 2] * EYE[2]) > 0 && uSide[w] < lowest) lowest = uSide[w]
    }
    run.uA[s] = uSide[v]
    run.uMin[s] = lowest
    run.local[3 * s] = surface.local[3 * v]
    run.local[3 * s + 1] = surface.local[3 * v + 1]
    run.local[3 * s + 2] = surface.local[3 * v + 2]
    // the screen's normal: the tangent turned a quarter, to the side the normal of the surface that is seen points away from (at an outline the
    // eye-facing normal of the surface that is seen points out of the figure, on a fold of a sheet as on a sphere); an open sheet's was read by its cast
    let nx = run.nrm[2 * s]
    let ny = run.nrm[2 * s + 1]
    if (nx === 0 && ny === 0) {
      const a0 = Math.max(0, s - 1), a1 = Math.min(n - 1, s + 1)
      let tx = sx[a1] - sx[a0]
      let ty = sy[a1] - sy[a0]
      const tl = dist2d(tx, ty) || 1
      tx /= tl
      ty /= tl
      nx = -ty
      ny = tx
      const onx = sig * nor[3 * v], ony = sig * nor[3 * v + 1], onz = sig * nor[3 * v + 2]
      const oxs = (W / 2) * (vp[0] * onx + vp[4] * ony + vp[8] * onz)
      const oys = -(H / 2) * (vp[1] * onx + vp[5] * ony + vp[9] * onz)
      if (nx * oxs + ny * oys > 0) {
        nx = -nx
        ny = -ny
      }
      run.nrm[2 * s] = nx
      run.nrm[2 * s + 1] = ny
    }
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

// What the eye sees at a point of a mesh: the nearest of its triangles on the eye's ray through the point, exactly. The pick's BVH over the mesh (built once
// for the mark and shared with its picks) and Moller-Trumbore on the mesh's own triangles (the refined surface lies exactly on them: surface.ts): no screen
// buffer, no projection of the mesh, and no bound on how far a triangle may reach on the screen. One per mark.
// The slack of a ray's barycentrics (a point on the border of a sheet, or on an edge two triangles share, is on the sheet).
const CAST_EDGE = 1e-9

export class MeshCaster {
  private readonly mesh: MeshMark
  private readonly bvh: Bvh
  // The traversal's stack (a tree of 2^30 triangles is not deeper than this).
  private readonly stack = new Int32Array(64)
  // The last hit: its depth along the view direction and its facing (n.toEye, the normal interpolated over the triangle).
  hitDepth = 0
  hitFacing = 0
  // How many casts there have been (a test reads it).
  casts = 0

  constructor(mesh: MeshMark) {
    this.mesh = mesh
    this.bvh = bvhOf(mesh)
  }

  // The nearest surface on the eye's ray through the world point (x, y, z): the line along the view direction under an orthographic view, the ray from the
  // eye under a perspective one. False where there is none.
  cast(fc: FrameCtx, x: number, y: number, z: number): boolean {
    this.casts++
    const view = fc.view
    const ex = view.eye[0], ey = view.eye[1], ez = view.eye[2]
    let ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, sMin: number
    if (fc.ortho) {
      ox = x
      oy = y
      oz = z
      dx = view.viewDir[0]
      dy = view.viewDir[1]
      dz = view.viewDir[2]
      sMin = -1e12
    } else {
      ox = ex
      oy = ey
      oz = ez
      dx = x - ex
      dy = y - ey
      dz = z - ez
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      dx /= l
      dy /= l
      dz /= l
      sMin = 0
    }
    // the nearest triangle: the BVH's boxes by the slab test, the leaves' triangles by Moller-Trumbore, two-sided
    const bvh = this.bvh
    if (bvh.left.length === 0) return false
    const bounds = bvh.bounds, left = bvh.left, right = bvh.right, start = bvh.start, count = bvh.count, order = bvh.order
    const pos = this.mesh.positions, idx = this.mesh.indices
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
    const stack = this.stack
    let sp = 0
    stack[sp++] = 0
    let best = 1e12
    let bt = -1, bb1 = 0, bb2 = 0
    while (sp > 0) {
      const node = stack[--sp]
      const nb = 6 * node
      let lo = sMin
      let hi = best
      // (an axis the ray does not move along is a slab it is in or out of for good, and on a face of the box is in)
      if (dx !== 0) {
        const t1 = (bounds[nb] - ox) * ix, t2 = (bounds[nb + 3] - ox) * ix
        lo = Math.max(lo, Math.min(t1, t2))
        hi = Math.min(hi, Math.max(t1, t2))
      } else if (ox < bounds[nb] || ox > bounds[nb + 3]) continue
      if (dy !== 0) {
        const t1 = (bounds[nb + 1] - oy) * iy, t2 = (bounds[nb + 4] - oy) * iy
        lo = Math.max(lo, Math.min(t1, t2))
        hi = Math.min(hi, Math.max(t1, t2))
      } else if (oy < bounds[nb + 1] || oy > bounds[nb + 4]) continue
      if (dz !== 0) {
        const t1 = (bounds[nb + 2] - oz) * iz, t2 = (bounds[nb + 5] - oz) * iz
        lo = Math.max(lo, Math.min(t1, t2))
        hi = Math.min(hi, Math.max(t1, t2))
      } else if (oz < bounds[nb + 2] || oz > bounds[nb + 5]) continue
      // (a hair of slack, so a ray grazing a box face still enters it)
      if (lo > hi + 1e-12 * Math.max(1, Math.abs(hi))) continue
      if (left[node] < 0) {
        const to = start[node] + count[node]
        for (let i = start[node]; i < to; i++) {
          const tri = order[i]
          const a = 3 * idx[3 * tri], b = 3 * idx[3 * tri + 1], c = 3 * idx[3 * tri + 2]
          const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2]
          const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2]
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
          const det = e1x * px + e1y * py + e1z * pz
          if (det === 0 || !Number.isFinite(det)) continue
          const inv = 1 / det
          const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2]
          const b1 = (tx * px + ty * py + tz * pz) * inv
          if (b1 < -CAST_EDGE || b1 > 1 + CAST_EDGE) continue
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
          const b2 = (dx * qx + dy * qy + dz * qz) * inv
          if (b2 < -CAST_EDGE || b1 + b2 > 1 + CAST_EDGE) continue
          const s = (e2x * qx + e2y * qy + e2z * qz) * inv
          if (s < sMin || s > best || !Number.isFinite(s)) continue
          if (s < best || tri < bt) {
            best = s
            bt = tri
            bb1 = b1
            bb2 = b2
          }
        }
      } else {
        stack[sp++] = right[node]
        stack[sp++] = left[node]
      }
    }
    if (bt < 0) return false
    const a = 3 * idx[3 * bt], b = 3 * idx[3 * bt + 1], c = 3 * idx[3 * bt + 2]
    const w0 = 1 - bb1 - bb2
    const nor = this.mesh.normals
    const nx = w0 * nor[a] + bb1 * nor[b] + bb2 * nor[c]
    const ny = w0 * nor[a + 1] + bb1 * nor[b + 1] + bb2 * nor[c + 1]
    const nz = w0 * nor[a + 2] + bb1 * nor[b + 2] + bb2 * nor[c + 2]
    this.hitFacing = -(nx * dx + ny * dy + nz * dz)
    this.hitDepth = (ox + dx * best - ex) * view.viewDir[0] + (oy + dy * best - ey) * view.viewDir[1] + (oz + dz * best - ez) * view.viewDir[2]
    return true
  }
}

const casters = new WeakMap<MeshMark, MeshCaster>()
export function casterOf(mesh: MeshMark): MeshCaster {
  let c = casters.get(mesh)
  if (!c) {
    c = new MeshCaster(mesh)
    casters.set(mesh, c)
  }
  return c
}

// Every this many samples of an open sheet's outline has its side cast (32 px), and the last; where two casts differ the middle is cast, and so on.
const CAST_STRIDE = 16

// On an open sheet, the side seen at each sample (run.sg) and the screen's normal toward the figure (run.nrm): what the eye sees PROBE_PX to either side of
// the outline (the surface nearest the eye there: a fold's sheet is on one side of its outline only, and where both sides have a surface the one at the
// outline's own depth is the sheet's), as the model's G-buffer read 3 px in sees it. The side that surface shows the eye is the side seen, and its side of the
// outline the way in. Both are the majority of 7 along the run, so that a blip does not flicker the colours; a stretch is cut where they change.
function readSides(mc: MarkCtx, run: SilhouetteRun, near: Int32Array, sx: Float64Array, sy: Float64Array, wxyz: Float64Array): void {
  const { fc, mesh } = mc
  const caster = casterOf(mesh)
  const view = fc.view
  const rx = view.view[0], ry = view.view[4], rz = view.view[8]
  const ux = view.view[1], uy = view.view[5], uz = view.view[9]
  const n = run.n
  const rawSide = new Int8Array(n)
  const rawWay = new Int8Array(n)
  const way = new Int8Array(n).fill(1)
  const nx0 = new Float64Array(n)
  const ny0 = new Float64Array(n)
  for (let s = 0; s < n; s++) {
    const a0 = Math.max(0, s - 1), a1 = Math.min(n - 1, s + 1)
    let tx = sx[a1] - sx[a0]
    let ty = sy[a1] - sy[a0]
    const tl = dist2d(tx, ty) || 1
    nx0[s] = -ty / tl
    ny0[s] = tx / tl
  }
  let prefer = 1
  let any = false
  // one cast at sample s: the side of the outline that has the sheet (rawWay) and what it shows the eye (rawSide); 0 where neither side has any
  const castAt = (s: number): void => {
    if (near[s] < 0) return
    const px = wxyz[3 * s], py = wxyz[3 * s + 1], pz = wxyz[3 * s + 2]
    const inv = SILHOUETTE_PROBE_PX / Math.max(1e-9, pxPerUnit(fc, px, py, pz))
    const depthP = (px - view.eye[0]) * view.viewDir[0] + (py - view.eye[1]) * view.viewDir[1] + (pz - view.eye[2]) * view.viewDir[2]
    // the point PROBE_PX to a side of the sample on the screen (the plane of the sample's depth), and what is there
    let sideA = 0, faceA = 0, gapA = Infinity
    let sideB = 0, faceB = 0, gapB = Infinity
    for (let t = 0; t < 2; t++) {
      const d = t === 0 ? prefer : -prefer
      const ox = d * nx0[s] * inv, oy = d * ny0[s] * inv
      if (!caster.cast(fc, px + rx * ox - ux * oy, py + ry * ox - uy * oy, pz + rz * ox - uz * oy)) continue
      if (t === 0) {
        sideA = d
        faceA = caster.hitFacing
        gapA = Math.abs(caster.hitDepth - depthP)
      } else {
        sideB = d
        faceB = caster.hitFacing
        gapB = Math.abs(caster.hitDepth - depthP)
      }
    }
    let side = sideA
    let facing = faceA
    if (sideA === 0 || (sideB !== 0 && gapB < gapA)) {
      side = sideB
      facing = faceB
    }
    if (side === 0) return
    any = true
    prefer = side
    rawWay[s] = side
    rawSide[s] = facing > 0 ? 1 : facing < 0 ? -1 : 0
  }
  // The sides change slowly along an outline: every CAST_STRIDE samples (and the last) is cast, and between two that agree the samples take their answer; where
  // they differ the middle sample is cast, and so on down to the sample where it changes.
  const fill = (a: number, b: number): void => {
    if (b - a <= 1) return
    if (rawSide[a] !== 0 && rawSide[a] === rawSide[b] && rawWay[a] !== 0 && rawWay[a] === rawWay[b]) {
      for (let s = a + 1; s < b; s++) {
        rawSide[s] = rawSide[a]
        rawWay[s] = rawWay[a]
      }
      return
    }
    const m = (a + b) >> 1
    castAt(m)
    fill(a, m)
    fill(m, b)
  }
  for (let s = 0; s < n; s += CAST_STRIDE) castAt(s)
  if ((n - 1) % CAST_STRIDE !== 0) castAt(n - 1)
  for (let a = 0; a < n - 1; a += CAST_STRIDE) fill(a, Math.min(a + CAST_STRIDE, n - 1))
  if (!any) return
  medianSigma(rawSide, run.sg)
  medianSigma(rawWay, way)
  for (let s = 0; s < n; s++) {
    run.nrm[2 * s] = way[s] * nx0[s]
    run.nrm[2 * s + 1] = way[s] * ny0[s]
  }
}

// The side seen at each sample as the majority of the 7 about it, the ends repeating (a sample whose side is not known, 0, has no vote; a tie keeps the one before).
export function medianSigma(raw: Int8Array, out: Int8Array): void {
  const n = raw.length
  let prev = 1
  for (let i = 0; i < n; i++) {
    let sum = 0
    // (the ends repeat, as the median of the classes does: a change of side near the end of the run does not move)
    for (let k = -3; k <= 3; k++) sum += raw[i + k < 0 ? 0 : i + k > n - 1 ? n - 1 : i + k]
    prev = out[i] = sum > 0 ? 1 : sum < 0 ? -1 : prev
  }
}

function sliceRun(r: SilhouetteRun, a: number, n: number): SilhouetteRun {
  return {
    mark: r.mark, n, world: r.world.slice(3 * a, 3 * (a + n)), screen: r.screen.slice(2 * a, 2 * (a + n)), poly: r.poly, tpos: r.tpos.slice(a, a + n), nrm: r.nrm.slice(2 * a, 2 * (a + n)),
    sg: r.sg.slice(a, a + n),
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
  const noise = new NoiseRun(mc.noiseSeed)
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
    let hh = edgeHardness('silhouette', t, params) + ep.noise * noise.at(x * EDGE_NOISE_FREQ, y * EDGE_NOISE_FREQ, z * EDGE_NOISE_FREQ)
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

// ---- the cuts of a run, and the draws of a stretch ----

// A cell's key makes a site of the outline where it is the lowest within this many samples either side (the model's cuts, under a key hash of a position,
// were counted from the stretch before: a cut moved as the run's start did). The sites of a run are the same in every view, save where the outline crosses
// into another cell: it is cut at them, and a stretch is named by the site it follows.
export const CUT_WINDOW = 14
// The samples between the pulls of a soft stretch and the bridges of a lost one (the model's: one every 34 and 42 px; the same for both, so that a stretch
// which turns from lost to soft as the view turns keeps the strokes that cross its outline), counted from the site the stretch follows.
export const PULL_STEP = 19
// A stretch under this many samples joins the one before it.
const JOIN_UNDER = 11

// The samples that begin one polyline vertex's key (the samples between two vertices have the key of the first) and whose key is the lowest within `window`
// samples either side, in order.
export function lowestKeys(keys: Uint32Array, window: number): Int32Array {
  const n = keys.length
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0 && keys[i] === keys[i - 1]) continue
    let lowest = true
    for (let j = Math.max(0, i - window); j <= Math.min(n - 1, i + window) && lowest; j++) if (keys[j] < keys[i]) lowest = false
    if (lowest) out.push(i)
  }
  return Int32Array.from(out)
}

// The index in `sites` of the last site at or before sample i; -1 where there is none.
export function siteBefore(sites: Int32Array, i: number): number {
  let lo = 0
  let hi = sites.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (sites[m] <= i) lo = m + 1
    else hi = m
  }
  return lo - 1
}

// The kind of each sample of a run, what its stretch is of one of: the class, whether the figure's side is in the shadow family there (the lowest value on
// the way in under the cap), and the side of the surface that is seen (bit 8: the back). The cut falls where any of them changes, so what a stretch is held
// to, and what it is bridged to, is true of all of it.
export function stretchKinds(run: SilhouetteRun, capU: number): Uint8Array {
  const n = run.n
  const out = new Uint8Array(n)
  const cls = run.cls, uMin = run.uMin, sg = run.sg
  for (let i = 0; i < n; i++) out[i] = cls[i] | (uMin[i] <= capU ? 4 : 0) | (sg[i] < 0 ? 8 : 0)
  return out
}

// The stretches of a run, [first, last, kind, part]: cut where the kind changes (the class, the shadow family, the side seen), at the sites (so that a cut
// stays on the surface where the camera turns, whatever the run's own start), and a stretch longer than `maxSamples` in equal parts (the part's number).
// A stretch under JOIN_UNDER samples joins the one before it.
export function cutRun(kinds: Uint8Array, maxSamples: number, sites: Int32Array): [number, number, number, number][] {
  const n = kinds.length
  const segs: [number, number, number, number][] = []
  let s0 = 0
  let next = 0
  for (let i = 1; i <= n; i++) {
    if (i < n && kinds[i] === kinds[s0]) {
      while (next < sites.length && sites[next] < i) next++
      if (next >= sites.length || sites[next] !== i) continue
    }
    const len = i - s0
    const parts = Math.max(1, Math.ceil(len / maxSamples))
    for (let k = 0; k < parts; k++) segs.push([s0 + Math.round((len * k) / parts), s0 + Math.round((len * (k + 1)) / parts) - 1, kinds[s0], k])
    s0 = i
  }
  for (let k = segs.length - 1; k > 0; k--) {
    if (segs[k][1] - segs[k][0] < JOIN_UNDER) {
      segs[k - 1][1] = segs[k][1]
      segs.splice(k, 1)
    }
  }
  return segs
}

// The world's lattice of the draws: the cell of model/edges.ts' noise, two thirds of a unit.
const DRAW_FREQ = EDGE_NOISE_FREQ
const DRAW_SEEDS = Uint32Array.from({ length: 64 }, (_, k) => mix2(k, 0x7e57ab1e))
// A 32-bit finaliser (murmur3's): the hash of a corner and a draw's seed, mixed so that the draws of one place are not related.
const fmix = (h: number): number => {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}
// value noise at a point has the spread of 0.37; scaled to the spread of a uniform draw (0.289) and of a normal one (1)
const DRAW_UNIFORM = 0.78
const DRAW_NORMAL = 2.7

// A stretch's draws (its brush's loads and widths, the jitter of its colours, the turn of a pull): the random source the model's recipes ask for, but each
// value taken from smooth world-space noise at the stretch's place (one noise field for each draw in turn), so that a stretch which moves a little as the
// view turns changes its brush a little, and does not draw a new one.
export class WorldDraw implements Random {
  // The lattice cell of the place (its eight corners' hashes, made once for the place) and where in it the place is (the smoothstep weights).
  private readonly corner = new Uint32Array(8)
  private ux = 0
  private uy = 0
  private uz = 0
  private k = 0
  constructor(x: number, y: number, z: number) {
    this.at(x, y, z)
  }

  // Draw again, from the noise at another place.
  at(x: number, y: number, z: number): this {
    const px = x * DRAW_FREQ, py = y * DRAW_FREQ, pz = z * DRAW_FREQ
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz)
    const fx = px - ix, fy = py - iy, fz = pz - iz
    this.ux = fx * fx * (3 - 2 * fx)
    this.uy = fy * fy * (3 - 2 * fy)
    this.uz = fz * fz * (3 - 2 * fz)
    for (let c = 0; c < 8; c++) this.corner[c] = hash3(ix + (c & 1), iy + ((c >> 1) & 1), iz + (c >> 2))
    this.k = 0
    return this
  }

  // The next draw's noise field: a hashed value in [-1, 1] at each corner (the corner's hash with the draw's seed through a finaliser), smoothstep-blended.
  private noise(): number {
    const s = DRAW_SEEDS[this.k++ & 63]
    const c = this.corner
    let h = fmix(c[0] ^ s)
    const v000 = h / 2147483648 - 1
    h = fmix(c[1] ^ s)
    const v100 = h / 2147483648 - 1
    h = fmix(c[2] ^ s)
    const v010 = h / 2147483648 - 1
    h = fmix(c[3] ^ s)
    const v110 = h / 2147483648 - 1
    h = fmix(c[4] ^ s)
    const v001 = h / 2147483648 - 1
    h = fmix(c[5] ^ s)
    const v101 = h / 2147483648 - 1
    h = fmix(c[6] ^ s)
    const v011 = h / 2147483648 - 1
    h = fmix(c[7] ^ s)
    const v111 = h / 2147483648 - 1
    const x00 = v000 + (v100 - v000) * this.ux
    const x10 = v010 + (v110 - v010) * this.ux
    const x01 = v001 + (v101 - v001) * this.ux
    const x11 = v011 + (v111 - v011) * this.ux
    const y0 = x00 + (x10 - x00) * this.uy
    const y1 = x01 + (x11 - x01) * this.uy
    return y0 + (y1 - y0) * this.uz
  }

  next(): number {
    return clamp(0.5 + DRAW_UNIFORM * this.noise(), 0, 0.999999)
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1
  }

  gauss(): number {
    return DRAW_NORMAL * this.noise()
  }
}

// ---- the strokes ----

// The world points of a stroke along samples a..b of a run: PATH_POINTS of them at equal screen arc length (as polylinePath places its path's), each ON the
// silhouette polyline itself (the sample's place along it, interpolated), not on the chords between samples. `cum` is scratch of at least b - a + 1.
function alongWorld(run: SilhouetteRun, a: number, b: number, world: Float32Array, cum: Float64Array): void {
  const n = b - a + 1
  cum[0] = 0
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + dist2d(run.screen[2 * (a + i)] - run.screen[2 * (a + i - 1)], run.screen[2 * (a + i) + 1] - run.screen[2 * (a + i - 1) + 1])
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

// What a call of silhouetteStrokes keeps from stretch to stretch: the settings, the mixer, and the scratch its strokes are made in (no stroke or stretch
// makes an array or a closure of its own).
interface Brush {
  list: StrokeList
  fc: FrameCtx
  env: RecipeEnv
  capU: number
  floorU: number
  mixer: LoadMixer
  rp: PaintParams['roles']['edge']
  right: number[]
  up: number[]
  stats: SilhouetteStats | undefined
  path: Float32Array
  width: Float32Array
  world: Float32Array
  xs: Float64Array
  ys: Float64Array
  cum: Float64Array
  px2: Float64Array
  py2: Float64Array
  lab: Oklab
  loc: Float64Array
  // the draws of the stretch, and of the pull or bridge being made
  draw: WorldDraw
  pdraw: WorldDraw
}

// The stretch being made: what its strokes share.
interface Stretch {
  run: SilhouetteRun
  a: number
  b: number
  // The class the stretch was cut at (its brush: behaviourOf), and the class it is drawn as (a form in shadow against light is at least firm).
  cl: number
  beh: ReturnType<typeof behaviourOf>
  uA: number
  // The cell its strokes are mixed in: the stretch's own, so that they share one brush load and the next stretch has another.
  cell: number
  shadowSide: boolean
  lighterIsA: boolean
  // The figure's side's recipe, and the other side's source, and the colours made of them when first wanted (every blended stroke is a mix of the two);
  // the figure's own side's lightness at the cap, which a stroke held to its own side is held to.
  recA: ColourRecipe
  srcB: ColourSource
  labA: Oklab | null
  labB: Oklab | null
  ownBound: number
  mx: number
  my: number
  depth: number
}

const sourceLab = (env: RecipeEnv, s: ColourSource): Oklab => (Array.isArray(s) ? [s[0], s[1], s[2]] : colourOfRecipe(s as ColourRecipe, env))

// The colour of a stroke that blends the figure's side (t of the way) with the other: [a, b] in the order the stroke names them. (Written to scratch.)
function blendLab(B: Brush, S: Stretch, aIsOwn: boolean, t: number): Oklab {
  const la = (S.labA ??= sourceLab(B.env, S.recA))
  const lb = (S.labB ??= sourceLab(B.env, S.srcB))
  const x = aIsOwn ? la : lb
  const y = aIsOwn ? lb : la
  const out = B.lab
  out[0] = x[0] + (y[0] - x[0]) * t
  out[1] = x[1] + (y[1] - x[1]) * t
  out[2] = x[2] + (y[2] - x[2]) * t
  return out
}

// The lightness of the figure's own side at the cap (what a stroke held to its own side's family is held to), once.
function ownBoundOf(B: Brush, S: Stretch): number {
  if (Number.isNaN(S.ownBound)) S.ownBound = lightnessAtValue({ a: S.recA, b: null, t: 0 }, B.capU, B.env)
  return S.ownBound
}

// One stroke made: its brush and colour (`lab0`, before the mix; `bound` the lightness it is held to when `held`), the path in B.path, B.width and B.world.
// `cell` names the stroke (the load it may begin, and its seed with `kk`), `draw` gives its brush's jitters.
function finishStroke(B: Brush, S: Stretch, kk: number, cell: number, draw: WorldDraw, lab0: Oklab, bound: number, alpha: number, held: boolean): void {
  const { rp, list, path, width, world } = B
  const beh = S.beh
  const load = rp.load * beh.loadMul * (0.9 + 0.2 * draw.next())
  const bristles = Math.max(1, Math.round(rp.bristles * draw.range(0.88, 1.12)))
  const jit0 = draw.gauss()
  const jit1 = draw.gauss()
  const seed = (cell ^ Math.imul(kk, 0x85ebca6b)) >>> 0
  let lab = B.mixer.mixByCell({ role: 'edge', cell: S.cell, u: S.uA, x: S.mx, y: S.my, lab: lab0, colormapped: false, seed, jit0, jit1 }).lab
  if (held) lab = holdLightness(lab, true, bound)
  const lin = oklabToLinear(lab)
  const e = list.push()
  list.role[e] = R_EDGE
  list.layer[e] = EDGE_LAYER
  for (let q = 0; q < 2 * P; q++) list.path[2 * P * e + q] = path[q]
  for (let q = 0; q < P; q++) list.width[P * e + q] = width[q]
  for (let q = 0; q < 3 * P; q++) list.worldPath[3 * P * e + q] = world[q]
  list.depth[e] = S.depth
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
  list.edge[e] = S.cl
  list.seed[e] = seed
  list.worldNormal[3 * e] = 0
  list.worldNormal[3 * e + 1] = 0
  list.worldNormal[3 * e + 2] = 0
  list.hidden[e] = HIDDEN_NA
  const stats = B.stats
  if (stats) {
    stats.strokes++
    stats.byClass[S.cl]++
  }
}

// A stroke ALONG the stretch: its screen polyline resampled to PATH_POINTS at equal arc length, the world points on the 3D polyline.
function alongStroke(B: Brush, S: Stretch, kk: number, cell: number, draw: WorldDraw, widthPx: number, lab0: Oklab, bound: number, alpha: number): void {
  const { run, a, b } = S
  const n = b - a + 1
  if (B.xs.length < n) {
    B.xs = new Float64Array(2 * n)
    B.ys = new Float64Array(2 * n)
    B.cum = new Float64Array(2 * n)
  }
  for (let s = a; s <= b; s++) {
    B.xs[s - a] = run.screen[2 * s]
    B.ys[s - a] = run.screen[2 * s + 1]
  }
  if (!(polylinePath(B.xs, B.ys, n, widthPx, true, false, B.path, B.width) > 1e-6)) return
  // the points are on the silhouette polyline, and the path is their projection (so that a world path and a path are one stroke)
  const { world, path, fc } = B
  alongWorld(run, a, b, world, B.cum)
  const vp = fc.vp
  for (let q = 0; q < P; q++) {
    const x = world[3 * q], y = world[3 * q + 1], z = world[3 * q + 2]
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15]
    if (w <= 1e-9) return
    path[2 * q] = (((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w + 1) / 2) * fc.W
    path[2 * q + 1] = ((1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) / 2) * fc.H
  }
  finishStroke(B, S, kk, cell, draw, lab0, bound, alpha, S.shadowSide)
  const stats = B.stats
  if (stats) {
    if (S.cl >= 2) stats.crisp++
    else stats.drags++
  }
}

// A stroke ACROSS the outline through sample `ii` along the screen direction (dx, dy), `len` px long (`from` of it behind the sample, `to` ahead): a decal
// in the plane of the sample's depth.
function acrossStroke(
  B: Brush, S: Stretch, kk: number, cell: number, draw: WorldDraw, ii: number, dx: number, dy: number, len: number, widthPx: number, lab0: Oklab, alpha: number, from: number, to: number,
): void {
  const { run } = S
  const { path, world, fc, right, up } = B
  const cx = run.screen[2 * ii]
  const cy = run.screen[2 * ii + 1]
  B.px2[0] = cx - dx * len * from
  B.px2[1] = cx + dx * len * to
  B.py2[0] = cy - dy * len * from
  B.py2[1] = cy + dy * len * to
  polylinePath(B.px2, B.py2, 2, widthPx, true, false, path, B.width)
  const wx = run.world[3 * ii], wy = run.world[3 * ii + 1], wz = run.world[3 * ii + 2]
  const inv = 1 / Math.max(1e-9, pxPerUnit(fc, wx, wy, wz))
  for (let q = 0; q < P; q++) {
    const ox = (path[2 * q] - cx) * inv
    const oy = (path[2 * q + 1] - cy) * inv
    world[3 * q] = wx + right[0] * ox - up[0] * oy
    world[3 * q + 1] = wy + right[1] * ox - up[1] * oy
    world[3 * q + 2] = wz + right[2] * ox - up[2] * oy
  }
  finishStroke(B, S, kk, cell, draw, lab0, S.shadowSide ? ownBoundOf(B, S) : 0, alpha, S.shadowSide)
}

// The strokes of the runs, appended to `list`: the bake's edge strokes (edgeStrokes.ts) of kind 1, built on the screen. Returns the count.
export function silhouetteStrokes(
  list: StrokeList, runs: SilhouetteRun[], params: PaintParams, view: PaintView, fc: FrameCtx, senv: SilhouetteEnv, stats?: SilhouetteStats,
): number {
  const rp = params.roles.edge
  const minContrast = params.detect.edgeMinContrast
  const { env, capU, floorU } = senv
  const canvas: ColourSource = [params.canvas.tone[0], params.canvas.tone[1], params.canvas.tone[2]]
  const maxSamples = Math.max(12, Math.round((3 * rp.length) / SILHOUETTE_STEP_PX))
  const before = list.count
  const B: Brush = {
    list, fc, env, capU, floorU, mixer: new LoadMixer(params), rp, right: [view.view[0], view.view[4], view.view[8]], up: [view.view[1], view.view[5], view.view[9]], stats,
    path: new Float32Array(2 * P), width: new Float32Array(P), world: new Float32Array(3 * P), xs: new Float64Array(64), ys: new Float64Array(64), cum: new Float64Array(64),
    px2: new Float64Array(2), py2: new Float64Array(2), lab: [0, 0, 0], loc: new Float64Array(3), draw: new WorldDraw(0, 0, 0), pdraw: new WorldDraw(0, 0, 0),
  }
  const S: Stretch = {
    run: runs[0], a: 0, b: 0, cl: 0, beh: behaviourOf(0), uA: 0, cell: 0, shadowSide: false, lighterIsA: false, recA: null as unknown as ColourRecipe, srcB: canvas, labA: null, labB: null,
    ownBound: Number.NaN, mx: 0, my: 0, depth: 0,
  }
  for (const run of runs) {
    if (run.contrast < minContrast) continue
    if (stats) stats.runs++
    S.run = run
    const kinds = stretchKinds(run, capU)
    const sites = lowestKeys(run.keys, CUT_WINDOW)
    for (const [a, b, cl0k, part] of cutRun(kinds, maxSamples, sites)) {
      if (b - a < MIN_STRETCH) continue
      const mid = Math.floor((a + b) / 2)
      // the stretch follows a site (the run's start where none is before it), whose cell names it: it is on the surface and not in the run, and a stretch
      // that slides along the outline as the kinds do keeps its site. Its strokes are told apart by the kind and the part, and by their places after the site.
      const k0 = siteBefore(sites, a)
      const first = k0 >= 0 ? sites[k0] : 0
      const cell = run.keys[first]
      const kkAlong = 0x1000 + cl0k + 16 * part
      // the role's density thins the strokes, by a draw of the name
      if (hash01(cell ^ Math.imul(kkAlong, 0x85ebca6b), params.seed, 0x5113c0de) >= rp.density) continue
      if (stats) stats.stretches++
      const rng = B.draw.at(run.world[3 * mid], run.world[3 * mid + 1], run.world[3 * mid + 2])
      let cl = cl0k & 3
      S.beh = behaviourOf(cl)
      S.a = a
      S.b = b
      // (the strokes of a stretch share a load: its own cell, from the site's cell, the kind and the part: the next stretch is another load, a fresh mix)
      S.cell = hash3(cell, kkAlong, 0x51c)
      S.uA = meanOver(run.uA, a, b)
      const uB = meanOver(run.uB, a, b)
      S.shadowSide = run.uMin[mid] <= capU
      const shadowEdge = S.shadowSide && run.uB[mid] >= floorU
      if (shadowEdge) cl = Math.max(cl, 2)
      S.cl = cl
      const uLo = Math.min(S.uA, uB)
      // the figure's local colour over the stretch
      const loc = B.loc
      loc[0] = loc[1] = loc[2] = 0
      for (let s = a; s <= b; s++) for (let c = 0; c < 3; c++) loc[c] += run.local[3 * s + c]
      for (let c = 0; c < 3; c++) loc[c] /= b - a + 1
      S.recA = sideRecipeOf(null, null, false, loc, S.uA, rng)
      // across the outline: the canvas where it is light, or the table in the figure's own cast shadow, as dark as it is there
      S.srcB = uB >= floorU ? canvas : groundRecipe(uB, rng)
      S.lighterIsA = S.uA >= uB
      S.labA = null
      S.labB = null
      S.ownBound = Number.NaN
      S.mx = run.screen[2 * mid]
      S.my = run.screen[2 * mid + 1]
      S.depth = run.depth[mid]

      if (cl >= 2) {
        // distinct: a crisp, loaded stroke along the edge, darker than the darker side
        const uE = Math.min(clamp(uLo - (cl === 3 ? 0.12 : 0.06), 0.1, 0.8), shadowEdge ? capU : 1)
        const colour: DraftColour = { a: sideRecipeOf(null, null, false, loc, uE, rng, 0.9), b: null, t: 0 }
        alongStroke(B, S, kkAlong, cell, rng, rp.width * (cl === 3 ? 0.7 : 0.475) * rng.range(0.88, 1.12), colourOfDraft(colour, env), S.shadowSide ? lightnessAtValue(colour, capU, env) : 0, cl === 3 ? 1 : 0.85)
      } else if (cl === 1) {
        // blended: a wide dragged stroke along the boundary, and short scumbled pulls from the lighter side into the darker, at the sites of the run
        alongStroke(B, S, kkAlong, cell, rng, rp.width * 2.6 * rng.range(0.88, 1.12), blendLab(B, S, true, 0.5), S.shadowSide ? ownBoundOf(B, S) : 0, 0.8)
        let made = 0
        let fallback = false
        for (let j = 0; ; j++) {
          // (every PULL_STEP samples after the site, half a step in; the stretch's middle when none falls in it)
          let ii = first + Math.round((j + 0.5) * PULL_STEP)
          if (ii > b - 2) {
            if (made > 0) break
            ii = mid
            fallback = true
          }
          if (ii < a + 2) continue
          // from the lighter side into the darker: out of the figure when it is the lighter, else into it (the normal points in)
          const sgn = S.lighterIsA ? -1 : 1
          const dir0x = sgn * run.nrm[2 * ii]
          const dir0y = sgn * run.nrm[2 * ii + 1]
          const pd = B.pdraw.at(run.world[3 * ii], run.world[3 * ii + 1], run.world[3 * ii + 2])
          const rot = pd.range(-0.35, 0.35)
          const dx = dir0x * Math.cos(rot) - dir0y * Math.sin(rot)
          const dy = dir0x * Math.sin(rot) + dir0y * Math.cos(rot)
          const len = rp.length * (22 / 30) * pd.range(0.8, 1.2)
          // (the lighter source's share is 0.7)
          acrossStroke(B, S, fallback ? 0x2000 + kkAlong : 1 + j, cell, pd, ii, dx, dy, len, rp.width * 1.9 * pd.range(0.88, 1.12), blendLab(B, S, S.lighterIsA, 0.3), 0.75, 0.45, 0.55)
          made++
          if (stats) stats.pulls++
          if (fallback) break
        }
      } else {
        // lost: a few strokes that bridge both sides, carrying one colour into the other
        let made = 0
        let fallback = false
        for (let j = 0; ; j++) {
          let ii = first + Math.round((j + 0.5) * PULL_STEP)
          if (ii > b - 2) {
            if (made > 0) break
            ii = mid
            fallback = true
          }
          if (ii < a + 2) continue
          const pd = B.pdraw.at(run.world[3 * ii], run.world[3 * ii + 1], run.world[3 * ii + 2])
          const len = rp.length * (26 / 30) * pd.range(0.85, 1.15)
          const rot = pd.range(-0.3, 0.3)
          const dx = -run.nrm[2 * ii] * Math.cos(rot) + run.nrm[2 * ii + 1] * Math.sin(rot)
          const dy = -run.nrm[2 * ii] * Math.sin(rot) - run.nrm[2 * ii + 1] * Math.cos(rot)
          acrossStroke(B, S, fallback ? 0x2000 + kkAlong : 1 + j, cell, pd, ii, dx, dy, len, rp.width * 1.8 * pd.range(0.88, 1.12), blendLab(B, S, true, 0.5), 0.6, 0.5, 0.5)
          made++
          if (stats) stats.bridges++
          if (fallback) break
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
